// TASK-069 §2.8: eval household lifecycle on the LOCAL database (guarded by runtime.loadEvalEnv).
// Seeds the synthetic fixture, runs the backfill path to completion, fingerprints the index state,
// and tears everything down via the households ON DELETE CASCADE.
//
// Server modules are passed in (`deps`) rather than imported, so nothing here can open a DB
// connection before the guard has run.
import { randomUUID } from 'node:crypto';
import { daysAgoAt } from './dates.js';

export const EVAL_HOUSEHOLD_PREFIX = 'eval-TASK-069-';
const MEAL_LOG_INSERT_CONCURRENCY = 10;

const rowsOf = (res) => res?.rows ?? res ?? [];

/** Deletes eval households left behind by a crashed earlier run. Returns how many. */
export async function removeStaleEvalHouseholds({ db, sql }) {
  const res = await db.execute(
    sql`DELETE FROM households WHERE name LIKE ${`${EVAL_HOUSEHOLD_PREFIX}%`} RETURNING id`
  );
  return rowsOf(res).length;
}

/**
 * Inserts the household, recipes and meal logs. Returns the id ↔ fixture-key maps.
 * `base` is the UTC midnight the fixture's *DaysAgo offsets are measured from.
 */
export async function seedHousehold({ db, schema }, fixture, base) {
  const [household] = await db
    .insert(schema.households)
    .values({ name: `${EVAL_HOUSEHOLD_PREFIX}${new Date().toISOString()}`, joinCode: `eval-${randomUUID()}` })
    .returning({ id: schema.households.id });
  const householdId = household.id;

  const recipeRows = await db
    .insert(schema.recipes)
    .values(
      fixture.recipes.map((r) => {
        const savedAt = daysAgoAt(base, r.savedDaysAgo);
        return {
          householdId,
          name: r.name,
          description: r.description,
          ingredients: JSON.stringify(r.ingredients),
          steps: JSON.stringify(r.steps),
          tags: JSON.stringify(r.tags),
          savedAt,
          updatedAt: savedAt,
        };
      })
    )
    .returning({ id: schema.recipes.id, name: schema.recipes.name });
  // Names are unique per household (fixtureCheck rule 2), so map by name, not RETURNING order.
  const recipeKeyByName = new Map(fixture.recipes.map((r) => [r.name, r.key]));
  const keyById = new Map();
  const idByKey = new Map();
  for (const row of recipeRows) {
    const key = recipeKeyByName.get(row.name);
    keyById.set(`recipe:${row.id}`, key);
    idByKey.set(key, { source_type: 'recipe', source_id: row.id });
  }

  // Meal logs are not unique by content, so insert one per statement to map ids to keys exactly.
  const queue = [...fixture.mealLogs];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const [row] = await db
        .insert(schema.mealLogs)
        .values({
          householdId,
          itemName: m.itemName,
          category: m.category,
          wasExpiring: m.wasExpiring,
          loggedAt: daysAgoAt(base, m.loggedDaysAgo),
          source: 'eval',
        })
        .returning({ id: schema.mealLogs.id });
      keyById.set(`meal_log:${row.id}`, m.key);
      idByKey.set(m.key, { source_type: 'meal_log', source_id: row.id });
    }
  };
  await Promise.all(Array.from({ length: MEAL_LOG_INSERT_CONCURRENCY }, worker));

  return { householdId, keyById, idByKey, recipeRows };
}

/** The backfill script's loop (server/scripts/backfillSearchDocuments.js), run in-process. */
export async function runBackfill({ reconcileHousehold, BACKFILL_EMBED_BATCH }, householdId) {
  let tokens = 0;
  const passes = [];
  for (;;) {
    const res = await reconcileHousehold(householdId, { embedBudget: BACKFILL_EMBED_BATCH });
    tokens += res.embedTokens ?? 0;
    passes.push({ upserted: res.upserted, embedded: res.embedded, pending: res.pending, docCount: res.docCount });
    if (res.pending === 0) return { passes, tokens, docCount: res.docCount, pending: 0 };
    if (!res.embedded) throw new Error(`backfill made no progress (pending=${res.pending})`);
  }
}

/** Fingerprint of the household's persisted index: any doc/embedding change alters it. */
export async function indexStateHash({ db, sql }, householdId) {
  const res = await db.execute(sql`
    SELECT count(*)::int AS docs,
           count(*) FILTER (WHERE embedding IS NULL OR embedded_hash IS DISTINCT FROM content_hash)::int AS pending,
           md5(string_agg(concat_ws(':', id, source_type, source_id, content_hash, embedded_hash, embedding_model,
                                    md5(embedding::text)), ',' ORDER BY id)) AS hash
      FROM search_documents WHERE household_id = ${householdId}`);
  return rowsOf(res)[0];
}

export async function teardownHousehold({ db, sql }, householdId) {
  await db.execute(sql`DELETE FROM households WHERE id = ${householdId}`);
}
