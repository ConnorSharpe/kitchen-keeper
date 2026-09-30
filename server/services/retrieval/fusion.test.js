import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion, RRF_RANK_CONSTANT } from './fusion.js';

// TASK-069 criterion 3 (+ the RRF_RANK_CONSTANT export from criterion 5). Pure: nothing mocked.
//
// Input convention: each ranked list is an array of document keys (strings), best first.
// Output convention: an array of fused entries, best first, each exposing `score`, and its
// key as `id` or `key` (a bare string is also accepted for the key).

const keyOf = (e) => (typeof e === 'string' ? e : (e.id ?? e.key));
const keys = (out) => out.map(keyOf);
const scoreOf = (out, k) => out.find((e) => keyOf(e) === k).score;

test('RRF_RANK_CONSTANT is exported and equals 60', () => {
  assert.equal(RRF_RANK_CONSTANT, 60);
});

test('fuses [a,b,c] and [c,a,d] into a, c, b, d', () => {
  const out = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'a', 'd']], { rankConstant: 60 });
  assert.deepEqual(keys(out), ['a', 'c', 'b', 'd']);
});

test("a's fused score is 1/61 + 1/62", () => {
  const out = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'a', 'd']], { rankConstant: 60 });
  assert.ok(Math.abs(scoreOf(out, 'a') - (1 / 61 + 1 / 62)) < 1e-12);
});

test('a doc present in only one list is still returned', () => {
  const out = reciprocalRankFusion([['a'], ['b']], { rankConstant: 60 });
  assert.deepEqual(keys(out).sort(), ['a', 'b']);
});

test('a doc present in only one list scores 1/(rankConstant + rank)', () => {
  const out = reciprocalRankFusion([['a', 'b'], []], { rankConstant: 60 });
  assert.ok(Math.abs(scoreOf(out, 'b') - 1 / 62) < 1e-12);
});

test('equal scores break ties by first-seen order', () => {
  // a and b each get 1/61 + 1/62 (opposite orders), so they tie exactly.
  const out = reciprocalRankFusion([['a', 'b'], ['b', 'a']], { rankConstant: 60 });
  assert.deepEqual(keys(out), ['a', 'b']);
});

test('equal scores across disjoint lists keep first-seen order', () => {
  const out = reciprocalRankFusion([['x'], ['y']], { rankConstant: 60 });
  assert.deepEqual(keys(out), ['x', 'y']);
});

test('no lists returns an empty array', () => {
  assert.deepEqual(reciprocalRankFusion([], { rankConstant: 60 }), []);
});

test('only empty lists returns an empty array', () => {
  assert.deepEqual(reciprocalRankFusion([[], []], { rankConstant: 60 }), []);
});

test('the option is named rankConstant and changes the score', () => {
  const out = reciprocalRankFusion([['a']], { rankConstant: 10 });
  assert.ok(Math.abs(scoreOf(out, 'a') - 1 / 11) < 1e-12);
});

test('an unrelated option named k is not the rank constant', () => {
  const out = reciprocalRankFusion([['a']], { rankConstant: 60, k: 10 });
  assert.ok(Math.abs(scoreOf(out, 'a') - 1 / 61) < 1e-12);
});
