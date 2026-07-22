import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPE_SOURCES } from './recipeSources.js';

test('RECIPE_SOURCES includes every source the app writes, including url_import', () => {
  for (const source of [
    'upload',
    'ai_suggested',
    'web_suggested',
    'manual',
    'url_import',
  ]) {
    assert.ok(RECIPE_SOURCES.includes(source), `missing source: ${source}`);
  }
});
