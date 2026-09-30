import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logServerEvent, captureExceptionSafely } from '../../instrument.js';
import { resolveProvider } from '../ai/resolveProvider.js';
import { EMBEDDING_MODEL } from '../ai/openaiProvider.js';
import { buildRecipeDocument, buildMealLogDocument } from './documents.js';
import { INTERACTIVE_EMBED_BUDGET } from './constants.js';

// TASK-069 §2.4: lazy, household-scoped reconciliation of the search_documents index.
//
// Tenancy invariant: reconcileHousehold(householdId) reads only that household's source rows and
// writes only search_documents rows with that household_id. Every statement below carries the
// household id; none is unscoped.

/** The recipe columns the fingerprint covers. Must equal documents.js RECIPE_BUILDER_FIELDS. */
export const RECIPE_FINGERPRINT_COLUMNS = Object.freeze([
  'name',
  'description',
  'tags',
  'ingredients',
  'steps',
  'saved_at',
]);

/**
 * Content-change fingerprint over a `recipes` alias named `r`: the G9-proven expression
 * md5(json_build_array(...)::text). JSON encoding makes field boundaries and NULL unambiguous.
 * md5 is a change detector here, not a security primitive. Excludes is_favorite and updated_at.
 */
export const RECIPE_FINGERPRINT_SQL = `md5(json_build_array(${RECIPE_FINGERPRINT_COLUMNS.map((c) => `r.${c}`).join(', ')})::text)`;

const FINGERPRINT = sql.raw(RECIPE_FINGERPRINT_SQL);

// Complement of searchService's vector-eligibility predicate (§2.4 `pending` definition).
const NOT_VECTOR_ELIGIBLE = sql`(embedding IS NULL OR embedding_model <> ${EMBEDDING_MODEL} OR embedded_hash <> content_hash)`;

const rowsOf = (res) => res?.rows ?? res ?? [];

/**
 * Authoritative-snapshot guarded upsert (§2.4 step 1b, §8 G9). One statement for the whole
 * batch: each recipe row is locked FOR SHARE (in id order) with the fingerprint check in the
 * locking WHERE, so a snapshot is written only if it is still the recipe's latest committed state.
 * Never touches the embedding columns.
 *
 * @param {number} householdId
 * @param {Array<{ sourceId: number, fingerprint: string, content: string,
 *                 contentHash: string, occurredAt: string }>} snapshots
 * @returns {Promise<{ written: number[] }>} source ids inserted or updated, ascending. A snapshot
 *   missing from `written` had a stale fingerprint, a deleted recipe, or a household mismatch on
 *   conflict. Rejects on a database error.
 */
export async function upsertRecipeDocuments(householdId, snapshots) {
  if (!snapshots.length) return { written: [] };
  const payload = JSON.stringify(
    snapshots.map((s) => ({
      source_id: s.sourceId,
      fingerprint: s.fingerprint,
      content: s.content,
      content_hash: s.contentHash,
      occurred_at: s.occurredAt,
    }))
  );
  const res = await db.execute(sql`
    WITH v AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
        AS v(source_id int, fingerprint text, content text, content_hash text, occurred_at text)
    ),
    src AS (
      SELECT r.id FROM recipes r JOIN v ON v.source_id = r.id
      WHERE r.household_id = ${householdId}
        AND ${FINGERPRINT} = v.fingerprint
      ORDER BY r.id
      FOR SHARE OF r
    )
    INSERT INTO search_documents
      (household_id, source_type, source_id, content, content_hash, occurred_at, source_fingerprint)
    SELECT ${householdId}, 'recipe', src.id, v.content, v.content_hash, v.occurred_at::timestamptz, v.fingerprint
      FROM src JOIN v ON v.source_id = src.id
    ON CONFLICT (source_type, source_id) DO UPDATE SET
      content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, occurred_at = EXCLUDED.occurred_at,
      source_fingerprint = EXCLUDED.source_fingerprint, updated_at = now()
    WHERE search_documents.household_id = EXCLUDED.household_id
    RETURNING search_documents.source_id`);
  const written = rowsOf(res)
    .map((r) => Number(r.source_id))
    .sort((a, b) => a - b);
  return { written };
}

// Docs for this household's own (unwritten) recipes that claim another household: an
// integrity error (spec §2.2 identity). Only runs when some snapshots were not written.
async function countHouseholdMismatches(householdId, sourceIds) {
  const res = await db.execute(sql`
    SELECT count(*)::int AS c
      FROM search_documents d
      JOIN recipes r ON r.id = d.source_id AND r.household_id = ${householdId}
     WHERE d.source_type = 'recipe' AND d.household_id <> ${householdId}
       AND d.source_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(sourceIds)}::jsonb)::int)`);
  return rowsOf(res)[0]?.c ?? 0;
}

// Recipes with no doc or a doc whose fingerprint differs from the live row, as upsert snapshots.
async function detectRecipeSnapshots(householdId) {
  const res = await db.execute(sql`
    SELECT r.id, r.name, r.description, r.tags, r.ingredients, r.steps, r.saved_at,
           ${FINGERPRINT} AS fingerprint
      FROM recipes r
      LEFT JOIN search_documents d
        ON d.source_type = 'recipe' AND d.source_id = r.id AND d.household_id = r.household_id
     WHERE r.household_id = ${householdId}
       AND (d.id IS NULL OR d.source_fingerprint IS DISTINCT FROM ${FINGERPRINT})
     ORDER BY r.id`);
  // Builder input and fingerprint come from the same read.
  return rowsOf(res).map((row) => {
    const doc = buildRecipeDocument(row);
    return {
      sourceId: row.id,
      fingerprint: row.fingerprint,
      content: doc.content,
      contentHash: doc.contentHash,
      occurredAt: doc.occurredAt,
    };
  });
}

async function indexRecipes(householdId) {
  const snapshots = await detectRecipeSnapshots(householdId);
  const { written } = await upsertRecipeDocuments(householdId, snapshots);

  if (written.length < snapshots.length) {
    const writtenIds = new Set(written);
    const unwritten = snapshots.map((s) => s.sourceId).filter((id) => !writtenIds.has(id));
    const mismatches = await countHouseholdMismatches(householdId, unwritten);
    if (mismatches > 0) {
      logServerEvent('retrieval-integrity', { householdMismatches: mismatches });
      captureExceptionSafely(new Error(`search_documents household mismatch on ${mismatches} recipe doc(s)`));
    }
  }
  return written.length;
}

// Meal logs are immutable (G4): missing-only, no fingerprint, no lock.
async function detectMealLogDocs(householdId) {
  const res = await db.execute(sql`
    SELECT m.id, m.item_name, m.category, m.was_expiring, m.logged_at
      FROM meal_logs m
      LEFT JOIN search_documents d
        ON d.source_type = 'meal_log' AND d.source_id = m.id AND d.household_id = m.household_id
     WHERE m.household_id = ${householdId} AND d.id IS NULL
     ORDER BY m.id`);
  return rowsOf(res).map((row) => {
    const doc = buildMealLogDocument(row);
    return { source_id: row.id, content: doc.content, content_hash: doc.contentHash, occurred_at: doc.occurredAt };
  });
}

async function indexMealLogs(householdId) {
  const docs = await detectMealLogDocs(householdId);
  if (!docs.length) return 0;
  const payload = JSON.stringify(docs);
  const inserted = await db.execute(sql`
    INSERT INTO search_documents (household_id, source_type, source_id, content, content_hash, occurred_at)
    SELECT ${householdId}, 'meal_log', m.id, v.content, v.content_hash, v.occurred_at::timestamptz
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS v(source_id int, content text, content_hash text, occurred_at text)
      JOIN meal_logs m ON m.id = v.source_id AND m.household_id = ${householdId}
    ON CONFLICT (source_type, source_id) DO NOTHING
    RETURNING source_id`);
  return rowsOf(inserted).length;
}

async function deleteOrphans(householdId) {
  const recipes = await db.execute(sql`
    DELETE FROM search_documents d
     WHERE d.household_id = ${householdId} AND d.source_type = 'recipe'
       AND NOT EXISTS (SELECT 1 FROM recipes r WHERE r.id = d.source_id AND r.household_id = ${householdId})
    RETURNING d.id`);
  // Future-proofs the derived index only: meal logs have no supported delete lifecycle (G4).
  const mealLogs = await db.execute(sql`
    DELETE FROM search_documents d
     WHERE d.household_id = ${householdId} AND d.source_type = 'meal_log'
       AND NOT EXISTS (SELECT 1 FROM meal_logs m WHERE m.id = d.source_id AND m.household_id = ${householdId})
    RETURNING d.id`);
  return rowsOf(recipes).length + rowsOf(mealLogs).length;
}

// §2.4 step 3: embed up to `budget` pending rows in priority order, in one API call.
async function embedPending(householdId, budget, stats) {
  const res = await db.execute(sql`
    SELECT id, content, content_hash
      FROM search_documents
     WHERE household_id = ${householdId} AND ${NOT_VECTOR_ELIGIBLE}
     ORDER BY CASE WHEN embedding IS NULL THEN 1
                   WHEN embedded_hash <> content_hash THEN 2
                   ELSE 3 END,
              source_type ASC, source_id ASC
     LIMIT ${budget}`);
  const rows = rowsOf(res);
  if (!rows.length) return 0;

  stats.batches += 1;
  stats.textsRequested += rows.length;
  const vectors = await resolveProvider().embed(
    rows.map((r) => r.content),
    { onUsage: (tokens) => (stats.tokens += tokens ?? 0) }
  );

  // Conditional write: only if the row still holds the content that was embedded.
  const payload = JSON.stringify(
    rows.map((r, i) => ({ id: r.id, content_hash: r.content_hash, embedding: `[${vectors[i].join(',')}]` }))
  );
  const updated = await db.execute(sql`
    UPDATE search_documents d
       SET embedding = v.embedding::vector, embedding_model = ${EMBEDDING_MODEL}, embedded_hash = v.content_hash
      FROM jsonb_to_recordset(${payload}::jsonb) AS v(id int, content_hash text, embedding text)
     WHERE d.id = v.id AND d.household_id = ${householdId} AND d.content_hash = v.content_hash
    RETURNING d.id`);
  const embedded = rowsOf(updated).length;
  stats.conditionalWritesSkipped += rows.length - embedded;
  return embedded;
}

async function countIndex(householdId) {
  const res = await db.execute(sql`
    SELECT count(*)::int AS doc_count,
           count(*) FILTER (WHERE ${NOT_VECTOR_ELIGIBLE})::int AS pending,
           count(*) FILTER (WHERE source_type = 'recipe')::int AS recipe_docs,
           count(*) FILTER (WHERE source_type = 'meal_log')::int AS meal_log_docs
      FROM search_documents
     WHERE household_id = ${householdId}`);
  return rowsOf(res)[0] ?? null;
}

/**
 * Read-only preview of what reconcileHousehold would do (the backfill script's dry run). Issues
 * only SELECTs and makes no embedding call.
 *
 * @returns {Promise<{ toUpsert: number, toDelete: number, toEmbed: number, embedChars: number }>}
 *   toEmbed/embedChars cover the docs that would be (re)written plus the existing pending docs
 *   that are not being rewritten.
 */
export async function planReconcile(householdId) {
  const recipes = await detectRecipeSnapshots(householdId);
  const mealLogs = await detectMealLogDocs(householdId);
  const orphans = await db.execute(sql`
    SELECT count(*)::int AS c
      FROM search_documents d
     WHERE d.household_id = ${householdId}
       AND ((d.source_type = 'recipe'
             AND NOT EXISTS (SELECT 1 FROM recipes r WHERE r.id = d.source_id AND r.household_id = ${householdId}))
         OR (d.source_type = 'meal_log'
             AND NOT EXISTS (SELECT 1 FROM meal_logs m WHERE m.id = d.source_id AND m.household_id = ${householdId})))`);
  const pending = await db.execute(sql`
    SELECT source_type, source_id, length(content)::int AS chars
      FROM search_documents
     WHERE household_id = ${householdId} AND ${NOT_VECTOR_ELIGIBLE}`);

  const rewritten = new Set([
    ...recipes.map((s) => `recipe:${s.sourceId}`),
    ...mealLogs.map((d) => `meal_log:${d.source_id}`),
  ]);
  const pendingKept = rowsOf(pending).filter((r) => !rewritten.has(`${r.source_type}:${r.source_id}`));
  return {
    toUpsert: rewritten.size,
    toDelete: rowsOf(orphans)[0]?.c ?? 0,
    toEmbed: rewritten.size + pendingKept.length,
    embedChars:
      recipes.reduce((n, s) => n + s.content.length, 0) +
      mealLogs.reduce((n, d) => n + d.content.length, 0) +
      pendingKept.reduce((n, r) => n + r.chars, 0),
  };
}

function logFailure(step, err) {
  logServerEvent('retrieval-reconcile', { step, error: String(err?.message ?? err) });
  captureExceptionSafely(err);
}

/**
 * Brings one household's search_documents up to date with its recipes and meal logs, then embeds
 * up to `embedBudget` pending rows. At-least-once and idempotent. Never throws: every failure is
 * logged and leaves rows pending.
 *
 * @param {number} householdId
 * @param {{ embedBudget?: number }} [options]  0 = index only, no embed call
 * @returns {Promise<{ upserted: number, deleted: number, embedded: number, pending: number|null,
 *   docCount: number|null, reconcileEmbed: 'ok'|'failed'|'skipped', embedTokens: number }>}
 *   - upserted: docs inserted or updated this run (recipes written + meal logs inserted)
 *   - deleted: orphan docs removed this run
 *   - embedded: embeddings actually written this run (conditional writes that hit 0 rows excluded)
 *   - pending: INDEX-HEALTH count of this household's docs that are not vector-eligible
 *     (embedding IS NULL, other model, or stale hash), measured after this run. It is NOT
 *     `candidates − embedded`. null if the count itself failed.
 *   - docCount: total docs for the household after this run (null if the count failed)
 *   - reconcileEmbed: outcome of the embed step
 *   - embedTokens: billed tokens (usage.prompt_tokens) for this run's embed call, 0 if none
 */
export async function reconcileHousehold(householdId, { embedBudget = INTERACTIVE_EMBED_BUDGET } = {}) {
  const result = { upserted: 0, deleted: 0, embedded: 0, pending: null, docCount: null, reconcileEmbed: 'skipped' };
  const stats = { batches: 0, textsRequested: 0, tokens: 0, failures: 0, conditionalWritesSkipped: 0 };

  try {
    result.upserted += await indexRecipes(householdId);
  } catch (err) {
    logFailure('index-recipes', err);
  }
  try {
    result.upserted += await indexMealLogs(householdId);
  } catch (err) {
    logFailure('index-meal-logs', err);
  }
  try {
    result.deleted = await deleteOrphans(householdId);
  } catch (err) {
    logFailure('delete-orphans', err);
  }
  if (embedBudget > 0) {
    try {
      result.embedded = await embedPending(householdId, embedBudget, stats);
      if (stats.batches > 0) result.reconcileEmbed = 'ok';
    } catch (err) {
      stats.failures += 1;
      result.reconcileEmbed = 'failed';
      logFailure('embed', err);
    }
  }
  try {
    const counts = await countIndex(householdId);
    if (counts) {
      result.pending = counts.pending;
      result.docCount = counts.doc_count;
      stats.recipeDocs = counts.recipe_docs;
      stats.mealLogDocs = counts.meal_log_docs;
    }
  } catch (err) {
    logFailure('count', err);
  }

  logServerEvent('retrieval-embed', stats);
  result.embedTokens = stats.tokens;
  return result;
}
