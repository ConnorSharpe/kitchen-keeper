# Task

TASK-064 spec-drafting session — iOS PWA double sign-in/sign-out: **approved for implementation**, per
TASK-064-spec.md DRAFT-6 (four review rounds, two independent P0 correctness bugs found and fixed). Builds on
TASK-063 (`loading -> settling -> settled` auth state machine, shipped, confirmed working as designed but not
sufficient on its own) and a prior session's on-device diagnostics, which separated the symptom into one
unified mechanism (see Current Status below).

# Current Status

**Second real on-device capture (2026-08-11 23:39-23:40) analyzed — sign-in and sign-out are two separate
bugs with different mechanisms, not one shared root cause as previously hypothesized:**

- **Sign-out: mechanism directly confirmed by this capture.** `signout-start` → `signout-resolved` (309ms,
  no error) → an uncommanded reload (`pagehide` persisted:false → `app-boot`, ~800ms after resolve, zero
  `window.location.reload()` calls exist anywhere in this codebase) → the freshly-booted app reads back
  `isSignedIn: true`. The reload landed in the gap between `signOut()`'s promise resolving and its effect
  becoming durable (most likely Clerk's local persisted-session cache, not yet confirmed which layer). Second
  attempt, no reload in between, works cleanly.
- **Sign-in: different mechanism, NOT yet directly evidenced (at the time this note was written — since
  resolved, see TASK-064-spec.md Section 2 for the third capture that closed this gap).** Connor confirmed he
  tapped "Continue with Google" twice, but the capture shows only one `/sign-in` navigation, one OAuth
  round-trip, and zero events of any kind in the ~3s between arriving at `/sign-in` and the (single,
  successful) OAuth flow starting. No reload occurred in that gap either — ruling out the sign-out-style
  "reload undoes a completed action" mechanism for this case. The first tap on Clerk's own hosted Google
  button appears to have produced **no observable effect at all**, consistent with a lost/ignored touch event
  rather than a completed-then-reverted action. We had no visibility into Clerk's hosted button internals at
  the time, so root cause was still open.

**Diagnostics added in this round**: `installClickLogging()` (`lifecycleLog.js`) — logs every `pointerdown`
and `click` app-wide, capture-phase (before anything can `stopPropagation`), with target
tag/id/className/text/`isTrusted`. This is what produced the third capture (2026-08-12 16:15-16:16) that
closed the sign-in gap — see TASK-064-spec.md Section 2 for the resulting evidence (a clean click landing on
Clerk's Google button, followed 1.8s later by an uncommanded same-origin reload before the Google redirect
ever started).

Original TASK-063 on-device finding (2026-08-11 23:06-23:07, first capture) remains valid background: the
`settling`/`settled` state machine itself works exactly as designed (every settlement was `"stable"`,
`initial === final`) — it was solving a real, correctly-identified problem that turned out not to be *this*
one.

Web research that's still relevant:
- Clerk has a **documented, intentional "transfer" mechanism**: an OAuth sign-in Clerk can't confirm maps to
  an existing account gets automatically transferred into the sign-up flow (`missing_requirements` status →
  the `/sign-up` form, pre-filled from Google). Default `transfer: true`. Ruled out for the sign-in mechanism
  specifically once the third capture showed `signInStatus`/`signUpStatus` staying `null` throughout.
- An Apple Developer Forums thread describes the same *class* of symptom (a PWA misbehaving right after an
  OAuth round-trip in iOS standalone mode specifically), unresolved, with the reporter's own diagnosis
  pointing at session/cookie continuity breaking across the domain round-trip in standalone mode.
- **Confirmed Chrome-vs-Safari doesn't change any of this**: Connor tests via Chrome's iOS home-screen
  install (zero browser UI), which uses the same WebKit engine/standalone WKWebView container as Safari.

**Diagnostics shipped across these rounds, live in `staging`+`production`:**
1. `logout()` wraps `await signOut()` with `logEvent('signout-start'/'signout-resolved'/'signout-threw')`.
2. A global `unhandledrejection` listener (`lifecycleLog.js`).
3. `SignFlowStateLogger` (`App.jsx`) — reads Clerk's own `useSignIn()`/`useSignUp()` step-machine state.
4. Raw `pushState`/`replaceState`/`popstate` URL logging (`lifecycleLog.js`), independent of React Router.
5. `DebugPanel.jsx` "Copy all" button.
6. `installClickLogging()` (`lifecycleLog.js`) — global `pointerdown` + `click` logging, capture-phase.

# TASK-064 Spec-Drafting Outcome

Four architect review rounds (DRAFT-1 → DRAFT-6, plus one parallel independent review of DRAFT-3), converging
on: a session-ID-based marker mechanism for sign-out repair (two independent reviews found the same P0 —
a sign-out marker could otherwise auto-undo a later, genuinely new sign-in — and independently converged on
the session-ID comparison as the fix), and an explicit re-prompt (no automatic navigation) for sign-in.
DRAFT-6 approved ~9.5/10, "no further redesign expected." Full spec, evidence, and review history retained in
`ai/tasks/TASK-064-spec.md` (not archived — it's the authoritative design document for the implementation that
followed this session).

# Known Risks / Open Questions (as of spec approval, before implementation)

- **This was the fourth-plus investigation round of the same symptom** (TASK-061, TASK-062, TASK-063, and two
  diagnostic follow-up rounds) — "tests pass + fix looks architecturally sound" had repeatedly not resolved
  the actual symptom; only real on-device captures moved this forward. On-device verification after
  implementation remained mandatory before treating this as solved.
- `SETTLE_MAX_MS = 2000`'s real-world safety remains unresolved by any unit test (TASK-063 spec Section 8);
  carried forward, unaffected by TASK-064.

# Context Notes

- branch: `staging`.
- No dev servers started; verification was build/lint/test only in both the diagnostics and spec-drafting
  sessions this file covers.
