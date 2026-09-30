import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildRecipeDocument,
  buildMealLogDocument,
  RECIPE_BUILDER_FIELDS,
} from './documents.js';

// TASK-069 criteria 1 and 2. Pure builders: nothing is mocked.
//
// Input convention used by these tests: a recipe is the raw stored row, so
// ingredients / steps / tags are the JSON text stored in the DB (schema.js:
// `ingredients` JSON [{name, quantity, unit}], `steps` JSON string[], `tags` JSON string[]).
// Scalar columns are supplied under both their snake_case and camelCase spellings so the
// tests do not depend on which one the builder reads.

function withAliases(r) {
  return {
    ...r,
    householdId: r.household_id,
    savedAt: r.saved_at,
    updatedAt: r.updated_at,
    isFavorite: r.is_favorite,
  };
}

function recipe(overrides = {}) {
  return withAliases({
    id: 1,
    household_id: 1,
    name: 'Lemon Chicken',
    description: 'Bright weeknight dinner',
    tags: JSON.stringify(['dinner', 'chicken']),
    ingredients: JSON.stringify([
      { name: 'chicken thighs', quantity: '4', unit: 'pieces' },
      { name: 'lemon', quantity: '2', unit: 'whole' },
    ]),
    steps: JSON.stringify(['Season the chicken.', 'Roast for 35 minutes.']),
    saved_at: '2026-03-01T10:00:00.000Z',
    updated_at: '2026-05-05T12:30:00.000Z',
    is_favorite: false,
    ...overrides,
  });
}

function mealLog(overrides = {}) {
  const base = {
    id: 1,
    household_id: 1,
    item_name: 'Salmon fillet',
    category: 'Meat & Fish',
    was_expiring: true,
    logged_at: '2026-09-12T18:30:00.000Z',
    ...overrides,
  };
  return {
    ...base,
    itemName: base.item_name,
    wasExpiring: base.was_expiring,
    loggedAt: base.logged_at,
    householdId: base.household_id,
  };
}

const norm = (s) => String(s).toLowerCase().replace(/_/g, '');

// ---------- criterion 1: content ----------

test('buildRecipeDocument: a normal recipe includes name, tags, description, every ingredient line and steps', () => {
  const { content } = buildRecipeDocument(recipe());
  assert.match(content, /^Recipe: Lemon Chicken/m);
  assert.match(content, /^Tags: .*dinner.*chicken/m);
  assert.ok(content.includes('Bright weeknight dinner'));
  assert.ok(content.includes('chicken thighs — 4 pieces'));
  assert.ok(content.includes('lemon — 2 whole'));
  assert.ok(content.includes('Season the chicken.'));
  assert.ok(content.includes('Roast for 35 minutes.'));
});

test('buildRecipeDocument: identical input twice gives identical content and contentHash', () => {
  const a = buildRecipeDocument(recipe());
  const b = buildRecipeDocument(recipe());
  assert.equal(a.content, b.content);
  assert.equal(a.contentHash, b.contentHash);
});

test('buildRecipeDocument: contentHash is the sha256 hex digest of content', () => {
  const { content, contentHash } = buildRecipeDocument(recipe());
  assert.equal(contentHash, createHash('sha256').update(content).digest('hex'));
});

test('buildRecipeDocument: toggling isFavorite does not change contentHash', () => {
  const off = buildRecipeDocument(recipe({ is_favorite: false }));
  const on = buildRecipeDocument(recipe({ is_favorite: true }));
  assert.equal(off.contentHash, on.contentHash);
  assert.equal(off.content, on.content);
});

test('buildRecipeDocument: changing updated_at alone does not change contentHash', () => {
  const a = buildRecipeDocument(recipe({ updated_at: '2026-05-05T12:30:00.000Z' }));
  const b = buildRecipeDocument(recipe({ updated_at: '2026-06-06T01:00:00.000Z' }));
  assert.equal(a.contentHash, b.contentHash);
});

// ---------- criterion 1: occurredAt ----------

test('buildRecipeDocument: occurredAt equals saved_at, not updated_at', () => {
  const { occurredAt } = buildRecipeDocument(
    recipe({ saved_at: '2026-03-01T10:00:00.000Z', updated_at: '2026-05-05T12:30:00.000Z' })
  );
  assert.equal(new Date(occurredAt).toISOString(), '2026-03-01T10:00:00.000Z');
});

test('buildMealLogDocument: occurredAt equals logged_at', () => {
  const { occurredAt } = buildMealLogDocument(mealLog({ logged_at: '2026-09-12T18:30:00.000Z' }));
  assert.equal(new Date(occurredAt).toISOString(), '2026-09-12T18:30:00.000Z');
});

// ---------- criterion 1: drift guard (builder side) ----------

test('RECIPE_BUILDER_FIELDS is exactly the six builder-input columns and excludes is_favorite / updated_at', () => {
  assert.ok(RECIPE_BUILDER_FIELDS, 'RECIPE_BUILDER_FIELDS must be exported');
  const fields = new Set([...RECIPE_BUILDER_FIELDS].map(norm));
  assert.deepEqual(
    [...fields].sort(),
    ['description', 'ingredients', 'name', 'savedat', 'steps', 'tags']
  );
});

// ---------- criterion 1: length ceiling ----------

const words = (n, w = 'lorem') => Array.from({ length: n }, () => w).join(' ');

function extremeRecipes() {
  const manyIngredients = Array.from({ length: 2000 }, (_, i) => ({
    name: `ing-${String(i).padStart(4, '0')}`,
    quantity: '1',
    unit: 'cup',
  }));
  const manyTags = Array.from({ length: 700 }, (_, i) => `tag${i}`); // ~5k chars
  const bigSteps = Array.from({ length: 10 }, (_, i) => `S${i} ${words(1000)}`); // ~50k chars
  return {
    'name of 10k chars': recipe({ name: words(2000) }),
    'name of 10k chars with no whitespace': recipe({ name: 'x'.repeat(10000) }),
    'tag list of ~5k chars': recipe({ tags: JSON.stringify(manyTags) }),
    '2000 ingredients': recipe({ ingredients: JSON.stringify(manyIngredients) }),
    'steps of ~50k chars': recipe({ steps: JSON.stringify(bigSteps) }),
    'everything extreme at once': recipe({
      name: words(2000),
      description: words(3000),
      tags: JSON.stringify(manyTags),
      ingredients: JSON.stringify(manyIngredients),
      steps: JSON.stringify(bigSteps),
    }),
  };
}

for (const [label, r] of Object.entries(extremeRecipes())) {
  test(`buildRecipeDocument: content.length <= 8000 for ${label}`, () => {
    const { content } = buildRecipeDocument(r);
    assert.ok(content.length <= 8000, `content was ${content.length} chars`);
  });

  test(`buildRecipeDocument: Recipe: and Tags: lines are present for ${label}`, () => {
    const { content } = buildRecipeDocument(r);
    assert.match(content, /^Recipe: /m);
    assert.match(content, /^Tags:/m);
  });
}

// ---------- criterion 1: field caps ----------

test('buildRecipeDocument: a 300-char name is cut to <= 200 chars ending in an ellipsis', () => {
  const longName = words(60, 'alphab').slice(0, 300); // 300 chars, whitespace-separated words
  assert.equal(longName.length, 300);
  const { content } = buildRecipeDocument(recipe({ name: longName }));
  const line = content.split('\n').find((l) => l.startsWith('Recipe: '));
  const shownName = line.slice('Recipe: '.length);
  assert.ok(shownName.length <= 200, `name was ${shownName.length} chars`);
  assert.ok(shownName.endsWith('…'), `name should end with an ellipsis: ${shownName.slice(-10)}`);
});

test('buildRecipeDocument: tags are kept whole, in order, up to 500 chars', () => {
  const tags = Array.from({ length: 100 }, (_, i) => `tag-${String(i).padStart(3, '0')}`);
  const { content } = buildRecipeDocument(recipe({ tags: JSON.stringify(tags) }));
  const line = content.split('\n').find((l) => l.startsWith('Tags:'));
  const body = line.slice('Tags:'.length).trim();
  assert.ok(body.length <= 500, `tag text was ${body.length} chars`);
  const present = body.match(/tag-\d+/g) ?? [];
  assert.ok(present.length > 0 && present.length < 100, `kept ${present.length} tags`);
  // whole tags only (no half-cut tag), and a prefix of the input order
  assert.deepEqual(present, tags.slice(0, present.length));
});

// ---------- criterion 1: budget ordering ----------

test('buildRecipeDocument: when only steps overflow, every ingredient line is kept and steps are cut', () => {
  const ingredients = Array.from({ length: 10 }, (_, i) => ({
    name: `ingredient${i}`,
    quantity: '2',
    unit: 'tbsp',
  }));
  const step = (i) => `S${i}MARK ${words(998)}`; // ~5000 chars each
  const { content } = buildRecipeDocument(
    recipe({
      description: 'DESCMARK short description',
      ingredients: JSON.stringify(ingredients),
      steps: JSON.stringify([step(1), step(2), step(3)]),
    })
  );
  assert.ok(content.length <= 8000);
  assert.ok(content.includes('DESCMARK'), 'description should survive when only steps overflow');
  for (const ing of ingredients) {
    assert.ok(content.includes(`${ing.name} — 2 tbsp`), `missing ingredient line for ${ing.name}`);
  }
  assert.ok(content.includes(step(1)), 'the first step fits whole and is included');
  assert.ok(content.includes('S2MARK'), 'the first step that does not fit is included, cut');
  assert.ok(!content.includes('S3MARK'), 'no step after the cut one is included');
  assert.ok(content.includes('…'), 'the cut step is marked with an ellipsis');
});

test('buildRecipeDocument: when ingredients alone overflow, description is dropped and ingredients become names only (all names kept when names fit)', () => {
  // 200 ingredients whose full lines total > 8000 chars but whose names alone are small.
  const ingredients = Array.from({ length: 200 }, (_, i) => ({
    name: `ing-${String(i).padStart(3, '0')}`,
    quantity: 'QTY'.repeat(10),
    unit: 'UNITWORD',
  }));
  const { content } = buildRecipeDocument(
    recipe({
      description: 'DESCMARK a description',
      ingredients: JSON.stringify(ingredients),
      steps: JSON.stringify(['S1MARK do the thing.']),
    })
  );
  assert.ok(content.length <= 8000);
  assert.ok(!content.includes('DESCMARK'), 'description is dropped first');
  assert.ok(!content.includes('QTYQTY'), 'ingredient quantities are dropped (names only)');
  assert.ok(!content.includes('UNITWORD'), 'ingredient units are dropped (names only)');
  assert.ok(!content.includes('S1MARK'), 'no steps fit');
  for (const ing of ingredients) {
    assert.ok(content.includes(ing.name), `ingredient name ${ing.name} should be kept`);
  }
  assert.ok(!/\(\+\d+ more ingredients\)/.test(content), 'no suffix when every name fits');
});

test('buildRecipeDocument: when even names overflow, output ends in "(+N more ingredients)" with the correct N', () => {
  const total = 2000;
  const ingredients = Array.from({ length: total }, (_, i) => ({
    name: `ing-${String(i).padStart(4, '0')}`,
    quantity: '1',
    unit: 'cup',
  }));
  const { content } = buildRecipeDocument(
    recipe({
      description: 'DESCMARK a description',
      ingredients: JSON.stringify(ingredients),
      steps: JSON.stringify(['S1MARK do the thing.']),
    })
  );
  assert.ok(content.length <= 8000);
  assert.ok(!content.includes('DESCMARK'));
  assert.ok(!content.includes('S1MARK'));
  const suffix = content.trimEnd().match(/\(\+(\d+) more ingredients\)$/);
  assert.ok(suffix, `content should end with the suffix, ends with: ${content.slice(-60)}`);
  const n = Number(suffix[1]);
  const kept = content.match(/ing-\d{4}/g) ?? [];
  assert.ok(n > 0);
  assert.equal(kept.length + n, total, 'kept names + N must account for every ingredient');
  // kept names are whole and in original order
  assert.deepEqual(
    kept,
    ingredients.slice(0, kept.length).map((i) => i.name)
  );
});

// ---------- criterion 2: meal logs ----------

test('buildMealLogDocument: includes item name, category and the ISO date', () => {
  const { content } = buildMealLogDocument(mealLog());
  assert.ok(content.includes('Salmon fillet'));
  assert.ok(content.includes('Meat & Fish'));
  assert.ok(content.includes('2026-09-12'));
});

test('buildMealLogDocument: wasExpiring null renders "unknown"', () => {
  const { content } = buildMealLogDocument(mealLog({ was_expiring: null }));
  assert.match(content, /Was expiring: unknown/);
});

test('buildMealLogDocument: wasExpiring true renders "yes"', () => {
  const { content } = buildMealLogDocument(mealLog({ was_expiring: true }));
  assert.match(content, /Was expiring: yes/);
});

test('buildMealLogDocument: is deterministic and contentHash is sha256 of content', () => {
  const a = buildMealLogDocument(mealLog());
  const b = buildMealLogDocument(mealLog());
  assert.equal(a.content, b.content);
  assert.equal(a.contentHash, createHash('sha256').update(a.content).digest('hex'));
});
