import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled,
  boot,
  q,
  withHouseholds,
  insertRecipe,
  insertMealLog,
  docsOf,
  pairsOf,
  fake,
  installOpenAIMock,
} from './dbHarness.js';

// TASK-069 criterion 10 (tenant isolation, the security criterion), parts (a)-(d).
// Part (e) (mismatched-household upsert conflict) lives in reconcile.dbtest.js.
// Opt-in: RUN_DB_TESTS=1, local Neon branch only, migration 0022 applied.
//
// Fixture: households A and B each hold a recipe with IDENTICAL content and a meal log with
// IDENTICAL content. Ids necessarily differ (global serials).

const suite = enabled ? describe : describe.skip;

const RECIPE = {
  name: 'Zesty Lemon Chicken',
  description: 'Shared description of a zesty dinner',
  ingredients: [{ name: 'lemon', quantity: '1', unit: 'whole' }],
  steps: ['Roast until golden.'],
  tags: ['dinner'],
  savedAt: '2026-09-01T10:00:00.000Z',
};
const MEAL = {
  itemName: 'Zesty Salmon',
  category: 'Meat & Fish',
  wasExpiring: true,
  loggedAt: '2026-09-05T18:00:00.000Z',
};

suite('tenant isolation against the local database', () => {
  let reconcileHousehold;
  let searchRecipesAndMeals;

  before(async () => {
    await boot();
    installOpenAIMock();
    ({ reconcileHousehold } = await import('../../services/retrieval/indexer.js'));
    ({ searchRecipesAndMeals } = await import('../../services/retrieval/searchService.js'));
  });

  async function seedPair(hh) {
    const recipeId = await insertRecipe(hh, RECIPE);
    const mealId = await insertMealLog(hh, MEAL);
    return { recipeId, mealId };
  }

  for (const mode of ['lexical', 'vector', 'hybrid']) {
    test(`10a: searchRecipesAndMeals(A) in ${mode} mode returns exactly A's recipe and meal log, never B's`, async () => {
      fake.reset();
      await withHouseholds(2, async ([hhA, hhB]) => {
        const a = await seedPair(hhA);
        await seedPair(hhB);
        // B is fully indexed and embedded, so any leak would be reachable by every mode.
        await reconcileHousehold(hhB, { embedBudget: 25 });
        const res = await searchRecipesAndMeals(hhA, { query: 'zesty', limit: 10 }, { mode });
        const got = pairsOf(res).map(([t, id]) => `${t}:${id}`).sort();
        const want = [`meal_log:${a.mealId}`, `recipe:${a.recipeId}`].sort();
        assert.deepEqual(got, want);
      });
    });
  }

  test("10b: reconcileHousehold(A) leaves B's docs byte-identical (embedding, hashes, updated_at)", async () => {
    fake.reset();
    await withHouseholds(2, async ([hhA, hhB]) => {
      const a = await seedPair(hhA);
      await seedPair(hhB);
      await reconcileHousehold(hhA, { embedBudget: 25 });
      await reconcileHousehold(hhB, { embedBudget: 25 });
      const before = await docsOf(hhB);
      assert.equal(before.length, 2);
      // Give A real work to do: a content change that needs an upsert and a re-embed.
      await q(`UPDATE recipes SET name = 'Zesty Lemon Chicken Deluxe' WHERE id = $1`, [a.recipeId]);
      const res = await reconcileHousehold(hhA, { embedBudget: 25 });
      assert.ok(res.upserted >= 1, 'precondition: A had work to do');
      assert.deepEqual(await docsOf(hhB), before);
    });
  });

  test("10c: after deleting A's recipe, reconcile(A) removes A's orphan doc and B's doc survives", async () => {
    fake.reset();
    await withHouseholds(2, async ([hhA, hhB]) => {
      const a = await seedPair(hhA);
      const b = await seedPair(hhB);
      await reconcileHousehold(hhA, { embedBudget: 25 });
      await reconcileHousehold(hhB, { embedBudget: 25 });
      await q(`DELETE FROM recipes WHERE id = $1`, [a.recipeId]);
      await reconcileHousehold(hhA, { embedBudget: 25 });
      const aDocs = (await docsOf(hhA)).map((d) => `${d.source_type}:${d.source_id}`);
      const bDocs = (await docsOf(hhB)).map((d) => `${d.source_type}:${d.source_id}`).sort();
      assert.deepEqual(aDocs, [`meal_log:${a.mealId}`], "A's recipe doc is gone, A's meal log doc stays");
      assert.deepEqual(bDocs, [`meal_log:${b.mealId}`, `recipe:${b.recipeId}`].sort());
    });
  });

  test("10d: deleting B's recipe then reconciling A does not remove B's orphan doc; reconciling B does", async () => {
    fake.reset();
    await withHouseholds(2, async ([hhA, hhB]) => {
      await seedPair(hhA);
      const b = await seedPair(hhB);
      await reconcileHousehold(hhA, { embedBudget: 25 });
      await reconcileHousehold(hhB, { embedBudget: 25 });
      await q(`DELETE FROM recipes WHERE id = $1`, [b.recipeId]);

      await reconcileHousehold(hhA, { embedBudget: 25 });
      const stillThere = (await docsOf(hhB)).some((d) => d.source_type === 'recipe' && d.source_id === b.recipeId);
      assert.ok(stillThere, "reconcile(A) must not touch B's orphan doc");

      await reconcileHousehold(hhB, { embedBudget: 25 });
      const gone = !(await docsOf(hhB)).some((d) => d.source_type === 'recipe' && d.source_id === b.recipeId);
      assert.ok(gone, 'reconcile(B) removes B\'s orphan doc');
    });
  });
});
