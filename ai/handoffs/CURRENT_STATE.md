# Task

TASK-069: Semantic retrieval for the chat agent (pgvector + hybrid lexical/vector search + eval harness).
This is Phase A of the agent-knowledge roadmap. Spec: [TASK-069-spec.md](../tasks/TASK-069-spec.md)

# Current Status

**Gate G1–G9 CLOSED (2026-09-29), all passing; recorded in spec §8. Red tests written and committed. NO
implementation code exists.**
- G9 passed exactly, so the strong `FOR SHARE` invariant stands and the fallback was not applied.
- G1 is case (b) on staging and production: the extension is not installed, but `neondb_owner` can create it.
  The `vector` extension 0.8.0 is now installed on local only (by the gate).
- All three environments share the same migration history: 7 rows, max `created_at` 1785171529668 (0020).

# Files Modified

- `ai/tasks/TASK-069-spec.md` §8 (gate results, G9 verbatim)
- New Red tests, all untracked until this commit. Every file is locked, and editing any of them needs
  Connor's per-file permission:
  - `server/services/retrieval/{constants,documents,fusion,indexer,searchService}.test.js`
  - `server/services/ai/openaiProvider.test.js`
  - `server/instrument.test.js`
  - `server/services/chat/handlers/searchRecipesAndMeals{,.unavailable}.test.js`
  - `server/services/aiService.pantryTools.test.js`
  - `server/services/chat/createToolHandlers.test.js`
  - `server/scripts/backfillSearchDocuments.test.js`
  - `server/test/db/{backfill,bootCompat,fingerprint,reconcile,tenancy}.dbtest.js`
  - `server/test/db/dbHarness.js` (helper)

# Files Required Next

- Spec §2.2–§2.11, §3 (Allowed), §5 (criteria), §8 (G9 statement and fingerprint expression to reuse verbatim)
- The test files above. They define the seams the implementation must meet (see Decisions Made).
- `ai/migrations/MIGRATION_LEDGER.md` before applying 0022 anywhere

# Files Already Reviewed (don't re-read unless changed)

server/db/schema.js (recipes/meal_logs/households), server/db/migrate.js, drizzle migrator.js and
pg-core/dialect.js, meta/_journal.json, plus everything listed in the spec's review history.

# Dependency Chain

Editing (implementation): spec §3 Allowed only.
Requires: recipes/meal_logs (read-only), households FK, the OpenAI SDK, and `@neondatabase/serverless` 0.10.4
(HTTP for production, websocket `Pool` in tests only).
Irrelevant: client/**, auth, push, shopping, onboarding, recipeSearchService.

# Architecture Notes

- The G9-proven fingerprint expression is `md5(json_build_array(r.name, r.description, r.tags, r.ingredients,
  r.steps, r.saved_at)::text)`. `RECIPE_FINGERPRINT_SQL` must use it verbatim (indexer.test.js asserts it).
- On Node 24 the websocket `Pool` needs no `neonConfig.webSocketConstructor` (G8).
- `node --test`'s default discovery includes `**/test/**/*.js`, so the dbtests run inside `npm test`. Without
  `RUN_DB_TESTS=1` they skip, and they refuse any host other than `ep-icy-rice-` (local).

# Decisions Made

- The test-writer made interface assumptions, now locked in the tests; the implementation must match them.
  Recommended: write them into the spec (Remaining Work 1).
  - SQL goes through `db.execute(sql)` with `.rows`.
  - The only statement containing `<=>` is the vector query, and the only one containing
    `websearch_to_tsquery` is the lexical query.
  - Search takes `{sourceTypes, dateFrom, dateTo}`, with `dateTo` exclusive, and resolves to `{mode, results}`.
  - The builders take the raw stored row (JSON text columns; snake_case or camelCase).
  - Fusion takes lists of string keys and returns entries with `.score` and `.id`/`.key`.
  - The handler is the named export `searchRecipesAndMeals(args, ctx)`.
  - `aiService.js` exports `PANTRY_TOOLS`.
  - The backfill guard messages mention `BACKFILL_CONFIRM_ENV` and `i-understand-production`. The dry run
    prints `estimated_tokens_chars_div4` and the Neon host.
  - 11a keeps docs unembedded because the fake OpenAI fails multi-text calls.
  - `search_unavailable` is tested end to end through the handler, not by error class.

# Remaining Work

1. **Before implementing:**
   - Add a spec addendum that names the guarded-upsert export (signature and how rows written are reported).
   - Record the seam assumptions above in the spec.
   - Then have the test-writer author `server/test/db/snapshotGuard.dbtest.js` for 11d(i), 11d(ii), 11d(iii)
     and 11d(v). 11d(v) uses G9's `pg_stat_activity` lock-wait observation plus the websocket `Pool` writer.
     These are NOT written yet.
2. Implementation (Green) via the `implementer`.
3. Migration 0022: local, then staging, then production. Each application goes in the ledger with an honest
   status. G1 case (b) means 0022 creates the extension itself. The journal `when` must be > 1785171529668.
4. Backfill, evals and results doc, ADRs 0001–0005, README section.
5. Separate task, not yet filed: the README stack table says Gemini, but the app uses OpenAI.

# Known Risks / Open Questions

- **The suite is RED on `staging` (34 failing unit tests).** Do not push until Green, or CI goes red.
- The seam assumptions were guesses. If the implementer finds one unworkable, escalate to Connor. Never
  edit a locked test.
- A new outbound data flow (recipe and meal-log text to OpenAI embeddings) must be documented (spec R3).

# Verification Results

- New unit tests: 35, of which 34 FAIL (missing modules/exports, the correct Red reason) and 1 passes
  (an intentional regression guard).
- Full `npm test` in server: 134 tests, 100 pass, 34 fail (exactly the new ones; existing suite unaffected).
- dbtests with `RUN_DB_TESTS=1` on local: all FAIL with "migration 0022 not applied" (expected).

# Recommended Next Action

Draft the §2.4 guarded-upsert interface addendum and the seam list for Connor's approval (Remaining Work 1).
Then have the test-writer write `snapshotGuard.dbtest.js`, and only after that start Green.

# Forbidden Exploration

- client/**, and unrelated services (push, shopping, onboarding, household, suggestions, recipeSearchService)

# Context Notes

- branch: `staging`. Committed locally, not pushed (the suite is red).
- Enforcement kit NOT installed (no `.claude/tdd-config.json`). Test locking is by rule only.
- Pre-existing uncommitted changes, unrelated and left as is: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md`, `ai/handoffs/archive/TASK-061-implementation.md`.
- Staging and production credentials are not available to Claude (pulling them was blocked). Connor runs the
  read-only SQL for those environments in the Neon SQL Editor.
- context pressure: high; fresh session required.

---

## Archived History

- TASK-068 (Sentry errors+logs, debugLog migration, shipped to production; SW-registration hotfix): see [archive/TASK-068.md](archive/TASK-068.md)
- TASK-067 (service worker cross-origin cache-first fix, shipped to production, closed the TASK-063→067
  double-sign-in investigation): see [archive/TASK-067.md](archive/TASK-067.md)

- TASK-047 through TASK-053: see [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054: see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055: see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056: see [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting: see [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation: see [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting: see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy: see [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke-test session: see
  [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting: see [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy: see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
- TASK-063 implementation/deploy through TASK-064 spec-drafting: see
  [archive/TASK-063-064-diagnostics-and-spec.md](archive/TASK-063-064-diagnostics-and-spec.md)
- TASK-064 implementation/deploy (marker-based recovery mechanism, on-device verification confirmed working
  as designed): see [archive/TASK-064-implementation.md](archive/TASK-064-implementation.md)
- TASK-064 follow-up (timing diagnostics, confirmed the WebKit activation-expiry hypothesis with paired
  on-device data, feeding directly into TASK-065): see
  [archive/TASK-064-followup-timing-diagnostics.md](archive/TASK-064-followup-timing-diagnostics.md)
- TASK-065 implementation/deploy (preconnect hint shipped to `/sign-in` and `/sign-up`): see
  [archive/TASK-065-implementation.md](archive/TASK-065-implementation.md)
- TASK-065 post-deploy negative signal + TASK-066 diagnosis handoff: see
  [archive/TASK-065-negative-signal.md](archive/TASK-065-negative-signal.md)
- TASK-066 implementation + on-device capture results (conclusive: no main-thread stall observed): see
  [archive/TASK-066-implementation.md](archive/TASK-066-implementation.md)
