# TASK-069 Eval Results: Hybrid Retrieval and the Chat Agent Tool

| | |
|---|---|
| Date | 2026-09-30 (retrieval run 03:08Z, agent run 03:15Z) |
| Commit | `4c4df4d` (harness as committed). Tree dirty only in files unrelated to the eval (`.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md`) plus, for the agent run, the retrieval results file the previous run had just written |
| Models | embeddings `text-embedding-3-small` (1536-d); chat `gpt-4o-mini` |
| Database | local Neon branch (guarded: `EVAL_ALLOW_DB_WRITES=local`, `DATABASE_URL` from `server/.env.local`) |
| Corpus | synthetic: 207 recipes (21 hand-written targets + 186 generated) and 300 meal logs over 90 days = **507 docs** |
| Raw data | `eval/results/retrieval-2026-09-30.json`, `eval/results/agent-2026-09-30.json` |
| Reproduce | `$env:EVAL_ALLOW_DB_WRITES='local'; npm run eval:retrieval` / `npm run eval:agent` (≈ $0.002 / ≈ $0.10–0.20 per run). The harness's unit tests run in the root `npm test` (no API or DB calls) |

**Scope of this benchmark.** This eval measures **retrieval quality** and **small-corpus latency** on about
500 documents. It does **not** validate exact-scan behaviour at larger household sizes. The exact-scan vs
ANN decision is driven by production telemetry (spec §2.5 step 6), not by this fixture.

## 1. Retrieval eval (40 golden queries, 3 modes, one frozen index)

The eval seeds the fixture, runs the backfill path to completion (6 passes; `pending = 0` and
`docCount = 507` asserted before any measurement), then measures all three modes against that single
index. The index-state hash (every doc's content hash, embedded hash, model and embedding) was
identical before and after the quality pass and after the steady-state latency pass.

### Quality (recall@5 / MRR@10, search limit 10)

| category (n) | lexical R@5 / MRR@10 | vector R@5 / MRR@10 | hybrid R@5 / MRR@10 |
|---|---|---|---|
| ingredient_hidden (8) | 0.625 / 0.625 | 0.500 / 0.438 | 0.625 / 0.625 |
| paraphrase (8) | 0.375 / 0.375 | 1.000 / 0.938 | 1.000 / 1.000 |
| exact_rare_term (7) | 1.000 / 1.000 | 0.857 / 0.762 | 1.000 / 1.000 |
| temporal_meal_log (9) | 0.889 / 0.889 | 1.000 / 1.000 | 1.000 / 1.000 |
| **all positives (32)** | **0.719 / 0.719** | **0.844 / 0.792** | **0.906 / 0.906** |

What this shows:
- **Hybrid beats both single modes overall and never loses to either in any category.** It gets lexical's
  exact-term precision (vector alone drops `mirin`, which is split across two recipes, and ranks
  `sumac` third) and vector's paraphrase recall (lexical alone fails 5 of 8 paraphrases).
- **Misses in every mode (3):** `garbanzo beans` (the recipe says *chickpeas*), `sesame paste dressing`
  (the recipe says *tahini*), and `what uses tahini`. The first two are synonym gaps that neither FTS nor
  these embeddings bridge on ingredient-list documents. The third fails lexically because
  `websearch_to_tsquery` ANDs every non-stop-word term (`'use' & 'tahini'`), so *use* must also match, and vector
  alone doesn't rank the recipe in the top 5.
- Lexical's single temporal miss is `fermented cabbage` → *kimchi* (a paraphrase inside a date-filtered
  meal-log query).

### Negative queries (8; every result is irrelevant by definition)

| | lexical | vector | hybrid |
|---|---|---|---|
| `final_returned_nonempty_rate` (headline) | 0.000 | 1.000 | 1.000 |
| `vector_candidate_nonempty_rate` (diagnostic) | n/a | 1.000 | 1.000 |

A non-empty result means "nearest neighbours exist", not "the system judged these relevant". **Phase A
has no relevance floor (OQ5)**, so any mode with a vector leg returns its nearest documents for every
query. For negatives, `final_returned_nonempty_rate` *is* the false-retrieval rate. Relevance itself is
not measured by either rate.

### Top-1 cosine distance: negatives vs positives

| top-1 cosine distance | n | min | p10 | p25 | p50 | p75 | p90 | max |
|---|---|---|---|---|---|---|---|---|
| negative | 8 | 0.510 | 0.522 | 0.528 | 0.545 | 0.609 | 0.660 | 0.685 |
| positive (all) | 32 | 0.337 | 0.362 | 0.433 | 0.494 | 0.602 | 0.680 | 0.737 |
| ingredient_hidden | 8 | 0.419 | 0.497 | 0.551 | 0.577 | 0.614 | 0.615 | 0.615 |
| paraphrase | 8 | 0.337 | 0.342 | 0.354 | 0.373 | 0.410 | 0.438 | 0.447 |
| exact_rare_term | 7 | 0.430 | 0.460 | 0.505 | 0.686 | 0.722 | 0.737 | 0.737 |
| temporal_meal_log | 9 | 0.465 | 0.465 | 0.467 | 0.484 | 0.542 | 0.603 | 0.622 |

| bucket (width 0.05) | negative | positive |
|---|---|---|
| [0.30, 0.35) | 0 | ## 2 |
| [0.35, 0.40) | 0 | ### 3 |
| [0.40, 0.45) | 0 | ##### 5 |
| [0.45, 0.50) | 0 | ###### 6 |
| [0.50, 0.55) | #### 4 | #### 4 |
| [0.55, 0.60) | ## 2 | #### 4 |
| [0.60, 0.65) | # 1 | #### 4 |
| [0.65, 0.70) | # 1 | # 1 |
| [0.70, 0.75) | 0 | ### 3 |

The negative distribution (0.51–0.69) sits entirely **inside** the positive range. Short exact-term
queries (`sumac`, `mirin`) have the *largest* distances of any category, even though lexical finds them
perfectly. No single distance threshold separates relevant from irrelevant here, which supports
deferring the relevance floor (OQ5).

**No-tuning rule.** Phase A chooses no threshold from these numbers. Any future floor must be chosen on a
separate held-out golden split, so this eval stays an unbiased measurement rather than an optimisation
target.

### Latency (local machine → Neon us-west-2 → OpenAI; cache off, real embedding calls)

| latency (ms, n) | p50 | p95 |
|---|---|---|
| lexical search only (40) | 35 | 53 |
| vector search only (40) | 458 | 851 |
| hybrid search only (40) | 468 | 857 |
| query embedding alone (40) | 219 | 335 |
| hybrid + interactive reconcile, steady state, 0 pending (40) | 675 | 1154 |
| hybrid + interactive reconcile, cold, 25 pending (10) | 1529 | 2935 |
| &nbsp;&nbsp;of which reconcile (10) | 1173 | 2539 |

Network-bound latency varies between runs: the first (dirty-tree) run measured hybrid 489 / 903 ms
and cold 955 / 2870 ms.

The query embedding dominates vector and hybrid latency. Every cold rep's reconcile embedded all 25
pending docs within the interactive budget and ended at `pending = 0`, with `mode: hybrid`.

### Cost

The full backfill of 507 docs used **34,444 embedding tokens ≈ $0.0007** at $0.02 / 1M tokens (spec §8 G3).
This is the *measured* eval cost. Observed production cost comes from `retrieval-embed` telemetry.

## 2. Agent eval (15 golden + 5 control queries, 2 arms × 3 runs = 120 chats)

The same fixture is loaded into `chat()` the way the route builds it. The recipe summary is capped at 150
(most recently saved first), so 57 recipes, including 7 of the targets, are invisible to the no-tool arm.

| metric | without tool | with tool |
|---|---|---|
| **Tool-use correctness** (called for golden, not for controls) | 0.25 (tool unavailable) | **1.00** (all 3 runs) |
| &nbsp;&nbsp;golden → tool called | 0.00 | 1.00 |
| &nbsp;&nbsp;control → tool not called | 1.00 | 1.00 |
| **Retrieval correctness** (tool results include an expected id) | n/a | **1.00** (all 3 runs) |
| Heuristic answer-match (mean; per-run min–max) | 0.111 (0.067–0.133) | 0.978 (0.933–1.000) |
| Prompt tokens / chat (of which cached) | 10,151 (9,764) | 11,115 (10,643) |
| Completion tokens / chat | 61 | 88 |
| Model calls / chat | 1.78 | 1.82 |
| Chat latency p50 / p95 (ms) | 2,198 / 6,909 | 5,138 / 7,616 |
| Chats scored / errors | 60 / 0 | 60 / 0 |

Tool-use correctness and retrieval correctness are the rigorous metrics. The agent called the tool for
every golden query in every run and for none of the controls ("what's expiring?", "what did I ask you
earlier?", storage and conversion questions, "what should I cook tonight?", the last of which correctly
went to `suggest_recipes`).

**Heuristic answer-match is not a semantic answer evaluator.** It checks that the reply contains the
expected title or an alias (case- and punctuation-normalised). It can pass while the answer is otherwise
wrong (the right recipe with wrong ingredient details), and fail on a correct answer that paraphrases the
title. Both failure modes appeared:
- **False passes (no-tool arm):** all 5 of its matches are the meal-log questions (`mango`, `kimchi`),
  where the reply repeats the food word while saying it has no record. There are no genuine matches in
  this run. (In the first, dirty-tree run, `Shakshuka` and `Tarte Tatin`, both visible in the recipe
  summary, were genuinely named once each, for 0.178.)
- **A real failure it caught, reproduced (tool arm):** in run 2 of "Which of my recipes use chickpeas?"
  the tool returned *Sunday Night Traybake*, yet the model replied that none of the saved recipes use
  chickpeas. The first harness run showed the same failure, so it has occurred in 2 of 6 attempts at
  this query. Retrieval was correct and the answer ignored it. A plausible (unverified) cause: the prompt
  rule forbidding ingredient claims not in a "tool-result ingredients array" was written for
  `suggest_recipes`, while search results carry a snippet, not an ingredients array. Recorded here as
  an observation, outside TASK-069's scope.

## 3. Deviations from spec §2.8 and caveats

1. **Frozen index enforced by hash, not `embedBudget: 0`.** `searchRecipesAndMeals` always runs the
   interactive reconcile (budget 25) and exposes no budget override. With `pending = 0` that reconcile
   embeds nothing. The guarantee is instead enforced by asserting the index-state hash is unchanged
   across the measured passes, with no change to runtime code.
2. **"Without" arm = tool removed from the tool list only.** The system prompt still contains its one
   rule naming `search_recipes_and_meals`. In that arm the model fell back to `suggest_recipes` for 13
   of 15 golden queries. The harness stubs every non-search tool with a refusal (so no eval chat can
   mutate data), whereas in the app `suggest_recipes` would return pantry-based suggestions, never the
   saved recipe asked about.
3. **Agent search arguments were not recorded**, so the eval can't show how the agent phrased its
   queries (e.g. why "Do I have a recipe that uses tahini?" succeeded through the agent while the raw
   `what uses tahini` query missed).
4. **A first agent run was discarded.** At 4 concurrent chats, 71 of 120 chats hit the organisation's
   200k tokens/min rate limit, and the harness then scored errors as failures. The harness now retries
   rate-limited chats with backoff (fresh per-attempt state), runs 2 at a time, and excludes (and reports)
   any chat still failing. The reported run had 0 errors.
5. **Embedding cache.** The quality pass and backfill use an eval-only, gitignored cache keyed by
   `(model, sha256(text))` under `eval/.cache/`. It holds synthetic data only, and nothing in `server/`
   imports it. The latency pass and cold reps run with the cache **off**. Backfill tokens are the
   API-reported counts, apportioned per text by length when served from cache.
6. **Temporal ranges** are relative to the run date (UTC). The fixture stores day offsets, so results are
   reproducible on any date.
7. **Small n.** 32 positive and 8 negative retrieval queries, and 15 + 5 agent queries × 3 runs. Treat
   single-query differences (about 0.03 recall in a category of 8) as anecdotal.
