import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// TASK-069 criterion 8. aiService.js constructs a DB client and an OpenAI client at import time
// (see aiService.contextCap.test.js), so placeholders are needed before importing it.
// The module must export PANTRY_TOOLS for this to be checkable (the spec's "snapshot" needs it).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const mod = await import('./aiService.js');

const tools = () => {
  assert.ok(Array.isArray(mod.PANTRY_TOOLS), 'aiService.js must export PANTRY_TOOLS');
  return mod.PANTRY_TOOLS;
};
const byName = (name) => tools().find((t) => t.function?.name === name);
const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

const EXPECTED_DESCRIPTION =
  "Search this household's saved recipes (full text, including ingredients and steps) and past meal logs. " +
  'Does not search chat conversations. Date filters are inclusive calendar dates (UTC); ' +
  'for recipes they filter by the date the recipe was saved.';

test('PANTRY_TOOLS contains search_recipes_and_meals as a function tool with the section 2.7 description', () => {
  const tool = byName('search_recipes_and_meals');
  assert.ok(tool, 'search_recipes_and_meals tool missing');
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.description, EXPECTED_DESCRIPTION);
});

test('search_recipes_and_meals parameters: query, source_types, date_from, date_to, limit; only query required', () => {
  const params = byName('search_recipes_and_meals').function.parameters;
  assert.equal(params.type, 'object');
  assert.deepEqual(Object.keys(params.properties).sort(), [
    'date_from',
    'date_to',
    'limit',
    'query',
    'source_types',
  ]);
  assert.deepEqual(params.required, ['query']);
});

test('search_recipes_and_meals schema bounds: query 1-500 chars, limit 1-10, dates are strings', () => {
  const { properties } = byName('search_recipes_and_meals').function.parameters;
  assert.equal(properties.query.type, 'string');
  assert.equal(properties.query.minLength, 1);
  assert.equal(properties.query.maxLength, 500);
  assert.ok(['integer', 'number'].includes(properties.limit.type));
  assert.equal(properties.limit.minimum, 1);
  assert.equal(properties.limit.maximum, 10);
  assert.equal(properties.date_from.type, 'string');
  assert.equal(properties.date_to.type, 'string');
});

test('search_recipes_and_meals source_types is limited to recipe and meal_log', () => {
  const st = byName('search_recipes_and_meals').function.parameters.properties.source_types;
  const values = st.items?.enum ?? st.enum;
  assert.deepEqual([...values].sort(), ['meal_log', 'recipe']);
});

test('the old search_history name is not used', () => {
  assert.equal(byName('search_history'), undefined);
});

test('PANTRY_TOOLS has exactly seven tools', () => {
  assert.equal(tools().length, 7);
});

// Snapshot of the six pre-existing tool definitions (sha256 of JSON.stringify of each entry,
// taken from the definitions as they stood before TASK-069).
const EXISTING = {
  add_pantry_item: '34557cc35eca125b56b09b21dfb304e161b50584cc394d1f032d4d9d6356ccd1',
  update_pantry_item: '15624317e3934a8fa6dea39ec823355b0943b9fdf7e4f1b1b1ceae5461115e0e',
  remove_pantry_item: 'cc62f0be2901026a23b8731f9d3d35b2ea879a5204772bcc0c47d8b1334984fb',
  consume_pantry_item: '2dbabfb2ef33eb5c6bbf6caa265fb903553e889a97899a3385072dc341dfe99f',
  suggest_recipes: 'eab06933aa51f015db4a8f71822ee091cb1aac38f4628d82e3ea5742a2f454fc',
  save_recipe: 'e3d7de2ae6febc352e8f441b9d09967ef2c02ed4fb3956c45d41b4fa77db4d34',
};

for (const [name, hash] of Object.entries(EXISTING)) {
  test(`existing tool ${name} is unchanged`, () => {
    const tool = byName(name);
    assert.ok(tool, `${name} missing`);
    assert.equal(sha(tool), hash);
  });
}
