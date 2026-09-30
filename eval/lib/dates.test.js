import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, utcMidnight, daysAgoAt, rangeFromDaysAgo } from './dates.js';

const base = Date.UTC(2026, 8, 29);

test('DAY_MS is 86400000', () => {
  assert.equal(DAY_MS, 86400000);
});

test('utcMidnight returns 00:00Z of the UTC day', () => {
  assert.equal(utcMidnight(new Date('2026-09-29T23:59:59.999Z')), base);
});

test('utcMidnight of exact midnight is unchanged', () => {
  assert.equal(utcMidnight(new Date('2026-09-29T00:00:00.000Z')), base);
});

test('daysAgoAt defaults to 12:00Z', () => {
  assert.equal(daysAgoAt(base, 3), '2026-09-26T12:00:00.000Z');
});

test('daysAgoAt honors hourUtc', () => {
  assert.equal(daysAgoAt(base, 0, 0), '2026-09-29T00:00:00.000Z');
});

test('rangeFromDaysAgo(14, 0) gives half-open range', () => {
  const r = rangeFromDaysAgo(base, 14, 0);
  assert.ok(r.dateFrom instanceof Date);
  assert.ok(r.dateTo instanceof Date);
  assert.equal(r.dateFrom.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(r.dateTo.toISOString(), '2026-09-30T00:00:00.000Z');
});

test('rangeFromDaysAgo with no bounds is empty', () => {
  assert.deepEqual(rangeFromDaysAgo(base), {});
});

test('rangeFromDaysAgo with only from omits dateTo key', () => {
  const r = rangeFromDaysAgo(base, 7);
  assert.ok('dateFrom' in r);
  assert.equal('dateTo' in r, false);
});

test('rangeFromDaysAgo with only to omits dateFrom key', () => {
  const r = rangeFromDaysAgo(base, undefined, 2);
  assert.ok('dateTo' in r);
  assert.equal('dateFrom' in r, false);
  assert.equal(r.dateTo.toISOString(), '2026-09-28T00:00:00.000Z');
});

test('timestamps for days within [to, from] are inside the range', () => {
  const from = 10, to = 3;
  const { dateFrom, dateTo } = rangeFromDaysAgo(base, from, to);
  for (let d = to; d <= from; d++) {
    const t = new Date(daysAgoAt(base, d));
    assert.ok(t >= dateFrom && t < dateTo, `day ${d} should be inside`);
  }
});

test('timestamps just outside the bounds are excluded', () => {
  const from = 10, to = 3;
  const { dateFrom, dateTo } = rangeFromDaysAgo(base, from, to);
  const older = new Date(daysAgoAt(base, from + 1));
  const newer = new Date(daysAgoAt(base, to - 1));
  assert.ok(older < dateFrom);
  assert.ok(newer >= dateTo);
});
