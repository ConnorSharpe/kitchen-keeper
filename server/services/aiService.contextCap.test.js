import { test } from 'node:test';
import assert from 'node:assert/strict';

// Same rationale as aiService.schemas.test.js: aiService.js constructs a DB
// client and an OpenAI client at module load time, both of which throw if
// their env vars are unset. buildPantrySummary/buildRecipeSummary are pure
// and never touch either, but the module-level throw would still fire on
// import without these placeholders.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const { buildPantrySummary, buildRecipeSummary, CHAT_CONTEXT_LIMITS } = await import(
  './aiService.js'
);

function pantryItem(id, status) {
  return { id, name: `item-${id}`, category: 'Misc', qty: '1', status, frozen: false };
}

function recipeItem(id) {
  return { id, name: `recipe-${id}`, tags: [] };
}

// --- buildPantrySummary ---

test('buildPantrySummary: under cap returns the same array, same order, untruncated', () => {
  const input = [pantryItem(1, 'ok'), pantryItem(2, 'expired'), pantryItem(3, 'warning')];
  const result = buildPantrySummary(input, 10);
  assert.deepEqual(result.items, input);
  assert.equal(result.truncated, false);
  assert.equal(result.omittedCount, 0);
});

test('buildPantrySummary: over cap sorts by urgency and truncates', () => {
  const input = [
    pantryItem(1, 'ok'),
    pantryItem(2, 'expired'),
    pantryItem(3, 'warning'),
    pantryItem(4, 'critical'),
    pantryItem(5, 'none'),
  ];
  const result = buildPantrySummary(input, 3);
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    result.items.map((i) => i.status),
    ['expired', 'critical', 'warning']
  );
  assert.equal(result.truncated, true);
  assert.equal(result.omittedCount, 2);
});

// --- buildRecipeSummary ---

test('buildRecipeSummary: under cap returns the same array, same order, untruncated', () => {
  const input = [recipeItem(1), recipeItem(2), recipeItem(3)];
  const result = buildRecipeSummary(input, 10);
  assert.deepEqual(result.items, input);
  assert.equal(result.truncated, false);
  assert.equal(result.omittedCount, 0);
});

test('buildRecipeSummary: over cap truncates without re-sorting (preserves original order)', () => {
  const input = [recipeItem(1), recipeItem(2), recipeItem(3), recipeItem(4), recipeItem(5)];
  const result = buildRecipeSummary(input, 3);
  assert.deepEqual(
    result.items.map((i) => i.id),
    [1, 2, 3]
  );
  assert.equal(result.truncated, true);
  assert.equal(result.omittedCount, 2);
});

// --- Stability regression (DRAFT-2 review, D-8) ---

test('buildPantrySummary: same-urgency items keep their original relative order (stable sort)', () => {
  const warningA = { id: 1, name: 'A', status: 'warning' };
  const expiredB = { id: 2, name: 'B', status: 'expired' };
  const warningC = { id: 3, name: 'C', status: 'warning' };
  const expiredD = { id: 4, name: 'D', status: 'expired' };
  // A trailing lowest-priority padding item forces truncation (cap=4, length=5)
  // while guaranteeing the 4 signal items above are exactly what survives the
  // slice — isolating the assertion to stable-sort order, not which items drop.
  const padding = { id: 5, name: 'padding', status: 'none' };
  const input = [warningA, expiredB, warningC, expiredD, padding];

  const result = buildPantrySummary(input, 4);
  assert.deepEqual(result.items, [expiredB, expiredD, warningA, warningC]);
  assert.equal(result.truncated, true);
  assert.equal(result.omittedCount, 1);
});

// --- Custom max parameter ---

test('buildPantrySummary: accepts an explicit max distinct from the default', () => {
  const input = [pantryItem(1, 'ok'), pantryItem(2, 'expired')];
  const result = buildPantrySummary(input, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'expired');
  assert.equal(result.truncated, true);
});

test('buildRecipeSummary: accepts an explicit max distinct from the default', () => {
  const input = [recipeItem(1), recipeItem(2)];
  const result = buildRecipeSummary(input, 1);
  assert.deepEqual(result.items, [recipeItem(1)]);
  assert.equal(result.truncated, true);
});

test('CHAT_CONTEXT_LIMITS: exposes the default pantry/recipe caps used when max is omitted', () => {
  assert.equal(CHAT_CONTEXT_LIMITS.pantry, 150);
  assert.equal(CHAT_CONTEXT_LIMITS.recipes, 150);
});
