import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getExpiryDays, getExpiryStatus } from './expiry.js';

describe('getExpiryDays', () => {
  test('returns null when no expiry date is set', () => {
    assert.equal(getExpiryDays(null), null);
    assert.equal(getExpiryDays(undefined), null);
    assert.equal(getExpiryDays(''), null);
  });

  test('returns 0 for an expiry date of today', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    assert.equal(getExpiryDays(today.toISOString()), 0);
  });

  test('returns a negative number for a past expiry date', () => {
    const past = new Date();
    past.setUTCHours(0, 0, 0, 0);
    past.setUTCDate(past.getUTCDate() - 3);
    assert.equal(getExpiryDays(past.toISOString()), -3);
  });

  test('returns a positive number for a future expiry date', () => {
    const future = new Date();
    future.setUTCHours(0, 0, 0, 0);
    future.setUTCDate(future.getUTCDate() + 5);
    assert.equal(getExpiryDays(future.toISOString()), 5);
  });
});

describe('getExpiryStatus', () => {
  function daysFromToday(n) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString();
  }

  test('returns "none" when no expiry date is set', () => {
    assert.equal(getExpiryStatus(null), 'none');
  });

  test('returns "expired" for a past expiry date', () => {
    assert.equal(getExpiryStatus(daysFromToday(-1)), 'expired');
  });

  test('returns "critical" within 2 days', () => {
    assert.equal(getExpiryStatus(daysFromToday(0)), 'critical');
    assert.equal(getExpiryStatus(daysFromToday(2)), 'critical');
  });

  test('returns "warning" within 3-7 days', () => {
    assert.equal(getExpiryStatus(daysFromToday(3)), 'warning');
    assert.equal(getExpiryStatus(daysFromToday(7)), 'warning');
  });

  test('returns "ok" beyond 7 days', () => {
    assert.equal(getExpiryStatus(daysFromToday(8)), 'ok');
  });
});
