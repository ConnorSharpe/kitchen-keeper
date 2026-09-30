import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enabled, boot, q, withHouseholds, insertRecipe, SERVER_DIR } from './dbHarness.js';

// TASK-069 criterion 11e (schema boot compatibility) plus the journal facts from G5.4.
// Opt-in: RUN_DB_TESTS=1, local Neon branch only. This file never applies a migration itself:
// boot() refuses to continue unless search_documents already exists on the local branch.

const suite = enabled ? describe : describe.skip;

const MAX_EXISTING_WHEN = 1785171529668; // latest created_at in every environment's __drizzle_migrations (G5)

suite('schema boot compatibility on the local database', () => {
  before(async () => {
    await boot();
  });

  test('11e: the migration journal has a 0022_search_documents entry whose when is strictly greater than every applied created_at', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(SERVER_DIR, 'db', 'migrations', 'meta', '_journal.json'), 'utf8')
    );
    const entry = journal.entries.find((e) => e.tag === '0022_search_documents');
    assert.ok(entry, '0022_search_documents must be journaled');
    assert.ok(entry.when > MAX_EXISTING_WHEN, `journal when ${entry.when} must exceed ${MAX_EXISTING_WHEN}`);
  });

  test('11e: schema.js exports searchDocuments', async () => {
    const schema = await import('../../db/schema.js');
    assert.ok(schema.searchDocuments, 'schema.js must export searchDocuments');
  });

  test('11e: importing server/app.js succeeds and an existing drizzle-typed query (recipeService.getAll) still returns rows', async () => {
    await import('../../app.js');
    const recipeService = await import('../../services/recipeService.js');
    await withHouseholds(1, async ([hh]) => {
      await insertRecipe(hh, { name: 'Boot Compat One' });
      await insertRecipe(hh, { name: 'Boot Compat Two' });
      const rows = await recipeService.getAll(hh);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.name).sort(), ['Boot Compat One', 'Boot Compat Two']);
    });
  });

  test('11e: server/db/migrate.js completes as a no-op on a second boot', async () => {
    const boots = [];
    for (let i = 0; i < 2; i++) {
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', "import './loadEnv.js'; await import('./db/migrate.js'); process.exit(0);"],
        { cwd: SERVER_DIR, encoding: 'utf8', timeout: 90000, env: { ...process.env } }
      );
      assert.equal(r.status, 0, `boot ${i + 1} failed: ${r.stderr}`);
      const [{ c }] = await q(`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`);
      boots.push(c);
    }
    assert.equal(boots[0], boots[1], 'the second boot must not apply anything');
  });
});
