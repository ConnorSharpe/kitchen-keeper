# Task

TASK-062 implementation — iOS standalone PWA Google OAuth self-correction (referrer-detect + single reload).

# Current Status

Implemented [TASK-062-spec.md](../tasks/TASK-062-spec.md) DRAFT-4 (Sections 3.1–3.3) in full. **Connor
explicitly approved implementing provisionally and deferring Section 7's on-device capture** — he has not yet
walked the real Google OAuth flow on the affected iOS PWA to confirm `document.referrer` actually resolves to
`/sign-in/sso-callback`. Per the spec's own design, this is a single named constant
(`EXPECTED_OAUTH_CALLBACK_PATH` in `client/src/lib/oauthReturn.js`) specifically so that correcting it against
the real observed value later is a one-line change, not a redesign.

**This fix is code-complete and build/lint/test-green, but functionally unverified.** The actual bug (does
this reload the stale render into a signed-in dashboard on iOS?) can only be confirmed device-side, which
Connor deferred. Do not treat this as "done" — see Known Risks.

# Files Modified

- `client/src/lib/oauthReturn.js` — new file. `EXPECTED_OAUTH_CALLBACK_PATH` (`/sign-in/sso-callback`,
  pending-verification default), `OAUTH_RELOAD_MARKER_KEY`, `cameFromOAuthCallback()`, `isStandalonePwa()`.
- `client/src/App.jsx` — added `OAuthReturnGuard` component (mounted inside `AuthProvider`, sibling of
  `<Routes>`, runs on every render regardless of matched route). Uses Clerk's `useAuth()`
  (`isLoaded`/`isSignedIn`) + `useLocation()`. Implements spec Section 3.2's full AND'd guard and Section
  3.3's marker lifecycle (set + reload when guard fires; cleared once `isLoaded` resolves on any load where
  it doesn't — covers both "signed in after reload" and "genuinely still signed out"). `PrivateRoute`/
  `PublicRoute` (TASK-061's surface) untouched — confirmed TASK-061 acceptance criterion 1 still holds.
- `ai/handoffs/archive/TASK-062-spec-drafting.md` — new file, archived prior CURRENT_STATE.md content
  per Size Discipline.
- `ai/handoffs/CURRENT_STATE.md` — this file.

# Files Required Next

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
  Flagging this clearly here rather than silently treating the task as fully verified.
- Extracted detection/guard-condition helpers into `client/src/lib/oauthReturn.js` rather than inlining in
  `App.jsx` — spec Section 4 explicitly allowed either; chose extraction since the constant is meant to be a
  one-line edit point if Section 7's capture reveals a different callback path.
- Did not touch `PrivateRoute`/`PublicRoute` or wire `routerPush`/`routerReplace` — both explicitly out of
  scope per spec Section 5.

# Remaining Work

1. **Section 7's on-device capture and verification — still fully pending, deferred by Connor.** When he's
   ready: walk the real Google OAuth flow on the installed iOS PWA, record `document.referrer`/URL/
   display-mode/Clerk state at each step. If it matches `/sign-in/sso-callback`, this implementation should
   already work as-is — confirm via the adversarial cancellation test and post-correction navigation test in
   spec Section 7. If it doesn't match, update `EXPECTED_OAUTH_CALLBACK_PATH` in `oauthReturn.js` (one line)
   and re-verify; if the referrer approach doesn't hold at all, stop and bring findings back for a DRAFT-5
   spec revision — do not add a lifecycle-heuristic fallback (spec explicitly forbids this).
2. Once device-verified: follow CONVENTIONS.md's canonical push workflow (this is client-only, no migration,
   so no `MIGRATION_LEDGER.md` entry is needed) — push to `staging`, confirm on the Preview URL, then merge
   `staging` → `main` for production.
3. Unrelated, carried forward: TASK-059's remaining phone-driven checklist rows (AUTH-1–5, ONB, HH, DASH,
   PANTRY, REC, SHOP, CHAT, DIET, PUSH, VIS-2–5, ERR-2/3/5) still pending a human pass; two disposable Clerk
   accounts (`+zzsmokeB@gmail.com`, `+zzsmokeC@gmail.com`) still need manual deletion from production Clerk.

# Known Risks / Open Questions

- **This fix is unverified against the actual bug.** Build/lint/test all pass, but none exercise real iOS
  Safari OAuth navigation — the one thing that determines whether the detector actually fires correctly.
  Treat as implemented-not-confirmed until Section 7 runs.
- If `document.referrer` is stripped/unavailable on-device (Referrer-Policy, WKWebView quirks), spec
  acceptance criterion 6 treats that as an acceptable degraded no-op, not a defect — but worth knowing going
  in that the fix could end up inert in practice.
- Not yet committed to git — working tree has this change plus pre-existing, unrelated, untouched
  modifications (`.claude/settings.local.json`, `ai/tasks/TASK-059-smoke-tests.md`,
  `ai/handoffs/archive/TASK-061-implementation.md`).
- Carried forward, unrelated: TASK-058/TASK-060 still placeholders; TASK-054's
  `consume_pantry_item`-on-truncated-item gap; Clerk Dashboard sign-up/bot-protection settings unverified;
  two disposable Clerk accounts left in production (Remaining Work #3).

# Verification Results

- `npm run lint` (root, `eslint .`): PASS, no warnings/errors.
- `npm run build` (root → `client`): PASS, `vite build` succeeded (pre-existing >500kB chunk-size warning,
  unrelated to this change).
- `npm test` (root): PASS — 98/98 tests, 0 failures. No existing test exercises `App.jsx` directly, so this
  confirms no regression in `shared/*` and `server/*` test coverage, not the OAuth fix itself.
- Device-side verification (spec Section 7): NOT RUN — deferred by Connor, see Known Risks.

# Recommended Next Action

When Connor is ready to test on his phone: perform Section 7's on-device capture first. If the observed
referrer matches expectations, run the remaining Section 7 verification steps (adversarial
cancel/back-navigation test, post-correction navigation test, single-shot guard confirmation, non-standalone
regression spot-check), then push `staging` → verify Preview → merge to `main`.

# Forbidden Exploration

- `client/src/api/index.js` and all of `server/*` — explicitly forbidden by TASK-062's own Files section.
- Any TASK-059 row requiring account creation/credential entry, and TASK-062's on-device capture step itself
  — both require a human on a real device, not agent-driven browser tooling; standing project rule.

# Context Notes

- branch: `staging` (no commit made this session — code changes are in the working tree only; see Known
  Risks).
- No dev servers started this session; verification was build/lint/test only, not a live browser session.
- No worktree used.
- Session followed the AI Development Agent Efficiency Guide's orientation protocol at Connor's request
  (read `CURRENT_STATE.md`, `TASK-062-spec.md`, `MIGRATION_LEDGER.md` — confirmed no outstanding gaps and
  not applicable to this client-only change).

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
