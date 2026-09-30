// Shared helpers for TASK-069 real-DB tests (server/test/db/*.dbtest.js).
//
// Importing this file has no side effects (node's default test discovery also executes it as a
// test file, and it must stay inert when RUN_DB_TESTS is not set).
//
// Safety: the DB tests are opt-in (RUN_DB_TESTS=1) and refuse to run unless DATABASE_URL's host
// starts with `ep-icy-rice-` (the local Neon branch, from server/.env.local). Each test seeds
// its own households and removes them (ON DELETE CASCADE) in a `finally`.

import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';

export const enabled = process.env.RUN_DB_TESTS === '1';
export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCAL_HOST_PREFIX = 'ep-icy-rice-';

let sql = null;

// Loads server/.env.local, refuses non-local hosts, and requires migration 0022 to be applied.
export async function boot() {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: path.join(SERVER_DIR, '.env.local') });
  // Never ship telemetry from a test run.
  delete process.env.SENTRY_DSN;
  process.env.OPENAI_API_KEY ??= 'sk-test-not-real';

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (expected in server/.env.local)');
  const host = new URL(url).hostname;
  if (!host.startsWith(LOCAL_HOST_PREFIX)) {
    throw new Error(
      `Refusing to run DB tests: DATABASE_URL host "${host}" does not start with "${LOCAL_HOST_PREFIX}" (local branch only)`
    );
  }

  const { neon } = await import('@neondatabase/serverless');
  sql = neon(url);
  const [{ t }] = await sql`SELECT to_regclass('public.search_documents') AS t`;
  if (!t) {
    throw new Error(
      'Migration 0022_search_documents is NOT applied on the local branch: table search_documents does not exist'
    );
  }
  return sql;
}

export const q = (text, params = []) => sql(text, params);

// ---------- seeding ----------

export async function createHousehold() {
  const code = `T69${randomBytes(6).toString('hex')}`;
  const rows = await sql(
    `INSERT INTO households (name, join_code, created_at) VALUES ($1, $2, $3) RETURNING id`,
    [`task069-test-${code}`, code, new Date().toISOString()]
  );
  return rows[0].id;
}

export async function deleteHouseholds(ids) {
  const list = ids.filter((x) => x != null);
  if (list.length) await sql(`DELETE FROM households WHERE id = ANY($1::int[])`, [list]);
}

// Runs fn(householdIds) with n freshly seeded households; always removes them (cascade).
export async function withHouseholds(n, fn) {
  const ids = [];
  try {
    for (let i = 0; i < n; i++) ids.push(await createHousehold());
    return await fn(ids);
  } finally {
    await deleteHouseholds(ids);
  }
}

export async function insertRecipe(
  householdId,
  {
    name = 'Test Recipe',
    description = 'A test recipe',
    ingredients = [{ name: 'salt', quantity: '1', unit: 'tsp' }],
    steps = ['Mix.'],
    tags = ['test'],
    savedAt = '2026-09-01T10:00:00.000Z',
    updatedAt = savedAt,
  } = {}
) {
  const rows = await sql(
    `INSERT INTO recipes (household_id, name, description, ingredients, steps, tags, saved_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      householdId,
      name,
      description,
      JSON.stringify(ingredients),
      JSON.stringify(steps),
      tags == null ? null : JSON.stringify(tags),
      savedAt,
      updatedAt,
    ]
  );
  return rows[0].id;
}

export async function insertMealLog(
  householdId,
  {
    itemName = 'Test Item',
    category = 'Other',
    wasExpiring = null,
    loggedAt = '2026-09-05T18:00:00.000Z',
  } = {}
) {
  const rows = await sql(
    `INSERT INTO meal_logs (household_id, item_name, category, was_expiring, logged_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [householdId, itemName, category, wasExpiring, loggedAt]
  );
  return rows[0].id;
}

// Bulk recipes named `${prefix} ${n}` all sharing the word "chicken" (single statement).
export async function bulkRecipes(householdId, n, prefix = 'Recipe') {
  const rows = await sql(
    `INSERT INTO recipes (household_id, name, description, ingredients, steps, tags, saved_at, updated_at)
     SELECT $1::int, $2::text || ' ' || g, 'Chicken dinner number ' || g,
            '[{"name":"chicken","quantity":"1","unit":"lb"}]', '["Cook it."]', '["dinner"]',
            to_char(timezone('UTC', now()) - (g || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            to_char(timezone('UTC', now()) - (g || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     FROM generate_series(1, $3::int) g RETURNING id`,
    [householdId, prefix, n]
  );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

export async function bulkMealLogs(householdId, n, prefix = 'Meal') {
  const rows = await sql(
    `INSERT INTO meal_logs (household_id, item_name, category, was_expiring, logged_at)
     SELECT $1::int, $2::text || ' ' || g, 'Other', false,
            to_char(timezone('UTC', now()) - (g || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     FROM generate_series(1, $3::int) g RETURNING id`,
    [householdId, prefix, n]
  );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

// ---------- reading ----------

export const docsOf = (householdId) =>
  sql(
    `SELECT id, household_id, source_type, source_id, content, content_hash, source_fingerprint,
            embedding::text AS embedding, embedding_model, embedded_hash,
            occurred_at::text AS occurred_at, updated_at::text AS updated_at
       FROM search_documents WHERE household_id = $1 ORDER BY source_type, source_id`,
    [householdId]
  );

export const docCount = async (householdId) =>
  (await sql(`SELECT count(*)::int AS c FROM search_documents WHERE household_id = $1`, [householdId]))[0].c;

export const liveFingerprint = async (recipeId) =>
  (
    await sql(
      `SELECT md5(json_build_array(r.name, r.description, r.tags, r.ingredients, r.steps, r.saved_at)::text) AS fp
         FROM recipes r WHERE r.id = $1`,
      [recipeId]
    )
  )[0].fp;

export const pairsOf = (res) =>
  res.results.map((r) => [r.source_type ?? r.sourceType, r.source_id ?? r.sourceId]);

// ---------- deterministic fake OpenAI (the only mocked external) ----------

export function textVector(text) {
  const v = new Array(1536).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash('sha256').update(w).digest();
    v[h.readUInt16BE(0) % 1536] += 1;
  }
  let norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  if (norm === 0) {
    v[0] = 1;
    norm = 1;
  }
  return v.map((x) => x / norm);
}

export const fake = {
  calls: [], // each: { model, input: string[] }
  failWith: null, // Error to throw from every call
  failWhen: null, // (input: string[]) => boolean; throw when true
  beforeResolve: null, // async (input: string[]) => void, runs after the call is recorded
  reset() {
    this.calls = [];
    this.failWith = null;
    this.failWhen = null;
    this.beforeResolve = null;
  },
};

// Must be called BEFORE importing any module under test.
export function installOpenAIMock() {
  mock.module('openai', {
    defaultExport: class FakeOpenAI {
      constructor() {
        this.embeddings = {
          create: async ({ model, input }) => {
            const inputs = Array.isArray(input) ? input : [input];
            fake.calls.push({ model, input: inputs });
            if (fake.failWith) throw fake.failWith;
            if (fake.failWhen && fake.failWhen(inputs)) throw new Error('fake OpenAI: forced failure');
            if (fake.beforeResolve) await fake.beforeResolve(inputs);
            return {
              data: inputs.map((t, index) => ({ index, embedding: textVector(t) })),
              usage: { prompt_tokens: inputs.length },
            };
          },
        };
      }
    },
  });
}
