import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiRateLimitKeyGenerator } from './aiRateLimitKeyGenerator.js';

test('keys by householdId when clerkAuth has populated req.user', () => {
  const req = { user: { householdId: 42 }, ip: '1.2.3.4' };
  assert.equal(aiRateLimitKeyGenerator(req), '42');
});

test('falls back to req.ip when req.user is absent', () => {
  const req = { user: undefined, ip: '1.2.3.4' };
  assert.equal(aiRateLimitKeyGenerator(req), '1.2.3.4');
});
