import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logServerEvent, captureExceptionSafely } from '../../instrument.js';
import { resolveProvider } from '../ai/resolveProvider.js';
import { EMBEDDING_MODEL } from '../ai/openaiProvider.js';
import { reconcileHousehold } from './indexer.js';
import { reciprocalRankFusion } from './fusion.js';
import { CANDIDATE_LIMIT, INTERACTIVE_EMBED_BUDGET, RRF_RANK_CONSTANT } from './constants.js';

// TASK-069 §2.5: hybrid (FTS + vector, RRF-fused) search over one household's search_documents.
//
// Tenancy invariant: no query here can read another household's rows. Both candidate queries and
// the source join are constrained by household id before ranking.
// Retrieval identity inside this module is (source_type, source_id). That is unique database-wide
// (global serials, spec §2.2) but is only used AFTER household scoping; never key on it unscoped.

const SNIPPET_MAX = 300;

/** A lexical-candidate or source-join failure: the floor the design guarantees is gone. */
export class SearchUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SearchUnavailableError';
    this.cause = cause;
  }
}

const rowsOf = (res) => res?.rows ?? res ?? [];
const keyOf = (row) => `${row.source_type}:${row.source_id}`;
const toIso = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

// Filters go inside BOTH candidate queries, before ranking, never after fusion.
function filtersSql({ sourceTypes, dateFrom, dateTo }) {
  const parts = [];
  if (sourceTypes?.length) {
    parts.push(sql` AND source_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(sourceTypes)}::jsonb))`);
  }
  if (dateFrom != null) parts.push(sql` AND occurred_at >= ${toIso(dateFrom)}::timestamptz`);
  if (dateTo != null) parts.push(sql` AND occurred_at < ${toIso(dateTo)}::timestamptz`);
  return sql.join(parts, sql``);
}

async function vectorCandidates(householdId, queryVector, filters) {
  const res = await db.execute(sql`
    SELECT id, source_type, source_id
      FROM search_documents
     WHERE household_id = ${householdId}
       AND embedding IS NOT NULL AND embedding_model = ${EMBEDDING_MODEL} AND embedded_hash = content_hash
       ${filters}
     ORDER BY embedding <=> ${`[${queryVector.join(',')}]`}::vector ASC, id ASC
     LIMIT ${CANDIDATE_LIMIT}`);
  return rowsOf(res);
}

async function lexicalCandidates(householdId, query, filters) {
  const res = await db.execute(sql`
    SELECT id, source_type, source_id
      FROM search_documents, websearch_to_tsquery('english', ${query}) AS q
     WHERE household_id = ${householdId} AND content_tsv @@ q
       ${filters}
     ORDER BY ts_rank_cd(content_tsv, q) DESC, id ASC
     LIMIT ${CANDIDATE_LIMIT}`);
  return rowsOf(res);
}

// Household-matched join back to the live source rows; docs whose source is gone drop out.
async function joinSources(householdId, docIds) {
  const res = await db.execute(sql`
    SELECT d.source_type, d.source_id, COALESCE(r.name, m.item_name) AS title,
           d.content, d.occurred_at
      FROM search_documents d
      LEFT JOIN recipes r
        ON d.source_type = 'recipe' AND r.id = d.source_id AND r.household_id = ${householdId}
      LEFT JOIN meal_logs m
        ON d.source_type = 'meal_log' AND m.id = d.source_id AND m.household_id = ${householdId}
     WHERE d.household_id = ${householdId}
       AND d.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(docIds)}::jsonb)::int)
       AND (r.id IS NOT NULL OR m.id IS NOT NULL)`);
  return rowsOf(res);
}

/**
 * @param {number} householdId  the caller's household (never model-supplied)
 * @param {{ query: string, sourceTypes?: string[], dateFrom?: Date|string, dateTo?: Date|string,
 *           limit?: number }} params  dateTo is EXCLUSIVE
 * @param {{ mode?: 'hybrid'|'vector'|'lexical' }} [options]  mode override for the eval harness only
 * @returns {Promise<{ mode: string, results: Array<{ source_type, source_id, title, snippet, occurred_at }> }>}
 *   mode is 'hybrid' when the query embedding and vector query succeeded (even with zero vector
 *   candidates), else 'lexical_only'. Rejects with SearchUnavailableError when the lexical
 *   candidate query or the source join fails.
 */
export async function searchRecipesAndMeals(
  householdId,
  { query, sourceTypes, dateFrom, dateTo, limit = 5 } = {},
  { mode: modeOverride } = {}
) {
  // Reconcile is its own failure domain: it never decides `mode`.
  const reconcileStart = performance.now();
  let reconcile = null;
  try {
    reconcile = await reconcileHousehold(householdId, { embedBudget: INTERACTIVE_EMBED_BUDGET });
  } catch (err) {
    captureExceptionSafely(err);
  }
  const reconcileMs = Math.round(performance.now() - reconcileStart);

  const searchStart = performance.now();
  const filters = filtersSql({ sourceTypes, dateFrom, dateTo });
  const wantVector = modeOverride !== 'lexical';
  const wantLexical = modeOverride !== 'vector';

  let queryEmbed = 'skipped';
  let vectorList = null;
  if (wantVector) {
    let queryVector = null;
    try {
      [queryVector] = await resolveProvider().embed([query]);
      queryEmbed = 'ok';
    } catch {
      queryEmbed = 'failed'; // degrade to lexical_only; not an error worth capturing per search
    }
    if (queryVector) {
      try {
        vectorList = await vectorCandidates(householdId, queryVector, filters);
      } catch (err) {
        captureExceptionSafely(err);
      }
    }
  }

  let lexicalList = null;
  if (wantLexical) {
    try {
      lexicalList = await lexicalCandidates(householdId, query, filters);
    } catch (err) {
      throw new SearchUnavailableError('lexical candidate query failed', err);
    }
  }

  const candidates = new Map();
  for (const row of [...(vectorList ?? []), ...(lexicalList ?? [])]) candidates.set(keyOf(row), row);
  const fused = reciprocalRankFusion(
    [(vectorList ?? []).map(keyOf), (lexicalList ?? []).map(keyOf)],
    { rankConstant: RRF_RANK_CONSTANT }
  );

  let results = [];
  if (fused.length) {
    let sources;
    try {
      sources = await joinSources(householdId, fused.map((f) => candidates.get(f.id).id));
    } catch (err) {
      throw new SearchUnavailableError('source join failed', err);
    }
    const byKey = new Map(sources.map((row) => [keyOf(row), row]));
    results = fused
      .map((f) => byKey.get(f.id))
      .filter(Boolean)
      .slice(0, limit)
      .map((row) => ({
        source_type: row.source_type,
        source_id: row.source_id,
        title: row.title,
        snippet: String(row.content ?? '').slice(0, SNIPPET_MAX),
        occurred_at: row.occurred_at,
      }));
  }

  const mode = modeOverride ?? (vectorList ? 'hybrid' : 'lexical_only');
  logServerEvent('retrieval-search', {
    mode,
    queryEmbed,
    reconcileEmbed: reconcile?.reconcileEmbed ?? 'failed',
    vectorCandidates: vectorList?.length ?? null,
    lexicalCandidates: lexicalList?.length ?? null,
    results: results.length,
    docCount: reconcile?.docCount ?? null,
    pending: reconcile?.pending ?? null,
    reconcileMs,
    searchMs: Math.round(performance.now() - searchStart),
  });
  return { mode, results };
}
