import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getExpiryDays, getExpiryStatus, getExpiringItems } from './expiry.js';

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

describe('getExpiringItems', () => {
  function daysFromToday(n) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString();
  }

  test('excludes items with no expiry date', () => {
    const items = [{ id: 1, expiryDate: null }];
    assert.deepEqual(getExpiringItems(items), []);
  });

  test('excludes already-expired items', () => {
    const items = [{ id: 1, expiryDate: daysFromToday(-1) }];
    assert.deepEqual(getExpiringItems(items), []);
  });

  test('excludes items beyond withinDays', () => {
    const items = [{ id: 1, expiryDate: daysFromToday(8) }];
    assert.deepEqual(getExpiringItems(items), []);
  });

  test('includes items within the default 7-day window', () => {
    const items = [
      { id: 1, expiryDate: daysFromToday(0) },
      { id: 2, expiryDate: daysFromToday(7) },
    ];
    assert.deepEqual(getExpiringItems(items), items);
  });

  test('respects a custom withinDays parameter', () => {
    const items = [
      { id: 1, expiryDate: daysFromToday(2) },
      { id: 2, expiryDate: daysFromToday(5) },
    ];
    assert.deepEqual(getExpiringItems(items, 3), [items[0]]);
  });
});
