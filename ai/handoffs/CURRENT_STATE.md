# Task

TASK-067 — Service Worker: exclude cross-origin requests from cache-first strategy. **Complete, shipped to
production.** Root cause of the long-running Google sign-in "double click" investigation (TASK-063 through
TASK-066). See [TASK-067-spec.md](../tasks/TASK-067-spec.md) for the full investigation, both architect
review rounds, and the evidence trail.

# Current Status

Code shipped to `staging` and `main` (both at commit `3a6777a`). Fix: `client/public/sw.js`'s cache-first
fetch branch now excludes any request where `url.origin !== self.location.origin`, so cross-origin GETs
(Clerk's API) always go to network instead of risking a stale Cache Storage hit. Same-origin behavior
(navigations, `/api/*`, `/uploads/*`, static assets) unchanged.

**Root cause, in one line**: TASK-064's iOS-PWA "uncommanded WebKit reload" theory was a correct mitigation
for a real symptom, but not the actual cause — this session reproduced the identical symptom on desktop
Chrome, ruling out every WebKit-specific theory and pointing at the service worker instead. The fetch
handler's cache-first branch had no origin check, so Clerk's cross-origin `/v1/client` session-check response
(the request that determines `isSignedIn`) could be served a stale, pre-sign-in cached copy immediately after
a real OAuth completion — explaining why the first attempt consistently read as signed-out while a same-tap
retry, which picked up the background-refreshed cache entry, succeeded.

**Evidence** (spec §0, Step 0): three convergent findings, not one perfectly-isolated capture — (1) a live
SW-internal diagnostic (`console.log` inside the fetch handler, viewed via the worker's own DevTools console)
showed `cacheHit: true` on the exact `/v1/client` request; (2) Application → Cache Storage inspection on
production showed a `/v1/client` entry transitioning from a signed-out to a signed-in body ~74 seconds apart,
matching the stale-then-background-refreshed mechanism; (3) `kk_debug_log` captures showed both the failed
and successful attempts settling *fast* (~400-560ms), ruling out a timing race against `useSettledAuth`'s
2-second ceiling as an alternative explanation.

# Remaining Work

None for this task. On-device verification (fresh incognito, staging): signed in with Google on the first
attempt, no "tap to try again" message — matches the expected outcome. TASK-064's recovery mechanism,
TASK-065's preconnect hint, and TASK-066's rAF heartbeat diagnostic are all untouched and remain in the
codebase.

# Known Risks / Open Questions

- Minor loss of offline resilience for cross-origin resources (spec §7) — no known cross-origin dependency
  actually needs SW-level caching today, but flagged rather than assumed away.
- TASK-066's residual open question (splitting WebKit-proper from Chrome's iOS shell code, blocked on Mac
  access) is unrelated to this fix and remains open separately, if ever revisited.
- If the "tap to try again" message reappears for anyone in production, that would mean either a second,
  distinct interruption cause exists (TASK-064's recovery mechanism still catches it, by design) or this
  fix's reasoning has a gap — treat as a new finding, not an assumed recurrence of the same bug.

# Recommended Next Action

None queued. This closes out the TASK-063→067 double-sign-in investigation chain.

# Context Notes

- branch: `staging` and `main` both at commit `3a6777a`.
- No migration/schema work — `MIGRATION_LEDGER.md` doesn't apply to this task.
- Pre-existing, unrelated to this task (carried forward, untouched): `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md` (both modified), `ai/handoffs/archive/TASK-061-implementation.md`
  (untracked) — not staged or committed by this task's sessions.
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
- TASK-066 implementation + on-device capture results (conclusive: no main-thread stall observed): see
  [archive/TASK-066-implementation.md](archive/TASK-066-implementation.md)
