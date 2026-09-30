// TASK-069 retrieval knobs (spec §2.4, §2.5). The RRF constant is named distinctly from the
// four count-like knobs so they can't be confused.

/** Rows fetched by each candidate query (vector and lexical) before fusion. */
export const CANDIDATE_LIMIT = 20;

/** Max texts embedded by the reconcile a chat search runs. Bounds per-search work. */
export const INTERACTIVE_EMBED_BUDGET = 25;

/** Texts embedded per reconcile pass by the backfill script. */
export const BACKFILL_EMBED_BATCH = 100;

/** Reciprocal-rank-fusion rank constant (score = Σ 1 / (RRF_RANK_CONSTANT + rank)). */
export const RRF_RANK_CONSTANT = 60;
