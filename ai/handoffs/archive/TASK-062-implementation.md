# Task

TASK-062 implementation — iOS standalone PWA Google OAuth self-correction (referrer-detect + single reload).

# Current Status

Implemented [TASK-062-spec.md](../../tasks/TASK-062-spec.md) DRAFT-4 (Sections 3.1–3.3) in full. **Connor
explicitly approved implementing provisionally and deferring Section 7's on-device capture** — he has not yet
walked the real Google OAuth flow on the affected iOS PWA to confirm `document.referrer` actually resolves to
`/sign-in/sso-callback`. Per the spec's own design, this is a single named constant
(`EXPECTED_OAUTH_CALLBACK_PATH` in `client/src/lib/oauthReturn.js`) specifically so that correcting it against
the real observed value later is a one-line change, not a redesign.

**This fix is code-complete, build/lint/test-green, committed, and deployed to both `staging` and
`production` (commit `8ff523f`) — but functionally unverified.** Connor explicitly instructed committing and
pushing to both environments now, deferring only the device-side check. The actual bug (does this reload the
stale render into a signed-in dashboard on iOS?) can only be confirmed device-side, which Connor deferred.
Production deployment confirmed live via `vercel inspect kitchenkeeper.kitchen` (`dpl_BJuJcKABnsKkYMcE3WftcyHhFeFa`,
status Ready). No migration involved, so `MIGRATION_LEDGER.md` has no new row. Do not treat this as fully
verified — see Known Risks.

**Superseded outcome (recorded in TASK-063-spec.md Section 0): TASK-062's `OAuthReturnGuard` never fired in
any of three later real repro captures — including one containing an actual completed Google sign-in — and
was removed by TASK-063.** Its premise (referrer matching `/sign-in/sso-callback`) simply never matched
production's actual OAuth flow. Kept here as the historical record of what was tried and why it didn't hold.

# Files Modified

- `client/src/lib/oauthReturn.js` — new file (later deleted by TASK-063). `EXPECTED_OAUTH_CALLBACK_PATH`
  (`/sign-in/sso-callback`, pending-verification default), `OAUTH_RELOAD_MARKER_KEY`,
  `cameFromOAuthCallback()`, `isStandalonePwa()`.
- `client/src/App.jsx` — added `OAuthReturnGuard` component (mounted inside `AuthProvider`, sibling of
  `<Routes>`, runs on every render regardless of matched route). Uses Clerk's `useAuth()`
  (`isLoaded`/`isSignedIn`) + `useLocation()`. Implements spec Section 3.2's full AND'd guard and Section
  3.3's marker lifecycle (set + reload when guard fires; cleared once `isLoaded` resolves on any load where
  it doesn't — covers both "signed in after reload" and "genuinely still signed out"). `PrivateRoute`/
  `PublicRoute` (TASK-061's surface) untouched — confirmed TASK-061 acceptance criterion 1 still holds.
- `ai/handoffs/archive/TASK-062-spec-drafting.md` — new file, archived prior CURRENT_STATE.md content
  per Size Discipline.
- `ai/handoffs/CURRENT_STATE.md` — this file (at the time).

# Files Required Next (at the time)

- None to implement further — the code change is complete per spec. Next session's job is verification
  (device-side) and, once confirmed, the staging → production push.

# Files Already Reviewed

`client/src/App.jsx`, `client/src/main.jsx` (re-confirmed `ClerkProvider` has no `routerPush`/`routerReplace`
wired, matching the spec's Section 3.1 premise), `client/node_modules/@clerk/clerk-react/dist/index.d.mts`
(confirmed `useAuth` is exported by the installed `@clerk/clerk-react@5.61.8`, safe to use).

# Dependency Chain

Editing: `client/src/App.jsx`, `client/src/lib/oauthReturn.js` (new).
Requires: Clerk's `useAuth()` (`isLoaded`/`isSignedIn`), React Router's `useLocation()`. No new npm
dependency.
Irrelevant: all of `server/*`, `client/src/api/index.js` (TASK-061's surface, untouched), any
database/schema change (none — this is a client-only change; `MIGRATION_LEDGER.md` has no outstanding gaps
and does not apply here, confirmed at session start).

# Architecture Notes

`OAuthReturnGuard` is a standalone component with no rendered output (`return null`), mounted once at the
top of the route tree so it runs independent of which route matched — this was necessary because the guard
needs to observe `location.pathname === '/'` itself (per spec Section 3.2) rather than being scoped to a
specific `<Route>`. The single-shot `sessionStorage` marker (`kk_oauth_reload_consumed`) is the sole
loop-prevention authority, structurally decoupled from whatever `document.referrer` does across
`window.location.reload()` — per DRAFT-2/DRAFT-3's required corrections, correctness does not depend on that
behavior.

# Decisions Made

- Implemented provisionally with the spec's expected `/sign-in/sso-callback` constant rather than waiting on
  Section 7's on-device capture — explicit choice by Connor this session ("implement the login fix on the
  latest spec, I will defer phone testing"), not an agent judgment call to skip a blocking spec requirement.
- Extracted detection/guard-condition helpers into `client/src/lib/oauthReturn.js` rather than inlining in
  `App.jsx` — spec Section 4 explicitly allowed either; chose extraction since the constant is meant to be a
  one-line edit point if Section 7's capture reveals a different callback path.
- Did not touch `PrivateRoute`/`PublicRoute` or wire `routerPush`/`routerReplace` — both explicitly out of
  scope per spec Section 5.

# Known Risks / Open Questions (at the time, now resolved by TASK-063)

- This fix shipped to production unverified against the actual bug. It turned out to be a safe no-op in
  practice (per TASK-063's captured evidence: `decision` was `"noop"` in every real repro, including a
  successful sign-in) rather than a wrong-firing bug — but its detection premise was simply wrong, not just
  unverified. Removed by TASK-063 rather than corrected, since the whole referrer-based approach didn't hold.

# Verification Results (at the time)

- `npm run lint` (root, `eslint .`): PASS, no warnings/errors.
- `npm run build` (root → `client`): PASS, `vite build` succeeded (pre-existing >500kB chunk-size warning,
  unrelated to this change).
- `npm test` (root): PASS — 98/98 tests, 0 failures.
- Device-side verification (spec Section 7): NOT RUN at the time — later superseded by TASK-063's captured
  evidence showing the guard never fired.
- Deploy: `staging` push confirmed (`8ff523f`); production confirmed live via `vercel inspect
  kitchenkeeper.kitchen` → `dpl_BJuJcKABnsKkYMcE3WftcyHhFeFa`, status Ready.

# Context Notes

- branch: `staging` (committed `8ff523f`, pushed to `staging`, fast-forward merged and pushed to `main`).
- Session followed the AI Development Agent Efficiency Guide's orientation protocol at Connor's request.
