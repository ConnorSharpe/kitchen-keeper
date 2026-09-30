import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { enabled, boot, q, withHouseholds, insertRecipe, docsOf, docCount, liveFingerprint } from './dbHarness.js';

// TASK-069 criterion 11d (i), (ii), (iii), (v): authoritative-snapshot guard on the named export
// upsertRecipeDocuments(householdId, snapshots) -> { written: number[] }.
// Opt-in: RUN_DB_TESTS=1, local Neon branch only, migration 0022 applied.

const suite = enabled ? describe : describe.skip;

suite('upsertRecipeDocuments authoritative-snapshot guard on the local database', () => {
  let upsertRecipeDocuments;
  let reconcileHousehold;
  let buildRecipeDocument;
  let Pool;

  before(async () => {
    await boot();
    ({ upsertRecipeDocuments, reconcileHousehold } = await import('../../services/retrieval/indexer.js'));
    ({ buildRecipeDocument } = await import('../../services/retrieval/documents.js'));
    ({ Pool } = await import('@neondatabase/serverless'));
    assert.equal(typeof upsertRecipeDocuments, 'function', 'indexer.js must export upsertRecipeDocuments');
  });

  // Reads recipe `id` and returns a snapshot in the shape upsertRecipeDocuments takes.
  async function snapshotOf(id) {
    const [row] = await q(`SELECT * FROM recipes WHERE id = $1`, [id]);
    const doc = buildRecipeDocument(row);
    return {
      sourceId: id,
      fingerprint: await liveFingerprint(id),
      content: doc.content,
      contentHash: doc.contentHash,
      occurredAt: doc.occurredAt,
    };
  }

  async function docOf(hh) {
    const docs = await docsOf(hh);
    assert.equal(docs.length, 1);
    return docs[0];
  }

  test('11d(i): a stale snapshot writes nothing and the doc keeps the newer content', async () => {
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Original Name' });
      const s1 = await snapshotOf(rid);
      await q(`UPDATE recipes SET name = 'Changed Name' WHERE id = $1`, [rid]);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const before = await docOf(hh);
      const s2 = await snapshotOf(rid);
      assert.equal(before.content, s2.content);
      assert.notEqual(s1.content, s2.content);

      const res = await upsertRecipeDocuments(hh, [s1]);
      assert.deepEqual(res.written, []);
      const after = await docOf(hh);
      assert.equal(after.content, s2.content);
      assert.equal(after.content_hash, s2.contentHash);
      assert.equal(after.content_hash, before.content_hash);
      assert.equal(after.updated_at, before.updated_at);
    });
  });

  test('11d(ii): a stale snapshot with an identical updated_at string still writes nothing', async () => {
    await withHouseholds(1, async ([hh]) => {
      const ts = '2026-09-02T12:00:00.000Z';
      const rid = await insertRecipe(hh, { name: 'Original Name' });
      await q(`UPDATE recipes SET updated_at = $2 WHERE id = $1`, [rid, ts]);
      const s1 = await snapshotOf(rid);
      await q(`UPDATE recipes SET name = 'Changed Name', updated_at = $2 WHERE id = $1`, [rid, ts]);
      const [{ updated_at }] = await q(`SELECT updated_at FROM recipes WHERE id = $1`, [rid]);
      assert.equal(updated_at, ts);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const before = await docOf(hh);
      const s2 = await snapshotOf(rid);
      assert.equal(before.content, s2.content);
      assert.notEqual(s1.content, s2.content);

      const res = await upsertRecipeDocuments(hh, [s1]);
      assert.deepEqual(res.written, []);
      const after = await docOf(hh);
      assert.equal(after.content, s2.content);
      assert.equal(after.content_hash, s2.contentHash);
      assert.equal(after.updated_at, before.updated_at);
    });
  });

  test('11d(iii): a snapshot of a recipe deleted before the write creates no doc', async () => {
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Doomed' });
      const s1 = await snapshotOf(rid);
      await q(`DELETE FROM recipes WHERE id = $1`, [rid]);

      const res = await upsertRecipeDocuments(hh, [s1]);
      assert.deepEqual(res.written, []);
      assert.equal(await docCount(hh), 0);
    });
  });

  // ---------- (v) concurrent interleaving ----------

  // Runs the interleaving with a websocket Pool transaction T holding R's row lock, and finishes T
  // with `finish` ('COMMIT' or 'ROLLBACK'). Returns everything the assertions need.
  async function interleave(hh, finish) {
    const rid = await insertRecipe(hh, { name: 'Original Name' });
    const s1 = await snapshotOf(rid);
    const seeded = await upsertRecipeDocuments(hh, [s1]);
    assert.deepEqual(seeded.written, [rid]);
    const beforeDoc = await docOf(hh);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    let inTx = false;
    try {
      await client.query('BEGIN');
      inTx = true;
      await client.query(`UPDATE recipes SET name = 'Concurrent Name' WHERE id = $1`, [rid]);

      let settled = false;
      const pending = upsertRecipeDocuments(hh, [s1]).finally(() => {
        settled = true;
      });
      pending.catch(() => {});

      // Observe the lock wait from a separate connection (up to 5 s).
      let sawLock = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const rows = await q(
          `SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%search_documents%'`
        );
        if (rows.length > 0) {
          sawLock = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(sawLock, 'the upsert backend never showed wait_event_type = Lock within 5 s');
      assert.equal(settled, false, 'the upsert must still be pending while T holds the row lock');

      await client.query(finish);
      inTx = false;
      const res = await pending;
      return { rid, s1, beforeDoc, res };
    } finally {
      if (inTx) await client.query('ROLLBACK').catch(() => {});
      client.release();
      await pool.end().catch(() => {});
    }
  }

  test('11d(v) commit run: S1 upsert blocked by an uncommitted S2 writes nothing after S2 commits', async () => {
    await withHouseholds(1, async ([hh]) => {
      const { rid, s1, beforeDoc, res } = await interleave(hh, 'COMMIT');
      assert.deepEqual(res.written, []);
      const after = await docOf(hh);
      assert.equal(after.content, beforeDoc.content);
      assert.equal(after.content, s1.content);
      assert.equal(after.content_hash, beforeDoc.content_hash);
      assert.equal(after.updated_at, beforeDoc.updated_at);

      await reconcileHousehold(hh, { embedBudget: 0 });
      const [row] = await q(`SELECT * FROM recipes WHERE id = $1`, [rid]);
      const s2 = buildRecipeDocument(row);
      const healed = await docOf(hh);
      assert.equal(healed.content, s2.content);
      assert.equal(healed.content_hash, s2.contentHash);
      assert.notEqual(healed.content, s1.content);
    });
  });

  test('11d(v) rollback run: S1 upsert proceeds when the concurrent writer rolls back', async () => {
    await withHouseholds(1, async ([hh]) => {
      const { rid, s1, res } = await interleave(hh, 'ROLLBACK');
      assert.equal(res.written.length, 1);
      assert.deepEqual(res.written, [rid]);
      const after = await docOf(hh);
      assert.equal(after.content, s1.content);
      assert.equal(after.content_hash, s1.contentHash);
    });
  });
});
