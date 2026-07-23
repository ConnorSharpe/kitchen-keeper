# Task

Implementation session for `ai/tasks/TASK-042-spec.md` (DRAFT-3, approved 9.7 → 9.95). Prior session was
audit-only (spec drafting, zero code touched); this session implemented the code-level parts.

# Current Status

**Implementation Complete: Parts A, B, C, E, F — done, verified, not yet deployed.**
**Release Validation (Parts D, G): still open — unchanged from the spec, requires Connor + physical devices.**

## Part A — pinned dependency versions

`server/package.json`: `express` → `^4.22.2`, `morgan` → `^1.11.0`, plus an `overrides` block for
`qs`/`body-parser`/`form-data`/`brace-expansion`/`side-channel`/`hasown`. `client/package.json`:
`react-router-dom` → `^6.30.4`, plus `overrides` for `postcss`/`@babel/core`/`nanoid`. Ran `npm install` +
`npm dedupe` in root/`server`/`client`.

Verified via `npm audit` in each workspace — remaining findings match the spec's "out of scope" table
exactly, nothing else:
- `server`: `drizzle-orm` (SQL injection advisory), `drizzle-kit`/`esbuild` (dev-server CSRF), `@vercel/blob`/
  `undici` (multiple advisories) — 7 findings, all pre-identified semver-major exclusions.
- `client`: `vite`/`esbuild` (dev-server CSRF) — 2 findings (moderate + high on the same chain), same
  pre-identified exclusion.
- root: **new finding not in the spec's tables** — `shell-quote` (high, via `concurrently`'s dev dependency
  tree). Pre-existing, unrelated to this task (the spec's dependency tables only covered `server/` and
  `client/`, not root) — was previously masked in `npm audit` output by the much larger `@clerk/nextjs`
  subtree Part B removes. Not fixed this session (out of scope for TASK-042); worth a follow-up ticket since
  it's now visible.

## Part B — dead dependency/code removal

Deleted `server/middleware/auth.js`. Removed from `server/package.json`: `jsonwebtoken`, `bcrypt`, `uuid`,
`cookie-parser` (+ its import and `app.use(cookieParser())` from `server/app.js`). Removed `@clerk/nextjs`
from root `package.json`. Removed `@clerk/react` from `client/package.json`. Removed the `INVITE_CODE` row
from `.env.example`.

Verified: dedicated grep across `*.js`/`*.jsx` for all six removed-package names returns zero source matches;
`npm ls @clerk/nextjs jsonwebtoken bcrypt uuid cookie-parser` (root) and `npm ls @clerk/react` (client) each
report the packages absent from the resolved tree. `npm run lint`, `npm test` (82/82 passing, all three
workspaces), and `npm run build` all pass clean after the removal.

**Not independently verified this session**: a live Clerk sign-in against a local dev server (the spec's own
Known Risk flagged this as the real verification for `cookie-parser` removal, not code-reading alone). This
session mistakenly checked the repo-root `.env` (stale, pre-Clerk-migration leftover — missing
`CLERK_SECRET_KEY`/`ENCRYPTION_KEY`/`OWNER_CLERK_ID`/`OPENAI_API_KEY`) and concluded no real credentials were
available. **That was wrong** — `server/loadEnv.js` actually loads `server/.env.local` (confirmed present,
with real `CLERK_SECRET_KEY`, `ENCRYPTION_KEY`, `OWNER_CLERK_ID`, `OPENAI_API_KEY`, `DATABASE_URL`, VAPID
keys, and Blob token), and `client/.env.local` also exists with real Clerk/DB values. A real dev server CAN
be booted and tested — this just wasn't discovered until after the dummy-env smoke test had already run. As
a partial substitute this session, `server/app.js` was loaded with dummy env values via a one-off Node
script: it imported cleanly through every router (`household.js` included) with no import-time errors,
failing only on a downstream dummy-VAPID-key format check in the push module — confirms no import breakage
from the `cookie-parser` removal, but is not the same as a real end-to-end signed-in session. **See Testing
Walkthrough below — do this for real next session, it's actually possible now.**

## Part C — join rate limiter

New `server/middleware/createRateLimiter.js` factory. `server/middleware/aiRateLimit.js` refactored to use it
(behavior-preserving — same `windowMs`, dynamic `limit`, `aiRateLimitKeyGenerator`, message text).
`aiRateLimitKeyGenerator.js` and its test untouched. New `server/middleware/joinRateLimit.js` (10 attempts /
15 min, keyed by `req.user?.id ?? req.ip`), applied to `router.post('/join', joinRateLimit, ...)` in
`server/routes/household.js`.

Verified: `aiRateLimitKeyGenerator.test.js`'s two tests ("keys by householdId when clerkAuth has populated
req.user", "falls back to req.ip when req.user is absent") both still pass post-refactor — confirms the
extraction didn't change `aiRateLimit`'s behavior.

**Not verified this session**: the spec's manual check (11 wrong-code join attempts in <15 min as the same
user → 11th rejected; a different user's correct code still succeeds in the same window) — requires a live
authenticated session against a running server. Real credentials exist (`server/.env.local`) — see Testing
Walkthrough below, this is doable next session.

## Part E — README accuracy

- Tech Stack Auth row: `JWT stored in httpOnly, sameSite=strict cookies` → `Authentication provided by
  Clerk`.
- Live Demo line: invite-code claim → `Sign-up is currently unrestricted — create an account via the link
  above.`
- Removed `INVITE_CODE` and `JWT_SECRET` rows from the Environment Variables table (`JWT_SECRET` removal
  wasn't explicit in the spec's Part E bullet list but is required by the spec's own Verification Step 7 —
  "README.md ... no longer mention[s] INVITE_CODE or JWT_SECRET" — so removed for consistency with that
  criterion).
- Removed the `INVITE_CODE` parenthetical from the "Run Your Own Instance" step 7, same reasoning.

Note: README's Tech Stack row still says AI is "Google Gemini 2.0 Flash" and there's a `GEMINI_API_KEY` row
in the env table — both stale (the app runs on OpenAI per `server/services/ai/resolveProvider.js`, per
`.env.example`'s actual `OPENAI_API_KEY`). **Not fixed** — outside TASK-042's Part E scope, which named three
specific edits, not a full README pass. Flagging so it isn't mistaken for missed scope.

## Part F — household/members diagnostics

`server/routes/household.js`'s `GET /members` handler now generates a short `requestId`
(`randomUUID().split('-')[0]`, same pattern as `server/routes/ai.js`), times the call, and on error logs
`request_id`/`householdId`/`userId`/`elapsedMs`/`error` before rethrowing (client-facing 500 unchanged —
`server/app.js`'s global error handler wasn't touched).

`householdService.getMembers(householdId, { requestId })` now logs the combined Neon query duration
(`getById` + the `householdMembers` select) as `neon_query_elapsedMs`, and passes `requestId` through to
`lookupClerkUsers`, which now logs its own `elapsedMs` and whether the `Promise.race` timeout actually fired
(`timedOut=true/false`) on both the success and catch paths. Fallback behavior (empty `Map` on any failure)
is unchanged — this only adds visibility.

**Not verified this session**: the spec's manual check (force a Neon-layer error, confirm the log line
appears with real values) — same as B/C above, doable next session with `server/.env.local`. Static review
of the diff is the only verification done so far.

# Files Created / Changed (this session)

**New**: `server/middleware/createRateLimiter.js`, `server/middleware/joinRateLimit.js`.
**Deleted**: `server/middleware/auth.js`.
**Modified**: `package.json`, `package-lock.json`, `server/package.json`, `server/package-lock.json`,
`client/package.json`, `client/package-lock.json`, `server/app.js`, `server/middleware/aiRateLimit.js`,
`server/routes/household.js`, `server/services/householdService.js`, `README.md`, `.env.example`,
`ai/handoffs/CURRENT_STATE.md` (this file).
**Not touched**: `server/middleware/aiRateLimitKeyGenerator.js` and its test (by design, per spec).

Nothing deployed. All changes are local/uncommitted as of this handoff — Connor has not yet been asked to
commit or push.

# Decisions Made

- Removed the `JWT_SECRET` row from README's env table even though the spec's Part E bullets only named it
  for `.env.example` (where it was already absent) — the spec's own Verification Step 7 requires README to
  no longer mention `JWT_SECRET` either, so treated that as the binding criterion over the possibly-incomplete
  bullet list.
- Did not touch README's stale Gemini/`GEMINI_API_KEY` references — genuinely out of Part E's named scope,
  unlike the JWT_SECRET case above which was directly required by a verification step.
- Did not attempt to fix the newly-surfaced `shell-quote`/`concurrently` root-level vulnerability — outside
  TASK-042's approved scope (spec's dependency tables never covered root), flagged as a follow-up instead of
  silently fixed or silently ignored.
- Used a dummy-env module-load smoke test as a partial substitute for real sign-in verification, initially
  believing no valid credentials existed locally (checked the wrong file — repo-root `.env`, stale). Corrected
  later in this same session: `server/.env.local` / `client/.env.local` do have real credentials, so the real
  verification steps are actually possible and are laid out in the Testing Walkthrough section below rather
  than left as a vague "needs real creds" blocker.

# Known Risks

Carried forward + new:

- **Real-credential verification is still outstanding for Parts B, C, and F** — this session could only
  static-check (grep, `npm ls`, lint/test/build, a dummy-env import smoke test), but real credentials for
  this ARE available locally (`server/.env.local`, `client/.env.local`) — see Testing Walkthrough below. Do
  these before or immediately after deploying, not skip them.
- `overrides` in Part A pin a floor, not a permanent fixture — see the spec's own removal-check guidance
  before any future direct-dependency bump in these areas.
- Part C's `joinRateLimit` threshold (10/15min) is still an unvalidated guess per the spec's own "Decisions
  Needed" — not changed this session.
- Part D (Clerk sign-up posture, OpenAI prepaid billing) and Part G (iOS camera picker, full mobile tour,
  Android install) remain fully open — unchanged from the prior handoff, still need Connor + physical
  devices.
- New, small, out-of-scope finding: root-level `shell-quote` high-severity advisory via `concurrently` (dev
  dependency only, not shipped to production) — not part of this task, noted above.

# Testing Walkthrough Results (2026-07-23, done)

All three checks passed against real credentials (`server/.env.local`), local dev server (`node server/index.js`
on :3001, Vite on :5183), signed in as Connor Sharpe via Clerk.

**Check 1 — Clerk sign-in without `cookie-parser` (Part B): PASS.** Session was already active on first load;
forced a full reload and confirmed it stayed signed in on the dashboard, no redirect to sign-in.

**Check 2 — join-code rate limiting (Part C): PASS** for the core behavior — 10 wrong-code submissions to
`/api/household/join` via the real `/join` UI each returned `404 Invalid join code`; the 11th returned
`429 Too Many Requests` with the exact spec'd message. **Not independently verified**: the "different user
still succeeds in the same window" half of the check — no second Clerk account was available this session.
`keyGenerator: (req) => req.user?.id ?? req.ip` in `server/middleware/joinRateLimit.js` keys per-user by
construction, so this is a code-reading confirmation, not a live cross-user test — do that specifically if a
second account/household becomes available.

**Check 3 — `household/members` diagnostics (Part F): PASS.** Temporarily broke the Neon query (bogus column
via a raw `sql` fragment in `getMembers`'s `householdMembers` select), hit `GET /api/household/members` through
the real Household page, confirmed the server log:
`[kitchen-keeper] request_id=43ac5d8f function=getMembers householdId=1 userId=user_3FVuvJJGq9W65mQ1SrVwLaz48wS
elapsedMs=128 error=column "household_id_bogus_column_xyz" does not exist` — while the client only ever saw a
generic "Internal server error" (500), confirming no detail leak. Reverted the breakage immediately after
(`git diff` confirmed clean); restarted the server and reconfirmed the members list renders normally again.

**Two unrelated things surfaced during this session, not part of TASK-042, not investigated further:**

1. **PWA service worker (`client/public/sw.js`) navigation-cache bug**: once the SW is active (2nd+ visit),
   a full-page navigation straight to `/join` (e.g., a real invite-link click) sometimes lands the address bar
   back on `/` instead of showing the join form — looks like the classic SW gotcha where a cached response's
   internal `.url` differing from the request causes the browser to rewrite the address bar. Only reproduced
   with the SW active; unregistering it fixed it immediately. Worth a real test on a device with the PWA
   actually installed (ties into Part G's device-verification gap) since this would break real invite links,
   not just an artifact of this session's tooling.
2. **Clerk token hydration race right after a full page load**: submitting a form within ~1s of a hard
   navigation (before `window.Clerk.session` fully hydrates) got a real `401` from `clerkAuth`, which redirects
   to `/sign-in`. A manual `fetch` a moment later with a freshly-fetched token succeeded fine. Likely not a
   real user-facing issue (humans don't submit forms that fast after a page load) but flagging since it's a
   genuine 401, not a test artifact — happened consistently, not once.

Both are candidates for their own follow-up tickets if Connor wants them looked at; neither touches any
TASK-042 code path.

# Testing Walkthrough (next session — do this interactively with Connor)

Prerequisite already satisfied: `server/.env.local` and `client/.env.local` exist with real Clerk/OpenAI/
Neon/VAPID/Blob credentials — confirmed present this session. No credential setup needed, just start the
server and walk through these three checks together.

**Setup**
1. Start the dev server: `npm run dev` from repo root (via the Browser preview tool's `dev` launch config if
   one exists in `.claude/launch.json`, otherwise `run_in_background` Bash/PowerShell). This runs Express on
   `:3001` and Vite on `:5173` concurrently.
2. Open `http://localhost:5173` in the Browser pane.

**Check 1 — Clerk sign-in still works without `cookie-parser` (Part B)**
3. Ask Connor to sign in (or sign up) through the app's normal Clerk flow.
4. Confirm the app lands on the pantry/dashboard view, not stuck on the sign-in screen.
5. Reload the page. Confirm the session persists (still signed in, no redirect back to sign-in) — this is
   the actual proof that removing `cookie-parser` didn't break Clerk's own session handling.

**Check 2 — join-code rate limiting (Part C)**
6. With Connor signed in to one household, submit a wrong join code via the app's "Join household" UI 11
   times within 15 minutes (same user/session each time).
7. Confirm the 11th attempt returns the rate-limit message ("Too many join attempts. Please wait a few
   minutes and try again.") instead of the normal "Invalid join code" error — check the Network tab or ask
   Connor what the UI showed.
8. If a second household/account is available, confirm it can still attempt a join in the same 15-minute
   window without being blocked — proves the limiter is keyed per-user (`req.user.id`), not global.

**Check 3 — `household/members` diagnostics fire correctly (Part F)**
9. Temporarily break the Neon query on purpose — easiest is editing `DATABASE_URL` in `server/.env.local` to
   an unreachable host, or briefly renaming a column reference in `householdService.getById`/`getMembers` —
   restart the dev server after the change.
10. Hit `GET /api/household/members` (load the household/settings page in the app, or `curl` it with a valid
    session cookie).
11. Check the server's console output for a line matching
    `[kitchen-keeper] request_id=<id> function=getMembers householdId=<id> userId=<id> elapsedMs=<n>
    error=<msg>` — confirms Part F's diagnostics actually fire with real values, not just look right in the
    diff.
12. Revert the temporary breakage (restore the real `DATABASE_URL` / column reference) and confirm
    `GET /api/household/members` succeeds normally again before moving on.

If all three checks pass, Parts B/C/F are verified for real, not just via lint/test/build — safe to treat
Implementation Complete as fully proven, not just "should work."

# Files Required Next

None beyond the Testing Walkthrough above and deployment. Suggested order for the next session or for
Connor directly:
1. Run the Testing Walkthrough above (real credentials already exist, no setup blocker).
2. Commit and deploy Parts A/B/C/E/F once the walkthrough passes.
3. Work Part D (Clerk Dashboard + OpenAI billing decisions) and Part G (device checks) directly with Connor,
   per the spec's Completion Criteria split.
4. Consider a follow-up ticket for the `shell-quote`/`concurrently` finding and the separately-flagged
   `@vercel/blob`/`drizzle-orm` major-version upgrades (both already called out as their own future task in
   the spec's Out of Scope section).

# Recommended Next Action

Run the Testing Walkthrough above with Connor (real credentials are already in place — no blocker), then
deploy Parts A/B/C/E/F, and separately schedule time with Connor for Part D's dashboard decisions and Part
G's device checks — do not let those two quietly drop the way TASK-037's equivalent items did before this
task existed specifically to catch that.

# Context Notes

- branch: `staging`.
- worktree: none.
- `.claude/settings.local.json` continues to have pre-existing local uncommitted changes (permission-prompt
  settings) unrelated to this or any prior session's work — left as-is, same note carried in every handoff
  since TASK-040.
- No production or staging deploy happened this session — all verification was local (lint/test/build) or
  static (grep/npm ls/npm audit).
