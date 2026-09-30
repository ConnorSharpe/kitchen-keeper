// TASK-069 §2.8: refuse to run DB-writing evals against anything but the local env file.

/** Returns {ok:true} or {ok:false, reason}. */
export function checkEvalEnv({ allowFlag, preexisting, envFile }) {
  if (allowFlag !== 'local') {
    return { ok: false, reason: 'EVAL_ALLOW_DB_WRITES must be set to "local"' };
  }
  if (!envFile) {
    return { ok: false, reason: '.env.local not found' };
  }
  if (!envFile.DATABASE_URL) {
    return { ok: false, reason: 'DATABASE_URL missing from .env.local' };
  }
  const pre = preexisting && preexisting.DATABASE_URL;
  if (pre && pre !== envFile.DATABASE_URL) {
    return { ok: false, reason: 'Pre-existing DATABASE_URL differs from .env.local DATABASE_URL' };
  }
  return { ok: true };
}
