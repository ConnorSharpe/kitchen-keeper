# ADR-0003: Exact vector scan filtered by household; no ANN index

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** TASK-069 (spec §2.1 D4; §2.5 step 6; §2.11)

## Context

pgvector supports approximate nearest-neighbour (ANN) indexes (HNSW, IVFFlat). Every query here is
restricted to one household, which is a highly selective filter over a table shared by all households.

## Decision

Build **no ANN index**. The vector candidate query filters to the household's rows (the btree index
`idx_search_documents_household (household_id, source_type)` is available for that), then computes exact
distances and sorts by `embedding <=> $q`.

## Alternatives rejected

- **HNSW / IVFFlat with a household filter:** the index finds nearest neighbours across *all* households
  first, then the tenant filter is applied. With a selective filter, this can silently return **fewer than
  k results**, or none, even though matching household rows exist. That is a correctness failure that looks
  like "no results", not an error. Mitigations (iterative scans, partitioning, per-tenant indexes) add
  complexity for a problem that doesn't exist at current sizes.

## Revisit trigger (telemetry-driven)

Every search logs `retrieval-search` with flat fields including `docCount` (the household's document count),
`pending`, `mode`, `reconcileMs`, and `searchMs`. Revisit ANN when the **observed per-search distribution**
of `docCount` or p95 `searchMs` reaches thresholds set from this production telemetry plus the eval's
latency curve. **No threshold is chosen in advance.**

- No household identifier is logged. The trigger needs the distribution of per-search counts and timings,
  which the events carry without identifying anyone.
- The eval does **not** stand in for this. It measures retrieval quality and small-corpus latency on about
  500 documents (hybrid search p50 468 ms / p95 857 ms, dominated by the query embedding call, not the
  scan). It does not validate exact-scan behavior at larger household sizes.

## Consequences

- Results are exact and complete for the household: k requested, k returned whenever k eligible rows exist.
- Query cost grows linearly with household size. The telemetry exists to show when that matters.
- Adding an ANN index later is additive: a new index plus a check that filtered recall holds.
