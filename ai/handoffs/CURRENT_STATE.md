# Task

TASK-068 — Wire up Sentry (errors + logs), migrate `debugLog.js`'s `logEvent()` call sites to it, delete
the closed investigation's diagnostic scaffolding. Spec: [TASK-068-spec.md](../tasks/TASK-068-spec.md)
(DRAFT-7, approved 9.8-10/10). Previous task (TASK-067, service worker fix) archived below.

# Current Status

**Implementation complete, locally verified, one architectural finding sent back for round-8 architect
review before it can be closed out (see Known Risks below — not a blocker on anything except criterion
11/marking this task fully done).** §2.0's verification gate ran first
(decision table filled in the spec, §2.0) — key finding: current Sentry docs recommend a separate
`instrument.js` imported as literally the first import in the entry file, not the spec's originally-proposed
`<script>` tag; used that instead since it satisfies the same ordering requirement via standard ES module
evaluation semantics. `sendDefaultPii` is deprecated in the current SDK line — used `dataCollection: {
userInfo: false, httpBodies: [] }` instead for the same minimal-PII behavior.

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
- **Deleted**: `client/src/components/DebugPanel.jsx`, `client/src/components/PreconnectGoogleOAuth.jsx`,
  `client/src/lib/lifecycleLog.js`

# Remaining Work

Everything below genuinely needs a live browser and/or a real deployment — not further local iteration:

1. **Local dev smoke test** (spec §6 steps A/B/D): run both dev servers, deliberately throw a client error
   and a server error, confirm both land in the Sentry dashboard tagged `environment: local`; sign in and
   confirm `auth-settled` appears in Sentry Logs; run the real sign-in flow to confirm no regression from
   removing `PreconnectGoogleOAuth`/`AuthStateLogger`/`SignFlowStateLogger` (Rule 9: desktop Chrome first).
2. **F11**: temporarily break `Sentry.init()` on each side, confirm the app still boots/server still starts.
3. **F12**: mechanical init-ordering proof against the served production build (not dev server) — I have
   high confidence via documented ES module evaluation semantics + Sentry's own current guidance (recorded
   in §2.0's decision table), but this criterion specifically asks for a runtime check, not an argument.
4. **G (duplicate-error check)**: confirm a thrown React render error produces exactly one Sentry event, not
   two.
5. **H (source-map resolution)**: confirm a triggered production-build exception resolves to original
   source in the Sentry dashboard UI itself (upload succeeded — confirmed this session — but resolution in
   the UI is a separate check).
6. **I (N=10 serverless burst test)**: needs a deployed Preview, not local — trigger 10 separate server
   errors across separate invocations, confirm all 10 arrive, record the delivery window.
7. **Vercel setup** (deferred from account setup, not blocking so far): mirror
   `SENTRY_DSN`/`SENTRY_ENVIRONMENT`/`VITE_SENTRY_DSN`/`VITE_SENTRY_ENVIRONMENT` into Preview/Production
   scopes with `staging`/`production` values; add `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` to
   Production/Preview **build** environment only (never client-exposed).
8. Registering `getsentry/sentry-mcp` for Claude Code — explicitly out of scope for this diff (spec §4), a
   local config step to do once this ships.

# Known Risks / Open Questions

- **Architectural question resolved (rounds 8-9), one test remains before criterion 11 closes.** Round-9
  verdict: do **not** disable `browserApiErrorsIntegration` in any environment — production's real coverage
  across 10 real `addEventListener` call sites (including the load-bearing
  `installOauthMarkerListener()`) is worth more than removing what live testing showed is very likely a
  React development-build-only artifact. §2.2's rationale rewritten in the spec; a wording fix round-9
  flagged also applied. **Explicitly rejected** doing the one remaining verification via a temporary
  `preview.proxy` hack — round-9 wants it run against a real deployed Vercel Preview instead (exercises
  actual production React, routing, auth, `/api` deployment, and Sentry config together). Full history in
  [TASK-068-spec.md Section 8](../tasks/TASK-068-spec.md#8-live-verification-finding--pending-round-8-architect-review-post-implementation).
- Separately (non-blocking, recorded in spec §8): signed-out-user render errors never reach
  `captureExceptionSafely()` at all — `/api/client-errors` requires auth (pre-existing, not introduced by
  this task), so the report 401s before the route handler runs.
- The release value in this session's test builds read `unknown` (no `VERCEL_GIT_COMMIT_SHA` locally) — the
  byte-for-byte release-equality criteria (12/17/20) need a real Vercel-built deploy to actually check
  against.
- Everything else the spec itself flags in its own §7 (log-volume/free-tier quota, `err.message` content
  bounded-not-scrubbed, the shape allowlist's scope) still applies unchanged.

# Recommended Next Action

Round-9 architect review closed the design question (§8) — remaining path to done is now concrete:
1. Add all seven Sentry env vars to Vercel's Preview scope (Connor hasn't touched the Vercel project yet).
2. Push to get a Preview deployment built with them.
3. Signed in, on that Preview: deliberately throw a render error, confirm exactly one Sentry event with
   `originalStack`/`componentStack` present (criterion 11 / round-9's required test).
4. Same Preview covers item 6 above (N=10 serverless burst test) and items 3/5 (F12 init-ordering, H
   source-map resolution) — all need a real deployment anyway, worth doing in one pass rather than four.
Waiting on Connor's go-ahead before touching Vercel config or pushing.

# Context Notes

- branch: `staging` (working tree, not yet committed).
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
