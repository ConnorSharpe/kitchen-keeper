import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';

// TASK-069 criterion 5 (last two failure-boundary bullets) end to end through the handler:
// a rejecting lexical candidate query, or a rejecting source join, surfaces to the model as
// { ok: false, error: 'search_unavailable' }. The service is real here (so the typed error it
// throws is whatever it actually throws); the database driver, OpenAI and the indexer are faked.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const dialect = new PgDialect();
const s = {};
function reset() {
  s.lexicalError = null;
  s.joinError = null;
  s.captured = [];
}
reset();
beforeEach(reset);

const rowsOf = (list) => Object.assign([...list], { rows: [...list], rowCount: list.length });
const candidate = {
  id: 1001,
  source_type: 'recipe',
  source_id: 1,
  sourceType: 'recipe',
  sourceId: 1,
  household_id: 5,
  content: 'c',
  occurred_at: '2026-09-12T10:00:00.000Z',
};

mock.module('../../../db/client.js', {
  namedExports: {
    db: {
      execute: async (q) => {
        const text = typeof q === 'string' ? q : dialect.sqlToQuery(q).sql;
        if (text.includes('<=>')) return rowsOf([candidate]);
        if (/websearch_to_tsquery/i.test(text)) {
          if (s.lexicalError) throw s.lexicalError;
          return rowsOf([candidate]);
        }
        if (s.joinError) throw s.joinError;
        return rowsOf([]);
      },
    },
  },
});

mock.module('../../retrieval/indexer.js', {
  namedExports: {
    reconcileHousehold: async () => ({ upserted: 0, deleted: 0, embedded: 0, pending: 0 }),
  },
});

mock.module('../../../instrument.js', {
  namedExports: {
    logServerEvent: () => {},
    captureExceptionSafely: (e) => s.captured.push(e),
    flush: async () => {},
  },
});

mock.module('openai', {
  defaultExport: class FakeOpenAI {
    constructor() {
      this.embeddings = {
        create: async ({ input }) => {
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

const { searchRecipesAndMeals } = await import('./searchRecipesAndMeals.js');

test('a rejecting lexical candidate query is reported as { ok: false, error: "search_unavailable" }', async () => {
  s.lexicalError = new Error('lexical query failed');
  const res = await searchRecipesAndMeals({ query: 'lemon' }, { householdId: 5 });
  assert.deepEqual(res, { ok: false, error: 'search_unavailable' });
});

test('a rejecting source join is reported as { ok: false, error: "search_unavailable" }', async () => {
  s.joinError = new Error('join failed');
  const res = await searchRecipesAndMeals({ query: 'lemon' }, { householdId: 5 });
  assert.deepEqual(res, { ok: false, error: 'search_unavailable' });
});
