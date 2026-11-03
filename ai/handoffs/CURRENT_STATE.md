# Task

No implementation in progress. TASK-071 (drizzle-orm 0.29.5 → 0.45.4) is at **DRAFT-5, waiting for architect
round-5 review** (round 4: one blocker; the architect expects to approve). TASK-072 (production health) is still at DRAFT-1, waiting for review.

# Current Status

- TASK-071 DRAFT-5 (round 4): the `clerkUserId` cleanup selector is limited to `households` + `user_onboarding`
  (checked: the only tables the tested flows write; no triggers in migrations). The `randomBytes` mock is one
  armed/disarmed dispatcher, reset per sub-test.
- TASK-071 DRAFT-4 (round 3, one blocker): the AC3 dbtest isolation contract. Codes are generated per run and
  verified absent; cleanup is only by captured PKs, rows referencing them, or the synthetic `clerkUserId`
  (never by join code); before/after counts are compared. Author additions: a separate C2 for 3b and 3c, and
  the `clerkUserId` selector covers a `getOrCreate` that rejects after its insert.
- TASK-071 DRAFT-3 (round 2): B1: the fingerprint-change "auto-revert" was replaced with a 6-step incident
  procedure (❌ row in MIGRATION_LEDGER.md, preserve listings, find the SQL that executed, no hand edits, no
  revert without a reviewed plan). B2: the Order list was reformatted one step per line, because markdown had
  renumbered it so "step 7" looked missing. N1: the Q1 status was split out. N2: `COALESCE` in the fingerprint,
  and the listing is authoritative. N3: AC3 cleanup contract incl. the onboarding flow row.
- [TASK-071](../tasks/TASK-071-dependency-security-phase-b.md) DRAFT-2 addressed every round-1 finding (B1–B4,
  N2–N5); the change table is in its Architect Review History. Key changes: pre-bump and post-bump gates in one
  order; the migration ledger is verified by an md5 fingerprint of all `(id, hash, created_at)` rows instead of
  count/max; AC3b–d test the join-code retry itself, using a mocked `crypto.randomBytes` against the real DB;
  the `isUniqueViolation` walk order, try/catch and depth are pinned; G2 is an 8-point migrator checklist.
- The zod/blob/react-router investigation, the full advisory table and the TASK-072/073/074 scopes moved to
  [dependency-phase-b-followons.md](../plans/dependency-phase-b-followons.md). TASK-071 is ~24KB, over the
  15KB spec budget; what's left is ACs and gates.
- Q1 (an interim zod `.max()` task, TASK-075): **Connor said hold off (2026-11-03).** It stays open: the zod
  exposure is deferred, not accepted. Don't create TASK-075 unless asked.
- TASK-070 shipped 2026-11-03 (`9e243da`). MIGRATION_LEDGER: no open rows.

# Files Modified

- `ai/tasks/TASK-071-dependency-security-phase-b.md` (DRAFT-5), this file. Docs only; no code changed.

# Files Required Next

- TASK-071 only, for the re-review. For implementation, its §4 Allowed Files.

# Decisions Made

- Every round-1 architect finding was accepted. Q2 is resolved: record the Vercel Node version in CONVENTIONS.md
  and don't add `engines`.
- TASK-075 is on hold (Connor).

# Remaining Work

- Connor: send TASK-071 DRAFT-5 for architect round-5 review; review TASK-072 and answer its open questions (4xx in
  Sentry, `www`, downtime window for the password rotation, Fly.io).
- Connor: run `vercel login` (the CLI token is invalid). Rotate the Neon `neondb_owner` password (TASK-072 Phase 3).
- Connor: record the Vercel project Node version in CONVENTIONS.md (TASK-071 G6; blocks TASK-073/074).

# Known Risks / Open Questions

- zod GHSA-mrhx has real exposure (unbounded arrays on authed routes) and stays unmitigated while TASK-075 is on hold.
- TASK-071's migrator semantics are unverified until G2 runs. The retry test assumes `mock.module('crypto')`
  intercepts `householdService`'s import; the test-writer has to confirm that.
- Neon quota and suspend state are unverified. Signed-in production flows weren't smoke-tested.

# Verification Results

- Docs-only session: no tests run. TASK-070's last results: shared/server 118+225 pass, client 75 pass, build OK,
  and lint has the 30 known `.claude/hooks/tdd/*.mjs` errors.

# Recommended Next Action

When the TASK-071 round-5 review comes back, critically assess each finding, then produce DRAFT-3 or mark it approved.
Implementation starts at §9 Order step 1 (G1), after TASK-070 is confirmed on `staging`.

# Forbidden Exploration

- `client/**` and the zod/openai/blob code paths: out of scope for TASK-071.

# Context Notes

- Branch: `staging`. No worktree. Stray untracked `ai/.claude/tdd-state/` is TDD-hook state created when a
  shell ran from `ai/`. It is safe to delete and is not committed.
- Context pressure at handoff: low.
- TDD enforcement kit is installed. Pre-existing unrelated uncommitted changes:
  `.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md`.
- Gotcha: `npm audit fix --omit=dev` prunes devDependencies from `node_modules`. Run `npm install` afterwards.
- Local `npm run build` uploads source maps to Sentry when `SENTRY_AUTH_TOKEN` is set in `.env`.

---

## Archived History

- TASK-071 DRAFT-4: `da6666b`; DRAFT-3: `23c3f4d`; DRAFT-2: `9a13de8`. DRAFT-1 + TASK-072 spec-drafting: see commit `2f444d6`
- TASK-070 (non-breaking dependency fixes, shipped 2026-11-03): see [TASK-070](../tasks/TASK-070-dependency-security.md)
- TASK-069 (semantic retrieval: pgvector + hybrid search + eval harness, shipped to production): see [archive/TASK-069.md](archive/TASK-069.md)

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
