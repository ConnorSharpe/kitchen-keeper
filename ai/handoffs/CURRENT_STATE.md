# Task

TASK-072: production health and outstanding updates (approved DRAFT-3). **Phase 1 is COMPLETE; next is Phase 2**
(stop reporting 4xx errors to Sentry, TDD). TASK-071 is paused at §9 step 7 (see Archived History).

# Current Status

- Phase 1 (production smoke test) was run 2026-11-03 by Claude in Chrome as Connor's signed-in session, at Connor's
  request. Rows 1–6, 8 and 9 pass. Connor marked it COMPLETE. Results are in the TASK-072 Phase 1 Results block.
- Production's pantry and recipes are empty, and Connor says that's expected (an earlier chat "compost all" request
  cleared the pantry). All test data was deleted, and the Blob image now returns 404.
- No code changed this session.

# Files Modified

- `ai/tasks/TASK-072-production-health-and-updates.md` (Phase 1 Results only), this file,
  new `ai/handoffs/archive/TASK-071-green-handoff.md` (TASK-071's handoff, moved unchanged).

# Files Required Next

- Phase 2: `server/instrument.js`, `server/instrument.test.js`, `server/app.js` (error handler, ~lines 73–83).

# Files Already Reviewed

- `server/services/recipeService.js:1-48`: the only Blob upload path (recipe images).

# Dependency Chain

Editing (P2): `server/instrument.js`, `server/instrument.test.js`, `server/app.js`. Requires: Q1 answered.
Irrelevant: client, `clerkAuth.js` (forbidden), migrations, `package*.json`.

# Architecture Notes

- Blob is used only by `recipeService.uploadImage`, via the "Upload Recipe Image" flow (OpenAI extraction, then save).

# Decisions Made

- Row 2's pass condition was relaxed to "renders, 200, correct account", because the account is empty by design.
- Row 4 used a test recipe created in-session, since Connor had no saved recipes.
- Phase 1 counts as COMPLETE with row 7 (cron) left as a carried-over check, not a failure.

# Remaining Work

1. **Q1 (gate for Phase 2):** Connor's answer is still needed. The recommendation is "out completely" (the spec's contract).
2. Phase 2 per the spec: Red (AC 1–6a) → Green → `npm test` and lint → push `staging` → stop. AC 7/8 run when Connor triggers them.
3. Connor: check the `/api/push/cron` logs within about an hour after an 08:00Z run (Hobby log retention is about 1 h).
4. TASK-072 DRAFT-4 items (still open): Phase 4 is likely moot (lint is already 0 via the `.claude/` ignore), and
   Phase 5 should be ordered after TASK-071's bump. The spec is 35KB against a 15KB budget.
5. Resume TASK-071 at §9 step 7 (see the archived handoff).
6. Then Phase 3 gates (G1–G3, Q3); Connor only.

# Known Risks / Open Questions

- Q1, Q3, Q5 and Q6 are unanswered. Phase 3 is a deliberate production outage, run by Connor only.
- The zod GHSA-mrhx exposure is unmitigated (TASK-075 on hold).

# Verification Results

- Phase 1: health 200; Neon write and reload OK; Blob 200 image/jpeg; chat retrieval returned the exact ingredients;
  production deploy `e3fe613` Ready; Neon 0.11 CU-hrs used (Free plan, Vercel-managed), not suspended; Sentry
  showed no new issues or events (SERVER-2 at 505).

# Recommended Next Action

In a fresh session: get Connor's Q1 answer, then start TASK-072 Phase 2 Red (`server/instrument.test.js`, AC 1–6a).

# Forbidden Exploration

- `client/**`, `server/middleware/clerkAuth.js`, and the zod/openai/blob code paths.

# Context Notes

- Branch: `staging`. No worktree. The TDD enforcement kit is installed; run kit commands from the repo root.
- Stray untracked `ai/.claude/` and `server/.claude/` hold TDD-hook state; they're safe to delete and not committed.
- Context pressure: high (this session). Start fresh.

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
