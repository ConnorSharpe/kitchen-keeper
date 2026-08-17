# Task

TASK-068 — Wire up Sentry (errors + logs), migrate `debugLog.js`'s `logEvent()` call sites to it, delete
the closed investigation's diagnostic scaffolding. Spec: [TASK-068-spec.md](../tasks/TASK-068-spec.md)
(DRAFT-7, approved 9.8-10/10). Previous task (TASK-067, service worker fix) archived below.

# Current Status

**Implementation complete, committed and pushed to `staging` (`dfa8d5a`), round-8/9 architect review closed
the one architectural question this task raised, and round-9's required live test PASSED against a real
deployed Preview.** Full history: [TASK-068-spec.md Section
8](../tasks/TASK-068-spec.md#8-live-verification-finding--pending-round-8-architect-review-post-implementation).
Short version: live testing found Sentry's own automatic instrumentation independently captured a React
render error in the dev server (contradicting the spec's original §2.2 rationale) — but a production-build
retest showed zero automatic captures, and round-9 confirmed (against a real Preview, authenticated, commit
`cbc7b6a`) that the intended `ErrorBoundary` → `/api/client-errors` → `captureExceptionSafely()` path alone
produces exactly one correctly-tagged event. No Sentry integration was disabled; §2.2's rationale is
rewritten in the spec to match reality. Criterion 11 is satisfied.

§2.0's verification gate ran first (decision table filled in the spec, §2.0) — key finding: current Sentry
docs recommend a separate `instrument.js` imported as literally the first import in the entry file, not the
spec's originally-proposed `<script>` tag; used that instead since it satisfies the same ordering
requirement via standard ES module evaluation semantics. `sendDefaultPii` is deprecated in the current SDK
line — used `dataCollection: { userInfo: false, httpBodies: [] }` instead for the same minimal-PII behavior.

**Installed & pinned**: `@sentry/react@10.70.0`, `@sentry/vite-plugin@5.4.0` (client), `@sentry/node@10.70.0`
(server) — exactly the three direct dependencies the spec's dependency-policy exception (§2.1a) allows,
confirmed via `git diff` on all three `package.json` files.

**Live-verified against the real Sentry account** (org `connor-sharpe`, projects `kitchen-keeper-client`/
`kitchen-keeper-server`, set up earlier this session): `npm run build` actually authenticated and uploaded
source maps to Sentry (confirmed via the build's own "Uploaded files to Sentry... Organization: connor-sharpe
... Projects: kitchen-keeper-client" output), and generated `.map` files are absent from `client/dist/assets/`
afterward. Caught and fixed a real bug during this: `vite.config.js` originally read `process.env.SENTRY_ORG`
etc. directly, which does **not** reflect `.env.local` contents — fixed by switching to Vite's own
`loadEnv(mode, cwd, '')`, verified directly via a standalone probe script before and after.

**Also caught and fixed via the tests actually running** (not just written): `safeSentryLog()` and
`captureExceptionSafely()` originally only caught *synchronous* throws from the underlying Sentry SDK call —
missed the case where the call returns a rejected Promise. `debugLog.test.js`'s failure-isolation test
(mocking `@sentry/react` at the module level via `node:test`'s `mock.module`, added
`--experimental-test-module-mocks` to `client/package.json`'s test script to match server's existing
pattern) caught this immediately; fixed in both `client/src/instrument.js` and `server/instrument.js` by
also `.catch()`-absorbing a thenable return value.

**§1's call-site audit had a gap**: `main.jsx`'s `app-boot` `logEvent()` call wasn't in the spec's original
table. Found via criterion 2's required repo-wide `logEvent(` grep reconciliation, added to the spec's §1
table — its payload is all top-level strings/booleans/numbers, fits the shape allowlist unchanged, no code
change needed.

**Verification run this session** (automatable slice only — see Remaining Work for what still needs a live
browser/deployment):
- `npm run lint` — clean, zero errors.
- `npm run build` — succeeds; also re-ran with build-time credentials unset (no `client/.env.local`
  variables in shell env) to confirm graceful degradation — build still succeeds, just skips upload
  (criterion 19's local-build-without-credentials half).
- Full test suite: root `npm test` (shared + server, 117 tests) green. Root script does **not** include
  client tests (pre-existing gap, not introduced by this task) — ran `npm test --prefix client` separately,
  75 tests green, including `debugLog.test.js`'s new shape/failure-isolation tests and every other client
  test that transitively imports `debugLog.js` → `instrument.js` → real (unmocked) `@sentry/react`, confirmed
  passing standalone too (`Sentry.init()` with no DSN doesn't throw under plain Node without jsdom).

**Local dev smoke test run live against the real Sentry account** (both dev servers up locally; a pre-
existing, unrelated bug surfaced along the way — `nodemon`'s bundled `minimatch` crashes on file-watch
restart due to a `brace-expansion` version conflict from `server/package.json`'s `overrides`, not caused by
this task; worked around by running `node index.js` directly instead of through `nodemon` for this session):
- **Server-side capture: confirmed working end-to-end.** Deliberate throw → landed in Sentry with
  `environment: local`, resolved to real source (`app.js:75:9`), breadcrumbs showed only `http.method`, no
  bodies. 465ms response time vs. ~2ms baseline — consistent with `await flush(2000)` completing a real
  network round-trip.
- **Client-side capture: works, but found a real gap in the spec's own design reasoning** — see the
  blocking item in Known Risks below. Not a regression from this task's code; it's the spec's stated
  rationale for skipping `<Sentry.ErrorBoundary>` turning out to be incomplete once tested live.
- Both temporary throws (`server/app.js`, `client/src/pages/LandingPage.jsx`) fully reverted; `git diff`
  confirms only the intended change set remains.

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

Criteria 1, 11, and 13 are now done (duplicate-error, init-failure/init-ordering, N=10 burst delivery — all
confirmed against the real `staging` Preview or by local test, see spec §6 steps F11/F12/G/I). Still open,
both needing you to drive a real browser against the Preview (I'm blocked from navigating that domain,
same as `localhost`):

1. **H (source-map resolution)**: confirm a *client-side* production exception (one Sentry's own SDK
   captures directly, not via the server path) resolves to original source/line in the dashboard UI, not
   minified output — upload itself already confirmed working (§2.1a's build output), this checks the
   *resolution*, a separate thing.
2. **B (Sentry Logs)**: sign in and confirm `auth-settled` actually appears in Sentry's *Logs* view
   (distinct from Errors) — `useSettledAuth.js`'s `logEvent()` call.
3. **Vercel Production scope**: only Preview has the seven Sentry env vars so far — add to Production when
   actually ready to ship this there (not urgent; `staging` stays the working branch).
4. Registering `getsentry/sentry-mcp` for Claude Code — explicitly out of scope for this diff (spec §4).

# Known Risks / Open Questions

- **Resolved this session, not a risk going forward**: the duplicate-error architectural question (rounds
  8-9, §8) — `browserApiErrorsIntegration` stays enabled everywhere, no integration disabled, confirmed via
  a real Preview test. Kept here only as a pointer: [TASK-068-spec.md Section
  8](../tasks/TASK-068-spec.md#8-live-verification-finding--pending-round-8-architect-review-post-implementation).
- Signed-out-user render errors never reach `captureExceptionSafely()` — `/api/client-errors` requires auth
  (pre-existing, not introduced by this task), so the report 401s before the route handler runs. Recorded,
  not yet decided whether to special-case (spec §8).
- One Sentry-side observation (not this task's own scrubbing): `client.originalStack`'s value showed
  `[Filtered]` in the dashboard during round-9's test — Sentry's own default Data Scrubber, not
  `validateTelemetryShape()` (which doesn't govern `captureExceptionSafely()`'s `clientContext`). Worth
  knowing if `originalStack` content is ever needed for real debugging.
- Everything else the spec itself flags in its own §7 (log-volume/free-tier quota, `err.message` content
  bounded-not-scrubbed, the shape allowlist's scope) still applies unchanged.

# Recommended Next Action

Criteria 1/11/13 done this session (F11/F12 fixed+verified, N=10 burst test 10/10). Only H and B remain,
and both need Connor driving a real browser against the Preview — I can check the Sentry dashboard side of
each once he triggers them, same pattern as the round-9 test.

# Context Notes

- branch: `staging`, pushed through `1555f43`. Commit sequence this session: `dfa8d5a` (implementation),
  `cbc7b6a`/`467b0f9` (round-9 duplicate-error test trigger + revert), `9ec380e` (F11 try/catch fix,
  permanent), `70f741d`/`1555f43` (N=10 burst-test route trigger + revert). Only `dfa8d5a` and `9ec380e`
  carry permanent code; the other four are temporary-test-then-revert pairs, code gone from HEAD, kept in
  history.
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Pre-existing, unrelated to this task (carried forward, untouched): `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed by this task's sessions.
- context pressure: medium
- token usage concerns: none

---

## Archived History

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
