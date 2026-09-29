# Task

TASK-069: Semantic retrieval for the chat agent (pgvector + hybrid lexical/vector search + eval harness).
This is Phase A of 3 in the agent-knowledge roadmap: B = food knowledge graph + allergen guard, C = graph-backed
household memory. Spec: [TASK-069-spec.md](../tasks/TASK-069-spec.md)

# Current Status

**Spec APPROVED (DRAFT-6, architect round 6, 2026-09-29). No code written yet.** The next phase is the
pre-implementation gate G1–G9 (§2.0), with results recorded in spec §8. G9 must be recorded verbatim, and before
any test authoring. The motivation is Connor's job-search portfolio (spec §0.1), so the eval harness and ADRs are
first-class deliverables.

Also created this session: `ai/architecture/SYSTEM_OVERVIEW.md` and `ai/maps/FILE_MAP.md`. Both were missing.

# Files Modified

- `ai/tasks/TASK-069-spec.md` (new; 6 drafts, review history and dispositions in §9–§13)
- `ai/architecture/SYSTEM_OVERVIEW.md` (new), `ai/maps/FILE_MAP.md` (new)
- `ai/handoffs/CURRENT_STATE.md` (this file); TASK-068's handoff moved to `archive/TASK-068.md`

# Files Required Next

- `ai/tasks/TASK-069-spec.md`: §2.0 (G1–G9), §2.4 step 1b (the FOR SHARE mechanism G9 proves), §8
- `server/db/migrations/meta/_journal.json`, `server/db/migrate.js` (G5)
- `ai/migrations/MIGRATION_LEDGER.md` (before applying 0022 anywhere)

# Files Already Reviewed (don't re-read unless changed)

server/db/schema.js, server/routes/ai.js (chat route), server/services/aiService.js (chat(), PANTRY_TOOLS,
context caps), server/services/ai/providerInterface.js, chatService.js, createToolHandlers.js,
mealLogService.js (exports), recipeService.js (write paths), server/instrument.js (exports),
client/src/lib/debugLog.js, drizzle-orm pg-core/dialect.js (migrator rule), ai/handoffs/CONVENTIONS.md.

# Dependency Chain

Editing (implementation phase): see spec §3 Allowed.
Requires: recipes/meal_logs (read-only), households FK, server/instrument.js (adds logServerEvent), the OpenAI SDK.
Irrelevant: client/**, auth, push, shopping, onboarding, recipeSearchService.

# Architecture Notes

- Facts verified in code during spec review. Each one corrected an earlier assumption:
  - `logEvent()` is **client-only**; the server has only `captureExceptionSafely` and `flush`. Hence spec §2.11
    `logServerEvent`.
  - **Migrations never auto-run on Vercel.** `migrate.js` is imported only by local `server/index.js`.
  - Drizzle's migrator applies a journal entry only if its `when` is greater than the latest applied
    `created_at`; otherwise it is silently skipped (`dialect.js:45`).
  - `recipes.id` and `meal_logs.id` are global SERIALs, so `UNIQUE(source_type, source_id)` is the stronger
    constraint. G6 re-confirms this.
  - Recipe context to the agent is `{id,name,tags}` only. Chat is trimmed to 50 messages.
- There are no real-DB tests in the repo yet. TASK-069 adds opt-in `*.dbtest.js` (`RUN_DB_TESTS=1`, local only).

# Decisions Made

All are in the spec's decision table (§2.1) and disposition tables. Key ones:
- pgvector in Neon; one `search_documents` table.
- Hybrid FTS + vector with RRF; no ANN index.
- Lazy reconcile with an interactive embed budget of 25.
- Content-fingerprint staleness with a same-statement `FOR SHARE` guard.
- Chat is excluded from the corpus.
- Tool name: `search_recipes_and_meals`.

# Remaining Work

1. Gate G1–G9 against local/staging/production (read-only on staging and production, except the local
   `CREATE EXTENSION`). **G9 fails → apply the pre-agreed fallback. Do not invent a third mechanism.**
2. Red tests via the `test-writer` for criteria 1–11e.
3. Implementation.
4. Migration 0022 local → staging → production, logged in the ledger.
5. Backfill.
6. Evals and results doc.
7. ADRs 0001–0005 and the README section.
8. Separate small task, not yet filed: the README stack table says Gemini, but the app uses OpenAI.

# Known Risks / Open Questions

- G1 case (c) on any environment means STOP and no partial roll-forward (spec G1).
- G9 is the empirical proof of the concurrency mechanism.
- A new outbound data flow (full recipe and meal-log text to OpenAI embeddings) is accepted and must be
  documented (spec R3).

# Verification Results

- None. This was spec-only; no code or tests changed.

# Recommended Next Action

In a fresh session, run gate G1–G9 exactly as written in spec §2.0 and record the results in §8. Stop at any
failed gate per its stated rule.

# Forbidden Exploration

- client/**, and unrelated services (push, shopping, onboarding, household, suggestions, recipeSearchService)

# Context Notes

- branch: `staging` (spec work only, uncommitted).
- Pre-existing uncommitted, unrelated to this work: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md`, and `ai/handoffs/archive/TASK-061-implementation.md` (untracked). Leave as is.
- Enforcement kit: not checked this session (no code changes).
- context pressure: high (long 6-round spec review); fresh session recommended.

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
