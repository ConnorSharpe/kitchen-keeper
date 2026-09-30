# ADR-0002: Hybrid retrieval: Postgres full-text + vector, fused with RRF

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** TASK-069 (spec §2.1 D3; §2.5; §7 R1)

## Context

Kitchen queries come in two shapes. Exact rare terms ("sumac", "mirin") need precise lexical matching.
Paraphrases ("that spicy Korean fermented cabbage", "a light summer dessert") need semantic matching.
Neither retriever alone handles both.

## Decision

`searchRecipesAndMeals` runs two household-scoped candidate queries, `CANDIDATE_LIMIT = 20` each:

- **Lexical:** `content_tsv @@ websearch_to_tsquery('english', $query)`, ordered by `ts_rank_cd DESC, id ASC`.
- **Vector:** eligible rows only (`embedding IS NOT NULL AND embedding_model = $currentModel AND
  embedded_hash = content_hash`), ordered by cosine distance `embedding <=> $q ASC, id ASC`.

The two lists are fused with **Reciprocal Rank Fusion**: `score = Σ 1 / (60 + rank)`, with a deterministic
tie-break (`fusion.js`, `RRF_RANK_CONSTANT = 60`). Source-type and date filters are applied **inside both
candidate queries, before ranking**. Filtering after fusion could discard all 40 candidates while in-range
matches exist.

RRF was chosen because it uses ranks only. `ts_rank_cd` and cosine distance are on unrelated scales, and
RRF needs no score calibration between them.

## Alternatives rejected

- **Vector only:** weak on exact rare terms. In the eval, vector alone missed `mirin` and ranked `sumac` third.
- **Lexical only:** misses paraphrase. In the eval, lexical alone failed 5 of 8 paraphrase queries.
- **Weighted score blending:** needs per-retriever normalization and a tuned weight, and there is no
  held-out data to tune it on.
- **A reranker model:** out of scope for Phase A.

## `mode` semantics

`mode` describes the **retrieval strategy attempted**, not how many candidates each leg produced:

| Index state | Query embedding | `mode` |
|---|---|---|
| fully, partially, or not at all embedded | succeeds | `hybrid` |
| any | fails (or the vector query errors) | `lexical_only` |

- **"Hybrid results equal lexical order" when no vector candidates exist is correct behavior, never a
  failure.** An un-embedded index yields an empty vector list, and RRF over one list is that list's order.
  "Fixing" this to `lexical_only` would break the eval's mode semantics.
- A reconcile failure never produces `lexical_only`. Reconciliation and query embedding are separate
  failure domains (ADR-0004).
- The lexical query is the floor. If it fails, the tool returns `{ ok: false, error: 'search_unavailable' }`,
  never a vector-only partial result, and the chat turn continues as it would without the tool.

## Language assumption (spec §7 R1)

Content, queries, and stemming are **English** (`to_tsvector('english', …)`, generated as a stored column).
Supporting other languages would be a retrieval-architecture change (per-row language, per-language
configs, query-language detection), not a config tweak.

## Consequences

- Measured on the 40-query golden set, hybrid recall@5 is **0.906**, against lexical 0.719 and vector
  0.844. It never loses to either single mode in any category
  ([results](../eval/TASK-069-results.md)).
- Remaining shared misses are synonym gaps (`garbanzo beans` vs *chickpeas*, `sesame paste` vs *tahini*)
  and `websearch_to_tsquery` AND-ing every non-stop-word term (`what uses tahini` requires *use* too).
- **No relevance floor (OQ5).** With a vector leg, some results come back for every query, including
  queries with no relevant answer. The eval's negative/positive distance distributions overlap, so no
  threshold was chosen. A future floor must be tuned on a separate held-out split.
- Rows are lexically searchable the moment they are indexed. They join the vector ranking once embedded.
