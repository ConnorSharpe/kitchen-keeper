# ADR-0005: Retrieval index identity and tenancy

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** TASK-069 (spec §0.4; §2.1 D2; §2.2; §2.4; §2.5; spec criterion 10)

## Context

`search_documents` is one table for all source types (`source_type`, `source_id`), not an `embedding`
column on each source table. That keeps domain tables free of the retrieval model and FTS/versioning
metadata, but it means there is **no foreign key to the source row**. The index is shared by every
household, so it must never become a second store with weaker tenancy guarantees than the source tables.

Posture: the index is **derived, household-scoped, rebuildable, and optional**. Source tables stay
authoritative. It can be truncated and rebuilt by the backfill.

## Decision: identity is `UNIQUE (source_type, source_id)`

`recipes.id` and `meal_logs.id` each come from one table-wide `SERIAL` sequence (gate G6), so
`(source_type, source_id)` identifies exactly one source row in the whole database.

Review proposed the composite `UNIQUE (household_id, source_type, source_id)`. It was **declined because
it is the weaker constraint**. It permits two documents for one recipe under different households. That
state could only arise from a bug, and it would then be a cross-tenant leak waiting to be served. The
global key makes it unrepresentable.

## Decision: where tenancy is enforced

Tenancy is enforced where reads and writes happen, not by the uniqueness key:

- **Writes.** A doc's `household_id` is copied only from its source row, never from a caller.
  `reconcileHousehold(h)` reads only household `h`'s source rows and writes or deletes only `h`'s docs,
  orphan GC included. No indexer statement is unscoped.
- **Joins.** Every reconcile join matches both `source.id = doc.source_id` **and**
  `source.household_id = doc.household_id`.
- **Conflict guard.** The upsert's `ON CONFLICT … DO UPDATE … WHERE search_documents.household_id =
  EXCLUDED.household_id` updates nothing on a household mismatch. The mismatch is logged as an integrity
  error (`retrieval-integrity`) and reported to Sentry.
- **Reads.** Both candidate queries and the source join are household-constrained before ranking.
  Inside the service, `(source_type, source_id)` is a valid identity **only after** household scoping.
- **Tool boundary.** The agent tool handler passes the session's `ctx.householdId`, never a model-supplied
  id. Results go back as structured, untrusted tool-result JSON (snippets ≤ 300 chars), never as instructions.
- **Deletion.** `household_id` references `households(id) ON DELETE CASCADE`, matching how source rows are
  removed with a household.

## Alternatives rejected

- **An `embedding` column on each source table:** couples domain tables to the retrieval model and
  duplicates FTS and model-versioning metadata per table.
- **Composite household-aware key:** see above.

## Consequences

- There is no FK to the source, so orphan handling is per source type and household-scoped (ADR-0004).
- Tenancy is proven semantically, against real Postgres (spec criterion 10): with two households holding
  **identical** recipe and meal-log content, search in each of lexical, vector, and hybrid mode returns exactly
  the caller's ids; reconciling A leaves B's docs byte-identical; A's reconcile never deletes B's orphan;
  and a mismatched-household conflict updates nothing.
- If the SERIAL assumption ever changes (e.g. per-household ids), this key must be revisited first.
