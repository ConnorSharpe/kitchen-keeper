# Task

TASK-063 implementation + follow-up investigation — iOS PWA double sign-in/sign-out: `loading -> settling
-> settled` auth state machine shipped, confirmed NOT to fix the user-facing symptom, root cause reframed and
new diagnostics added, not yet redeployed with those diagnostics live. Per
[TASK-063-spec.md](../tasks/TASK-063-spec.md) DRAFT-3.

# Current Status

**TASK-063's `settling`/`settled` state machine is implemented, tested, and live in `staging` + `production`
(commit `a3f942f`)** — confirmed via a real on-device capture that the mechanism itself works exactly as
designed (every settlement in that capture was `"stable"` at ~401-402ms, `settleInitial === settleFinal`
every time). **But Connor confirmed the double sign-in/sign-out symptom still occurred during that same
test** — so TASK-063 fixed a real, correctly-identified problem (an unstable first post-mount reading) that
turned out not to be *this* problem. The two are architecturally distinct: TASK-063 catches a value that's
wrong-then-self-corrects within one mount; what actually happened is a first attempt whose outcome never
self-corrected (required a literal second tap) — settling has nothing to buffer in that case, because Clerk's
raw value was consistent throughout, just consistently reflecting a genuinely-not-yet-completed action.

Connor's detailed description of what he saw on-device narrowed this further:
- **Sign-in**: tap → Google → lands on `/sign-up` (not the app) → tap sign-in again → Google → lands on
  `/chat`. No `/sign-up` pathname ever appeared in the captured `clerk-auth-state` log, meaning if this really
  happened, whatever routed there didn't go through React Router's `useLocation()` at all — a blind spot in
  the existing diagnostics.
- **Sign-out**: tap → menu closes, still in the app → reopen menu, the button already shows its
  pressed/active style (consistent with iOS Safari's known `:active`-sticks-after-tap quirk, i.e. the first
  tap's `onClick` did fire) → tap again → redirects to sign-in. `logout()`
  (`AuthContext.jsx`) had **no error handling at all** around `await signOut()` — an exact repeat of the
  blind spot TASK-061 already found once with `forceRefreshToken()`.

Web research (see Sources in conversation) surfaced a concrete, testable explanation rather than pure
speculation:
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

**New diagnostics added this session, targeting exactly these gaps — implemented, build/lint/test-green, NOT
YET committed or deployed:**
1. `logout()` now wraps `await signOut()` with `logEvent('signout-start'/'signout-resolved'/'signout-threw')`.
2. A global `unhandledrejection` listener (`lifecycleLog.js`) — catches any silently-rejected promise
   anywhere in the app, not just `signOut()`.
3. `SignFlowStateLogger` (`App.jsx`) — new diagnostic-only component reading Clerk's own
   `useSignIn()`/`useSignUp()` step-machine state (`signIn.status`/`signUp.status`), independent of and
   invisible to the existing `isSignedIn`-only `AuthStateLogger`.
4. Raw `pushState`/`replaceState`/`popstate` URL logging (`lifecycleLog.js`), independent of React Router —
   closes the blind spot that let the `/sign-up` landing go completely unlogged.
5. `DebugPanel.jsx` gained a "Copy all" button (`navigator.clipboard.writeText`, with an
   `execCommand('copy')` fallback) — highlighting the raw log body was difficult on Connor's touch screen.

# Files Modified

Since TASK-063's implementation commit (`a3f942f`, already live) — this round, uncommitted as of this
handoff:
- `client/src/context/AuthContext.jsx` — `logout()` instrumented (see above).
- `client/src/lib/lifecycleLog.js` — `installUrlChangeLogging()` (new export) + `unhandledrejection` listener
  added to `installLifecycleLogging()`.
- `client/src/main.jsx` — calls `installUrlChangeLogging()` alongside the existing
  `installLifecycleLogging()`.
- `client/src/App.jsx` — new `SignFlowStateLogger` component, mounted alongside `AuthStateLogger`.
- `client/src/components/DebugPanel.jsx` — "Copy all" button + `copyStatus` state.

(TASK-063's own implementation files — `useSettledAuth.js`, `routeDecision.js`, etc. — are unchanged this
round; see the commit `a3f942f` already shipped, described in the prior handoff entry below this one before
it was overwritten by this update.)

# Files Required Next

None to implement further before deploying this round. Next: commit, push `staging`, fast-forward `main`,
confirm both `Ready` via `vercel inspect` — same pattern as TASK-063's own deploy.

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

1. **Deploy this round's diagnostics to `staging` + `production`** (about to happen this session, per
   Connor's go-ahead).
2. **Capture a fresh on-device repro** with the new diagnostics live — specifically watching for: (a)
   `sign-flow-state` showing `signIn.status`/`signUp.status` right before/after the `/sign-up` landing, to
   confirm or rule out Clerk's transfer-to-signup mechanism; (b) `url-change` events showing whether that
   landing happened via `pushState` (client-side, would show in React Router too — contradiction worth
   noting) or some other path; (c) `signout-start`/`signout-resolved`/`signout-threw`/`unhandled-rejection`
   around the sign-out button's first, ineffective tap.
3. TASK-063's own Section 9 deployment-verification-gate checklist items remain open pending this next
   capture's analysis (see prior entry, superseded by this one).
4. Unrelated, carried forward: TASK-059's remaining phone-driven checklist rows; two disposable Clerk
   accounts still need manual deletion from production Clerk; Section 2 finding 7 territory now directly
   addressed by item 2 in this round's diagnostics (`unhandled-rejection` listener).

# Known Risks / Open Questions

- **The actual root cause is still not confirmed, only hypothesized** — the Clerk-transfer + WebKit-reload
  interruption theory is well-supported by external sources and internal evidence, but not yet proven by a
  capture that directly shows it happening. Don't treat it as settled until the next capture confirms it.
- **This is now the fourth investigation round of the same symptom** (TASK-061, TASK-062, TASK-063, and this
  diagnostic follow-up) — worth being direct with Connor that "tests pass + fix looks architecturally sound"
  has now been true three times without resolving the actual symptom. Evidence from real on-device captures
  is the only thing that's moved this investigation forward at each step.
- Carried forward, unchanged from the prior entry: `SETTLE_MAX_MS = 2000`'s real-world safety remains
  unresolved by any unit test (spec Section 8); every mount incurs some settlement latency by design.

# Verification Results

- `npm run lint` (root): PASS.
- `npm run build` (root → `client`): PASS (pre-existing >500kB chunk-size warning, unrelated).
- `npm test` (root): PASS — 98/98.
- `node --test "src/**/*.test.js"` (client): PASS — 35/35, unchanged from TASK-063's own run (this round's
  changes are diagnostic-only additions with no new test coverage of their own, since they only add logging
  around existing, already-tested code paths).
- On-device verification: performed once already (captured log analyzed above) — confirmed TASK-063's
  mechanism works, confirmed the user-facing symptom persists. Next capture (with this round's diagnostics
  live) is the open item.

# Recommended Next Action

Deploy this round (staging → production, same pattern as before), then wait for Connor's next on-device
repro capture. Analyze that capture specifically against the Clerk-transfer and signOut-interruption
hypotheses above before proposing any actual behavioral fix.

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
