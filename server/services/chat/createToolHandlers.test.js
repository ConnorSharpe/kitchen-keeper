import { test } from 'node:test';
import assert from 'node:assert/strict';

// TASK-069 spec 2.7 / section 3: createToolHandlers registers the new tool's handler next to
// the six existing ones. Handlers import services that build DB / OpenAI clients at load time.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const { createToolHandlers } = await import('./createToolHandlers.js');

test('createToolHandlers registers search_recipes_and_meals', () => {
  const handlers = createToolHandlers({ householdId: 1 });
  assert.equal(typeof handlers.search_recipes_and_meals, 'function');
});

test('createToolHandlers keeps the six existing handlers', () => {
  const handlers = createToolHandlers({ householdId: 1 });
  for (const name of [
    'add_pantry_item',
    'update_pantry_item',
    'remove_pantry_item',
    'consume_pantry_item',
    'suggest_recipes',
    'save_recipe',
  ]) {
    assert.equal(typeof handlers[name], 'function', `${name} handler missing`);
  }
});
