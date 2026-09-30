import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// TASK-069 criterion 6. The OpenAI network client is the only thing faked.

const s = {};
function reset() {
  s.calls = [];
  s.respond = null;
  s.error = null;
}
reset();
beforeEach(reset);

const vec = (n) => Array.from({ length: 1536 }, () => n / 10);

mock.module('openai', {
  defaultExport: class FakeOpenAI {
    constructor() {
      this.embeddings = {
        create: async (args) => {
          s.calls.push(args);
          if (s.error) throw s.error;
          return s.respond(args);
        },
      };
    }
  },
});

const { OpenAIProvider } = await import('./openaiProvider.js');
const { AIProvider, AIProviderError } = await import('./providerInterface.js');

const okResponse = (args) => ({
  data: args.input.map((_, index) => ({ index, embedding: vec(index) })),
  usage: { prompt_tokens: args.input.length },
});

test('embed makes exactly one API call with the embedding model and the full input array', async () => {
  s.respond = okResponse;
  const provider = new OpenAIProvider('test-key');
  await provider.embed(['alpha', 'beta', 'gamma']);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].model, 'text-embedding-3-small');
  assert.deepEqual(s.calls[0].input, ['alpha', 'beta', 'gamma']);
});

test('embed returns one 1536-dim vector per input, in input order', async () => {
  // The API echoes an `index` per item; return them out of order to prove ordering follows input.
  s.respond = (args) => ({
    data: [
      { index: 2, embedding: vec(2) },
      { index: 0, embedding: vec(0) },
      { index: 1, embedding: vec(1) },
    ].slice(0, args.input.length),
    usage: { prompt_tokens: 3 },
  });
  const provider = new OpenAIProvider('test-key');
  const out = await provider.embed(['a', 'b', 'c']);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], vec(0));
  assert.deepEqual(out[1], vec(1));
  assert.deepEqual(out[2], vec(2));
});

test('embed raises AIProviderError for a vector whose length is not 1536', async () => {
  s.respond = () => ({
    data: [
      { index: 0, embedding: vec(0) },
      { index: 1, embedding: [0.1, 0.2, 0.3] },
    ],
    usage: { prompt_tokens: 2 },
  });
  const provider = new OpenAIProvider('test-key');
  await assert.rejects(() => provider.embed(['a', 'b']), AIProviderError);
});

test('embed wraps an API failure in AIProviderError', async () => {
  s.error = new Error('429 rate limited');
  const provider = new OpenAIProvider('test-key');
  await assert.rejects(() => provider.embed(['a']), AIProviderError);
});

test('the AIProvider interface declares embed and it is not implemented by default', async () => {
  const base = new AIProvider();
  assert.equal(typeof base.embed, 'function');
  await assert.rejects(async () => base.embed(['a']), /Not implemented/);
});
