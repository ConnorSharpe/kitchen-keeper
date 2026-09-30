import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recallAtK, reciprocalRankAtK, mean, nonemptyRate, percentile,
  distribution, histogram, normalizeForMatch, answerMatches,
} from './metrics.js';

test('recallAtK counts expected hits within first k', () => {
  assert.equal(recallAtK(['a', 'x', 'b'], ['a', 'b', 'c'], 2), 1 / 3);
});
test('recallAtK is 1 when all expected are in top k', () => {
  assert.equal(recallAtK(['a', 'b'], ['a', 'b'], 5), 1);
});
test('recallAtK returns null for empty expected', () => {
  assert.equal(recallAtK(['a'], [], 5), null);
});

test('reciprocalRankAtK uses rank of first hit', () => {
  assert.equal(reciprocalRankAtK(['x', 'y', 'b'], ['b'], 10), 1 / 3);
});
test('reciprocalRankAtK is 0 when hit is beyond k', () => {
  assert.equal(reciprocalRankAtK(['x', 'y', 'b'], ['b'], 2), 0);
});
test('reciprocalRankAtK returns null for empty expected', () => {
  assert.equal(reciprocalRankAtK(['x'], [], 10), null);
});

test('mean ignores nulls', () => {
  assert.equal(mean([1, null, 3]), 2);
});
test('mean returns null when no non-null values', () => {
  assert.equal(mean([null, null]), null);
  assert.equal(mean([]), null);
});

test('nonemptyRate is fraction of non-null counts > 0', () => {
  assert.equal(nonemptyRate([0, 3, null, 1]), 2 / 3);
});
test('nonemptyRate returns null when no non-null counts', () => {
  assert.equal(nonemptyRate([null]), null);
  assert.equal(nonemptyRate([]), null);
});

test('percentile interpolates between ranks', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
});
test('percentile of single value', () => {
  assert.equal(percentile([10], 90), 10);
});
test('percentile 0 and 100 give min and max of unsorted input', () => {
  assert.equal(percentile([3, 1, 2], 0), 1);
  assert.equal(percentile([3, 1, 2], 100), 3);
});
test('percentile returns null for empty input', () => {
  assert.equal(percentile([], 50), null);
});
test('percentile does not mutate input', () => {
  const v = [3, 1, 2];
  percentile(v, 50);
  assert.deepEqual(v, [3, 1, 2]);
});

test('distribution summarizes values', () => {
  const d = distribution([1, 2, 3, 4, 5]);
  assert.equal(d.n, 5);
  assert.equal(d.min, 1);
  assert.equal(d.p25, 2);
  assert.equal(d.p50, 3);
  assert.equal(d.p75, 4);
  assert.equal(d.max, 5);
  assert.ok(Math.abs(d.p10 - 1.4) < 1e-9);
  assert.ok(Math.abs(d.p90 - 4.6) < 1e-9);
});
test('distribution of empty input has nulls', () => {
  assert.deepEqual(distribution([]), {
    n: 0, min: null, p10: null, p25: null, p50: null, p75: null, p90: null, max: null,
  });
});

test('histogram includes zero-count buckets between min and max', () => {
  assert.deepEqual(histogram([0.12, 0.13, 0.26]), [
    { lo: 0.1, hi: 0.15, count: 2 },
    { lo: 0.15, hi: 0.2, count: 0 },
    { lo: 0.2, hi: 0.25, count: 0 },
    { lo: 0.25, hi: 0.3, count: 1 },
  ]);
});
test('histogram places boundary value in upper bucket', () => {
  assert.deepEqual(histogram([0.15]), [{ lo: 0.15, hi: 0.2, count: 1 }]);
});
test('histogram supports custom width', () => {
  assert.deepEqual(histogram([1, 2.5], 1), [
    { lo: 1, hi: 2, count: 1 },
    { lo: 2, hi: 3, count: 1 },
  ]);
});
test('histogram of empty input is empty', () => {
  assert.deepEqual(histogram([]), []);
});

test('normalizeForMatch strips diacritics and punctuation', () => {
  assert.equal(normalizeForMatch('Crème Brûlée!'), 'creme brulee');
});
test('normalizeForMatch deletes curly apostrophes', () => {
  assert.equal(normalizeForMatch('Nonna’s Ragù'), 'nonnas ragu');
});
test('normalizeForMatch collapses symbol runs', () => {
  assert.equal(normalizeForMatch('Mac & Cheese'), 'mac cheese');
});
test('normalizeForMatch deletes straight apostrophes', () => {
  assert.equal(normalizeForMatch("Za'atar"), 'zaatar');
});
test('normalizeForMatch maps null and undefined to empty string', () => {
  assert.equal(normalizeForMatch(null), '');
  assert.equal(normalizeForMatch(undefined), '');
});

test('answerMatches finds whole word candidate', () => {
  assert.equal(answerMatches('You saved Harira soup.', ['Harira']), true);
});
test('answerMatches rejects substring inside a word', () => {
  assert.equal(answerMatches('Try the chararira', ['harira']), false);
});
test('answerMatches matches after normalization', () => {
  assert.equal(answerMatches('Your crème brûlée recipe', ['Creme Brulee']), true);
});
test('answerMatches false for no candidates', () => {
  assert.equal(answerMatches('anything', []), false);
});
test('answerMatches never matches empty candidate', () => {
  assert.equal(answerMatches('x', ['']), false);
});
