import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// TASK-069 criterion 7. The retrieval service is faked at its module boundary (it owns the
// database and OpenAI); the handler's own validation and mapping run for real.
//
// Assumptions the spec leaves open: the handler is the named export `searchRecipesAndMeals(args, ctx)`
// (like its sibling handlers); it calls `searchRecipesAndMeals(householdId, { query, sourceTypes,
// dateFrom, dateTo, limit })` on the service; dateFrom / dateTo are Date objects or ISO strings
// (compared here via Date) with dateTo the EXCLUSIVE upper bound; `source_types` is an array.

const s = {};
function reset() {
  s.calls = [];
  s.result = { mode: 'hybrid', results: [] };
  s.error = null;
  s.captured = [];
}
reset();
beforeEach(reset);

mock.module('../../retrieval/searchService.js', {
  namedExports: {
    searchRecipesAndMeals: async (...args) => {
      s.calls.push(args);
      if (s.error) throw s.error;
      return s.result;
    },
  },
});

mock.module('../../../instrument.js', {
  namedExports: {
    logServerEvent: () => {},
    captureExceptionSafely: (e) => s.captured.push(e),
    flush: async () => {},
  },
});

const { searchRecipesAndMeals } = await import('./searchRecipesAndMeals.js');

const ctx = { householdId: 5 };
const iso = (d) => new Date(d).toISOString();

// ---------- validation ----------

test('rejects an empty query with { ok: false } and does not call the service', async () => {
  const res = await searchRecipesAndMeals({ query: '' }, ctx);
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

test('rejects a query over 500 chars', async () => {
  const res = await searchRecipesAndMeals({ query: 'x'.repeat(501) }, ctx);
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

test('accepts a query of exactly 500 chars', async () => {
  const res = await searchRecipesAndMeals({ query: 'x'.repeat(500) }, ctx);
  assert.equal(res.ok, true);
});

test('rejects limit 0', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', limit: 0 }, ctx);
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

test('rejects limit 11', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', limit: 11 }, ctx);
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

test('accepts limit 10', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', limit: 10 }, ctx);
  assert.equal(res.ok, true);
  assert.equal(s.calls[0][1].limit, 10);
});

test('rejects an unknown source_types value', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', source_types: ['chat'] }, ctx);
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

test('accepts source_types recipe and meal_log and passes them to the service', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', source_types: ['recipe', 'meal_log'] }, ctx);
  assert.equal(res.ok, true);
  assert.deepEqual([...s.calls[0][1].sourceTypes].sort(), ['meal_log', 'recipe']);
});

// ---------- tenancy ----------

test('always uses ctx.householdId', async () => {
  await searchRecipesAndMeals({ query: 'lemon' }, ctx);
  assert.equal(s.calls[0][0], 5);
});

test('ignores a model-supplied household_id in the args', async () => {
  const res = await searchRecipesAndMeals({ query: 'lemon', household_id: 999 }, ctx);
  assert.equal(res.ok, true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0], 5);
});

// ---------- date contract ----------

test('a single-day range is passed as the half-open UTC interval [day 00:00Z, next day 00:00Z)', async () => {
  await searchRecipesAndMeals({ query: 'salmon', date_from: '2026-09-12', date_to: '2026-09-12' }, ctx);
  const opts = s.calls[0][1];
  assert.equal(iso(opts.dateFrom), '2026-09-12T00:00:00.000Z');
  assert.equal(iso(opts.dateTo), '2026-09-13T00:00:00.000Z');
});

test('date_to 2026-12-31 rolls over to an exclusive bound of 2027-01-01T00:00:00Z', async () => {
  await searchRecipesAndMeals({ query: 'salmon', date_to: '2026-12-31' }, ctx);
  assert.equal(iso(s.calls[0][1].dateTo), '2027-01-01T00:00:00.000Z');
});

test('a from-only bound is accepted and leaves the upper bound open', async () => {
  const res = await searchRecipesAndMeals({ query: 'salmon', date_from: '2026-09-12' }, ctx);
  assert.equal(res.ok, true);
  assert.equal(iso(s.calls[0][1].dateFrom), '2026-09-12T00:00:00.000Z');
  assert.ok(s.calls[0][1].dateTo == null, 'dateTo should be unset');
});

test('a to-only bound is accepted and leaves the lower bound open', async () => {
  const res = await searchRecipesAndMeals({ query: 'salmon', date_to: '2026-09-12' }, ctx);
  assert.equal(res.ok, true);
  assert.equal(iso(s.calls[0][1].dateTo), '2026-09-13T00:00:00.000Z');
  assert.ok(s.calls[0][1].dateFrom == null, 'dateFrom should be unset');
});

for (const bad of ['2026-02-30', '2026-9-12', '12/09/2026']) {
  test(`rejects date_from ${bad}`, async () => {
    const res = await searchRecipesAndMeals({ query: 'salmon', date_from: bad }, ctx);
    assert.equal(res.ok, false);
    assert.equal(s.calls.length, 0);
  });

  test(`rejects date_to ${bad}`, async () => {
    const res = await searchRecipesAndMeals({ query: 'salmon', date_to: bad }, ctx);
    assert.equal(res.ok, false);
    assert.equal(s.calls.length, 0);
  });
}

test('rejects date_from later than date_to', async () => {
  const res = await searchRecipesAndMeals(
    { query: 'salmon', date_from: '2026-09-13', date_to: '2026-09-12' },
    ctx
  );
  assert.equal(res.ok, false);
  assert.equal(s.calls.length, 0);
});

// ---------- results / errors ----------

test('a service throw maps to { ok: false, error } and is captured', async () => {
  s.error = new Error('boom');
  const res = await searchRecipesAndMeals({ query: 'lemon' }, ctx);
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
  assert.ok(res.error.length > 0);
  assert.equal(s.captured.length, 1);
});

test('result items contain only the documented fields, snippets are <= 300 chars', async () => {
  s.result = {
    mode: 'hybrid',
    results: [
      {
        source_type: 'recipe',
        source_id: 11,
        sourceType: 'recipe',
        sourceId: 11,
        title: 'Lemon Chicken',
        name: 'Lemon Chicken',
        snippet: 'y'.repeat(1000),
        content: 'y'.repeat(1000),
        occurred_at: '2026-03-01T10:00:00.000Z',
        occurredAt: '2026-03-01T10:00:00.000Z',
        household_id: 5,
        embedding: [0.1, 0.2],
        content_hash: 'abc',
        score: 0.03,
      },
    ],
  };
  const res = await searchRecipesAndMeals({ query: 'lemon' }, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'hybrid');
  assert.equal(res.results.length, 1);
  assert.deepEqual(Object.keys(res.results[0]).sort(), [
    'occurred_at',
    'snippet',
    'source_id',
    'source_type',
    'title',
  ]);
  assert.equal(res.results[0].source_id, 11);
  assert.equal(res.results[0].source_type, 'recipe');
  assert.equal(res.results[0].title, 'Lemon Chicken');
  assert.ok(res.results[0].snippet.length <= 300);
});
