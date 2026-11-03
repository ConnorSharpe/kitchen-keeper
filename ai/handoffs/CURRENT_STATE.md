# Task

TASK-072: production health and outstanding updates (approved DRAFT-3). Phase 1 is COMPLETE. **Phase 2 is Green
and pushed to `staging`; AC7 (staging probe) is next, when Connor triggers it.** TASK-071 is paused at §9 step 7.

# Current Status

- Phase 1 (production smoke test, 2026-11-03): rows 1–6, 8 and 9 pass; Connor marked it COMPLETE.
- Phase 2: `shouldReportError(err)` added to `server/instrument.js`. `server/app.js`'s error handler now captures
  and flushes only when it returns true (5xx or no status). 4xx errors are no longer sent to Sentry.

# Files Modified

- `server/instrument.js` (new export), `server/app.js` (gated capture and flush), new `server/shouldReportError.test.js`.
- `ai/tasks/TASK-072-production-health-and-updates.md` (Phase 1 and Phase 2 Results), this file.

# Files Required Next

- None for AC7/AC8 (manual probes plus a Sentry check).

# Files Already Reviewed

- `server/services/recipeService.js:1-48`: the only Blob upload path (recipe images).

# Dependency Chain

Edited (P2): `server/instrument.js`, `server/app.js`, `server/shouldReportError.test.js`. Q1 answered.
Irrelevant: client, `clerkAuth.js` (forbidden), migrations, `package*.json`.

# Architecture Notes

- Blob is used only by `recipeService.uploadImage`, via the "Upload Recipe Image" flow (OpenAI extraction, then save).

# Decisions Made

- Row 2's pass condition was relaxed to "renders, 200, correct account", because the account is empty by design.
- Row 4 used a test recipe created in-session, since Connor had no saved recipes.
- Phase 1 counts as COMPLETE with row 7 (cron) left as a carried-over check, not a failure.
- Q1 = out completely (Connor: "nevermind, proceed", after first raising warning/sampled).
- Phase 2 tests are in the new file `server/shouldReportError.test.js` (Connor: "New test file"), because
  `server/instrument.test.js` is locked append-only. No `approve_test_rewrite.sh` was used.

# Remaining Work

1. Phase 2 AC7 (Connor triggers): after the staging deploy, an unauthenticated `curl` to `/api/pantry` returns 401
   `{"error":"Authentication required"}`, with no new SERVER-2 event for the staging SHA within 5 min. Then
   fast-forward `main` → AC8 (same probe on production; Connor resolves KITCHEN-KEEPER-SERVER-2).
3. Connor: check the `/api/push/cron` logs within about an hour after an 08:00Z run (Hobby log retention is about 1 h).
4. TASK-072 DRAFT-4 items (still open): Phase 4 is likely moot (lint is already 0 via the `.claude/` ignore), and
   Phase 5 should be ordered after TASK-071's bump. The spec is 35KB against a 15KB budget.
5. Resume TASK-071 at §9 step 7 (see the archived handoff).
6. Then Phase 3 gates (G1–G3, Q3); Connor only.

# Known Risks / Open Questions

- Q3, Q5 and Q6 are unanswered. Phase 3 is a deliberate production outage, run by Connor only.
- The zod GHSA-mrhx exposure is unmitigated (TASK-075 on hold).

# Verification Results

- Phase 1: health 200; Neon write and reload OK; Blob 200 image/jpeg; chat retrieval returned the exact ingredients;
  production deploy `e3fe613` Ready; Neon 0.11 CU-hrs used (Free plan, Vercel-managed), not suspended; Sentry
  showed no new issues or events (SERVER-2 at 505).
- Phase 2: Red 8/8 (`shouldReportError is not a function`) → Green 8/8. Root `npm test` exit 0 (118 + 245 pass,
  0 skipped); `npm run lint` exit 0.

# Recommended Next Action

When Connor triggers it: run Phase 2 AC7 on staging, then fast-forward `main` and run AC8.

# Forbidden Exploration

- `client/**`, `server/middleware/clerkAuth.js`, and the zod/openai/blob code paths.

# Context Notes

- Branch: `staging`. No worktree. The TDD enforcement kit is installed; run kit commands from the repo root.
- Stray untracked `ai/.claude/` and `server/.claude/` hold TDD-hook state; they're safe to delete and not committed.
- Context pressure: high (this session). Start fresh for anything after AC7/AC8.

---

## Archived History
- TASK-071 paused handoff (Green on 0.29.5; next: §9 step 7 bump): see [archive/TASK-071-green-handoff.md](archive/TASK-071-green-handoff.md)

- TASK-072 spec drafting (DRAFT-1…3): see [TASK-072](../tasks/TASK-072-production-health-and-updates.md) "Changes"
- TASK-071 spec drafting (DRAFT-1…5): commits `2f444d6`, `9a13de8`, `23c3f4d`, `da6666b`, `430972b`; round tables in TASK-071
- TASK-070 (non-breaking dependency fixes, shipped 2026-11-03): see [TASK-070](../tasks/TASK-070-dependency-security.md)
- TASK-069 (semantic retrieval, shipped to production): see [archive/TASK-069.md](archive/TASK-069.md)
- TASK-068: see [archive/TASK-068.md](archive/TASK-068.md)
- TASK-067: see [archive/TASK-067.md](archive/TASK-067.md)
- TASK-047 through TASK-053: see [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054: see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055: see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056: see [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting: see [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation: see [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting: see [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy: see [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke tests: see [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting: see [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy: see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
- TASK-063/064 diagnostics + spec: see [archive/TASK-063-064-diagnostics-and-spec.md](archive/TASK-063-064-diagnostics-and-spec.md)
- TASK-064 implementation: see [archive/TASK-064-implementation.md](archive/TASK-064-implementation.md)
- TASK-064 timing diagnostics: see [archive/TASK-064-followup-timing-diagnostics.md](archive/TASK-064-followup-timing-diagnostics.md)
- TASK-065 implementation: see [archive/TASK-065-implementation.md](archive/TASK-065-implementation.md)
- TASK-065 negative signal + TASK-066 diagnosis: see [archive/TASK-065-negative-signal.md](archive/TASK-065-negative-signal.md)
- TASK-066 implementation: see [archive/TASK-066-implementation.md](archive/TASK-066-implementation.md)
