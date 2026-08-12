# Task

TASK-066 — Main-thread rAF heartbeat diagnostic (instrumentation implemented; on-device capture not yet run).

# Current Status

Implemented per DRAFT-4 spec ([TASK-066-spec.md](../tasks/TASK-066-spec.md)), §2.1-2.3 in full. All
code-side acceptance criteria (1-4, 7, 9) verified. On-device paired-capture criteria (5, 6, 8) require
Connor's physical device and were **not attempted this session** — see Remaining Work.

# Files Modified

- `client/src/lib/authTransition.js` — exported the existing `GOOGLE_BUTTON_SELECTOR` const (no behavior
  change).
- `client/src/main.jsx` — added `userAgent`, `devicePixelRatio` to the existing `app-boot` `logEvent()` call.
- `client/src/lib/lifecycleLog.js` — added the rAF main-thread heartbeat: capture-phase click listener on
  `GOOGLE_BUTTON_SELECTOR` starts a heartbeat; checkpoint-zero first-gap definition; 50ms-threshold gap
  recording (`{startMs, gapMs}`); 3-frame observed-initial-cadence array; 5000ms safety-ceiling timeout;
  `completed`/`superseded`/`timed-out` terminal states (mutually exclusive, torn down via
  `cancelAnimationFrame`/`clearTimeout`); failure-isolated (try/catch around click handler and each rAF
  callback, never blocks the real Google-button click or `pagehide` handling); no-duplicate-registration
  guard if `installLifecycleLogging()` ever runs twice; a `completed` heartbeat is folded into the existing
  `lifecycle-pagehide` log entry, `superseded`/`timed-out` are logged separately as
  `heartbeat-superseded`/`heartbeat-timed-out`.

# Files Required Next

None for continuing code work. The next step is on-device capture (needs Connor's iPhone, the Chrome-for-iOS
home-screen PWA, and the existing DebugPanel debug-mode toggle), not further file changes.

# Files Already Reviewed

`client/src/lib/lifecycleLog.js`, `authTransition.js`, `main.jsx`, `debugLog.js` — all read in full before
editing.

# Dependency Chain

Editing:
- `client/src/lib/lifecycleLog.js`
- `client/src/lib/authTransition.js`
- `client/src/main.jsx`

Requires:
- `client/src/lib/debugLog.js` (`logEvent`/`isDebugEnabled` contract, unchanged)

Irrelevant:
- `client/src/hooks/useAuthRecovery.js`
- `client/src/lib/routeDecision.js`
- `client/src/context/AuthContext.jsx`
- `server/*`

# Architecture Notes

Heartbeat state is module-scoped (`activeHeartbeat`, a single instance) in `lifecycleLog.js`, not React
state — mirrors the existing pattern in that file, where every diagnostic is a plain module-level listener
installed once from `main.jsx`. Reuses the already-running tap-triggered loop for both the thresholded gap
array and the observed-initial-cadence fields (spec §2.3), rather than adding a second, always-on loop.

# Decisions Made

- Severity bands and overlap-flag classification (spec §2.2) are analysis-time calculations for the handoff
  document, not runtime code — the spec explicitly says not to compute bands in the recording hot path. The
  instrument itself only records raw `{startMs, gapMs}` pairs and the three cadence intervals.
- `heartbeat-timed-out` is logged (mirroring `heartbeat-superseded`) even though acceptance criterion 4 only
  explicitly requires a log entry for the superseded case — free to add given the existing `logEvent()` call,
  and keeps the timed-out path from being invisible if it ever fires during a real capture.
- The new click listener lives inside `installLifecycleLogging()` itself (not a new function called
  separately from `main.jsx`), since the spec's Allowed Files list for `main.jsx` only permits the app-boot
  line addition, not a new install call.

# Remaining Work

1. On-device paired captures (spec §5.5-5.8, acceptance criteria 5/6/8) — 3-5 failed/succeeded pairs on
   Connor's real device (Chrome-for-iOS home-screen icon, not Safari), using the existing DebugPanel toggle.
   Not started this session; requires Connor's manual involvement, cannot be done by an agent.
2. Per-attempt analysis (spec §2.2's required correlation: `signInsElapsedMs`, overlap flags, the
   qualifying-evidence rule) — done at handoff-writing time from the captured raw log data, once step 1
   produces captures.
3. Explicit yes/no/mixed conclusion (acceptance criterion 8) — depends on steps 1-2.

# Known Risks / Open Questions

- Carried forward from TASK-065's negative-signal finding (archived —
  [archive/TASK-065-negative-signal.md](archive/TASK-065-negative-signal.md)): the core premise that the
  delay is main-thread-attributable is still unconfirmed either way; this instrument is what will actually
  test it.
- §6-A (whether TASK-065's preconnect `<link>` actually lands in the DOM in production) remains unconfirmed —
  separate from this task's scope, not blocking.
- No regression risk: TASK-064's recovery mechanism is untouched; this is diagnostic-only, gated behind
  `isDebugEnabled()`, and failure-isolated from all real click/pagehide handling.

# Verification Results

- `npm run lint` (repo root, `eslint .`): PASS, 0 errors.
- `npm run build` (client, `vite build`): PASS, no new dependency, bundle size unchanged in kind (pre-existing
  >500kB chunk-size warning, not introduced by this change).
- `node --test src/lib/authTransition.test.js` (client): PASS, 18/18.
- No new automated test added — matches spec acceptance criterion 9 (same category as `lifecycleLog.js`'s
  other untested browser-timing diagnostics, precedent TASK-064 §1).
- On-device smoke test: **not performed this session** — requires Connor's physical device; this
  instrumentation only activates on the real Clerk Google-OAuth button, with no equivalent surface to
  exercise in a desktop browser.

# Recommended Next Action

Hand this to Connor for the on-device paired-capture phase (spec §5.5-5.8): enable debug mode via
DebugPanel, run 3-5 alternating failed/succeeded sign-in attempts on the actual Chrome-for-iOS home-screen
PWA, export the debug log, and bring the raw log back for analysis (§2.2's correlation calculations) in a
fresh session per Rule 5 — that's a distinct phase from this implementation session.

# Forbidden Exploration

- `client/src/hooks/useAuthRecovery.js`
- `client/src/lib/routeDecision.js`
- `client/src/context/AuthContext.jsx`
- `authTransition.js`'s marker read/write/expiry logic
- TASK-065's preconnect wrapper
- `server/*`

# Context Notes

- branch: `staging` and `main` both pushed to commit `f11678e` (Connor confirmed this diagnostic-only,
  debug-gated change is safe to also push straight to production — no on-device verification blocks this
  per Rule 8, push success is the completion signal, not confirmed-live).
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Pre-existing, unrelated to this task (carried forward, untouched): `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed by this session.
- context pressure: low
- token usage concerns: none

---

## Archived History

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
