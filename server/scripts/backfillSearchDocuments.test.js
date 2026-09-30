import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TASK-069 criterion 9 (guard half; the dry-run-writes-nothing half needs the real local DB and
// lives in server/test/db/backfill.dbtest.js).
//
// The script is run as a child process with DATABASE_URL pointing at an unroutable address
// (10.255.255.1 is not routable; a connection attempt hangs or errors). A guard that runs
// BEFORE any DB module loads exits immediately with its own message, never a connection error.

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backfillSearchDocuments.js');
const SERVER_DIR = path.dirname(path.dirname(SCRIPT));
const CONNECTION_ERRORS =
  /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|fetch failed|Error connecting|getaddrinfo/i;

function run(args, envOverrides) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://user:pass@10.255.255.1:5432/db',
      OPENAI_API_KEY: 'sk-test-not-real',
      ...envOverrides,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    elapsedMs: Date.now() - started,
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

test('--env not equal to BACKFILL_CONFIRM_ENV exits non-zero with the guard message, before any DB connection', () => {
  const r = run(['--env', 'staging', '--execute'], { BACKFILL_CONFIRM_ENV: 'local' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.ok(!r.timedOut, 'script hung (a connection attempt?)');
  assert.doesNotMatch(r.output, CONNECTION_ERRORS, `connection error in output: ${r.output.slice(0, 300)}`);
  assert.doesNotMatch(r.output, /Cannot find module|MODULE_NOT_FOUND/, 'script file must exist');
  assert.match(r.output, /BACKFILL_CONFIRM_ENV/, `expected the guard message, got: ${r.output.slice(0, 300)}`);
  assert.ok(r.elapsedMs < 5000, `guard took ${r.elapsedMs}ms (consistent with a connection attempt)`);
});

test('a missing BACKFILL_CONFIRM_ENV also fails the guard before any DB connection', () => {
  const r = run(['--env', 'local'], { BACKFILL_CONFIRM_ENV: '' });
  assert.notEqual(r.status, 0);
  assert.ok(!r.timedOut);
  assert.doesNotMatch(r.output, CONNECTION_ERRORS);
  assert.doesNotMatch(r.output, /Cannot find module|MODULE_NOT_FOUND/);
  assert.match(r.output, /BACKFILL_CONFIRM_ENV/);
  assert.ok(r.elapsedMs < 5000);
});

test('--env production without --i-understand-production exits non-zero with the guard message', () => {
  const r = run(['--env', 'production', '--execute'], { BACKFILL_CONFIRM_ENV: 'production' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.ok(!r.timedOut);
  assert.doesNotMatch(r.output, CONNECTION_ERRORS, `connection error in output: ${r.output.slice(0, 300)}`);
  assert.doesNotMatch(r.output, /Cannot find module|MODULE_NOT_FOUND/);
  assert.match(r.output, /i-understand-production/);
  assert.ok(r.elapsedMs < 5000);
});
