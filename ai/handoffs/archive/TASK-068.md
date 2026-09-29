# Task

TASK-068 — Wire up Sentry (errors + logs), migrate `debugLog.js`'s `logEvent()` call sites to it, delete
the closed investigation's diagnostic scaffolding. Spec: [TASK-068-spec.md](../tasks/TASK-068-spec.md)
(DRAFT-7, approved 9.8-10/10). Previous task (TASK-067, service worker fix) archived below.

**Post-ship hotfix (2026-09-14, no TASK number — small enough not to warrant one)**: Sentry's first
real-world catch. `navigator.serviceWorker.register('/sw.js')` had no `.catch()` — a pre-existing,
TASK-068-unrelated gap (that line predates TASK-068; TASK-068 never touched it) that had zero visibility
until Sentry's global unhandled-rejection handler surfaced it. Low severity (registration failing doesn't
break the app, just skips offline-caching setup for that session). Fixed in `client/src/main.jsx`: now
`.catch()`es and logs `sw-register-failed` via `logEvent()` for visibility without counting as a full
error. Shipped `staging`/`main` both at `cd6f1fa`, tests/lint/build all green, Preview gate bypassed per
Connor's standing preference for small, well-tested app-code fixes (verify live on prod instead).

# Current Status

**DONE AND SHIPPED TO PRODUCTION.** Implementation complete, all acceptance criteria and verification
steps closed, `staging` and `main` both at `d41a6ad` (fast-forward merge, pushed). All seven Sentry env
vars added to Vercel's Production scope (mirroring Preview's values, `SENTRY_ENVIRONMENT`/
`VITE_SENTRY_ENVIRONMENT` = `production` instead of `staging`, only `SENTRY_AUTH_TOKEN` sensitive). Full
history: [TASK-068-spec.md Section
8](../tasks/TASK-068-spec.md#8-live-verification-finding--pending-round-8-architect-review-post-implementation)
and the spec's own criteria annotations (§5) for the evidence behind each.

**The one architectural question this task raised** (rounds 8-9): live testing found Sentry's own automatic
instrumentation independently captured a React render error in the dev server, contradicting §2.2's
original duplicate-error rationale. A production-build retest showed zero automatic captures; round-9
confirmed against a real authenticated Preview that the intended `ErrorBoundary` → `/api/client-errors` →
`captureExceptionSafely()` path alone produces exactly one event. No Sentry integration was disabled —
`browserApiErrorsIntegration` stays fully enabled everywhere (disabling it would have cost real coverage
across ten `addEventListener` call sites app-wide). §2.2's rationale is rewritten to match this.

**Two real bugs caught and fixed by actually running things, not just writing code:**
1. `safeSentryLog()`/`captureExceptionSafely()` only absorbed *synchronous* SDK throws, missed rejected
   Promises — caught by `debugLog.test.js`'s failure-isolation test actually failing.
2. `Sentry.init()` wasn't wrapped in try/catch on either side — would have aborted the whole module
   evaluation on a real init failure (client: before React ever mounts; server: before `app.js` exports).
   Found while preparing F11's check, fixed, verified server-side via a forced-throw test.

Also fixed: `vite.config.js` originally read bare `process.env.SENTRY_ORG` etc., which doesn't reflect
`.env.local` — switched to `loadEnv()`. And `main.jsx`'s `app-boot` `logEvent()` call was missing from §1's
original audit table — found via the required repo-wide grep reconciliation, added, no code change needed
(payload already fits the shape allowlist).

**Every criterion in §5 confirmed with live evidence against the real Sentry account and, where the spec
required it, a real deployed `staging` Preview** — not simulated: server/client error capture, Sentry Logs
(`auth-settled`/`app-boot`), source-map resolution (byte-for-byte release verified via `git log`, not
assumed from Sentry's truncated UI display), N=10 serverless burst delivery (10/10), init-ordering against
the actual production bundle's byte offsets, init-failure-doesn't-block-boot. Full test suite (192 tests
across shared/server/client), lint, and build all green throughout.

Every temporary test trigger used to produce this evidence was committed, tested, then reverted in the
immediately-following commit — `git diff` confirmed clean after each one.

# Files Modified

- `client/src/instrument.js` (new) — `Sentry.init()`, `safeSentryLog()`
- `server/instrument.js` (new) — `Sentry.init()`, `captureExceptionSafely()`, `flush()`
- `client/src/main.jsx` — `instrument.js` as first import; removed `lifecycleLog.js` imports/calls
- `client/vite.config.js` — `@sentry/vite-plugin` wiring, `loadEnv()`, release injection
- `client/src/lib/debugLog.js` — rewritten: `validateTelemetryShape()` + Sentry-backed `logEvent()`,
  `isDebugEnabled`/`setDebugEnabled`/`getLog`/`clearLog` removed
- `client/src/lib/debugLog.test.js` — rewritten against the new contract
- `client/src/App.jsx` — removed `DebugPanel`, `PreconnectGoogleOAuth`, `AuthStateLogger`,
  `SignFlowStateLogger`
- `client/src/lib/authTransition.js` — removed `perfNowMs`, un-exported `GOOGLE_BUTTON_SELECTOR`, reworded
  two comments referencing the now-deleted `lifecycleLog.js`
- `server/app.js` — `instrument.js` import, error middleware calls `captureExceptionSafely()` + `flush()`
- `server/routes/clientErrors.js` — routes through `captureExceptionSafely()`
- `client/package.json`, `server/package.json` (+lockfiles) — three pinned dependencies;
  `client/package.json`'s test script gained `--experimental-test-module-mocks`
- `.env.example` — documented all seven new env vars
- `ai/tasks/TASK-068-spec.md` — §2.0 decision table filled in; §1 table's `app-boot` gap added
- `client/src/instrument.js`, `server/instrument.js` — `Sentry.init()` wrapped in try/catch (F11 fix, found
  while preparing that check — wasn't guarded before, would have aborted module evaluation on either side)
- **Deleted**: `client/src/components/DebugPanel.jsx`, `client/src/components/PreconnectGoogleOAuth.jsx`,
  `client/src/lib/lifecycleLog.js`

# Remaining Work

Nothing blocking, nothing left in the task's own scope. One optional item, out of scope for this diff:
registering `getsentry/sentry-mcp` for Claude Code (spec §4) — a one-time local config step, whenever
wanted.

# Known Risks / Open Questions

- Signed-out-user render errors never reach `captureExceptionSafely()` — `/api/client-errors` requires auth
  (pre-existing, not introduced by this task), so the report 401s before the route handler runs. Recorded
  in spec §8, not yet decided whether to special-case — a product/policy call, not an architecture one.
- One Sentry-side observation (not this task's own scrubbing): `client.originalStack`'s value showed
  `[Filtered]` in the dashboard during testing — Sentry's own default Data Scrubber, not
  `validateTelemetryShape()` (which doesn't govern `captureExceptionSafely()`'s `clientContext`). Worth
  knowing if `originalStack` content is ever needed for real debugging.
- Everything else the spec itself flags in its own §7 (log-volume/free-tier quota, `err.message` content
  bounded-not-scrubbed, the shape allowlist's scope) still applies unchanged — accepted trade-offs, not bugs.

# Recommended Next Action

None. Task closed. Next real trigger for touching Sentry again would be a future task, not follow-up on
this one.

# Context Notes

- branch: `staging` and `main` both at `d41a6ad` (fast-forward merge, no divergence). Two commits carry
  permanent code (`dfa8d5a` implementation, `9ec380e` the F11 try/catch fix); the rest of this session's
  commits on `staging` before the merge were temporary-test-trigger/revert pairs used to produce live
  evidence for §5's criteria — code from those is gone from HEAD, kept in history.
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Pre-existing, unrelated to this task (carried forward, untouched): `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed by this task's sessions.
- context pressure: medium
- token usage concerns: none

---

## Archived History

