import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { enabled, boot, withHouseholds, insertRecipe } from './dbHarness.js';

// TASK-069 criterion 1, "Fingerprint encoding (round 4 S1; real DB)": recipes that differ only
// in the stated way must produce DIFFERENT fingerprints under the production
// RECIPE_FINGERPRINT_SQL, and identical rows must produce identical fingerprints across two
// separate queries.
// Opt-in: RUN_DB_TESTS=1, local Neon branch only, migration 0022 applied.
//
// Assumption: RECIPE_FINGERPRINT_SQL is an expression over a recipes alias named `r`
// (as in the spec's guarded-upsert SQL), exported as a SQL string or drizzle sql fragment.

const suite = enabled ? describe : describe.skip;

suite('recipe fingerprint encoding on the local database', () => {
  let db;
  let dsql;
  let expr;

  before(async () => {
    await boot();
    const indexer = await import('../../services/retrieval/indexer.js');
    ({ db } = await import('../../db/client.js'));
    ({ sql: dsql } = await import('drizzle-orm'));
    let e = indexer.RECIPE_FINGERPRINT_SQL;
    assert.ok(e, 'indexer.js must export RECIPE_FINGERPRINT_SQL');
    if (typeof e === 'function') e = e('r');
    expr = typeof e === 'string' ? dsql.raw(e) : e;
  });

  async function fingerprint(recipeId) {
    const res = await db.execute(dsql`SELECT ${expr} AS fp FROM recipes r WHERE r.id = ${recipeId}`);
    const rows = res.rows ?? res;
    return rows[0].fp;
  }

  // A and B go in separate households: recipes are unique on (household_id, name), and several
  // pairs share a name. household_id is not a fingerprint input, so this changes nothing compared.
  async function fingerprintsOf([hhA, hhB], a, b) {
    const idA = await insertRecipe(hhA, { ...a, savedAt: '2026-09-01T10:00:00.000Z' });
    const idB = await insertRecipe(hhB, { ...b, savedAt: '2026-09-01T10:00:00.000Z' });
    return [await fingerprint(idA), await fingerprint(idB)];
  }

  const pairs = [
    [
      'a separator character (chr(31)) inside a value vs the same text split across fields',
      { name: 'a\u001fb', description: null },
      { name: 'a', description: 'b' },
    ],
    ['NULL description vs empty-string description', { name: 'n', description: null }, { name: 'n', description: '' }],
    [
      'NULL description vs the string "null"',
      { name: 'n', description: null },
      { name: 'n', description: 'null' },
    ],
    [
      'adjacent concatenation (ab|c vs a|bc)',
      { name: 'ab', description: 'c' },
      { name: 'a', description: 'bc' },
    ],
    ['accented vs unaccented text', { name: 'café' }, { name: 'cafe' }],
  ];

  for (const [label, a, b] of pairs) {
    test(`fingerprints differ: ${label}`, async () => {
      await withHouseholds(2, async (hhs) => {
        const [fa, fb] = await fingerprintsOf(hhs, a, b);
        assert.equal(typeof fa, 'string');
        assert.equal(typeof fb, 'string');
        assert.notEqual(fa, fb);
      });
    });
  }

  test('identical rows produce identical fingerprints across two separate queries', async () => {
    await withHouseholds(2, async (hhs) => {
      const same = { name: 'Same Recipe', description: 'Same description' };
      const [fa, fb] = await fingerprintsOf(hhs, same, same);
      assert.equal(fa, fb);
    });
  });

  test('the same row queried twice gives the same fingerprint', async () => {
    await withHouseholds(1, async ([hh]) => {
      const id = await insertRecipe(hh, { name: 'Stable', description: null });
      assert.equal(await fingerprint(id), await fingerprint(id));
    });
  });
});
