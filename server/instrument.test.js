import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// TASK-069 criterion 6a (spec 2.11). Only the Sentry SDK is faked, by stubbing the underlying
// operation (Sentry.logger.info), never the wrapper under test.

const s = { calls: [], impl: null };
beforeEach(() => {
  s.calls = [];
  s.impl = null;
});

mock.module('@sentry/node', {
  namedExports: {
    init: () => {},
    captureException: () => {},
    flush: async () => true,
    logger: {
      info: (...args) => {
        s.calls.push(args);
        return s.impl ? s.impl(...args) : undefined;
      },
    },
  },
});

const instrument = await import('./instrument.js');

const attrsOf = (call) => call.find((a, i) => i > 0 && a && typeof a === 'object');

test('logServerEvent forwards string, number, boolean and null fields under the given tag', () => {
  instrument.logServerEvent('retrieval-test', { s: 'text', n: 42, b: true, z: null });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0], 'retrieval-test');
  assert.deepEqual(attrsOf(s.calls[0]), { s: 'text', n: 42, b: true, z: null });
});

test('logServerEvent truncates an oversized string field', () => {
  const big = 'x'.repeat(10000);
  instrument.logServerEvent('retrieval-test', { big });
  const forwarded = attrsOf(s.calls[0]).big;
  assert.equal(typeof forwarded, 'string');
  assert.ok(forwarded.length > 0 && forwarded.length < big.length, `length was ${forwarded.length}`);
  assert.ok(big.startsWith(forwarded));
});

test('logServerEvent drops nested objects and arrays but keeps the flat fields', () => {
  instrument.logServerEvent('retrieval-test', {
    keep: 'yes',
    nested: { a: 1 },
    list: [1, 2, 3],
    count: 3,
  });
  const attrs = attrsOf(s.calls[0]);
  assert.equal(attrs.keep, 'yes');
  assert.equal(attrs.count, 3);
  assert.ok(!('nested' in attrs), 'nested object must be dropped');
  assert.ok(!('list' in attrs), 'array must be dropped');
});

test('logServerEvent does not throw when the Sentry logger throws synchronously', () => {
  s.impl = () => {
    throw new Error('sdk exploded');
  };
  assert.doesNotThrow(() => instrument.logServerEvent('retrieval-test', { a: 1 }));
});

test('logServerEvent absorbs a rejected promise from the Sentry logger', async () => {
  s.impl = () => Promise.reject(new Error('sdk rejected'));
  assert.doesNotThrow(() => instrument.logServerEvent('retrieval-test', { a: 1 }));
  // Give an unhandled rejection the chance to surface (it would fail the test run).
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('logServerEvent returns without a rejecting promise', async () => {
  s.impl = () => Promise.reject(new Error('sdk rejected'));
  const out = instrument.logServerEvent('retrieval-test', { a: 1 });
  await assert.doesNotReject(async () => out);
});
