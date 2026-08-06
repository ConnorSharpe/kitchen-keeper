import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { inviteRateLimit } from './inviteRateLimit.js';

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] };
    next();
  });
  app.post('/invite', inviteRateLimit, (_req, res) => res.json({ ok: true }));
  return app;
}

test('11th invite request within the window is rejected, per-user scoped', async () => {
  const app = makeApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const url = `http://localhost:${port}/invite`;

    for (let i = 0; i < 10; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-test-user': 'userA' },
      });
      assert.equal(res.status, 200, `request ${i + 1} for userA should succeed`);
    }

    const res11 = await fetch(url, {
      method: 'POST',
      headers: { 'x-test-user': 'userA' },
    });
    assert.equal(res11.status, 429);
    const body = await res11.json();
    assert.match(body.error, /too many invite emails/i);

    const resB = await fetch(url, {
      method: 'POST',
      headers: { 'x-test-user': 'userB' },
    });
    assert.equal(
      resB.status,
      200,
      'a different user must have an independent budget'
    );
  } finally {
    server.close();
  }
});
