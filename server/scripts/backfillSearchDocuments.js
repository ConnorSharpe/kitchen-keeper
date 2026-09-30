// TASK-069 §2.9: backfill / rebuild the search_documents retrieval index.
//
// INVARIANT: this file statically imports ONLY `node:` builtins. ES module static imports are
// evaluated before the script body runs, so any static import that could transitively reach
// db/client.js would open a database client BEFORE the guards below get to refuse a mismatched
// environment. All argument and environment validation happens first; only then are dotenv,
// db/client.js and the indexer loaded with dynamic import(). Keep it that way.
//
// Usage (dry run is the default; nothing is written and no embedding call is made):
//   BACKFILL_CONFIRM_ENV=local node scripts/backfillSearchDocuments.js --env local
//   BACKFILL_CONFIRM_ENV=local node scripts/backfillSearchDocuments.js --env local --execute
//   BACKFILL_CONFIRM_ENV=production DATABASE_URL=... node scripts/backfillSearchDocuments.js \
//     --env production --execute --i-understand-production
// Options: --household <id> limits the run to one household.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENVIRONMENTS = ['local', 'staging', 'production'];

function fail(message) {
  console.error(`backfill: ${message}`);
  process.exit(1);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      env: { type: 'string' },
      execute: { type: 'boolean', default: false },
      'i-understand-production': { type: 'boolean', default: false },
      household: { type: 'string' },
    },
    strict: true,
  }));
} catch (err) {
  fail(err.message);
}

if (!ENVIRONMENTS.includes(args.env)) {
  fail(`--env must be one of ${ENVIRONMENTS.join(', ')}`);
}
if (process.env.BACKFILL_CONFIRM_ENV !== args.env) {
  fail(
    `--env ${args.env} does not match BACKFILL_CONFIRM_ENV (${process.env.BACKFILL_CONFIRM_ENV || 'unset'}). ` +
      'Set BACKFILL_CONFIRM_ENV to the same environment to confirm the target.'
  );
}
if (args.env === 'production' && !args['i-understand-production']) {
  fail('--env production also requires --i-understand-production');
}
const onlyHousehold = args.household === undefined ? null : Number(args.household);
if (onlyHousehold !== null && !Number.isInteger(onlyHousehold)) {
  fail('--household must be an integer id');
}

// Validation passed. Only local reads server/.env.local; staging and production must supply
// DATABASE_URL explicitly so a missing variable can never fall back to the local branch.
if (args.env === 'local') {
  const dotenv = (await import('dotenv')).default;
  const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  dotenv.config({ path: path.join(serverDir, '.env.local') });
}
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

let host;
try {
  host = new URL(process.env.DATABASE_URL).hostname;
} catch {
  fail('DATABASE_URL is not a valid URL');
}
console.log(`backfill: env=${args.env} host=${host} mode=${args.execute ? 'EXECUTE' : 'dry-run'}`);

const { sql } = await import('drizzle-orm');
const { db } = await import('../db/client.js');
const { reconcileHousehold, planReconcile } = await import('../services/retrieval/indexer.js');
const { BACKFILL_EMBED_BATCH } = await import('../services/retrieval/constants.js');
const { flush } = await import('../instrument.js');

const householdIds =
  onlyHousehold !== null
    ? [onlyHousehold]
    : ((await db.execute(sql`SELECT id FROM households ORDER BY id`)).rows ?? []).map((r) => r.id);

let exitCode = 0;
if (!args.execute) {
  let totalChars = 0;
  for (const id of householdIds) {
    const plan = await planReconcile(id);
    totalChars += plan.embedChars;
    console.log(
      `household ${id}: upsert=${plan.toUpsert} delete=${plan.toDelete} embed=${plan.toEmbed} chars=${plan.embedChars}`
    );
  }
  console.log(
    `estimated_tokens_chars_div4=${Math.ceil(totalChars / 4)} ` +
      '(approximation, not a tokenizer count). Re-run with --execute to apply.'
  );
} else {
  // Idempotent and resumable (§2.4.5): re-running picks up wherever a previous run stopped.
  for (const id of householdIds) {
    for (let pass = 1; ; pass++) {
      const res = await reconcileHousehold(id, { embedBudget: BACKFILL_EMBED_BATCH });
      console.log(
        `household ${id} pass ${pass}: upserted=${res.upserted} deleted=${res.deleted} ` +
          `embedded=${res.embedded} pending=${res.pending} tokens=${res.embedTokens}`
      );
      if (res.pending === 0) break;
      if (res.embedded === 0) {
        console.error(`household ${id}: no progress (pending=${res.pending}); stopping this household`);
        exitCode = 1;
        break;
      }
    }
  }
}

await flush(2000).catch(() => {});
process.exit(exitCode);
