# Task

TASK-069: Semantic retrieval for the chat agent (pgvector + hybrid lexical/vector search + eval harness).
Phase A of the agent-knowledge roadmap. Spec: [TASK-069-spec.md](../tasks/TASK-069-spec.md)

# Current Status

**Green COMPLETE for criteria 1–11e, committed on `staging` (`7e34395`), not pushed. Migration 0022 applied on local only.
Local smoke test (§6 step 4) PASSED 2026-09-29.**
Unit tests 223/223, dbtests 44/44 (local), eslint clean. Three locked tests were fixed with Connor's
permission (see Decisions Made).

# Files Modified

- New: `server/services/retrieval/{constants,documents,fusion,indexer,searchService}.js`,
  `server/services/chat/handlers/searchRecipesAndMeals.js`, `server/scripts/backfillSearchDocuments.js`,
  `server/db/migrations/0022_search_documents.sql`, `server/test/db/snapshotGuard.dbtest.js` (test-writer,
  Red first: it failed on the missing migration/export; now locked)
- Edited: `server/db/schema.js` (`searchDocuments` + `vector`/`tsvector` customType),
  `db/migrations/meta/_journal.json` (idx 20, `when` 1790728028520), `server/instrument.js` (`logServerEvent`),
  `services/ai/{providerInterface,openaiProvider}.js` (`embed`, `EMBEDDING_MODEL`), `services/aiService.js`
  (tool entry, one prompt rule, `export PANTRY_TOOLS`), `services/chat/createToolHandlers.js`,
  `server/package.json` (`test:db` script), `ai/migrations/MIGRATION_LEDGER.md` (row 6)

# Files Required Next

- The 3 locked test files named in Known Risks, only once Connor grants permission
- Spec §2.8 (eval), §2.10 (ADRs/README), §6 steps 4–7 for the rollout

# Files Already Reviewed (don't re-read unless changed)

Spec §2–§8 and every TASK-069 test file. Also `dbHarness.js`, `aiService.js` (tool list and prompt rules),
`resolveProvider.js`, `loadEnv.js`, `db/client.js`, `db/migrate.js`.

# Dependency Chain

Editing: spec §3 Allowed only (all edits so far are inside it).
Requires: recipes/meal_logs (read-only), households FK, `resolveProvider()` → OpenAI SDK, drizzle `db.execute`.
Irrelevant: client/**, auth, push, shopping, onboarding, recipeSearchService.

# Architecture Notes

- `upsertRecipeDocuments` is ONE statement for the batch: a `jsonb_to_recordset` payload CTE, then
  `src` (`JOIN recipes r` … `ORDER BY r.id FOR SHARE OF r`), then a top-level INSERT … ON CONFLICT … WHERE
  household matches. The G9 shape is otherwise unchanged. 11d(v) proves the batched/joined form still
  blocks and rechecks (commit → `written=[]`, rollback → `[rid]`).
- Household-mismatch integrity check: a separate query in `reconcileHousehold`, run only when some
  snapshots went unwritten. It emits `retrieval-integrity` plus `captureExceptionSafely`.
- `reconcileHousehold` also returns `docCount`, `reconcileEmbed`, `embedTokens` (extra fields beyond C9).
  `searchService` logs them, so it issues no extra queries (the C2 statement classification stays clean).
- The search `mode` override: `lexical` skips the query embed and vector query; `vector` skips lexical.
  The returned `mode` is the override's name. The eval uses this.
- `planReconcile(hh)` (read-only) powers the backfill dry run and shares the detect queries with reconcile.
- Backfill loads `.env.local` only for `--env local`. Staging and production need `DATABASE_URL` set explicitly.

# Decisions Made

- `test:db` runs the dbtest files serially (`--test-concurrency=1`). backfill.dbtest's "writes nothing"
  counts ALL `search_documents` rows, so it fails when other files write concurrently.
- 2026-09-30 Connor: "You have permission to fix all three test files". The enforcement kit isn't installed,
  so `approve_test_rewrite.sh` doesn't exist and was not run. Edits:
  - `fingerprint.dbtest.js`: each pair is seeded in 2 households, because recipes are unique on
    (household_id, name) and household_id is not a fingerprint input.
  - `bootCompat.dbtest.js`: the child no longer calls `process.exit(0)` (Windows/Node 24 libuv crash).
  - `backfill.dbtest.js`: removed the unused `spawnSync` import.

# Remaining Work

1. Evals + results doc, ADRs 0001–0005, README section. (Local smoke test §6 step 4 PASSED 2026-09-29.)
   Local DB residue from the smoke test, for Connor to clear (Claude's DB access was blocked by the auto-mode
   classifier): `chat_messages` with id > 144 (the smoke Q&A turns), and `search_documents` (0 rows before;
   now lazily indexed for household 1, including an orphaned doc for the deleted recipe 823, which the next reconcile deletes).
2. 0022 on staging → push staging → backfill; then production (ledger row each, per the migrations skill).
3. Separate, unfiled task: the README stack table says Gemini.

# Known Risks / Open Questions

- Don't push until the rollout is sequenced: staging needs 0022 applied first (ledger), per the migrations skill.
- R3: the new outbound data flow to OpenAI embeddings must be documented in ADR-0001 and the README.

# Verification Results

- `server` npm test: 223 pass / 0 fail.
- `RUN_DB_TESTS=1 npm run test:db` (local): 44/44 pass.
- eslint on changed source + server/test/db: clean.
- 0022 on local: `vector` 0.8.0, table + 4 indexes, `__drizzle_migrations` 8 rows, max 1790728028520.
- Local smoke (§6 step 4), real UI, observed via scratchpad-only OpenAI SDK preloads (no repo edits):
  (1) chickpeas (ingredient only, temp recipe) → `search_recipes_and_meals`, `mode: hybrid`, correct recipe ranked #1;
  (2) forced `embeddings.create` throw → `lexical_only`, correct recipe, chat 200, normal answer;
  (3) "What did I ask you earlier?" → single model request, no tool round. PASS.
  Local gotcha: Clerk 401s on every call were Windows clock skew (−5.5 s, over Clerk's 5 s tolerance); a resync fixed them.

# Recommended Next Action

Fresh session: spec §6 step 5. Run `eval:retrieval` and `eval:agent` (§2.8), commit the results doc,
then write ADRs 0001–0005 and the README section (§2.10; ADR-0001 must cover the OpenAI embeddings data flow, R3).
Before any local browser smoke: check the clock is synced (Clerk rejects tokens at >5 s skew).

# Forbidden Exploration

- client/**, and unrelated services (push, shopping, onboarding, household, suggestions, recipeSearchService)

# Context Notes

- branch: `staging`. TASK-069 Green committed (`7e34395`). Nothing pushed.
- TDD enforcement kit INSTALLED 2026-09-30, copied from the Ahab-phisherman project (Node port). Files:
  `.claude/{settings.json,tdd-config.json,flaky-quarantine.json,hooks/tdd/*,tdd-state/.gitignore}`,
  `githooks/pre-commit`. The only script change: `tdd_record_result.mjs` also recognizes `node … --test`.
  All 9 simulated hook checks behave correctly. Hooks take effect from the next session.
  `git config core.hooksPath githooks` is SET (2026-09-30), after committing TASK-069 Green (`7e34395`) and the kit (`1af7501`).
- Kit gaps: flaky-quarantine.json is not wired into node:test (no file-exclude config). No STABLE_CONTEXT.md
  exists to sync `alwaysExemptPatterns` with. CI (`.github/workflows/ci.yml`) runs on main only, on Node 20
  (`--experimental-test-module-mocks` needs Node ≥22.3), and doesn't run client tests.
- Pre-existing uncommitted changes, unrelated and left as is: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md`. (`archive/TASK-061-implementation.md` was committed 2026-09-29, since
  handoff docs link to it.)
- context pressure: medium; fresh session recommended (phase boundary: local smoke verified → evals/docs).

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
