# Task

TASK-071: drizzle-orm 0.29.5 → 0.45.4 (approved DRAFT-5). §9 Order steps 1–3, 5 and 6 are done; **next is step 7,
the dependency bump**.

# Current Status

- Recorded in TASK-071 §11: G1 (baselines, and the local ledger fingerprint `4ece5377cd4cd53324b2de1a38fcd46a`),
  G2 (the migrator decides identically on all 8 points), G5 (pass), and the G4 0.29.5 half.
- Red: confirmed against a stub `pgError.js` that Connor created, because the kit rejects a missing-module Red.
- Green on 0.29.5: `isUniqueViolation` is implemented, and `householdService` uses it in both retry loops.
- Still on 0.29.5: `server/package*.json` are untouched. Green work is committed (`11d8417`).
- Side work this session: TASK-072 spec (production health + updates) went through architect rounds 1–2 and is
  at DRAFT-3 (reviewer: approve after round-2 fixes, which DRAFT-3 makes). Not approved by Connor yet.

# Files Modified

- New: `server/db/pgError.js`, `server/db/pgError.test.js`, `server/test/db/joinCodeCollision.dbtest.js`
  (both test files are locked: Red was confirmed).
- `server/services/householdService.js` (the import + 2 expressions).
- `ai/tasks/TASK-071-dependency-security-phase-b.md` (status line, §11), this file.

# Files Required Next

- `server/package.json`, `server/package-lock.json`. Maybe `backfillSearchDocuments.js:84`, only if G4 needs it.
  Docs: SYSTEM_OVERVIEW (the "drizzle-orm 0.29" mention), the `schema.js:223` comment, CONVENTIONS.md (G6).

# Files Already Reviewed

- `householdService.js`, `onboardingService.upsertFlow`, `db/client.js`, `db/migrate.js`, `test/db/dbHarness.js`,
  `backfillSearchDocuments.js:75-95`, the `schema.js` FKs (all `ON DELETE CASCADE`).

# Dependency Chain

Editing: server manifests/lockfile, docs. Requires: G6 (Connor). Irrelevant: client, zod/openai/blob, migrations.

# Architecture Notes

- The dbtest mocks `'crypto'` with a spread of the real `node:crypto` plus a dispatcher `randomBytes`. Interception is
  confirmed (3b/3c call counts and sizes).

# Decisions Made

- No fast-check property test: fast-check isn't installed and §6 forbids new deps. AC2g–j/l cover never-throws.
- AC3 selector (ii) is satisfied by `ON DELETE CASCADE` when the captured households are deleted.
- Red was confirmed via a stub that Connor created ("add the stub and we will address it later"). **To address
  later:** the kit treats a missing module of the unit under test as wrong-reason Red, while TASK-071 §9 step 6
  specified exactly that reason. Either the kit or the spec template needs to change.

# Remaining Work

1. §9 step 7: `npm install --prefix server drizzle-orm@0.45.4` and `drizzle-kit@0.31.11 -D` (exact versions; check
   that the manifest ranges don't drift).
2. Step 8: G3 (unique-violation shape on 0.45.4); the G4 0.45.4 half (rerun the exact query + the timestamptz
   literal) and its decision table.
3. Step 9: AC3 again, test:db (expect 48), AC4 (root 118, server 237, client 75, lint 0 errors, build), the AC6
   "after" ledger (must equal `4ece5377…`), AC1 (`npm ls` + audit), AC7 (`git diff --stat`). Docs updates.
4. Then: commit, and the staging smoke (Connor runs the ledger query before/after). Load the `migrations` skill
   before any push.
5. Connor: G6, `vercel login`, TASK-072 DRAFT-3 approval and its gate answers (Q1, Q3, Q4, Q5).
6. TASK-072 DRAFT-4 (small): resolve the two notes at the top of the spec. Phase 4 is likely moot (lint is
   already 0 via the `.claude/` ignore in `e3fe613`), and its "TASK-072 before TASK-071" order is stale because
   TASK-071 is underway. The spec is ~32KB (budget 15KB); splitting Phase 3 out into its own TASK is the cleanest cut.

# Known Risks / Open Questions

- Local `search_documents` is empty, so G4(B) uses a typed `timestamptz` literal as a substitute (recorded in §11).
- The zod GHSA-mrhx exposure is unmitigated (TASK-075 on hold). The TASK-071 spec is 32KB, over the 15KB budget.
- TASK-072 Phase 3 (Neon password rotation) is a deliberate production outage. Only Connor runs it, and only after
  its G1–G3 gates. Approving the spec doesn't authorize it, or the Phase 1 production smoke test.

# Verification Results

- G1 (0.29.5): shared 118, server 225, client 75, test:db 44, all pass. Lint 0 errors (the baseline is now 0,
  not 30). Build OK.
- Green (0.29.5): AC2 12/12, AC3 4/4, server 237/237, shared 118/118, test:db 48/48. Client, lint and build were
  not rerun (no client/lint-relevant change).
- `tdd_weakening_report`: not run (no locked tests were edited).

# Recommended Next Action

In a fresh session, start at §9 Order step 7 (the bump), using the commands in Remaining Work.

# Forbidden Exploration

- `client/**` and the zod/openai/blob code paths.

# Context Notes

- Branch: `staging`. No worktree. TDD enforcement kit installed.
- Stray untracked `ai/.claude/` and **`server/.claude/`**: TDD-hook state created when the shell cwd was a
  subfolder. Not committed; safe to delete. Run the kit commands from the repo root.
- Context pressure: high. Continue in a fresh session.
- Scratch installs of drizzle 0.29.5/0.45.4/kit 0.31.11 are in this session's scratchpad (disposable).

---

## Archived History

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
