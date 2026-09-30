import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';

// TASK-069 criterion 5. True externals are faked: the database driver (db.execute), the OpenAI
// network client (`openai` package) and the telemetry sink. The indexer is faked too, because
// its own behaviour is covered elsewhere and criterion 5 needs it to throw / report on demand.
// Pure code (fusion, constants) runs for real.
//
// Assumptions this file makes about the seam (the spec does not pin them down):
//  - all SQL goes through `db.execute(<drizzle sql template>)` from db/client.js;
//  - the vector candidate query is the only statement containing `<=>`, the lexical candidate
//    query is the only statement containing `websearch_to_tsquery`, and any other statement
//    is the source join;
//  - the service resolves to `{ mode, results }`, results carrying source_type / source_id.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const dialect = new PgDialect();

function toQuery(q) {
  if (typeof q === 'string') return { text: q.replace(/\s+/g, ' '), params: [] };
  const { sql, params } = dialect.sqlToQuery(q);
  return { text: sql.replace(/\s+/g, ' '), params };
}

const rowsOf = (list) => Object.assign([...list], { rows: [...list], rowCount: list.length });

const s = {};
function reset() {
  s.statements = [];
  s.vector = [];
  s.lexical = [];
  s.joinRows = [];
  s.vectorError = null;
  s.lexicalError = null;
  s.joinError = null;
  s.queryEmbedError = null;
  s.reconcileError = null;
  s.reconcileResult = { upserted: 0, deleted: 0, embedded: 0, pending: 0 };
  s.reconcileCalls = [];
  s.events = [];
}
reset();
beforeEach(reset);

mock.module('../../db/client.js', {
  namedExports: {
    db: {
      execute: async (q) => {
        const stmt = toQuery(q);
        s.statements.push(stmt);
        if (stmt.text.includes('<=>')) {
          if (s.vectorError) throw s.vectorError;
          return rowsOf(s.vector);
        }
        if (/websearch_to_tsquery/i.test(stmt.text)) {
          if (s.lexicalError) throw s.lexicalError;
          return rowsOf(s.lexical);
        }
        if (s.joinError) throw s.joinError;
        return rowsOf(s.joinRows);
      },
    },
  },
});

mock.module('./indexer.js', {
  namedExports: {
    reconcileHousehold: async (...args) => {
      s.reconcileCalls.push(args);
      if (s.reconcileError) throw s.reconcileError;
      return s.reconcileResult;
    },
  },
});

mock.module('../../instrument.js', {
  namedExports: {
    logServerEvent: (tag, data) => s.events.push({ tag, data }),
    captureExceptionSafely: () => {},
    flush: async () => {},
  },
});

mock.module('openai', {
  defaultExport: class FakeOpenAI {
    constructor() {
      this.embeddings = {
        create: async ({ input }) => {
          if (s.queryEmbedError) throw s.queryEmbedError;
          const inputs = Array.isArray(input) ? input : [input];
          return {
            data: inputs.map((_, index) => ({ index, embedding: Array(1536).fill(0.01) })),
            usage: { prompt_tokens: inputs.length },
          };
        },
      };
    }
  },
});

const { searchRecipesAndMeals } = await import('./searchService.js');
const { RRF_RANK_CONSTANT } = await import('./fusion.js');

// ---------- fixtures ----------

let docSeq = 1000;
const cand = (type, id) => ({
  id: ++docSeq,
  source_type: type,
  source_id: id,
  sourceType: type,
  sourceId: id,
  household_id: 7,
  householdId: 7,
  content: `content of ${type} ${id}`,
  occurred_at: '2026-09-12T10:00:00.000Z',
  occurredAt: '2026-09-12T10:00:00.000Z',
});

const src = (type, id) => ({
  id,
  source_type: type,
  source_id: id,
  sourceType: type,
  sourceId: id,
  title: `Title ${id}`,
  name: `Title ${id}`,
  item_name: `Title ${id}`,
  itemName: `Title ${id}`,
  content: `content of ${type} ${id}`,
  snippet: `content of ${type} ${id}`,
  occurred_at: '2026-09-12T10:00:00.000Z',
  occurredAt: '2026-09-12T10:00:00.000Z',
  saved_at: '2026-09-12T10:00:00.000Z',
  savedAt: '2026-09-12T10:00:00.000Z',
  logged_at: '2026-09-12T10:00:00.000Z',
  loggedAt: '2026-09-12T10:00:00.000Z',
});

const recipeIds = (res) => res.results.filter((r) => (r.source_type ?? r.sourceType) === 'recipe').map((r) => r.source_id ?? r.sourceId);
const allIds = (res) => res.results.map((r) => r.source_id ?? r.sourceId);

const vectorStmt = () => s.statements.find((x) => x.text.includes('<=>'));
const lexicalStmt = () => s.statements.find((x) => /websearch_to_tsquery/i.test(x.text));

// ---------- degradation: query embedding ----------

test('when the query embedding fails it returns mode lexical_only with lexical results and does not throw', async () => {
  s.queryEmbedError = new Error('openai down');
  s.lexical = [cand('recipe', 3), cand('recipe', 1)];
  s.joinRows = [src('recipe', 1), src('recipe', 3)]; // join order differs from rank order
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'lexical_only');
  assert.deepEqual(allIds(res), [3, 1]);
});

test('when the query embedding fails the vector candidate query is not run', async () => {
  s.queryEmbedError = new Error('openai down');
  s.lexical = [cand('recipe', 3)];
  s.joinRows = [src('recipe', 3)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(vectorStmt(), undefined);
});

// ---------- mode table ----------

test('query embed ok but reconcile embed failed (partially embedded index) is still mode hybrid', async () => {
  s.reconcileResult = { upserted: 0, deleted: 0, embedded: 0, pending: 25 };
  s.lexical = [cand('recipe', 1)];
  s.vector = [];
  s.joinRows = [src('recipe', 1)];
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'hybrid');
  assert.deepEqual(allIds(res), [1]);
});

test('query embed ok with zero vector candidates is mode hybrid and results equal lexical order', async () => {
  s.lexical = [cand('recipe', 3), cand('recipe', 1), cand('recipe', 2)];
  s.vector = [];
  s.joinRows = [src('recipe', 1), src('recipe', 2), src('recipe', 3)];
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'hybrid');
  assert.deepEqual(allIds(res), [3, 1, 2]);
});

test('with both candidate lists non-empty the mode is hybrid and a doc ranked in both lists comes first', async () => {
  s.lexical = [cand('recipe', 1), cand('recipe', 2)];
  s.vector = [cand('recipe', 3), cand('recipe', 2)];
  s.joinRows = [src('recipe', 1), src('recipe', 2), src('recipe', 3)];
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'hybrid');
  assert.equal(allIds(res)[0], 2);
});

// ---------- failure boundary ----------

test('reconcileHousehold throwing while the query embed succeeds still gives hybrid with results', async () => {
  s.reconcileError = new Error('reconcile exploded');
  s.lexical = [cand('recipe', 1)];
  s.vector = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'hybrid');
  assert.deepEqual(allIds(res), [1]);
});

test('a rejecting vector candidate query degrades to lexical_only with lexical results', async () => {
  s.vectorError = new Error('vector query failed');
  s.lexical = [cand('recipe', 2), cand('recipe', 1)];
  s.joinRows = [src('recipe', 1), src('recipe', 2)];
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.mode, 'lexical_only');
  assert.deepEqual(allIds(res), [2, 1]);
});

test('a rejecting lexical candidate query makes the service throw', async () => {
  s.lexicalError = new Error('lexical query failed');
  s.vector = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await assert.rejects(() => searchRecipesAndMeals(7, { query: 'lemon' }, {}), Error);
});

test('a rejecting source join makes the service throw', async () => {
  s.joinError = new Error('join failed');
  s.lexical = [cand('recipe', 1)];
  s.vector = [cand('recipe', 1)];
  await assert.rejects(() => searchRecipesAndMeals(7, { query: 'lemon' }, {}), Error);
});

// ---------- source join / limit ----------

test('results whose source no longer exists are dropped', async () => {
  s.lexical = [cand('recipe', 3), cand('recipe', 1), cand('recipe', 2)];
  s.joinRows = [src('recipe', 1), src('recipe', 3)]; // recipe 2 was deleted
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.deepEqual(allIds(res), [3, 1]);
});

test('limit is respected', async () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  s.lexical = ids.map((i) => cand('recipe', i));
  s.joinRows = ids.map((i) => src('recipe', i));
  const res = await searchRecipesAndMeals(7, { query: 'lemon', limit: 3 }, {});
  assert.equal(res.results.length, 3);
  assert.deepEqual(recipeIds(res), [1, 2, 3]);
});

test('limit defaults to 5', async () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  s.lexical = ids.map((i) => cand('recipe', i));
  s.joinRows = ids.map((i) => src('recipe', i));
  const res = await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(res.results.length, 5);
});

// ---------- captured query text ----------

test('both candidate queries include a deterministic id ASC tie-break', async () => {
  s.lexical = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.match(vectorStmt().text, /\bid\s+ASC\b/i, 'vector query needs an id ASC tie-break');
  assert.match(lexicalStmt().text, /\bid\s+ASC\b/i, 'lexical query needs an id ASC tie-break');
});

test('the vector candidate query filters to embedded, current-model, non-stale rows', async () => {
  s.lexical = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  const text = vectorStmt().text;
  assert.match(text, /embedding\s+IS\s+NOT\s+NULL/i);
  assert.match(text, /embedding_model\s*=/i);
  assert.match(text, /embedded_hash\s*=\s*(\w+\.)?content_hash/i);
});

test('the vector candidate query orders by cosine distance', async () => {
  s.lexical = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.match(vectorStmt().text, /ORDER\s+BY\s+.*<=>/i);
});

test('date range filters are applied inside both candidate queries', async () => {
  s.lexical = [cand('meal_log', 1)];
  s.joinRows = [src('meal_log', 1)];
  await searchRecipesAndMeals(
    7,
    {
      query: 'salmon',
      dateFrom: new Date('2026-09-12T00:00:00.000Z'),
      dateTo: new Date('2026-09-13T00:00:00.000Z'),
    },
    {}
  );
  for (const [label, stmt] of [['vector', vectorStmt()], ['lexical', lexicalStmt()]]) {
    assert.match(stmt.text, /occurred_at\s*>=/i, `${label} query lacks the lower date bound`);
    assert.match(stmt.text, /occurred_at\s*</i, `${label} query lacks the exclusive upper date bound`);
    const params = JSON.stringify(stmt.params);
    assert.ok(params.includes('2026-09-12'), `${label} query lacks the from date param`);
    assert.ok(params.includes('2026-09-13'), `${label} query lacks the to date param`);
  }
});

test('the source-type filter is applied inside both candidate queries', async () => {
  s.lexical = [cand('meal_log', 1)];
  s.joinRows = [src('meal_log', 1)];
  await searchRecipesAndMeals(7, { query: 'salmon', sourceTypes: ['meal_log'] }, {});
  for (const [label, stmt] of [['vector', vectorStmt()], ['lexical', lexicalStmt()]]) {
    const haystack = `${stmt.text} ${JSON.stringify(stmt.params)}`;
    assert.ok(haystack.includes('meal_log'), `${label} query does not filter on the source type`);
  }
});

// ---------- tenancy / orchestration ----------

test('every statement the search issues is scoped to the caller household', async () => {
  s.lexical = [cand('recipe', 1)];
  s.vector = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.ok(s.statements.length >= 3, 'expected vector, lexical and join statements');
  for (const stmt of s.statements) {
    assert.ok(
      stmt.params.some((p) => p === 7 || p === '7'),
      `statement is not household-scoped: ${stmt.text.slice(0, 120)}`
    );
  }
});

test('search reconciles the household first with the interactive embed budget of 25', async () => {
  s.lexical = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  assert.equal(s.reconcileCalls.length, 1);
  assert.equal(s.reconcileCalls[0][0], 7);
  assert.equal(s.reconcileCalls[0][1].embedBudget, 25);
});

test('search emits a flat retrieval-search event with mode, reconcileMs and searchMs', async () => {
  s.lexical = [cand('recipe', 1)];
  s.joinRows = [src('recipe', 1)];
  await searchRecipesAndMeals(7, { query: 'lemon' }, {});
  const ev = s.events.find((e) => e.tag === 'retrieval-search');
  assert.ok(ev, 'a retrieval-search event must be logged');
  assert.equal(ev.data.mode, 'hybrid');
  assert.equal(typeof ev.data.reconcileMs, 'number');
  assert.equal(typeof ev.data.searchMs, 'number');
  for (const [k, v] of Object.entries(ev.data)) {
    assert.ok(
      v === null || ['string', 'number', 'boolean'].includes(typeof v),
      `event field ${k} must be a flat primitive`
    );
  }
  assert.ok(!('householdId' in ev.data) && !('household_id' in ev.data), 'no household identifier is logged');
});

test('the RRF rank constant used by search is the exported 60', () => {
  assert.equal(RRF_RANK_CONSTANT, 60);
});
