import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './index.js';

function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function installClerkMock({ skipCacheToken = 'fresh-token' } = {}) {
  let skipCacheCalls = 0;
  let hrefSetCount = 0;
  const locationState = { pathname: '/', _href: '' };

  globalThis.window = {
    location: {
      get pathname() {
        return locationState.pathname;
      },
      get href() {
        return locationState._href;
      },
      set href(v) {
        hrefSetCount++;
        locationState._href = v;
      },
    },
    Clerk: {
      session: {
        getToken: async (opts) => {
          if (opts && opts.skipCache) {
            skipCacheCalls++;
            return skipCacheToken;
          }
          return 'stale-token';
        },
      },
    },
  };

  return {
    getSkipCacheCalls: () => skipCacheCalls,
    getHrefSetCount: () => hrefSetCount,
    getHref: () => locationState._href,
  };
}

test('authorizedFetch (via api.get): retries once with a forced-refresh token and succeeds', async () => {
  const mock = installClerkMock();
  const calls = [];
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, opts });
    return calls.length === 1 ? mockResponse(401, { error: 'expired' }) : mockResponse(200, { ok: true });
  };

  const data = await api.get('/api/test');

  assert.deepEqual(data, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer stale-token');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer fresh-token');
  assert.equal(mock.getSkipCacheCalls(), 1);
  assert.equal(mock.getHrefSetCount(), 0);
});

test('authorizedFetch: N concurrent 401s trigger exactly one forced-refresh call (single-flight)', async () => {
  const mock = installClerkMock();
  globalThis.fetch = async (path, opts) => {
    const auth = opts.headers.Authorization;
    return auth === 'Bearer fresh-token' ? mockResponse(200, { ok: true, path }) : mockResponse(401, { error: 'expired' });
  };

  const results = await Promise.all([
    api.get('/api/a'),
    api.get('/api/b'),
    api.get('/api/c'),
    api.get('/api/d'),
    api.get('/api/e'),
  ]);

  assert.equal(results.length, 5);
  for (const r of results) assert.equal(r.ok, true);
  assert.equal(mock.getSkipCacheCalls(), 1, 'expected exactly one skipCache getToken() call across 5 concurrent 401s');
  assert.equal(mock.getHrefSetCount(), 0);
});

test('authorizedFetch: genuinely expired session (both attempts 401) redirects exactly once even with concurrent callers', async () => {
  const mock = installClerkMock({ skipCacheToken: 'still-bad-token' });
  globalThis.fetch = async () => mockResponse(401, { error: 'expired' });

  const settled = await Promise.allSettled([
    api.get('/api/a'),
    api.get('/api/b'),
    api.get('/api/c'),
    api.get('/api/d'),
    api.get('/api/e'),
  ]);

  for (const s of settled) {
    assert.equal(s.status, 'rejected');
    assert.equal(s.reason.message, 'Session expired');
  }
  assert.equal(mock.getSkipCacheCalls(), 1, 'expected exactly one skipCache getToken() call across 5 concurrent failures');
  assert.equal(mock.getHrefSetCount(), 1, 'expected exactly one redirect regardless of how many concurrent callers failed');
  assert.equal(mock.getHref(), '/sign-in');
});
