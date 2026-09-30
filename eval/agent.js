// TASK-069 §2.8 agent eval: does the chat agent use search_recipes_and_meals when it should, and not
// when it shouldn't? Two arms (without / with the tool) × RUNS runs over golden + control queries.
//
// Usage (PowerShell):  $env:EVAL_ALLOW_DB_WRITES='local'; npm run eval:agent
// Local database only (guarded). Writes eval/results/agent-<date>.json. Makes real gpt-4o-mini calls.
//
// Arm "without" removes the tool from the tool list sent to the model (eval-process patch of
// OpenAIProvider.prototype.startChatSession). The system prompt is unchanged, so its one rule that
// names the tool is still present in that arm; recorded in the results doc.
// Every other tool gets a stub handler that refuses, so no eval chat can mutate pantry data.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadEvalEnv, serverModule, serverDependency, gitInfo, cacheStorage, writeResults } from './lib/runtime.js';
import { validateFixture } from './lib/fixtureCheck.js';
import { installEmbedCache } from './lib/embedCache.js';
import { utcMidnight } from './lib/dates.js';
import { mean, percentile, answerMatches } from './lib/metrics.js';
import { removeStaleEvalHouseholds, seedHousehold, runBackfill, teardownHousehold } from './lib/household.js';

const RUNS = 3;
const ARMS = ['without', 'with'];
const CONCURRENCY = 2; // 4 hit the org's 200k tokens/min limit on 2026-09-30
const MAX_ATTEMPTS = 6;
const SEARCH_TOOL = 'search_recipes_and_meals';
const CHAT_MODEL = 'gpt-4o-mini'; // hard-coded in aiService.chat / openaiProvider.streamMessage
const readJson = (p) => JSON.parse(readFileSync(path.join(REPO_ROOT, p), 'utf8'));

const fixture = readJson('eval/fixtures/household.json');
const golden = readJson('eval/fixtures/golden.json');
const problems = validateFixture(fixture, golden);
if (problems.length) {
  console.error(`eval: fixture invalid:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const { host } = await loadEvalEnv();
const { sql } = await serverDependency('drizzle-orm');
await serverModule('instrument.js');
const { db } = await serverModule('db/client.js');
const schema = await serverModule('db/schema.js');
const { reconcileHousehold } = await serverModule('services/retrieval/indexer.js');
const constants = await serverModule('services/retrieval/constants.js');
const { OpenAIProvider, EMBEDDING_MODEL } = await serverModule('services/ai/openaiProvider.js');
const { chat, PANTRY_TOOLS } = await serverModule('services/aiService.js');
const { searchRecipesAndMeals: searchHandler } = await serverModule('services/chat/handlers/searchRecipesAndMeals.js');

const cache = installEmbedCache(OpenAIProvider, { model: EMBEDDING_MODEL, ...cacheStorage });
const deps = { db, sql, schema, reconcileHousehold, BACKFILL_EMBED_BATCH: constants.BACKFILL_EMBED_BATCH };
const base = utcMidnight(new Date());
const log = (msg) => console.log(`eval:agent ${msg}`);
const round = (x, d = 4) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

// ---- Eval-process patches: tool removal per arm, per-chat token usage, quieter logs ----
const usageByRequest = new Map();
const toolRemovedFor = new Set();
const originalStart = OpenAIProvider.prototype.startChatSession;
OpenAIProvider.prototype.startChatSession = function startChatSession(opts) {
  const tools = toolRemovedFor.has(opts.requestId)
    ? opts.tools.filter((t) => t.function?.name !== SEARCH_TOOL)
    : opts.tools;
  return originalStart.call(this, { ...opts, tools });
};
const originalStream = OpenAIProvider.prototype.streamMessage;
OpenAIProvider.prototype.streamMessage = async function streamMessage(session, ...rest) {
  const response = await originalStream.call(this, session, ...rest);
  const u = usageByRequest.get(session.requestId);
  if (u) {
    u.calls += 1;
    u.prompt += response.usage?.prompt_tokens ?? 0;
    u.completion += response.usage?.completion_tokens ?? 0;
    u.cached += response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  }
  return response;
};
const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[kitchen-keeper]')) return;
  originalLog(...args);
};

async function runOne(job, ctx) {
  const requestId = `eval-${job.arm}-${job.run}-${job.q.id}`;
  const usage = { calls: 0, prompt: 0, completion: 0, cached: 0 };
  usageByRequest.set(requestId, usage);
  if (job.arm === 'without') toolRemovedFor.add(requestId);

  let toolCalls = [];
  let returnedKeys = [];
  const handlers = {};
  for (const t of PANTRY_TOOLS) {
    const name = t.function.name;
    handlers[name] = async () => {
      toolCalls.push(name);
      return { ok: false, error: 'This tool is disabled in the eval harness.' };
    };
  }
  handlers[SEARCH_TOOL] = async (args) => {
    toolCalls.push(SEARCH_TOOL);
    const out = await searchHandler(args, { householdId: ctx.householdId, requestId });
    for (const r of out.results ?? []) returnedKeys.push(ctx.keyOf(r));
    return out;
  };

  // Rate limits (429) are an API condition, not an eval outcome: back off and retry the whole chat
  // with fresh per-attempt state. A chat still failing after MAX_ATTEMPTS is excluded from the rates
  // and reported under `errors`, never scored as a wrong answer.
  let reply = null;
  let error = null;
  let latencyMs = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && reply === null; attempt++) {
    toolCalls = [];
    returnedKeys = [];
    Object.assign(usage, { calls: 0, prompt: 0, completion: 0, cached: 0 });
    const t0 = performance.now();
    try {
      ({ reply } = await chat(fixture.pantry, ctx.recipeSummary, job.q.history ?? [], job.q.message, handlers, '', requestId));
      latencyMs = performance.now() - t0;
    } catch (err) {
      error = err.message;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }

  const expectedKeys = job.q.expected.map((e) => e.key);
  const aliases = job.q.expected.flatMap((e) => e.aliases);
  const called = toolCalls.includes(SEARCH_TOOL);
  return {
    arm: job.arm, run: job.run, id: job.q.id, kind: job.q.kind,
    searchCalled: called,
    toolUseCorrect: job.q.kind === 'golden' ? called : !called,
    retrievalHit: job.q.kind === 'golden' ? returnedKeys.some((k) => expectedKeys.includes(k)) : null,
    answerMatch: job.q.kind === 'golden' && reply !== null ? answerMatches(reply, aliases) : null,
    toolCalls, returnedKeys: [...new Set(returnedKeys)],
    usage, latencyMs: latencyMs === null ? null : Math.round(latencyMs), error: reply === null ? error : null,
    reply,
  };
}

async function pool(jobs, worker) {
  const out = [];
  const queue = jobs.map((job, i) => ({ job, i }));
  const next = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      out[item.i] = await worker(item.job);
      if (out.filter(Boolean).length % 20 === 0) log(`${out.filter(Boolean).length}/${jobs.length} chats done`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return out;
}

function armSummary(allRows) {
  const rows = allRows.filter((r) => !r.error);
  const goldenRows = rows.filter((r) => r.kind === 'golden');
  const controlRows = rows.filter((r) => r.kind === 'control');
  const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
  const perRun = [];
  for (let run = 1; run <= RUNS; run++) {
    const g = goldenRows.filter((r) => r.run === run);
    const c = controlRows.filter((r) => r.run === run);
    perRun.push({
      run,
      toolUseCorrectness: round(rate([...g, ...c], (r) => r.toolUseCorrect)),
      retrievalCorrectness: round(rate(g, (r) => r.retrievalHit)),
      heuristicAnswerMatch: round(rate(g.filter((r) => r.answerMatch !== null), (r) => r.answerMatch)),
    });
  }
  const spread = (key) => {
    const v = perRun.map((p) => p[key]).filter((x) => x !== null);
    return v.length ? { mean: round(mean(v)), min: Math.min(...v), max: Math.max(...v) } : null;
  };
  return {
    chats: allRows.length, scored: rows.length, errors: allRows.length - rows.length,
    toolUseCorrectness: spread('toolUseCorrectness'),
    goldenCalledRate: round(rate(goldenRows, (r) => r.searchCalled)),
    controlNotCalledRate: round(rate(controlRows, (r) => !r.searchCalled)),
    retrievalCorrectness: spread('retrievalCorrectness'),
    heuristicAnswerMatch: spread('heuristicAnswerMatch'),
    tokensPerChat: {
      prompt: round(mean(rows.map((r) => r.usage.prompt)), 0),
      completion: round(mean(rows.map((r) => r.usage.completion)), 0),
      cachedPrompt: round(mean(rows.map((r) => r.usage.cached)), 0),
      modelCalls: round(mean(rows.map((r) => r.usage.calls)), 2),
    },
    latencyMs: { p50: Math.round(percentile(rows.map((r) => r.latencyMs), 50)), p95: Math.round(percentile(rows.map((r) => r.latencyMs), 95)) },
    perRun,
  };
}

await removeStaleEvalHouseholds(deps).then((n) => n && log(`removed ${n} stale eval household(s)`));
let householdId = null;
try {
  const seeded = await seedHousehold(deps, fixture, base);
  householdId = seeded.householdId;
  const backfill = await runBackfill(deps, householdId);
  cache.save();
  log(`host=${host} household=${householdId} docs=${backfill.docCount} pending=${backfill.pending}`);

  // Same shape the chat route builds: most recently saved first; chat() truncates at 150.
  const idByKey = seeded.idByKey;
  const recipeSummary = [...fixture.recipes]
    .sort((a, b) => a.savedDaysAgo - b.savedDaysAgo)
    .map((r) => ({ id: idByKey.get(r.key).source_id, name: r.name, tags: r.tags }));
  const ctx = {
    householdId,
    recipeSummary,
    keyOf: (r) => seeded.keyById.get(`${r.source_type}:${r.source_id}`) ?? `unknown:${r.source_type}:${r.source_id}`,
  };

  const jobs = [];
  for (const arm of ARMS) for (let run = 1; run <= RUNS; run++) for (const q of golden.agent) jobs.push({ arm, run, q });
  log(`running ${jobs.length} chats (${ARMS.length} arms × ${RUNS} runs × ${golden.agent.length} queries)`);
  const rows = await pool(jobs, (job) => runOne(job, ctx));
  cache.save();

  const arms = Object.fromEntries(ARMS.map((arm) => [arm, armSummary(rows.filter((r) => r.arm === arm))]));
  const results = {
    task: 'TASK-069', eval: 'agent', date: new Date().toISOString(), git: gitInfo(),
    models: { chat: CHAT_MODEL, embedding: EMBEDDING_MODEL }, host,
    design: {
      runs: RUNS, arms: ARMS, golden: golden.agent.filter((q) => q.kind === 'golden').length,
      controls: golden.agent.filter((q) => q.kind === 'control').length,
      recipesInFixture: fixture.recipes.length, recipeSummaryCap: 150,
      withoutArm: 'search tool removed from the tool list; system prompt unchanged',
    },
    arms,
    perChat: rows,
  };
  const file = writeResults('agent', results);
  log(`wrote ${path.relative(REPO_ROOT, file)}`);
  for (const arm of ARMS) {
    const a = arms[arm];
    log(`${arm.padEnd(7)} toolUse=${a.toolUseCorrectness?.mean} goldenCalled=${a.goldenCalledRate} controlNotCalled=${a.controlNotCalledRate} retrieval=${a.retrievalCorrectness?.mean} answerMatch=${a.heuristicAnswerMatch?.mean} errors=${a.errors}`);
  }
} finally {
  cache.save();
  if (householdId !== null) {
    await teardownHousehold(deps, householdId);
    log(`teardown: household ${householdId} deleted`);
  }
}
process.exit(0);
