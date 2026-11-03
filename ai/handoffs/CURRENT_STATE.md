# Task

No task in progress. TASK-070 (non-breaking dependency security fixes) is **DONE and shipped 2026-11-03**.
The next tasks, TASK-071 and TASK-072, are DRAFT-1 specs waiting for review.

# Current Status

- TASK-070 is pushed to `staging` and fast-forwarded to `main` (`9e243da`). The TASK-072 investigation
  confirmed production is serving `9e243da` (client bundle and Sentry release both match).
- [TASK-071-dependency-security-phase-b.md](../tasks/TASK-071-dependency-security-phase-b.md) covers the
  breaking upgrades: drizzle 0.45, zod 4 + openai, @vercel/blob 2, react-router 7. It recommends four
  separate tasks, drizzle first.
- [TASK-072-production-health-and-updates.md](../tasks/TASK-072-production-health-and-updates.md) has six
  phases. Production is healthy. Phase 2 is the only code change: stop sending 4xx errors to Sentry,
  because `server/app.js` error handler reports and `flush(2000)`s every error, and that is what
  KITCHEN-KEEPER-SERVER-2 is (504 events, 0 users).
- Both specs are uncommitted and need Connor's architect review before implementation.
- MIGRATION_LEDGER: no open rows. TASK-070 had no migrations.

# Files Modified

- `server/package.json` (qs/body-parser overrides), `server/package-lock.json`, `client/package-lock.json`,
  `ai/tasks/TASK-070-dependency-security.md` (committed, `9e243da`)
- New and uncommitted: `ai/tasks/TASK-071-*.md`, `ai/tasks/TASK-072-*.md`

# Decisions Made

- The app does not use Supabase (Connor suspected a paused Supabase project). The database is Neon,
  which scales to zero and wakes on demand.
- body-parser and qs were fixed by bumping the TASK-042 security overrides, staying inside
  express 4.22.3's own ranges.
- Skipped the staging-preview gate for TASK-070 under the "prod verification bypass" feedback
  (dependency-only change, green suite).

# Remaining Work

- Connor: review the TASK-071 and TASK-072 specs and answer TASK-072's open questions, including
  whether 4xx errors should stay out of Sentry entirely, whether `www` should resolve, a downtime window
  for the password rotation, and whether any Fly.io app is still running.
- Connor: run `vercel login`. The CLI token is invalid, so deploy, function-log and cron checks weren't possible.
- Connor: rotate the Neon `neondb_owner` password (TASK-072 Phase 3 gives the order).

# Known Risks / Open Questions

- Remaining audit advisories need TASK-071: drizzle-orm (high), zod (high), @fastify/busboy (high), react-router (moderate).
- Neon quota and suspend state are unverified (no console access). Signed-in production flows weren't smoke-tested.

# Verification Results

- TASK-070: shared/server 118+225 pass, client 75 pass, build OK. Lint has the 30 pre-existing
  `.claude/hooks/tdd/*.mjs` errors, same as baseline.
- Production: `/` 200, `/api/health` 200, `/api/pantry` without a session 401 (expected).

# Recommended Next Action

Review TASK-072 first (Phase 2 is small and fixes the Sentry noise), then TASK-071 starting with drizzle.

# Context Notes

- Branch: `staging` (= `origin/staging` = `origin/main` = `9e243da`). No worktree.
- TDD enforcement kit is installed. Pre-existing unrelated uncommitted changes:
  `.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md`.
- Gotcha: `npm audit fix --omit=dev` prunes devDependencies from `node_modules`. Run `npm install` afterwards.
- Local `npm run build` uploads source maps to Sentry when `SENTRY_AUTH_TOKEN` is set in `.env`.

---

## Archived History

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
