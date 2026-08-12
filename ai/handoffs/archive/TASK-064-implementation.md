# Task

TASK-064 implementation — iOS PWA double sign-in/sign-out recovery mechanism, per
[TASK-064-spec.md](../../tasks/TASK-064-spec.md) DRAFT-6 (approved, ~9.5/10). Implemented, committed
(`10fff5e`), and deployed to both `staging` and `production` on Connor's explicit instruction — ahead of the
on-device verification the spec calls load-bearing (spec Section 7).

# Current Status

Marker-based recovery mechanism implemented, surviving the uncommanded WebKit-level reload (spec Section 2)
that can land mid-`signOut()` or mid-Google-sign-in-tap. Sign-out gets a bounded, session-ID-verified
automatic repair (Rule 1 + Rule 2, spec Section 3.2); sign-in gets an explicit re-prompt toast, never
automatic navigation (spec Section 3.3). All 20 acceptance criteria (spec Section 6) verified against the
implementation.

**On-device verification result (this session, real captured log 2026-08-12 18:54)**: both mechanisms
confirmed working exactly as designed. Sign-out: `signout-resolved` → interrupting reload →
`signout-repair-attempt` fires automatically → succeeds — one tap, invisible repair, matches Connor's report
("logging out seems to be fixed"). Sign-in: tap → reload before redirect starts → "didn't complete, tap to
try again" toast (the deliberate re-prompt design, not a bug) → second tap succeeds. Matches Connor's report
("still have to log in twice, but get a message the first time"). **This is the spec working as designed —
the remaining friction is inherent to the design choice not to auto-retry sign-in (spec §3.3's Option B),
not a defect in the implementation.**

# Files Modified

New:
- `client/src/lib/authTransition.js` — marker read/write/clear/expiry for `kk_pending_signout` +
  `kk_pending_oauth`, fail-closed parsing, plus `installOauthMarkerListener()` (production Google-button click
  listener, separate from `lifecycleLog.js`'s diagnostic-only click logging).
- `client/src/lib/authTransition.test.js` — 18 tests (round-trip, monotonicity, expiry, fail-closed parsing,
  storage-failure-never-blocks).
- `client/src/hooks/useAuthRecovery.js` — `decideSignoutRecovery()`/`decideSigninRecovery()` (pure, exported)
  implementing Rule 1 (continuous raw-`isSignedIn`-false clearing), Rule 2 (bounded, session-ID-verified
  repair), and the sign-in re-prompt table. `useAuthRecovery()` hook wires these up, returns
  `{ recovering, recoveryMessage }`.
- `client/src/hooks/useAuthRecovery.test.js` — 14 tests, all spec Section 7 named regressions incl. both P0
  variants, null-sessionId guard, attempt:1-never-retries.

Modified:
- `client/src/context/AuthContext.jsx` — `logout()` writes the marker before `signOut()`, no longer clears it
  itself (ownership moved to `useAuthRecovery()` — DRAFT-1's original bug, now structurally unrepeatable).
- `client/src/lib/routeDecision.js` + `.test.js` — `resolveRouteDecision()` gains `recovering`; forces
  `render-nothing` even when settled + signed in.
- `client/src/App.jsx` — added `AppRoutes()`, the single call site for `useAuthRecovery()`. `PrivateRoute`/
  `PublicRoute` take `recovering` as a prop, never call the hook. `recoveryMessage` surfaced via the existing
  `Toaster`/`toast()` (no new dependency).
- `client/src/main.jsx` — calls `installOauthMarkerListener()` alongside existing diagnostic installers.

Untouched (forbidden by spec Section 4): `useSettledAuth.js`, `api/index.js`, all of `server/*`. No new npm
dependencies.

# Architecture Notes

**Structural gap in the spec, resolved during implementation**: spec Section 3.4 names the single call site
as literally "`App()`," which is impossible — `useSettledAuth()` (which the hook needs) is only provided
inside `<AuthProvider>`'s subtree. Resolved with `AppRoutes()`, a new component rendered as `AuthProvider`'s
child (alongside `AuthStateLogger`/`SignFlowStateLogger`) that plays `App()`'s structural role.

Google-button click detection uses `click` (capture-phase), not `pointerdown`. Sign-out and sign-in markers
are evaluated in one shared post-settle effect (`evaluatedRef` guard) rather than two.

# Known Risks / Open Questions (still relevant)

- Same-session OAuth cancellation remains a documented, unsolved gap (spec §3.3).
- Keyboard/assistive-tech sign-in activation is uncovered.
- Sign-in requires exactly one retry when the interrupting reload lands — this is the accepted ceiling given
  the design's deliberate rejection of auto-retry (see CURRENT_STATE.md's active TASK-064-followup entry for
  the current investigation into whether that ceiling can be lowered).

# Verification Results

- `npm run lint`: PASS. `npm run build`: PASS. `npm test` (server): PASS 98/98.
- `node --test "src/**/*.test.js"` (client): PASS 69/69.
- All 20 spec acceptance criteria checked against the actual implementation.
- Deploy confirmed live: `production` `dpl_6EUH2PKa2j9TfbYb7WymvUaTZA6a`, `kitchenkeeper.kitchen` aliased to it.
- **On-device verification: confirmed this session** — both mechanisms fire as designed against a real
  capture. Sign-out fix is a genuine one-tap improvement. Sign-in's remaining two-tap requirement is now
  understood to be inherent to the design, not an implementation gap — see the active follow-up investigation.
