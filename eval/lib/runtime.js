// TASK-069 §2.8: process-level plumbing shared by eval/retrieval.js and eval/agent.js.
//
// INVARIANT: this file statically imports ONLY `node:` builtins and pure eval/lib modules. Nothing
// here may reach server/db/client.js until loadEvalEnv() has passed the guard, because importing the
// DB client opens a connection with whatever DATABASE_URL is in process.env at that moment.
//
// Nothing under server/ imports anything under eval/ (§2.8 embedding-cache invariant); the eval
// reaches in, never the reverse. Patches applied by the runners affect this eval process only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkEvalEnv } from './guard.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const ENV_FILE = path.join(SERVER_DIR, '.env.local');
const CACHE_FILE = path.join(REPO_ROOT, 'eval', '.cache', 'embeddings.json');

/** Imports a server/ module by server-relative path (same module instance the server code uses). */
export function serverModule(relPath) {
  return import(pathToFileURL(path.join(SERVER_DIR, relPath)).href);
}

// Resolves a server dependency to its ESM entry file so the eval shares the server's instance
// (a CJS copy or a second resolution would make patches and instanceof checks silently miss).
function pickEntry(target) {
  if (typeof target === 'string') return target;
  for (const cond of ['import', 'node', 'default']) {
    if (target?.[cond]) return pickEntry(target[cond]);
  }
  return null;
}
export function serverDependency(pkg) {
  const dir = path.join(SERVER_DIR, 'node_modules', pkg);
  const json = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const entry = pickEntry(json.exports?.['.'] ?? json.exports) ?? json.module ?? json.main ?? 'index.js';
  return import(pathToFileURL(path.join(dir, entry)).href);
}

/**
 * Refuses unless EVAL_ALLOW_DB_WRITES=local and DATABASE_URL comes from server/.env.local, then
 * applies that file to process.env (dotenv semantics: existing vars win, which the guard has already
 * proven equal for DATABASE_URL). SENTRY_DSN is removed so eval traffic never reaches Sentry.
 */
export async function loadEvalEnv() {
  const dotenv = (await serverDependency('dotenv')).default;
  const envFile = existsSync(ENV_FILE) ? dotenv.parse(readFileSync(ENV_FILE)) : null;
  const verdict = checkEvalEnv({
    allowFlag: process.env.EVAL_ALLOW_DB_WRITES,
    preexisting: { DATABASE_URL: process.env.DATABASE_URL },
    envFile,
  });
  if (!verdict.ok) {
    console.error(`eval: refusing to run: ${verdict.reason}`);
    process.exit(1);
  }
  for (const [key, value] of Object.entries(envFile)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  delete process.env.SENTRY_DSN;
  if (!process.env.OPENAI_API_KEY) {
    console.error('eval: refusing to run: OPENAI_API_KEY is not set in server/.env.local');
    process.exit(1);
  }
  return { host: new URL(process.env.DATABASE_URL).hostname };
}

/** Commit + dirty flag for the results header; dirtyFiles shows whether the dirt is relevant. */
export function gitInfo() {
  const raw = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const run = (args) => raw(args).trim();
  // No trim here: porcelain lines start with a status column that may be a space.
  const dirtyFiles = raw(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3));
  return { commit: run(['rev-parse', '--short', 'HEAD']), dirty: dirtyFiles.length > 0, dirtyFiles };
}

/** load/persist for eval/lib/embedCache.js: eval-only, local-only, gitignored. */
export const cacheStorage = {
  load: () => (existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {}),
  persist: (store) => {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(store));
  },
};

/**
 * Captures logServerEvent() output via the Sentry client's beforeCaptureLog hook. Sentry.logger is
 * an ES module namespace (not patchable); with SENTRY_DSN removed the client has no transport, so
 * captured logs go nowhere else. Requires server/instrument.js to have been imported (Sentry.init).
 */
export function installLogCapture(Sentry) {
  const events = [];
  const client = Sentry.getClient();
  if (!client) throw new Error('eval: Sentry client missing; import server/instrument.js first');
  client.on('beforeCaptureLog', (log) => {
    events.push({ tag: log.message, ...log.attributes });
  });
  return {
    last(tag) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].tag === tag) return events[i];
      return null;
    },
  };
}

/** Writes eval/results/<name>-<date>.json and returns its path. */
export function writeResults(name, data) {
  const dir = path.join(REPO_ROOT, 'eval', 'results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}
