import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mocks the underlying Sentry SDK operation, not our own safeSentryLog()/logEvent() wrapper —
// registered before debugLog.js (which transitively imports the real ../instrument.js) is ever
// imported, so every test below exercises the real wrapper against a controllable SDK call.
// See ai/tasks/TASK-068-spec.md Section 2.3a/criterion 10 for why this is the correct boundary.
const sentryLogMock = { mode: 'ok' };
mock.module('@sentry/react', {
  namedExports: {
    init: () => {},
    logger: {
      info: () => {
        if (sentryLogMock.mode === 'throw') throw new Error('sync SDK failure');
        if (sentryLogMock.mode === 'reject') return Promise.reject(new Error('async SDK failure'));
        return undefined;
      },
    },
  },
});

const { validateTelemetryShape, logEvent } = await import('./debugLog.js');

test('validateTelemetryShape passes through ordinary payload shapes unchanged', () => {
  const { tag, data } = validateTelemetryShape('auth-settled', {
    settleReason: 'timeout',
    settleElapsedMs: 42,
    settleFinalIsSignedIn: true,
    navigationType: null,
  });
  assert.equal(tag, 'auth-settled');
  assert.deepEqual(data, {
    settleReason: 'timeout',
    settleElapsedMs: 42,
    settleFinalIsSignedIn: true,
    navigationType: null,
  });
});

test('missing/undefined data becomes {}', () => {
  assert.deepEqual(validateTelemetryShape('tag', undefined).data, {});
  assert.deepEqual(validateTelemetryShape('tag').data, {});
});

test('non-object data (string/array/Error) is replaced with {}, not coerced', () => {
  assert.deepEqual(validateTelemetryShape('tag', 'a string').data, {});
  assert.deepEqual(validateTelemetryShape('tag', [1, 2, 3]).data, {});
  assert.deepEqual(validateTelemetryShape('tag', new Error('boom')).data, {});
  assert.deepEqual(validateTelemetryShape('tag', 42).data, {});
  assert.deepEqual(validateTelemetryShape('tag', null).data, {});
});

test('a non-string tag is replaced with the invalid-tag placeholder', () => {
  assert.equal(validateTelemetryShape(42, {}).tag, 'invalid-tag');
  assert.equal(validateTelemetryShape(null, {}).tag, 'invalid-tag');
});

test('nested object/array/function values inside data are dropped without traversal, including a circular reference', () => {
  const circular = { self: null };
  circular.self = circular;

  const { data } = validateTelemetryShape('tag', {
    keep: 'yes',
    nestedObject: { a: 1 },
    nestedArray: [1, 2],
    nestedFn: () => {},
    nestedCircular: circular,
    nestedDate: new Date(),
    nestedError: new Error('x'),
  });

  assert.deepEqual(data, { keep: 'yes' });
});

test('an oversized tag or string value is truncated to exactly the max length, no ellipsis', () => {
  const longTag = 'x'.repeat(150);
  const longString = 'y'.repeat(600);

  const { tag, data } = validateTelemetryShape(longTag, { message: longString });

  assert.equal(tag.length, 100);
  assert.equal(tag, 'x'.repeat(100));
  assert.equal(data.message.length, 500);
  assert.equal(data.message, 'y'.repeat(500));
});

test('logEvent completes without throwing when the underlying Sentry SDK call throws synchronously', () => {
  sentryLogMock.mode = 'throw';
  try {
    assert.doesNotThrow(() => logEvent('some-tag', { a: 1 }));
  } finally {
    sentryLogMock.mode = 'ok';
  }
});

test('logEvent completes without an unhandled rejection when the underlying Sentry SDK call rejects', async () => {
  sentryLogMock.mode = 'reject';
  try {
    // safeSentryLog() must absorb this inside itself — logEvent() is synchronous and must not
    // itself return a rejected Promise, nor produce an unhandled rejection.
    logEvent('some-tag', { a: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    sentryLogMock.mode = 'ok';
  }
});

test('logEvent with a normal SDK call does not throw', () => {
  assert.doesNotThrow(() => logEvent('tag-a', { x: 1 }));
});
