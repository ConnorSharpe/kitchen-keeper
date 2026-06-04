import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPurineLevel } from './purineIndex.js';

describe('getPurineLevel — low-purine cases', () => {
  test('"pear" → "low" (word boundary prevents "pea" match)', () =>
    assert.equal(getPurineLevel('pear', null), 'low'));
  test('"heart of palm" → "low" (PREPARATION_EXPANSIONS maps to "palm vegetable")', () =>
    assert.equal(getPurineLevel('heart of palm', null), 'low'));
  test('"apple" → "low"', () =>
    assert.equal(getPurineLevel('apple', null), 'low'));
});

describe('getPurineLevel — medium-purine cases', () => {
  test('"peas" → "medium" (normalizes to "pea" via PLURAL_FORMS)', () =>
    assert.equal(getPurineLevel('peas', null), 'medium'));
  test('"kidney bean" → "medium" (medium checked before high)', () =>
    assert.equal(getPurineLevel('kidney bean', null), 'medium'));
  test('"chicken" → "medium"', () =>
    assert.equal(getPurineLevel('chicken', null), 'medium'));
  test('unknown meat falls back to "medium" via category', () =>
    assert.equal(getPurineLevel('unknown meat', 'Meat'), 'medium'));
});

describe('getPurineLevel — high-purine cases', () => {
  test('"beef heart" → "high" (compound keyword match)', () =>
    assert.equal(getPurineLevel('beef heart', null), 'high'));
  test('"chicken heart" → "high"', () =>
    assert.equal(getPurineLevel('chicken heart', null), 'high'));
  test('"kidney" → "high" (organ meat, not legume)', () =>
    assert.equal(getPurineLevel('kidney', null), 'high'));
});
