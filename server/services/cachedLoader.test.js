import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedLoader } from './cachedLoader.js';

test('caches the loader result within the TTL window', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 10_000);
  const a = await loader.get();
  const b = await loader.get();
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test('reloads after the TTL expires', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 1);
  await loader.get();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await loader.get(), 2);
});

test('invalidate() forces a reload on the next get()', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    return calls;
  }, 10_000);
  await loader.get();
  loader.invalidate();
  assert.equal(await loader.get(), 2);
});

test('a throwing loader propagates and does not poison the cache', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  }, 10_000);
  await assert.rejects(() => loader.get());
  assert.equal(await loader.get(), 'ok');
  assert.equal(calls, 2);
});

test('deduplicates concurrent loads on a cache miss (no stampede)', async () => {
  let calls = 0;
  const loader = createCachedLoader(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return calls;
  }, 10_000);
  const [a, b, c] = await Promise.all([
    loader.get(),
    loader.get(),
    loader.get(),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(c, 1);
});
