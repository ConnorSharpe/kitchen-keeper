# Task

TASK-069: Semantic retrieval for the chat agent (pgvector + hybrid lexical/vector search + eval harness).
Phase A of the agent-knowledge roadmap. Spec: [TASK-069-spec.md](../tasks/TASK-069-spec.md)

# Current Status

**§6 step 5 (evals) DONE on local 2026-09-30 and committed on `staging`: harness `4c4df4d`, then the re-run results
commit.** Nothing is pushed. 0022 has been applied on local only.
Eval harness (spec §2.8) built and run. Results in [docs/eval/TASK-069-results.md](../../docs/eval/TASK-069-results.md):
- Retrieval: hybrid recall@5 0.906, lexical 0.719, vector 0.844.
- Agent, with tool: tool-use 1.0, retrieval 1.0.
- The results doc cites `4c4df4d`, dirty only in unrelated files. Re-run: same retrieval quality; no-tool answer-match
  0.111 (was 0.178). The chickpeas answer failure reproduced (2 of 6 attempts).
- The eval unit tests now run in the root `npm test` (explicit file list: CI is Node 20, which has no `--test` globs).

**Pushed to `staging` 2026-09-29 (docs + all TASK-069 commits). 0022 applied on staging by Connor (ledger row 7).
Staging backfill DONE 2026-09-30 (host `ep-floral-truth-ak9tw8h3`): 9 docs over households 1 and 28, pending 0,
1,473 embedding tokens (dry-run estimate 1,405).**
**§2.10 docs DONE 2026-09-29:** ADRs 0001–0005 in `docs/adr/` + README "Agent retrieval" section
(inserted after Features; cites `docs/eval/TASK-069-results.md`, states the R3 data flow and quality ≠ capacity).
README stack table (Gemini) deliberately untouched (spec §4).

# Files Modified (eval session, committed)

- New `eval/`:
  - `lib/{metrics,guard,fixtureCheck,dates,embedCache}.js` + `*.test.js` (99 tests, Red-first via test-writer, locked)
  - `lib/{runtime,household}.js`, `retrieval.js`, `agent.js`, `scripts/generateFixture.js`
  - `fixtures/{household,golden}.json`
  - `results/{retrieval,agent}-2026-09-30.json`
- New `docs/eval/TASK-069-results.md`; new `ai/memory/STABLE_CONTEXT.md` (the first one: TDD Exemptions list).
- Edited:
  - root `package.json`: `eval:test|fixture|retrieval|agent` scripts
  - `.gitignore`: `eval/.cache/`
  - `eslint.config.js`: `eval/**/*.js` added to the Node-globals block. **Not in the spec §3 Allowed list; flagged to Connor.**
- TDD kit (Connor approved "Fix the kit"):
  - `.claude/hooks/tdd/tdd_record_result.mjs` parses the node:test `ℹ fail N` / `ℹ pass N` summary before the exit code.
  - `tdd_source_gate.mjs` allows a Write that CREATES a new file of ≤2000 chars containing "not implemented"
    while the gate is awaiting_red (interface stubs).
  - `.claude/tdd-config.json`: eval orchestration exemptions.

# Files Required Next

- §6 steps 6–7 (staging/prod rollout), `ai/migrations/MIGRATION_LEDGER.md`, the backfill script's CLI flags (§2.9).

# Files Already Reviewed (don't re-read unless changed)

Spec §2–§8, every TASK-069 test file, `searchService.js`, `indexer.js` (reconcile + exports), `documents.js`
builders, `aiService.chat` + `PANTRY_TOOLS` search entry, `openaiProvider.js`, `instrument.js`, the chat route's
context building (`routes/ai.js` ~380–440), the search handler, the backfill script, the TDD kit hooks.

# Dependency Chain

Editing: `eval/**`, `docs/eval/**`, `docs/adr/**`, README (per spec §3).
Requires: server retrieval modules and `aiService.chat` (imported by the eval, never the reverse), local Neon branch, OpenAI.
Irrelevant: client/**, auth, push, shopping, onboarding, recipeSearchService.

# Architecture Notes

- The eval imports server modules and deps via `eval/lib/runtime.js` (`serverModule` / `serverDependency` resolve the
  ESM entry under `server/node_modules`, so patches hit the same instances). The guard runs before any DB import.
- `loadEvalEnv` deletes `SENTRY_DSN` (`.env.local` has it). Timings come from Sentry's
  `getClient().on('beforeCaptureLog')`. `Sentry.logger` is a module namespace and can't be patched.
- The frozen index is enforced by an index-state hash before and after the measured passes, because
  `searchRecipesAndMeals` has no `embedBudget` override. That's a recorded deviation.
- The agent "without" arm filters the tool out of `startChatSession` (eval process only). The prompt is unchanged.
  Non-search tools are stubbed with refusals.

# Decisions Made

- 2026-09-30 Connor: "Fix the kit (Recommended)". Kit gaps: (1) node:test output was never parsed, so every run was
  UNKNOWN; (2) a new module can't reach a valid Red. Fixed as listed under Files Modified.
- 2026-09-30 Connor: "Test logic, exempt runners". `eval/{retrieval,agent}.js`, `eval/lib/{household,runtime}.js` and
  `eval/scripts/**` are TDD-exempt (STABLE_CONTEXT + `alwaysExemptPatterns`). `runtime.js` was added to the list
  Connor approved, and he was told.
- The first agent run was discarded: at concurrency 4, 71/120 chats hit the 200k TPM limit. Now concurrency 2,
  backoff retry, and errors are excluded from rates. The reported run had 0 errors.
- No `approve_test_rewrite.sh` use this session. No test file was edited after being written.

# Remaining Work

1. (Done: committed and re-run at `4c4df4d`.)
2. (Done: ADRs + README section written; commit them: `TASK-069: add ADRs 0001-0005 and README retrieval section`.)
3. 0022 on staging → push staging → backfill; then production (ledger row each, per the migrations skill).
4. Separate, unfiled: the README stack table says Gemini. The lint chip "Fix eslint no-undef errors in TDD kit hooks"
   is offered (30 pre-existing errors in `.claude/hooks/tdd/*.mjs`, so `npx eslint .` fails).
5. Observations from the evals, out of scope (candidate follow-ups, not filed):
   - The agent once ignored a correct search hit (chickpeas). Possible prompt-rule mismatch: the "ingredients array"
     rule vs search snippets.
   - Synonym misses (garbanzo/chickpea, sesame paste/tahini).
   - `websearch_to_tsquery` ANDs filler words ("uses").
   - Agent search args aren't recorded by the harness.
6. Local DB residue from the earlier smoke test is still for Connor: `chat_messages` id > 144, and
   `search_documents` for household 1. The eval households were torn down (verified: 0 left).

# Known Risks / Open Questions

- Don't push until the rollout is sequenced: staging needs 0022 first (ledger), per the migrations skill.
- The kit's stub allowance is a heuristic (small new file + "not implemented"). Consider upstreaming both kit fixes
  to the source project.
- Re-running `eval:agent` costs about $0.10 (up to about $0.20 without prompt-cache hits) in gpt-4o-mini calls.
  Retrieval is about $0.002.

# Verification Results

- Root `npm test`: 118 pass (19 shared + 99 eval). `server` tests: 223/223 pass.
- `npx eslint eval`: clean. Repo-wide lint: 30 errors, all pre-existing in the kit's `.claude/hooks/tdd/*.mjs`.
- Guard: refuses with the flag unset and with `production` (exit 1, before any DB import).
- `eval:retrieval` (local): 507 docs, pending 0; index hash unchanged across passes; teardown done.
- `eval:agent` (local): 120/120 chats scored, 0 errors; teardown done. Eval households remaining: 0.

# Recommended Next Action

Staging Preview smoke 2026-09-30 (household 1, via Chrome): ingredient query PASS (coconut sugar → Curry Cod);
control PASS; no console errors; Sentry not checked (connector unauthenticated). **Meal-log query FAIL:** "When did I last
eat Spam Musubi?" → "no records … for this month". Direct `searchRecipesAndMeals(1)` on staging returns it first with no
date filter and nothing with a Sept filter, so the agent likely added an unrequested date filter (args aren't logged).
Connor chose "fix it first": `date_from`/`date_to` param descriptions now say omit unless the user names a date/period
(`aiService.js` PANTRY_TOOLS search entry, within §3; top-level description unchanged, it's pinned by a locked test).
Red-first via test-writer: new `server/services/aiService.searchDateGuidance.test.js`. Server 225/225, root 118/118.
Test chat rows 99–104 deleted (max id back to 98).

# Forbidden Exploration

- client/**, and unrelated services (push, shopping, onboarding, household, suggestions, recipeSearchService)

# Context Notes

- branch: `staging`. TASK-069 Green (`7e34395`) and eval harness (`4c4df4d`) + results committed. Nothing pushed.
- TDD enforcement kit installed and active (node:test parsing fixed this session). Run shell commands from the repo
  root: a `cd server` drifts the session cwd and the hooks then misresolve the project (it happened this session).
- CI (`.github/workflows/ci.yml`) runs on main only, on Node 20 (`--experimental-test-module-mocks` needs ≥22.3),
  and doesn't run client or eval tests.
- Pre-existing uncommitted changes, unrelated: `.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md`.
- Docs session: no code/tests touched (docs are TDD-exempt: no testable surface). Phase boundary crossed: docs → rollout.
- context pressure: low.

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
