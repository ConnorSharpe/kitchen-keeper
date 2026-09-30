// TASK-069 §2.8 retrieval eval: lexical vs vector vs hybrid over one frozen index.
//
// Usage (PowerShell):  $env:EVAL_ALLOW_DB_WRITES='local'; npm run eval:retrieval
// Local database only (guarded). Writes eval/results/retrieval-<date>.json.
//
// Sequence: validate fixture → guard → seed → backfill to pending=0 → hash index state →
// quality pass (all modes, embedding cache on) → top-1 distances → re-hash (must be unchanged) →
// latency pass (cache off: real embedding calls) → cold-reconcile reps (mutates, so last) → teardown.
//
// Deviation from §2.8, recorded in the results doc: searchRecipesAndMeals always runs the interactive
// reconcile (budget 25) and has no embedBudget override. With pending=0 that reconcile embeds nothing;
// the frozen-index guarantee is enforced by asserting the index-state hash is identical before and
// after the measured passes instead of by passing embedBudget: 0.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, loadEvalEnv, serverModule, serverDependency, gitInfo, cacheStorage, installLogCapture, writeResults,
} from './lib/runtime.js';
import { validateFixture } from './lib/fixtureCheck.js';
import { installEmbedCache } from './lib/embedCache.js';
import { utcMidnight, rangeFromDaysAgo } from './lib/dates.js';
import { recallAtK, reciprocalRankAtK, mean, nonemptyRate, percentile, distribution, histogram } from './lib/metrics.js';
import { removeStaleEvalHouseholds, seedHousehold, runBackfill, indexStateHash, teardownHousehold } from './lib/household.js';

const MODES = ['lexical', 'vector', 'hybrid'];
const COLD_REPS = 10;
const EMBED_PRICE_PER_MILLION_USD = 0.02; // spec §8 G3 (fetched 2026-09-29)
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
const Sentry = await serverDependency('@sentry/node');
await serverModule('instrument.js');
const { db } = await serverModule('db/client.js');
const schema = await serverModule('db/schema.js');
const { reconcileHousehold } = await serverModule('services/retrieval/indexer.js');
const { searchRecipesAndMeals } = await serverModule('services/retrieval/searchService.js');
const constants = await serverModule('services/retrieval/constants.js');
const { OpenAIProvider, EMBEDDING_MODEL } = await serverModule('services/ai/openaiProvider.js');
const { resolveProvider } = await serverModule('services/ai/resolveProvider.js');

const cache = installEmbedCache(OpenAIProvider, { model: EMBEDDING_MODEL, ...cacheStorage });
const logs = installLogCapture(Sentry);
const deps = { db, sql, schema, reconcileHousehold, BACKFILL_EMBED_BATCH: constants.BACKFILL_EMBED_BATCH };
const base = utcMidnight(new Date());
const log = (msg) => console.log(`eval:retrieval ${msg}`);

const round = (x, d = 4) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const rowsOf = (res) => res?.rows ?? res ?? [];

function paramsFor(q, limit = 10) {
  return { query: q.query, sourceTypes: q.sourceTypes, ...rangeFromDaysAgo(base, q.dateFromDaysAgo, q.dateToDaysAgo), limit };
}

// Same filter semantics as searchService (sourceTypes, inclusive dateFrom, exclusive dateTo).
function filterSql({ sourceTypes, dateFrom, dateTo }) {
  const parts = [];
  if (sourceTypes?.length) {
    parts.push(sql` AND source_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(sourceTypes)}::jsonb))`);
  }
  if (dateFrom) parts.push(sql` AND occurred_at >= ${dateFrom.toISOString()}::timestamptz`);
  if (dateTo) parts.push(sql` AND occurred_at < ${dateTo.toISOString()}::timestamptz`);
  return sql.join(parts, sql``);
}

async function topDistance(householdId, vector, params) {
  const res = await db.execute(sql`
    SELECT embedding <=> ${`[${vector.join(',')}]`}::vector AS d
      FROM search_documents
     WHERE household_id = ${householdId}
       AND embedding IS NOT NULL AND embedding_model = ${EMBEDDING_MODEL} AND embedded_hash = content_hash
       ${filterSql(params)}
     ORDER BY d ASC LIMIT 1`);
  const row = rowsOf(res)[0];
  return row ? Number(row.d) : null;
}

async function timedSearch(householdId, params, mode) {
  const found = await searchRecipesAndMeals(householdId, params, mode ? { mode } : {});
  return { found, event: logs.last('retrieval-search') };
}

function latencyStats(values) {
  return { n: values.length, p50: round(percentile(values, 50), 1), p95: round(percentile(values, 95), 1) };
}

await removeStaleEvalHouseholds(deps).then((n) => n && log(`removed ${n} stale eval household(s)`));
let householdId = null;
try {
  log(`host=${host} seeding ${fixture.recipes.length} recipes + ${fixture.mealLogs.length} meal logs`);
  const seeded = await seedHousehold(deps, fixture, base);
  householdId = seeded.householdId;
  const keyOf = (r) => seeded.keyById.get(`${r.source_type}:${r.source_id}`) ?? `unknown:${r.source_type}:${r.source_id}`;

  const backfill = await runBackfill(deps, householdId);
  cache.save();
  const expectedDocs = fixture.recipes.length + fixture.mealLogs.length;
  if (backfill.pending !== 0 || backfill.docCount !== expectedDocs) {
    throw new Error(`identical-corpus check failed: pending=${backfill.pending} docCount=${backfill.docCount} expected=${expectedDocs}`);
  }
  const stateBefore = await indexStateHash(deps, householdId);
  log(`backfill done: ${backfill.passes.length} passes, docs=${backfill.docCount}, tokens=${backfill.tokens}; state=${stateBefore.hash}`);

  // ---- Quality pass (cache on; every mode against the same frozen index) ----
  const perQuery = [];
  for (const mode of MODES) {
    for (const q of golden.retrieval) {
      const { found, event } = await timedSearch(householdId, paramsFor(q), mode);
      const resultKeys = found.results.map(keyOf);
      const expectedKeys = q.expected.map((e) => e.key);
      perQuery.push({
        id: q.id, category: q.category, mode,
        recall5: recallAtK(resultKeys, expectedKeys, 5),
        rr10: reciprocalRankAtK(resultKeys, expectedKeys, 10),
        returned: found.results.length,
        vectorCandidates: event?.vectorCandidates ?? null,
        lexicalCandidates: event?.lexicalCandidates ?? null,
        top5: resultKeys.slice(0, 5),
      });
    }
    log(`quality pass: ${mode} done`);
  }

  // ---- Top-1 cosine distance (same filters as the query) ----
  const provider = resolveProvider();
  const distances = [];
  for (const q of golden.retrieval) {
    const [vector] = await provider.embed([q.query]);
    distances.push({ id: q.id, category: q.category, d: await topDistance(householdId, vector, paramsFor(q)) });
  }
  cache.save();

  const stateAfterQuality = await indexStateHash(deps, householdId);
  if (stateAfterQuality.hash !== stateBefore.hash) {
    throw new Error(`mode-comparison invariant violated: index changed during measurement (${stateBefore.hash} → ${stateAfterQuality.hash})`);
  }

  // ---- Latency pass (cache off: real query embeddings) ----
  cache.enabled = false;
  const latency = { searchMs: {}, queryEmbedMs: [], steadyTotalMs: [], cold: [] };
  for (const mode of MODES) {
    latency.searchMs[mode] = [];
    for (const q of golden.retrieval) {
      const { event } = await timedSearch(householdId, paramsFor(q), mode);
      latency.searchMs[mode].push(event.searchMs);
      if (mode === 'hybrid') latency.steadyTotalMs.push(event.reconcileMs + event.searchMs);
    }
  }
  for (const q of golden.retrieval) {
    const t0 = performance.now();
    await provider.embed([q.query]);
    latency.queryEmbedMs.push(performance.now() - t0);
  }
  const stateAfterLatency = await indexStateHash(deps, householdId);
  if (stateAfterLatency.hash !== stateBefore.hash) {
    throw new Error('index changed during the steady-state latency pass');
  }

  // ---- Cold reconcile: 25 changed recipes pending, then one search (mutates the index; runs last) ----
  const coldIds = seeded.recipeRows
    .filter((r) => seeded.keyById.get(`recipe:${r.id}`).startsWith('filler_'))
    .slice(0, constants.INTERACTIVE_EMBED_BUDGET)
    .map((r) => r.id);
  for (let rep = 1; rep <= COLD_REPS; rep++) {
    await db.execute(sql`
      UPDATE recipes SET description = description || ${` (cold rep ${rep})`}
       WHERE household_id = ${householdId}
         AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(coldIds)}::jsonb)::int)`);
    const { event } = await timedSearch(householdId, paramsFor(golden.retrieval[0]));
    latency.cold.push({
      reconcileMs: event.reconcileMs, searchMs: event.searchMs, totalMs: event.reconcileMs + event.searchMs,
      pendingAfter: event.pending, reconcileEmbed: event.reconcileEmbed, mode: event.mode,
    });
  }
  log('latency passes done');

  // ---- Aggregate ----
  const summarize = (rows) => {
    const pos = rows.filter((r) => r.category !== 'negative');
    const neg = rows.filter((r) => r.category === 'negative');
    return {
      recall5: round(mean(pos.map((r) => r.recall5))),
      mrr10: round(mean(pos.map((r) => r.rr10))),
      n: pos.length,
      negatives: {
        n: neg.length,
        final_returned_nonempty_rate: round(nonemptyRate(neg.map((r) => r.returned))),
        vector_candidate_nonempty_rate: round(nonemptyRate(neg.map((r) => r.vectorCandidates))),
      },
    };
  };
  const categories = [...new Set(golden.retrieval.map((q) => q.category))];
  const quality = {};
  for (const mode of MODES) {
    const rows = perQuery.filter((r) => r.mode === mode);
    quality[mode] = { overall: summarize(rows), byCategory: {} };
    for (const c of categories.filter((c) => c !== 'negative')) {
      const cr = rows.filter((r) => r.category === c);
      quality[mode].byCategory[c] = { n: cr.length, recall5: round(mean(cr.map((r) => r.recall5))), mrr10: round(mean(cr.map((r) => r.rr10))) };
    }
  }
  const distOf = (rows) => {
    const values = rows.map((r) => r.d).filter((d) => d !== null);
    const dist = distribution(values);
    return { ...Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, k === 'n' ? v : round(v)])), histogram: histogram(values, 0.05) };
  };
  const distanceReport = {
    negative: distOf(distances.filter((r) => r.category === 'negative')),
    positive_all: distOf(distances.filter((r) => r.category !== 'negative')),
    positive_byCategory: Object.fromEntries(
      categories.filter((c) => c !== 'negative').map((c) => [c, distOf(distances.filter((r) => r.category === c))])
    ),
  };

  const results = {
    task: 'TASK-069', eval: 'retrieval', date: new Date().toISOString(), git: gitInfo(),
    models: { embedding: EMBEDDING_MODEL }, host,
    config: {
      CANDIDATE_LIMIT: constants.CANDIDATE_LIMIT, RRF_RANK_CONSTANT: constants.RRF_RANK_CONSTANT,
      INTERACTIVE_EMBED_BUDGET: constants.INTERACTIVE_EMBED_BUDGET, BACKFILL_EMBED_BATCH: constants.BACKFILL_EMBED_BATCH,
      searchLimit: 10,
    },
    corpus: { recipes: fixture.recipes.length, mealLogs: fixture.mealLogs.length, docs: backfill.docCount, queries: golden.retrieval.length },
    backfill: {
      passes: backfill.passes.length, tokens: backfill.tokens,
      costUsd: round((backfill.tokens / 1e6) * EMBED_PRICE_PER_MILLION_USD, 6), pricePerMillionUsd: EMBED_PRICE_PER_MILLION_USD,
    },
    invariants: { stateHash: stateBefore.hash, unchangedAfterQuality: true, unchangedAfterSteadyLatency: true, pendingBeforeMeasurement: 0 },
    quality,
    distances: distanceReport,
    latency: {
      searchMs: Object.fromEntries(MODES.map((m) => [m, latencyStats(latency.searchMs[m])])),
      queryEmbedMs: latencyStats(latency.queryEmbedMs),
      withReconcile_steady_0pending: latencyStats(latency.steadyTotalMs),
      withReconcile_cold_25pending: { ...latencyStats(latency.cold.map((c) => c.totalMs)), reconcileMs: latencyStats(latency.cold.map((c) => c.reconcileMs)), reps: latency.cold },
    },
    embedCache: cache.stats,
    perQuery,
    distancesPerQuery: distances.map((r) => ({ ...r, d: round(r.d) })),
  };
  const file = writeResults('retrieval', results);
  log(`wrote ${path.relative(REPO_ROOT, file)}`);
  for (const mode of MODES) {
    const o = quality[mode].overall;
    log(`${mode.padEnd(7)} recall@5=${o.recall5} MRR@10=${o.mrr10} neg_nonempty=${o.negatives.final_returned_nonempty_rate}`);
  }
} finally {
  cache.save();
  if (householdId !== null) {
    await teardownHousehold(deps, householdId);
    log(`teardown: household ${householdId} deleted`);
  }
}
process.exit(0);
