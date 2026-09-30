import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvalEnv } from './guard.js';

const URL = 'postgres://local/db';

test('ok when flag is local and env file has DATABASE_URL', () => {
  assert.deepEqual(
    checkEvalEnv({ allowFlag: 'local', preexisting: {}, envFile: { DATABASE_URL: URL } }),
    { ok: true },
  );
});
test('fails when flag is missing', () => {
  const r = checkEvalEnv({ allowFlag: undefined, preexisting: {}, envFile: { DATABASE_URL: URL } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /EVAL_ALLOW_DB_WRITES/);
});
test('flag must match exactly: LOCAL fails', () => {
  const r = checkEvalEnv({ allowFlag: 'LOCAL', preexisting: {}, envFile: { DATABASE_URL: URL } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /EVAL_ALLOW_DB_WRITES/);
});
test('flag production fails', () => {
  const r = checkEvalEnv({ allowFlag: 'production', preexisting: {}, envFile: { DATABASE_URL: URL } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /EVAL_ALLOW_DB_WRITES/);
});
test('fails when env file is missing', () => {
  const r = checkEvalEnv({ allowFlag: 'local', preexisting: {}, envFile: null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /\.env\.local/);
});
test('fails when env file lacks DATABASE_URL', () => {
  const r = checkEvalEnv({ allowFlag: 'local', preexisting: {}, envFile: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});
test('fails when env file DATABASE_URL is empty', () => {
  const r = checkEvalEnv({ allowFlag: 'local', preexisting: {}, envFile: { DATABASE_URL: '' } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});
test('fails when shell DATABASE_URL differs from env file', () => {
  const r = checkEvalEnv({
    allowFlag: 'local',
    preexisting: { DATABASE_URL: 'postgres://prod/db' },
    envFile: { DATABASE_URL: URL },
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});
test('ok when shell DATABASE_URL equals env file value', () => {
  assert.deepEqual(
    checkEvalEnv({ allowFlag: 'local', preexisting: { DATABASE_URL: URL }, envFile: { DATABASE_URL: URL } }),
    { ok: true },
  );
});
test('ok when shell DATABASE_URL is empty', () => {
  assert.deepEqual(
    checkEvalEnv({ allowFlag: 'local', preexisting: { DATABASE_URL: '' }, envFile: { DATABASE_URL: URL } }),
    { ok: true },
  );
});
