import { test } from 'node:test';
import assert from 'node:assert/strict';

// aiService.js constructs DB and OpenAI clients at import time, so placeholders are needed first.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const mod = await import('./aiService.js');

const searchProps = () => {
  assert.ok(Array.isArray(mod.PANTRY_TOOLS), 'aiService.js must export PANTRY_TOOLS');
  const tool = mod.PANTRY_TOOLS.find((t) => t.function?.name === 'search_recipes_and_meals');
  assert.ok(tool, 'search_recipes_and_meals tool must exist');
  return tool.function.parameters.properties;
};

const GUIDANCE =
  'Omit unless the user names a specific date or time period. Do not set it for "when did I last…" or other all-time questions.';

test('search_recipes_and_meals date_from tells the model to omit it unless a period is named', () => {
  assert.equal(
    searchProps().date_from.description,
    `Optional inclusive start date, YYYY-MM-DD (UTC). ${GUIDANCE}`
  );
});

test('search_recipes_and_meals date_to tells the model to omit it unless a period is named', () => {
  assert.equal(
    searchProps().date_to.description,
    `Optional inclusive end date, YYYY-MM-DD (UTC). ${GUIDANCE}`
  );
});
