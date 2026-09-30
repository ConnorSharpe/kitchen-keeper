import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql as dsql } from 'drizzle-orm';

// TASK-069 criteria 1 (drift guard), 4 (tenancy + failure isolation, the parts that do not
// need a real DB). The behavioural reconcile criteria (upsert selection, budget, priority
// order, pending accounting, conditional write, favorite-only) are proven against a real DB
// in server/test/db/reconcile.dbtest.js because the SQL seam is not specified by the spec.
//
// Assumption: the indexer reaches Postgres only through `db.execute(<drizzle sql template>)`
// from db/client.js, and reaches OpenAI only through the `openai` package.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const dialect = new PgDialect();
const state = { statements: [], mode: 'empty' };

function toQuery(q) {
  if (typeof q === 'string') return { text: q.replace(/\s+/g, ' '), params: [] };
  const { sql, params } = dialect.sqlToQuery(q);
  return { text: sql.replace(/\s+/g, ' '), params };
}

mock.module('../../db/client.js', {
  namedExports: {
    db: {
      execute: async (q) => {
        state.statements.push(toQuery(q));
        if (state.mode === 'fail') throw new Error('db down');
        return Object.assign([], { rows: [], rowCount: 0 });
      },
    },
  },
});

let embedCalls = 0;
mock.module('openai', {
  defaultExport: class FakeOpenAI {
    constructor() {
      this.embeddings = {
        create: async () => {
          embedCalls++;
          throw new Error('unexpected embeddings call');
        },
      };
    }
  },
});

const indexer = await import('./indexer.js');
const { RECIPE_BUILDER_FIELDS } = await import('./documents.js');

const norm = (s) => String(s).toLowerCase().replace(/_/g, '');

function fingerprintText() {
  let e = indexer.RECIPE_FINGERPRINT_SQL;
  if (typeof e === 'function') e = e('r');
  if (typeof e === 'string') return e.replace(/\s+/g, ' ');
  return toQuery(dsql`SELECT ${e}`).text;
}

// ---------- criterion 1: drift guard ----------

test('drift guard: RECIPE_BUILDER_FIELDS equals the fingerprint column set', () => {
  assert.ok(indexer.RECIPE_FINGERPRINT_COLUMNS, 'RECIPE_FINGERPRINT_COLUMNS must be exported');
  const builder = new Set([...RECIPE_BUILDER_FIELDS].map(norm));
  const fingerprint = new Set([...indexer.RECIPE_FINGERPRINT_COLUMNS].map(norm));
  assert.deepEqual([...builder].sort(), [...fingerprint].sort());
});

test('RECIPE_FINGERPRINT_SQL is the md5(json_build_array(...)::text) over exactly the builder columns', () => {
  const text = fingerprintText();
  assert.match(text, /md5\s*\(\s*json_build_array\s*\(/i);
  assert.match(text, /::\s*text/i);
  for (const col of ['name', 'description', 'tags', 'ingredients', 'steps', 'saved_at']) {
    assert.match(text, new RegExp(`\\b${col}\\b`), `fingerprint must cover ${col}`);
  }
  assert.doesNotMatch(text, /is_favorite/i, 'is_favorite must not be part of the fingerprint');
  assert.doesNotMatch(text, /updated_at/i, 'updated_at must not be part of the fingerprint');
});

// ---------- criterion 4: failure isolation ----------

test('reconcileHousehold resolves (does not throw) when the database fails, returning the four counters', async () => {
  state.mode = 'fail';
  state.statements = [];
  const result = await indexer.reconcileHousehold(42, { embedBudget: 25 });
  assert.equal(typeof result, 'object');
  for (const key of ['upserted', 'deleted', 'embedded', 'pending']) {
    assert.ok(key in result, `result must include ${key}`);
  }
});

// ---------- tenancy invariant (2.4) ----------

test('every statement reconcileHousehold issues is scoped to the household id', async () => {
  state.mode = 'empty';
  state.statements = [];
  await indexer.reconcileHousehold(42, { embedBudget: 25 });
  assert.ok(state.statements.length >= 2, 'expected at least the detect and orphan-GC statements');
  for (const s of state.statements) {
    assert.ok(
      s.params.some((p) => p === 42 || p === '42'),
      `statement is not household-scoped (no household id param): ${s.text.slice(0, 120)}`
    );
  }
});

test('reconcileHousehold garbage-collects orphans only via household-scoped DELETEs', async () => {
  state.mode = 'empty';
  state.statements = [];
  await indexer.reconcileHousehold(42, { embedBudget: 25 });
  const deletes = state.statements.filter((s) => /DELETE\s+FROM\s+search_documents/i.test(s.text));
  assert.ok(deletes.length >= 1, 'expected an orphan-GC DELETE');
  for (const d of deletes) {
    assert.match(d.text, /household_id/i);
    assert.ok(d.params.some((p) => p === 42 || p === '42'));
  }
});

test('with nothing to embed, reconcileHousehold makes no embeddings call', async () => {
  state.mode = 'empty';
  state.statements = [];
  embedCalls = 0;
  await indexer.reconcileHousehold(42, { embedBudget: 25 });
  assert.equal(embedCalls, 0);
});
