# Task

TASK-063 implementation + follow-up investigation — iOS PWA double sign-in/sign-out: `loading -> settling
-> settled` auth state machine shipped, confirmed NOT to fix the user-facing symptom on its own. Two rounds
of on-device diagnostics have now separated this into two distinct, differently-evidenced bugs (see Current
Status). Per [TASK-063-spec.md](../tasks/TASK-063-spec.md) DRAFT-3.

# Current Status

**Second real on-device capture (2026-08-11 23:39-23:40) analyzed — sign-in and sign-out are two separate
bugs with different mechanisms, not one shared root cause as previously hypothesized:**

- **Sign-out: mechanism directly confirmed by this capture.** `signout-start` → `signout-resolved` (309ms,
  no error) → an uncommanded reload (`pagehide` persisted:false → `app-boot`, ~800ms after resolve, zero
  `window.location.reload()` calls exist anywhere in this codebase) → the freshly-booted app reads back
  `isSignedIn: true`. The reload landed in the gap between `signOut()`'s promise resolving and its effect
  becoming durable (most likely Clerk's local persisted-session cache, not yet confirmed which layer). Second
  attempt, no reload in between, works cleanly.
- **Sign-in: different mechanism, NOT yet directly evidenced.** Connor confirmed he tapped "Continue with
  Google" twice, but the capture shows only one `/sign-in` navigation, one OAuth round-trip, and zero events
  of any kind in the ~3s between arriving at `/sign-in` and the (single, successful) OAuth flow starting. No
  reload occurred in that gap either — ruling out the sign-out-style "reload undoes a completed action"
  mechanism for this case. The first tap on Clerk's own hosted Google button appears to have produced **no
  observable effect at all**, consistent with a lost/ignored touch event rather than a completed-then-reverted
  action. We have no visibility into Clerk's hosted button internals, so root cause is still open.

**New diagnostics added this round (build/lint/test-green, NOT yet committed/deployed) to close the sign-in
gap**: `installClickLogging()` (`lifecycleLog.js`) — logs every `pointerdown` and `click` app-wide,
capture-phase (before anything can `stopPropagation`), with target tag/id/className/text/`isTrusted`. Answers
the narrower question a state-only diagnostic can't: does a "lost" tap reach the page as an event at all, and
what element receives it. Wired up in `main.jsx` alongside the existing lifecycle/URL-change installers.

No further sign-out-specific diagnostics added this round — its mechanism is already well-evidenced by the
existing `signout-*`/lifecycle/`auth-settled` logging; another capture with the same instrumentation would
likely just reconfirm it. Cookie-level inspection was considered and rejected: Clerk's actual session cookie
is almost certainly `HttpOnly` (standard practice, not independently confirmed) and therefore invisible to
client JS regardless of instrumentation.

Original TASK-063 on-device finding (2026-08-11 23:06-23:07, first capture) remains valid background: the
`settling`/`settled` state machine itself works exactly as designed (every settlement was `"stable"`,
`initial === final`) — it was solving a real, correctly-identified problem that turned out not to be *this*
one.

**Prior-round context (still relevant background, superseded in specifics by the Current Status above):**
TASK-063's `settling`/`settled` state machine shipped in commit `a3f942f`. The first on-device capture led to
a (now superseded) hypothesis that a single shared root cause — Clerk's transfer-to-signup mechanism plus a
WebKit-level reload racing an in-flight auth action — explained both symptoms. The second capture confirmed
this for sign-out specifically but left sign-in's mechanism open (see Current Status above); the transfer
mechanism remains plausible for sign-in but is not yet directly evidenced the way the sign-out race now is.

Web research (see Sources earlier in conversation) that's still relevant:
- Clerk has a **documented, intentional "transfer" mechanism**: an OAuth sign-in Clerk can't confirm maps to
  an existing account gets automatically transferred into the sign-up flow (`missing_requirements` status →
  the `/sign-up` form, pre-filled from Google). Default `transfer: true`. This is very likely exactly what
  Connor saw — not a random glitch, but Clerk's own fallback behavior firing because *something* broke the
  client-side continuity between "user started this OAuth flow" and "Google's callback is for that same
  user."
- An Apple Developer Forums thread describes the same *class* of symptom (a PWA misbehaving right after an
  OAuth round-trip in iOS standalone mode specifically), unresolved, with the reporter's own diagnosis
  pointing at session/cookie continuity breaking across the domain round-trip in standalone mode — consistent
  with this investigation's running hypothesis (silent WebKit-level reload/backgrounding, tracked since
  TASK-061) landing at the wrong moment mid-OAuth-callback or mid-`signOut()`.
- **Confirmed Chrome-vs-Safari doesn't change any of this**: Connor tests via Chrome's iOS home-screen
  install (zero browser UI, confirmed), not Safari's. Chrome added iOS home-screen install in July 2023 using
  the *same* Apple-provided installable-web-app APIs Safari uses — same WebKit engine, same standalone WKWebView
  container. Connor is in the US, so the EU's DMA-driven alternative-engine allowance doesn't apply regardless
  (and no browser has actually shipped a non-WebKit iOS engine yet even where it's legally permitted). All
  prior WebKit/Safari-standalone-PWA research genuinely applies here.

**Diagnostics shipped in the previous round (commit `707f8f8`, live in `staging`+`production`, produced the
second capture analyzed above):**
1. `logout()` wraps `await signOut()` with `logEvent('signout-start'/'signout-resolved'/'signout-threw')`.
2. A global `unhandledrejection` listener (`lifecycleLog.js`).
3. `SignFlowStateLogger` (`App.jsx`) — reads Clerk's own `useSignIn()`/`useSignUp()` step-machine state.
4. Raw `pushState`/`replaceState`/`popstate` URL logging (`lifecycleLog.js`), independent of React Router.
5. `DebugPanel.jsx` "Copy all" button.

**New this round (implemented, build/lint/test-green, NOT yet committed/deployed):**
6. `installClickLogging()` (`lifecycleLog.js`) — global `pointerdown` + `click` logging, capture-phase, with
   target tag/id/className/text/`isTrusted`. Targets the sign-in gap specifically (see Current Status).

# Files Modified

This round, uncommitted as of this handoff (on top of `707f8f8`, already live):
- `client/src/lib/lifecycleLog.js` — new `installClickLogging()` export.
- `client/src/main.jsx` — calls `installClickLogging()` alongside the existing installers.

# Files Required Next

None to implement further before deploying this round. Next: commit, push `staging`, fast-forward `main`,
confirm both `Ready` via `vercel inspect` — same pattern as before.

# Files Already Reviewed

`client/src/components/layout/Sidebar.jsx` (confirmed the sign-out button's `onClick={logout}` has no
`setMobileOpen(false)` of its own — ruled out as the source of the "menu closes" observation, which is more
likely a side effect of `AppLayout`/route-driven remounting). No `UserButton`/Clerk-hosted menu component is
used for sign-out — confirmed via repo-wide grep, ruling that out as the source of the "purple" styling
(most likely iOS Safari's `:active`-sticks-after-tap quirk instead).

# Dependency Chain

Editing: `client/src/context/AuthContext.jsx`, `client/src/lib/lifecycleLog.js`, `client/src/main.jsx`,
`client/src/App.jsx`, `client/src/components/DebugPanel.jsx`.
Requires: `@clerk/clerk-react`'s `useSignIn()`/`useSignUp()` hooks (already installed, no new dependency).
Irrelevant: `client/src/api/index.js`, all of `server/*` — unchanged, same as TASK-063 itself.

# Architecture Notes

All additions this round are read-only/diagnostic-only or defensive error-handling — no behavioral change to
the actual sign-in/sign-out flow itself. `SignFlowStateLogger` mirrors `AuthStateLogger`'s existing pattern
(a no-render component that just calls `logEvent` on state change) rather than introducing new
infrastructure. The `pushState`/`replaceState` monkey-patch in `lifecycleLog.js` is global and permanent
once installed (matches this file's existing pattern of installing global listeners once at boot) — cheap
since `logEvent` itself no-ops unless debug mode is on.

# Decisions Made

- Did not draft a full TASK-064 spec for this diagnostic round — mirrors how TASK-063's own original
  diagnostic logging (`debugLog.js`, `lifecycleLog.js`, `AuthStateLogger`) was added directly in an earlier
  session without a full architect-review cycle, since it's additive/reversible instrumentation, not a
  behavior change. The eventual *fix*, once these logs explain the mechanism, should go through the normal
  spec + review process given the project's established convention for this investigation.
- Did not change `logout()`'s actual behavior (e.g. adding a retry) — only added visibility. Confirming the
  mechanism before changing behavior, per explicit instruction this session not to write a fix yet.

# Remaining Work

1. **Deploy this round's click/pointerdown logging to `staging` + `production`** (about to happen this
   session, per Connor's go-ahead — he wants both sign-in and sign-out mechanisms understood, not just
   sign-out).
2. **Capture a third on-device repro**, deliberately tapping "Continue with Google" twice again, watching
   for: does `pointerdown`/`click` fire for the first tap at all, and if so, on what element? This is the
   specific open question — the second capture ruled out both "reload undoes it" (sign-out's mechanism) and
   "nothing happens at all, ever" (something changed state 3s later) for sign-in, but couldn't see what the
   first tap actually did or didn't hit.
3. **Sign-out's mechanism is well-evidenced enough to consider drafting a TASK-064 fix spec for** — the open
   question is whether Connor wants to fix sign-out now while sign-in investigation continues, or hold both
   for one combined spec once sign-in is equally well-evidenced. Not yet decided.
4. TASK-063's own Section 9 deployment-verification-gate checklist items remain open pending full resolution
   of both mechanisms (see prior entries, superseded by this one).
5. Unrelated, carried forward: TASK-059's remaining phone-driven checklist rows; two disposable Clerk
   accounts still need manual deletion from production Clerk.

# Known Risks / Open Questions

- **Sign-in and sign-out are confirmed to be two separate bugs, not one shared root cause** — don't design a
  single unified fix without re-confirming both mechanisms independently.
- **Sign-out's mechanism is well-evidenced** (signOut() resolves, uncommanded reload lands ~800ms later
  before the result is durable, stale signed-in state reads back) but the exact layer that's not-yet-durable
  (Clerk's local cache vs. cookie propagation vs. something else) is still inferred, not directly observed.
- **Sign-in's mechanism is still open** — ruled out both "reload interrupts a completed action" and "nothing
  ever happens," but the actual first-tap failure mode is unknown pending the next capture.
- **This is now the fourth-plus investigation round of the same symptom** (TASK-061, TASK-062, TASK-063, and
  two diagnostic follow-up rounds) — worth being direct with Connor that "tests pass + fix looks
  architecturally sound" has repeatedly not resolved the actual symptom; only real on-device captures have
  moved this forward.
- Carried forward, unchanged: `SETTLE_MAX_MS = 2000`'s real-world safety remains unresolved by any unit test
  (spec Section 8); every mount incurs some settlement latency by design.

# Verification Results

- `npm run lint` (root): PASS.
- `npm run build` (root → `client`): PASS (pre-existing >500kB chunk-size warning, unrelated).
- `npm test` (root): PASS — 98/98.
- `node --test "src/**/*.test.js"` (client): PASS — 35/35, unchanged (this round's changes are diagnostic-only
  additions with no new test coverage of their own).
- On-device verification: performed twice now (both captures analyzed above). Sign-out's mechanism is
  confirmed; sign-in's is not. A third capture is the open item.

# Recommended Next Action

Deploy this round (staging → production, same pattern as before), then wait for Connor's next on-device
repro capture — specifically a deliberate double-tap on "Continue with Google" with click/pointerdown logging
live. Once sign-in's mechanism is equally well-evidenced, draft TASK-064 covering a fix for both.

# Forbidden Exploration

- `client/src/api/index.js` and all of `server/*` — unchanged from TASK-063's own scope.
- The on-device repro itself — requires Connor on the real device, not agent-driven browser tooling.

# Context Notes

- branch: `staging`.
- No dev servers started this session; verification was build/lint/test only.
- No worktree used.

---

## Archived History

- TASK-047 through TASK-053 (spec-drafting + TASK-053 streaming implementation session): see
  [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054 (chat context-size cap implementation session): see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055 (post-audit hardening implementation session): see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056 (UI/UX effort-reduction redesign implementation session): see
  [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting session (5 architect review rounds, DRAFT-1 → DRAFT-6 approved): see
  [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation session (Phases 1-3 shipped, judgment calls resolved): see
  [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting session: see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy session (auth session-race fix, shipped to staging + production): see
  [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke-test session (ADMIN/SEC/ERR rows via real browser sessions): see
  [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting session (DRAFT-1 → DRAFT-4 approved, 4 architect review rounds): see
  [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy session (OAuth-return reload guard, shipped to staging + production, later
  found dead code and removed by TASK-063): see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
- TASK-063 implementation/deploy session (settling->settled auth state machine, shipped to staging +
  production, confirmed working-as-designed but not sufficient to fix the symptom): superseded by this entry.
