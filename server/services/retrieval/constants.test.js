import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as constants from './constants.js';

// TASK-069 spec 2.4 / 2.5: the named knobs live in constants.js. The RRF constant is named
// distinctly from the four count-like knobs.

test('CANDIDATE_LIMIT is 20', () => {
  assert.equal(constants.CANDIDATE_LIMIT, 20);
});

test('INTERACTIVE_EMBED_BUDGET is 25', () => {
  assert.equal(constants.INTERACTIVE_EMBED_BUDGET, 25);
});

test('BACKFILL_EMBED_BATCH is 100', () => {
  assert.equal(constants.BACKFILL_EMBED_BATCH, 100);
});

test('RRF_RANK_CONSTANT is 60', () => {
  assert.equal(constants.RRF_RANK_CONSTANT, 60);
});
