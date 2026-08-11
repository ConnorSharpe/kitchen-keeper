import { test } from 'node:test';
import assert from 'node:assert/strict';

function installLocalStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

test('logEvent is a no-op when debug mode is disabled', async () => {
  installLocalStorageMock();
  const { logEvent, getLog } = await import(`./debugLog.js?disabled`);
  logEvent('some-tag', { a: 1 });
  assert.deepEqual(getLog(), []);
});

test('logEvent records entries once enabled, and clearLog empties them', async () => {
  installLocalStorageMock();
  const { logEvent, getLog, clearLog, setDebugEnabled, isDebugEnabled } =
    await import(`./debugLog.js?enabled`);

  assert.equal(isDebugEnabled(), false);
  setDebugEnabled(true);
  assert.equal(isDebugEnabled(), true);

  logEvent('tag-a', { x: 1 });
  logEvent('tag-b', { y: 2 });

  const log = getLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].tag, 'tag-a');
  assert.deepEqual(log[0].data, { x: 1 });
  assert.ok(typeof log[0].t === 'string');

  clearLog();
  assert.deepEqual(getLog(), []);
});

test('log is capped at the most recent 200 entries', async () => {
  installLocalStorageMock();
  const { logEvent, getLog, setDebugEnabled } = await import(
    `./debugLog.js?capped`
  );
  setDebugEnabled(true);

  const originalDebug = console.debug;
  console.debug = () => {};
  try {
    for (let i = 0; i < 205; i++) logEvent('tag', { i });
  } finally {
    console.debug = originalDebug;
  }

  const log = getLog();
  assert.equal(log.length, 200);
  assert.equal(log[0].data.i, 5);
  assert.equal(log[199].data.i, 204);
});
