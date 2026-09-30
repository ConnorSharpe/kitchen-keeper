# ADR-0004: Lazy indexing at search time, with a bounded budget and at-least-once semantics

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** TASK-069 (spec §2.1 D5; §2.2; §2.4; §2.5 date contract; §2.9)

## Context

`search_documents` must track recipes and meal logs as they change. Recipe writes happen in
`recipeService.js`. The runtime is Vercel serverless over neon-http, which has no interactive transactions.

## Decision

The index is **reconciled lazily**. Every agent search first calls `reconcileHousehold(householdId,
{ embedBudget: 25 })`, and a guarded backfill script loops with a batch of 100 until nothing is pending.
There are **no write-path hooks**. The recipe and meal-log services don't know the index exists, and that
absence *is* the design.

Reconcile, all household-scoped:

1. **Detect changes.** A recipe needs indexing when it has no doc or its stored `source_fingerprint`
   differs from `md5(json_build_array(name, description, tags, ingredients, steps, saved_at)::text)` over
   the live row. Meal logs are immutable, so they are missing-only.
2. **Guarded upsert.** One statement locks the source row `FOR SHARE` in a CTE, re-checks the fingerprint in
   the locking `WHERE`, and upserts only if it still matches. A concurrent recipe update that commits first
   makes the write a no-op; one that starts later waits for it. The composition inside a data-modifying CTE
   isn't explicitly documented, so it was proven empirically over the production HTTP transport (gate G9,
   lock wait observed in `pg_stat_activity`) and is kept as a regression test.
3. **Garbage-collect orphans**, per source type and household.
4. **Embed within budget**, in a deterministic priority order: never embedded, then content changed, then
   model changed. Each embedding write is conditional on `content_hash` still matching what was embedded.

## Alternatives rejected

- **Write-path hooks** (index on every recipe save): couples every domain write to a second,
  non-transactional write and an external API call. A failed hook then means a failed or slow user save.
- **`waitUntil` / background work after the response:** a Vercel-specific second code path, and it still
  couples indexing to writes.
- **`updated_at`-based staleness:** two snapshots can share a millisecond timestamp, and writes that don't
  bump `updated_at` (manual SQL, a future path) would be missed. A content fingerprint has neither problem.

## Semantics

- **Bounded interactive work.** A chat search never tries to make the whole corpus current: at most 25
  embeddings per search, whatever the household's size. Rows over budget stay lexically searchable and join
  the vector ranking later. In the eval, a cold search with 25 pending took p50 1.5 s / p95 2.9 s.
- **At-least-once and idempotent.** Partial persistence, concurrent reconciles of one household, or a
  successful embed followed by a failed write can embed a document twice. That duplicate cost is
  accepted. Correctness holds because every write is an idempotent upsert keyed by source identity and hash.
  `retrieval-embed` telemetry (`tokens`, `failures`, `conditionalWritesSkipped`) makes the duplicate work
  observable in production.
- **No starvation for a fixed pending set.** Repeated successful reconciles process every pending row in
  order. No completion bound is claimed under continual churn.
- **`pending`** is an index-health count: rows *not* eligible for vector search, measured at the end of the
  reconcile. It is not "candidates minus embedded".
- **Failure isolation.** Any reconcile failure (DB or embedding, any step) is logged and contained. The
  search continues and `mode` is unaffected (ADR-0002).
- **Favorite toggles** change neither content nor fingerprint, so they cost no write and no embed.

## Recorded divergences and caveats

- **Timestamps.** `search_documents.occurred_at` is `TIMESTAMPTZ`, unlike the repo's `TEXT` convention,
  because date filtering is a core retrieval semantic. Source text is cast with `::timestamptz` at index
  time (gate G7: every existing value parses).
- **UTC date boundary.** Tool date filters are inclusive calendar dates, normalized to a half-open UTC
  interval. The app stores no household timezone, so a meal logged late in the evening far from UTC can land
  on the next UTC date. Accepted.
- **Orphan GC for meal logs future-proofs the index, not the domain model.** Meal logs have no supported
  delete path today (gate G4). This GC existing is not evidence that they do.
- **drizzle-kit.** `0022` was hand-written and `db:generate` was not run. Any future `db:generate` output
  must be checked against the `vector` / `tsvector` custom types and the generated `content_tsv` column
  before it is trusted.
