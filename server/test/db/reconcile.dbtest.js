import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled,
  boot,
  q,
  withHouseholds,
  insertRecipe,
  insertMealLog,
  bulkRecipes,
  bulkMealLogs,
  docsOf,
  docCount,
  liveFingerprint,
  pairsOf,
  fake,
  installOpenAIMock,
} from './dbHarness.js';

// TASK-069 criteria 4 (behavioural, real DB), 10(e), 11, 11a, 11b, 11c, 11d(iv).
// Opt-in: RUN_DB_TESTS=1, local Neon branch only, migration 0022 applied.
// Only OpenAI is faked (deterministic vectors). The indexer and search service run for real
// against the real database over neon-http.

const suite = enabled ? describe : describe.skip;

suite('reconcileHousehold + searchRecipesAndMeals against the local database', () => {
  let reconcileHousehold;
  let searchRecipesAndMeals;

  before(async () => {
    await boot();
    installOpenAIMock();
    ({ reconcileHousehold } = await import('../../services/retrieval/indexer.js'));
    ({ searchRecipesAndMeals } = await import('../../services/retrieval/searchService.js'));
  });

  const reset = () => fake.reset();

  // ---------- criterion 4: which rows get upserted ----------

  test('4: a recipe with no doc gets one (upserted = 1)', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Fresh Recipe' });
      const res = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(res.upserted, 1);
      const docs = await docsOf(hh);
      assert.equal(docs.length, 1);
      assert.equal(docs[0].source_type, 'recipe');
      assert.equal(docs[0].source_id, rid);
      assert.equal(docs[0].source_fingerprint, await liveFingerprint(rid));
      assert.ok(docs[0].content.includes('Fresh Recipe'));
    });
  });

  test('4: a recipe whose updated_at changed but whose fingerprint did not is not re-upserted', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const before = (await docsOf(hh))[0];
      await q(`UPDATE recipes SET updated_at = $2 WHERE id = $1`, [rid, '2031-01-01T00:00:00.000Z']);
      const res = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(res.upserted, 0);
      const after = (await docsOf(hh))[0];
      assert.equal(after.updated_at, before.updated_at);
      assert.equal(after.content_hash, before.content_hash);
    });
  });

  test('4: a recipe whose fingerprint changed is re-upserted with the new content', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Old Name' });
      await reconcileHousehold(hh, { embedBudget: 0 });
      await q(`UPDATE recipes SET name = 'Brand New Name' WHERE id = $1`, [rid]);
      const res = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(res.upserted, 1);
      const doc = (await docsOf(hh))[0];
      assert.ok(doc.content.includes('Brand New Name'));
      assert.ok(!doc.content.includes('Old Name'));
      assert.equal(doc.source_fingerprint, await liveFingerprint(rid));
    });
  });

  test('4: an already-indexed meal log is never re-upserted', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await insertMealLog(hh, { itemName: 'Salmon fillet', category: 'Meat & Fish', wasExpiring: true });
      const first = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(first.upserted, 1);
      const before = (await docsOf(hh))[0];
      const second = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(second.upserted, 0);
      const after = (await docsOf(hh))[0];
      assert.equal(after.updated_at, before.updated_at);
    });
  });

  test('4: favorite-only toggle causes no upsert, no embed call, and leaves the doc untouched', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh);
      await reconcileHousehold(hh, { embedBudget: 25 });
      const before = (await docsOf(hh))[0];
      assert.ok(before.embedding, 'precondition: the doc is embedded');
      reset();
      await q(`UPDATE recipes SET is_favorite = true WHERE id = $1`, [rid]);
      const res = await reconcileHousehold(hh, { embedBudget: 25 });
      assert.equal(res.upserted, 0);
      assert.equal(fake.calls.length, 0);
      const after = (await docsOf(hh))[0];
      assert.equal(after.embedding, before.embedding);
      assert.equal(after.content_hash, before.content_hash);
      assert.equal(after.embedded_hash, before.embedded_hash);
      assert.equal(after.updated_at, before.updated_at);
    });
  });

  test('4: the upsert never sets embedding columns (a content change leaves a stale embedding in place)', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Before Edit' });
      await reconcileHousehold(hh, { embedBudget: 25 });
      const before = (await docsOf(hh))[0];
      await q(`UPDATE recipes SET name = 'After Edit' WHERE id = $1`, [rid]);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const after = (await docsOf(hh))[0];
      assert.ok(after.content.includes('After Edit'));
      assert.equal(after.embedding, before.embedding, 'old embedding stays');
      assert.equal(after.embedded_hash, before.embedded_hash, 'embedded_hash stays at the old hash');
      assert.notEqual(after.embedded_hash, after.content_hash, 'the doc is now stale');
    });
  });

  // ---------- criterion 4: embedding budget, order, accounting ----------

  test('4: sends at most embedBudget texts in exactly one embed call', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 30);
      const res = await reconcileHousehold(hh, { embedBudget: 25 });
      assert.equal(fake.calls.length, 1);
      assert.equal(fake.calls[0].input.length, 25);
      assert.equal(res.embedded, 25);
    });
  });

  test('4: embedBudget 0 makes no embed call but still indexes documents', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 3);
      const res = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(fake.calls.length, 0);
      assert.equal(await docCount(hh), 3);
      assert.equal(res.embedded, 0);
      assert.equal(res.pending, 3);
    });
  });

  test('4: pending order is never-embedded, then content-changed, then model-changed, then source_type/source_id', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const alpha = await insertRecipe(hh, { name: 'Alpha' });
      const bravo = await insertRecipe(hh, { name: 'Bravo' });
      await insertRecipe(hh, { name: 'Charlie' });
      await reconcileHousehold(hh, { embedBudget: 100 });
      reset();
      // content-changed (tier 2)
      await q(`UPDATE recipes SET name = 'Bravo Changed' WHERE id = $1`, [bravo]);
      // model-changed (tier 3)
      await q(
        `UPDATE search_documents SET embedding_model = 'old-model'
          WHERE household_id = $1 AND source_type = 'recipe' AND source_id = $2`,
        [hh, alpha]
      );
      // never embedded (tier 1): a recipe and a meal log ('meal_log' sorts before 'recipe')
      await insertRecipe(hh, { name: 'Delta' });
      await insertMealLog(hh, { itemName: 'Nectarine', category: 'Produce' });

      await reconcileHousehold(hh, { embedBudget: 4 });

      assert.equal(fake.calls.length, 1);
      const texts = fake.calls[0].input;
      assert.equal(texts.length, 4);
      assert.ok(texts[0].includes('Nectarine'), `1st should be the never-embedded meal log: ${texts[0]}`);
      assert.ok(texts[1].includes('Delta'), `2nd should be the never-embedded recipe: ${texts[1]}`);
      assert.ok(texts[2].includes('Bravo Changed'), `3rd should be the content-changed recipe: ${texts[2]}`);
      assert.ok(texts[3].includes('Alpha'), `4th should be the model-changed recipe: ${texts[3]}`);
    });
  });

  test('4: does not re-embed docs with an unchanged hash and the current model', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 3);
      await reconcileHousehold(hh, { embedBudget: 25 });
      reset();
      const res = await reconcileHousehold(hh, { embedBudget: 25 });
      assert.equal(fake.calls.length, 0);
      assert.equal(res.embedded, 0);
      assert.equal(res.pending, 0);
    });
  });

  test('4: when embed rejects, reconcile resolves with the pending count and does not throw', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 3);
      fake.failWith = new Error('openai down');
      const res = await reconcileHousehold(hh, { embedBudget: 25 });
      assert.equal(res.embedded, 0);
      assert.equal(res.pending, 3);
      assert.equal(await docCount(hh), 3, 'docs are still indexed (lexically searchable)');
    });
  });

  test('4: pending is the index-health count, not candidates minus embedded (30 pending, budget 25, 1 conditional write skipped)', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 30);
      fake.beforeResolve = async (texts) => {
        // A concurrent content change lands while the embed call is in flight.
        await q(
          `UPDATE search_documents SET content = content || ' mutated', content_hash = 'mutated-hash'
            WHERE household_id = $1 AND content = $2`,
          [hh, texts[0]]
        );
      };
      const res = await reconcileHousehold(hh, { embedBudget: 25 });
      assert.equal(res.embedded, 24, 'the skipped conditional write is not counted as embedded');
      assert.equal(res.pending, 6, '5 never attempted + 1 whose content changed mid-flight');
      const [{ c }] = await q(
        `SELECT count(*)::int AS c FROM search_documents WHERE household_id = $1 AND embedding IS NOT NULL`,
        [hh]
      );
      assert.equal(c, 24);
    });
  });

  // ---------- criterion 10(e) ----------

  test('10e: an upsert conflict with a mismatched household_id updates nothing', async () => {
    reset();
    await withHouseholds(2, async ([hhA, hhB]) => {
      const rid = await insertRecipe(hhA, { name: 'Belongs To A' });
      // Corrupt state: a doc for A's recipe exists but claims household B.
      await q(
        `INSERT INTO search_documents (household_id, source_type, source_id, content, content_hash, occurred_at, source_fingerprint)
         VALUES ($1, 'recipe', $2, 'FOREIGN CONTENT', 'foreign-hash', now(), 'foreign-fp')`,
        [hhB, rid]
      );
      await reconcileHousehold(hhA, { embedBudget: 0 }); // must not throw
      const [row] = await q(
        `SELECT household_id, content, content_hash, source_fingerprint FROM search_documents
          WHERE source_type = 'recipe' AND source_id = $1`,
        [rid]
      );
      assert.equal(row.household_id, hhB);
      assert.equal(row.content, 'FOREIGN CONTENT');
      assert.equal(row.content_hash, 'foreign-hash');
      assert.equal(row.source_fingerprint, 'foreign-fp');
    });
  });

  // ---------- criterion 11 ----------

  test('11: after a full backfill of a seeded household, pending = 0 and doc count equals source row count', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 12);
      await bulkMealLogs(hh, 8);
      let res;
      for (let i = 0; i < 10; i++) {
        res = await reconcileHousehold(hh, { embedBudget: 7 }); // several passes, like the backfill loop
        if (res.pending === 0) break;
      }
      assert.equal(res.pending, 0);
      assert.equal(await docCount(hh), 20);
      const [{ c }] = await q(
        `SELECT count(*)::int AS c FROM search_documents WHERE household_id = $1 AND embedding IS NULL`,
        [hh]
      );
      assert.equal(c, 0);
    });
  });

  // ---------- criterion 11a ----------

  test('11a: with 25 docs none embedded, hybrid mode returns the lexical results in the same order', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 25);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const [{ c }] = await q(
        `SELECT count(*)::int AS c FROM search_documents WHERE household_id = $1 AND embedding IS NOT NULL`,
        [hh]
      );
      assert.equal(c, 0, 'precondition: nothing embedded');

      // Document batches fail to embed; the single-text query embedding succeeds. The index therefore
      // stays fully un-embedded while the query embedding works.
      fake.failWhen = (input) => input.length > 1;

      const lexical = await searchRecipesAndMeals(hh, { query: 'chicken', limit: 10 }, { mode: 'lexical' });
      const hybrid = await searchRecipesAndMeals(hh, { query: 'chicken', limit: 10 });
      assert.ok(lexical.results.length > 0, 'lexical search should find the chicken recipes');
      assert.equal(hybrid.mode, 'hybrid');
      assert.deepEqual(pairsOf(hybrid), pairsOf(lexical));
    });
  });

  // ---------- criterion 11b ----------

  test('11b: date_from = date_to = 2026-09-12 returns exactly the two meal logs inside that UTC day', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const stamps = [
        '2026-09-11T23:59:59.999Z',
        '2026-09-12T00:00:00.000Z',
        '2026-09-12T23:59:59.999Z',
        '2026-09-13T00:00:00.000Z',
      ];
      const ids = [];
      for (const loggedAt of stamps) {
        ids.push(await insertMealLog(hh, { itemName: 'Salmon supper', category: 'Meat & Fish', loggedAt }));
      }
      const res = await searchRecipesAndMeals(hh, {
        query: 'salmon',
        sourceTypes: ['meal_log'],
        dateFrom: new Date('2026-09-12T00:00:00.000Z'),
        dateTo: new Date('2026-09-13T00:00:00.000Z'), // exclusive upper bound
        limit: 10,
      });
      const got = pairsOf(res).map(([, id]) => id).sort((a, b) => a - b);
      assert.deepEqual(got, [ids[1], ids[2]]);
    });
  });

  // ---------- criterion 11c ----------

  test('11c: setting embedding without embedding_model violates the CHECK constraint', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await insertRecipe(hh);
      await reconcileHousehold(hh, { embedBudget: 0 });
      const vector = `[${Array(1536).fill(0.1).join(',')}]`;
      await assert.rejects(
        () =>
          q(`UPDATE search_documents SET embedding = $2::vector WHERE household_id = $1`, [hh, vector]),
        (err) => err.code === '23514' || /check constraint|violates/i.test(String(err.message))
      );
    });
  });

  test('11c: setting embedding_model without embedding violates the CHECK constraint', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await insertRecipe(hh);
      await reconcileHousehold(hh, { embedBudget: 0 });
      await assert.rejects(
        () => q(`UPDATE search_documents SET embedding_model = 'm' WHERE household_id = $1`, [hh]),
        (err) => err.code === '23514' || /check constraint|violates/i.test(String(err.message))
      );
    });
  });

  test('11c: after real embeds, including a conditional write skipped by a mid-flight change, every row satisfies the all-or-nothing embedding metadata', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      await bulkRecipes(hh, 10);
      fake.beforeResolve = async (texts) => {
        await q(
          `UPDATE search_documents SET content = content || ' mutated', content_hash = 'mutated-hash'
            WHERE household_id = $1 AND content = $2`,
          [hh, texts[0]]
        );
      };
      await reconcileHousehold(hh, { embedBudget: 25 });
      const [{ bad }] = await q(
        `SELECT count(*)::int AS bad FROM search_documents
          WHERE household_id = $1
            AND NOT ((embedding IS NULL) = (embedding_model IS NULL)
                 AND (embedding IS NULL) = (embedded_hash IS NULL))`,
        [hh]
      );
      assert.equal(bad, 0);
      const [{ embedded }] = await q(
        `SELECT count(*)::int AS embedded FROM search_documents WHERE household_id = $1 AND embedding IS NOT NULL`,
        [hh]
      );
      assert.equal(embedded, 9, 'the mutated row stays un-embedded');
    });
  });

  // ---------- criterion 11d(iv) ----------

  test('11d(iv): a doc with a wrong source_fingerprint is re-indexed to match the live row', async () => {
    reset();
    await withHouseholds(1, async ([hh]) => {
      const rid = await insertRecipe(hh, { name: 'Self Healing Stew' });
      await reconcileHousehold(hh, { embedBudget: 0 });
      await q(
        `UPDATE search_documents SET source_fingerprint = 'wrong', content = 'corrupted content', content_hash = 'corrupted-hash'
          WHERE household_id = $1 AND source_id = $2`,
        [hh, rid]
      );
      const res = await reconcileHousehold(hh, { embedBudget: 0 });
      assert.equal(res.upserted, 1);
      const doc = (await docsOf(hh))[0];
      assert.equal(doc.source_fingerprint, await liveFingerprint(rid));
      assert.ok(doc.content.includes('Self Healing Stew'));
      assert.notEqual(doc.content_hash, 'corrupted-hash');
    });
  });
});
