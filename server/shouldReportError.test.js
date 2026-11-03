import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// TASK-072 Phase 2: shouldReportError(err) uses the same status the error handler responds with
// (err.status || 500) and returns status >= 500; it never throws and reports when unsure.
// Only the Sentry SDK is faked, so importing instrument.js doesn't initialize a real client.

mock.module('@sentry/node', {
  namedExports: {
    init: () => {},
    captureException: () => {},
    flush: async () => true,
    logger: { info: () => {} },
  },
});

const instrument = await import('./instrument.js');

test('AC1: shouldReportError is false for 4xx statuses 400, 401, 404 and 429', () => {
  for (const status of [400, 401, 404, 429]) {
    assert.equal(instrument.shouldReportError({ status }), false, `status ${status}`);
  }
});

test('AC2: shouldReportError is true for 500, 503 and an Error with no status', () => {
  assert.equal(instrument.shouldReportError({ status: 500 }), true);
  assert.equal(instrument.shouldReportError({ status: 503 }), true);
  assert.equal(instrument.shouldReportError(new Error('x')), true);
});

test('AC3: shouldReportError is true for statusCode-only 403 (the handler answers it with 500)', () => {
  assert.equal(instrument.shouldReportError({ statusCode: 403 }), true);
});

test('AC4: shouldReportError is false for a real Error instance with status 401', () => {
  const e = new Error('x');
  e.status = 401;
  assert.equal(instrument.shouldReportError(e), false);
});

test('AC5: shouldReportError is true and does not throw for undefined, null, string and number', () => {
  for (const input of [undefined, null, 'str', 42]) {
    assert.equal(instrument.shouldReportError(input), true, `input ${String(input)}`);
  }
});

test('AC6: shouldReportError is true and does not throw when the status getter throws', () => {
  const err = {
    get status() {
      throw new Error('getter boom');
    },
  };
  assert.equal(instrument.shouldReportError(err), true);
});

test('AC6a: shouldReportError is true and does not throw for a Symbol status', () => {
  assert.equal(instrument.shouldReportError({ status: Symbol('x') }), true);
});

test('AC6a: shouldReportError is true and does not throw for a Proxy whose get trap throws', () => {
  const err = new Proxy(
    {},
    {
      get() {
        throw new Error('trap boom');
      },
    }
  );
  assert.equal(instrument.shouldReportError(err), true);
});
