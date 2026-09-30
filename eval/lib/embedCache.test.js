import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installEmbedCache } from './embedCache.js';

const key = (model, text) => `${model}:${createHash('sha256').update(text).digest('hex')}`;

function makeProvider() {
  class FakeProvider {
    constructor() { this.calls = []; this.failNext = false; }
    async embed(texts, { onUsage } = {}) {
      this.calls.push([...texts]);
      if (this.failNext) { this.failNext = false; throw new Error('boom'); }
      onUsage?.(texts.join('').length);
      return texts.map((t) => [t.length, 1]);
    }
  }
  return FakeProvider;
}

function setup(opts = {}) {
  const P = makeProvider();
  const store = opts.store ?? {};
  const persisted = [];
  const control = installEmbedCache(P, {
    model: opts.model ?? 'm1',
    load: () => store,
    persist: (s) => persisted.push(s),
  });
  return { P, p: new P(), store, persisted, control };
}

test('all cached: original not called, vectors in input order', async () => {
  const { p } = setup();
  await p.embed(['aa', 'b']);
  p.calls.length = 0;
  const out = await p.embed(['b', 'aa']);
  assert.deepEqual(p.calls, []);
  assert.deepEqual(out, [[1, 1], [2, 1]]);
});

test('all cached: onUsage gets rounded sum of t with duplicates counted', async () => {
  const { p, store } = setup();
  store[key('m1', 'a')] = { v: [9], t: 1.4 };
  store[key('m1', 'b')] = { v: [8], t: 2.3 };
  let usage;
  await p.embed(['a', 'b', 'a'], { onUsage: (n) => { usage = n; } });
  assert.equal(usage, Math.round(1.4 + 2.3 + 1.4));
  assert.deepEqual(p.calls, []);
});

test('all cached: no onUsage does not throw', async () => {
  const { p, store } = setup();
  store[key('m1', 'a')] = { v: [9], t: 1 };
  assert.deepEqual(await p.embed(['a']), [[9]]);
});

test('missing texts: original called once with unique texts in first-appearance order', async () => {
  const { p } = setup();
  await p.embed(['b', 'a', 'b', 'c']);
  assert.deepEqual(p.calls, [['b', 'a', 'c']]);
});

test('missing texts: original is invoked on the provider instance', async () => {
  const { P, control } = setup();
  const q = new P();
  await q.embed(['x']);
  assert.deepEqual(q.calls, [['x']]);
  assert.equal(control.stats.apiCalls, 1);
});

test('duplicates receive the same vector in input order', async () => {
  const { p } = setup();
  const out = await p.embed(['bb', 'a', 'bb']);
  assert.deepEqual(out, [[2, 1], [1, 1], [2, 1]]);
});

test('only missing texts fetched when some are cached', async () => {
  const { p } = setup();
  await p.embed(['a']);
  p.calls.length = 0;
  const out = await p.embed(['a', 'bb']);
  assert.deepEqual(p.calls, [['bb']]);
  assert.deepEqual(out, [[1, 1], [2, 1]]);
});

test('stored token share is proportional to text length', async () => {
  const { p, store } = setup();
  await p.embed(['a', 'bbb']); // batch tokens = 4
  assert.equal(store[key('m1', 'a')].t, 1);
  assert.equal(store[key('m1', 'bbb')].t, 3);
  assert.deepEqual(store[key('m1', 'a')].v, [1, 1]);
});

test('stats after a miss then a hit', async () => {
  const { p, control } = setup();
  await p.embed(['a', 'bb', 'a']);
  assert.deepEqual(control.stats, { hits: 0, misses: 2, apiCalls: 1, apiTokens: 3 });
  await p.embed(['a', 'a', 'bb', 'ccc']);
  assert.deepEqual(control.stats, { hits: 3, misses: 3, apiCalls: 2, apiTokens: 6 });
});

test('second call with same texts is served from cache', async () => {
  const { p } = setup();
  await p.embed(['a', 'b']);
  await p.embed(['a', 'b']);
  assert.equal(p.calls.length, 1);
});

test('original error propagates and nothing is stored', async () => {
  const { p, store } = setup();
  p.failNext = true;
  await assert.rejects(() => p.embed(['a']), /boom/);
  assert.deepEqual(store, {});
  await p.embed(['a']);
  assert.equal(p.calls.length, 2);
});

test('different model uses a different key space', async () => {
  const store = { [key('m1', 'a')]: { v: [9], t: 1 } };
  const { p } = setup({ model: 'm2', store });
  const out = await p.embed(['a']);
  assert.deepEqual(p.calls, [['a']]);
  assert.deepEqual(out, [[1, 1]]);
});

test('same model reads pre-loaded entries', async () => {
  const store = { [key('m1', 'a')]: { v: [9], t: 1 } };
  const { p } = setup({ model: 'm1', store });
  assert.deepEqual(await p.embed(['a']), [[9]]);
  assert.deepEqual(p.calls, []);
});

test('enabled defaults to true', () => {
  assert.equal(setup().control.enabled, true);
});

test('disabled: passes exact texts (no dedupe)', async () => {
  const { p, control } = setup();
  control.enabled = false;
  await p.embed(['a', 'a', 'b']);
  assert.deepEqual(p.calls, [['a', 'a', 'b']]);
});

test('disabled: forwards onUsage and counts apiCalls and apiTokens', async () => {
  const { p, control } = setup();
  control.enabled = false;
  let usage;
  await p.embed(['ab', 'c'], { onUsage: (n) => { usage = n; } });
  assert.equal(usage, 3);
  assert.equal(control.stats.apiCalls, 1);
  assert.equal(control.stats.apiTokens, 3);
});

test('disabled: never writes the store', async () => {
  const { p, control, store } = setup();
  control.enabled = false;
  await p.embed(['a']);
  assert.deepEqual(store, {});
  control.enabled = true;
  p.calls.length = 0;
  await p.embed(['a']);
  assert.deepEqual(p.calls, [['a']]);
});

test('disabled: does not read existing cached entries', async () => {
  const { p, control, store } = setup();
  store[key('m1', 'a')] = { v: [9], t: 1 };
  control.enabled = false;
  const out = await p.embed(['a']);
  assert.deepEqual(out, [[1, 1]]);
});

test('save persists the store with entries added so far', async () => {
  const { p, control, persisted, store } = setup();
  await p.embed(['a']);
  control.save();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0], store);
  assert.ok(key('m1', 'a') in persisted[0]);
});

test('uninstall restores the original embed', () => {
  const P = makeProvider();
  const original = P.prototype.embed;
  const control = installEmbedCache(P, { model: 'm1' });
  assert.notEqual(P.prototype.embed, original);
  control.uninstall();
  assert.equal(P.prototype.embed, original);
});

test('install works with default load and persist', async () => {
  const P = makeProvider();
  const control = installEmbedCache(P, { model: 'm1' });
  const p = new P();
  assert.deepEqual(await p.embed(['a']), [[1, 1]]);
  assert.doesNotThrow(() => control.save());
});
