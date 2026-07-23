# Task

Implementation session for TASK-040 — onboarding for a brand-new household's first user and for a new
member joining an existing household via invite (Welcome step + household naming, 6-step guided product
tour via driver.js, revived "stock your pantry" staples checklist). Built from `ai/tasks/TASK-040-spec.md`
DRAFT-5 (approved for implementation, written in the prior session), Design Parts A–E in order, per that
spec's own Recommended Next Action.

# Current Status

**Implemented, verified (lint/test/build + staging DB migration), and deployed to both `staging` and
`main`/production.** All 5 spec parts are done and match the spec's file list exactly:

- Part A (backend plumbing) ✅
- Part B (client gate + household naming) ✅
- Part C (StaplesChecklist reconnected) ✅
- Part D (guided tour) ✅
- Part E (dead-code cleanup: `LoginPage.jsx`, `users` table) ✅

`npm run lint`, `npm test` (82/82 passing), and `npm run build` all pass clean. Migrations
`0018_user_onboarding.sql` and `0019_drop_users.sql` applied successfully to the `staging` Neon branch
(server boots clean; `GET /api/onboarding` correctly mounted and 401-gated) and — as of this session's
`staging` → `main` merge and push — to production as well, via `server/db/migrate.js`'s auto-run-on-boot.

**Not yet done: interactive verification of the actual onboarding flow on production.** I have no Clerk
credentials for this app, so I could not click through Welcome → Tour → Checklist myself on either staging
or production — only route-mounting/health-check-level verification. The user is doing that pass themselves
on production now that the deploy is complete, against the spec's own 13 Verification Steps.

# Files Created / Changed (this session)

Exactly the file list `TASK-040-spec.md`'s Design Parts A–E called for:

- **New**: `server/db/migrations/0018_user_onboarding.sql`, `server/db/migrations/0019_drop_users.sql`,
  `server/services/onboardingService.js`, `server/routes/onboarding.js`,
  `client/src/components/onboarding/OnboardingGate.jsx`, `.../WelcomeStep.jsx`, `.../productTour.js`.
- **Modified**: `server/db/schema.js` (added `userOnboarding`/`onboardingFlowEnum`, removed `users`),
  `server/db/migrations/meta/_journal.json` (idx 17/18), `server/services/householdService.js` (two
  `upsertFlow` call sites + new `updateName`), `server/routes/household.js` (new `PATCH /`), `server/app.js`
  (mount `onboardingRouter`), `client/src/context/AuthContext.jsx` (real fetch + `completeOnboarding`),
  `client/src/components/onboarding/StaplesChecklist.jsx` (delegate completion to `onComplete` prop),
  `client/src/components/layout/AppLayout.jsx` (lifted `mobileNavOpen`, mounts `OnboardingGate`),
  `client/src/components/layout/Sidebar.jsx` (controlled-component conversion + `data-tour` attrs),
  `client/src/pages/PantryPage.jsx` (removed superseded onboarding gating), `client/package.json` (added
  `driver.js`).
- **Deleted**: `client/src/pages/LoginPage.jsx`.

Committed as `c10afba` on `staging`, then fast-forward merged and pushed to `main`.

# Decisions Made

- All design decisions were made in the prior (spec) session — see that entry's own "Decisions Made" if
  needed; nothing was re-litigated this session, the spec was implemented as approved.
- **Found and fixed a real bug in the spec's own SQL** while applying `0018_user_onboarding.sql` to
  staging: Neon's HTTP driver (`drizzle-orm/neon-http/migrator`) cannot run multiple SQL statements in one
  call, and the migration's four statements (`CREATE TYPE` / `CREATE TABLE` / two `COMMENT ON`s) had no
  `--> statement-breakpoint` separators between them — the spec's SQL block, copied verbatim, crashed the
  server on boot (`NeonDbError: cannot insert multiple commands into a prepared statement`). Fixed by adding
  breakpoints between each statement, matching the existing convention already used in
  `0016_recipe_blocklist.sql`. The parse failure happens before execution, so nothing was partially applied;
  safe to fix and retry.
- **Deployed to production this session**, not held at staging — user's explicit call after reviewing what
  the migration would do (confirmed understanding that `0019_drop_users.sql` is an irreversible `DROP TABLE`
  against the live database, empty/unused table, already grep-confirmed zero references).

# Known Risks (carried forward from the spec; still unverified — none resolved this session)

- Whether a driver.js-highlighted nav item remains tappable mid-tour was not verified against driver.js's
  actual behavior — worth checking during the user's production walkthrough, since tapping a highlighted
  item on mobile could navigate away mid-tour.
- Mobile orientation changes mid-tour are explicitly unsupported (accepted, not engineered around).
- A narrow, accepted edge case around household-rename propagation to already-mounted client state — see
  spec's Design Part B.
- `server/db/migrations/0017_platform_settings.sql`'s pre-existing, unrelated journal gap (flagged in the
  spec) — not investigated or fixed this session either; still worth checking directly against Neon before
  it causes confusion in some future migration.

# Separately flagged (not part of TASK-040, spun off this session)

Three components (`client/src/components/pantry/ReceiptUpload.jsx`,
`client/src/components/recipes/RecipeUrlImport.jsx`, `.../RecipeUpload.jsx`) redirect to `/login` on a
401 — a route that has never existed post-Clerk-migration (should be `/sign-in`, matching
`client/src/api/index.js`'s own 401 handler). A fourth file, `client/src/components/layout/ProtectedRoute.jsx`,
has the same bug but is entirely dead code (zero importers). Pre-existing, unrelated to this session's
`LoginPage.jsx` deletion (these reference the URL string, not the component) — spun off as its own
background task (`task_8893cd9f`) rather than fixed inline, to avoid scope creep into TASK-040.

# Files Required Next

None for TASK-040 itself — implementation is complete. Only remaining step is the user's own interactive
verification pass on production (spec's 13 Verification Steps), which requires their own Clerk sign-in.

# Recommended Next Action

Once the user's production walkthrough confirms the flow works end-to-end, TASK-040 can be considered fully
closed — no further action needed beyond that confirmation. If the walkthrough surfaces anything (e.g. the
mobile-tappable-nav-item risk above), triage as a fix commit on `staging` first, per the usual
staging-then-production order.

# Context Notes

- branch: `staging` (working branch restored here after the `main` merge/push completed)
- `main` and `staging` are both at `c10afba` as of this session — in sync, no drift.
- worktree: none
- `.claude/settings.local.json` has local uncommitted changes (permission-prompt settings) unrelated to
  this session's work — left as-is, not part of any commit this session.
