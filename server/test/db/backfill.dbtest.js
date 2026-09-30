import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { enabled, boot, q, createHousehold, deleteHouseholds, bulkRecipes, bulkMealLogs, SERVER_DIR } from './dbHarness.js';

// TASK-069 criterion 9, first bullet: without --execute the backfill performs no writes and
// makes no embed calls. Real local database; the OpenAI endpoint is a local HTTP server that
// counts requests (the script is pointed at it via OPENAI_BASE_URL).
// Opt-in: RUN_DB_TESTS=1, local Neon branch only, migration 0022 applied.
//
// Note: the dry run only READS every household on the local branch; the assertions below
// compare search_documents before and after, and count requests to the fake OpenAI server.

const suite = enabled ? describe : describe.skip;

suite('backfill script dry run against the local database', () => {
  let hh;
  let server;
  let requests = 0;
  let port;

  before(async () => {
    await boot();
    server = http.createServer((req, res) => {
      requests++;
      res.statusCode = 500;
      res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    hh = await createHousehold();
    await bulkRecipes(hh, 3, 'Dry Run Recipe');
    await bulkMealLogs(hh, 2, 'Dry Run Meal');
  });

  after(async () => {
    try {
      await deleteHouseholds([hh]);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
    }
  });

  function runScript(args) {
    // spawn (async) is required: the fake OpenAI server lives in this process and must keep serving.
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(SERVER_DIR, 'scripts', 'backfillSearchDocuments.js'), ...args], {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          BACKFILL_CONFIRM_ENV: 'local',
          OPENAI_BASE_URL: `http://127.0.0.1:${port}`,
          OPENAI_API_KEY: 'sk-test-not-real',
        },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      const timer = setTimeout(() => child.kill(), 120000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, out });
      });
    });
  }

  test('9: --env local without --execute exits 0, writes nothing, makes no embed calls, and reports the estimate', async () => {
    const [{ c: before }] = await q(`SELECT count(*)::int AS c FROM search_documents`);
    const r = await runScript(['--env', 'local']);
    assert.equal(r.status, 0, `dry run failed:\n${r.out.slice(0, 500)}`);
    assert.equal(requests, 0, 'a dry run must make no embed (OpenAI) calls');
    const [{ c: after }] = await q(`SELECT count(*)::int AS c FROM search_documents`);
    assert.equal(after, before, 'a dry run must not write search_documents rows');
    assert.match(r.out, /estimated_tokens_chars_div4/);
  });

  test('9: the run prints the Neon host of DATABASE_URL before doing anything', async () => {
    const r = await runScript(['--env', 'local']);
    const host = new URL(process.env.DATABASE_URL).hostname;
    assert.ok(r.out.includes(host), `expected the host ${host} in the output`);
  });
});
