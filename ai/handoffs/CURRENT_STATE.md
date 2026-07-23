# Task

Design session (no implementation) for TASK-040 — onboarding for a brand-new household's first user and
for a new member joining an existing household via invite. User asked for a welcome flow, a revived
"stock your pantry" staples checklist, and a guided product tour. Spec was drafted, then run through three
rounds of iterative architect review (the user's established workflow — see `ai/handoffs/CONVENTIONS.md`
conventions and prior tasks' own Architect Review History tables), with each round's feedback critically
checked against the actual codebase (the architect has no file access) before being adopted, corrected, or
declined. No application code changed this session — this was spec-only.

# Current Status

`ai/tasks/TASK-040-spec.md` is at **DRAFT-5, APPROVED FOR IMPLEMENTATION**. Ready for the next session to
build from Design Parts A–E, in order.

Investigation during this session found the app's existing onboarding surface was fully broken, not just
missing — see the spec's own "Current State" section for the full trace (`StaplesChecklist` gated on a
Clerk-user field that never exists; `completeOnboarding()` was a no-op stub; `LoginPage.jsx`/`users` table
are dead pre-Clerk-migration leftovers). TASK-040 fixes all of this as part of building the new flow.

# Files Created (this session)

- `ai/tasks/TASK-040-spec.md` — the spec, DRAFT-1 through DRAFT-5 (three architect review rounds + one
  round of user-directed scope decisions, all preserved in-file via the Architect Review History table and
  the "Decisions (resolved by user, ...)" section, matching this repo's established spec convention).

# Decisions Made

- **Clerk Organizations declined** in favor of the lighter-weight approach this spec takes (discussed with
  the user directly; Clerk Organizations would have meant migrating `households`/`householdMembers`/the
  join-code system onto Clerk's own org/invitation model — real infrastructure change, not just onboarding
  UI, and not needed for the actual ask).
- **Onboarding state**: new `user_onboarding` table keyed by Clerk user ID (not household ID — household
  owners and members live in two different existing tables, a per-user table avoids that asymmetry).
  Row-absence means "predates this feature, already onboarded" (no retroactive onboarding), matching this
  codebase's existing convention from `0003_onboarding_complete.sql`.
- **Flow ordering**: Welcome → Tour → Checklist (checklist only for the `new_household` flow). This
  ordering is also what makes the "don't mark onboarding complete until the tour actually finishes" fix
  fall out naturally — driver.js's `onDestroyed` callback is the transition to the next step, not a
  separate completion call racing `drive()`'s immediate return.
- **Household naming**: included in v1 (user's explicit call, reversing the spec's own initial
  recommendation to skip it) — folded into the existing Welcome step rather than adding a new state.
- **Any household member may rename the household** (not owner-only) — decided by surveying this
  codebase's actual permission model (no household mutation anywhere is gated by household-owner role;
  the only "owner" check in the app, `viewerIsOwner`, is the single global *platform* administrator, an
  unrelated concept), not by analogy to any one endpoint.
- **Full guided tour on mobile**, not desktop-only — user's explicit call ("this app will most likely be
  used on the phone"), reversing the spec's initial desktop-only recommendation. This required lifting the
  sidebar's `mobileOpen` state out of `Sidebar.jsx` into `AppLayout.jsx` so the tour can hold it open
  across all six nav steps.
- **Dead-code cleanup bundled into this task**: `LoginPage.jsx`, the vestigial `users` table (pre-Clerk,
  has `passwordHash`), and the dead `login`/`register` `AuthContext` stubs are deleted as part of TASK-040
  rather than filed separately — confirmed via `grep` this session that nothing else references any of them.
- **One-time tour only** for v1 — no "replay tour" affordance built.

# Known Risks (recorded in TASK-040-spec.md; none resolved this session, all for the implementing session to carry forward)

- **Pre-existing, unrelated to TASK-040**: `server/db/migrations/0017_platform_settings.sql` exists on disk
  but has no entry in `server/db/migrations/meta/_journal.json` — discovered while checking TASK-040's own
  migration numbering (which is why TASK-040's new migration is `0018`, not `0017`). Not investigated
  further or fixed this session — worth checking directly (Neon console, or query for the table) before
  TASK-040 ships, since it's unclear whether `drizzle-kit migrate` would ever (re-)apply it from the journal.
- Whether a driver.js-highlighted nav item remains tappable mid-tour was not verified against driver.js's
  actual behavior (unlike `onDestroyed`, which was checked directly) — worth confirming during
  implementation, since tapping a highlighted item on mobile could navigate away mid-tour.
- Mobile orientation changes mid-tour are explicitly unsupported (accepted, not engineered around).
- A narrow, accepted edge case around household-rename propagation to already-mounted client state — see
  spec's Design Part B for the full reasoning on why this wasn't built out further.

# Files Required Next

Everything in `TASK-040-spec.md`'s Design, Parts A–E — implementation hasn't started:

- **Part A** (backend plumbing): `server/db/migrations/0018_user_onboarding.sql`, `server/db/schema.js`
  (`userOnboarding` table + `onboardingFlowEnum`), new `server/services/onboardingService.js`, two call
  sites added to `server/services/householdService.js`, new `server/routes/onboarding.js` + mount in
  `server/app.js`.
- **Part B** (client gate + household naming): `client/src/context/AuthContext.jsx` rewrite, new
  `client/src/components/onboarding/OnboardingGate.jsx` and `WelcomeStep.jsx`, `AppLayout.jsx` and
  `Sidebar.jsx` changes (lifted `mobileOpen` state), `PantryPage.jsx` cleanup, new `PATCH /api/household`
  route + `householdService.updateName`.
- **Part C**: one-line change to the already-built `StaplesChecklist.jsx` (remove its own
  `completeOnboarding()` call).
- **Part D** (tour): add `driver.js` dependency, new `client/src/components/onboarding/productTour.js`,
  `data-tour` attributes on `Sidebar.jsx` nav links.
- **Part E** (cleanup): delete `LoginPage.jsx`, new `server/db/migrations/0019_drop_users.sql`, remove
  `users` export from `schema.js`.

Implementation should follow the spec's own Verification Steps (13 of them) closely — several encode
non-obvious behavior (exact completion timing, which dismiss paths do/don't persist, mobile sidebar
lifecycle around the tour) that would be easy to get subtly wrong without them.

# Recommended Next Action

Implement TASK-040 per the spec. Part A has no dependents outside itself and is the natural starting point;
Parts B–D depend on it (the client fetches `/api/onboarding`, which needs Part A's route to exist). Part E
is independent and can go first, last, or interleaved. Follow `CONVENTIONS.md`'s canonical migration order
(apply `0018`/`0019` to the `staging` Neon branch first, verify there, then production, then merge to
`main`). Run `npm test` / `npm run lint` / `npm run build` before considering it done — none were run this
session since no code changed.

# Context Notes

- branch: `staging` (this session's only change — `ai/tasks/TASK-040-spec.md` — was authored and will be
  committed directly on `staging`, no code changes, nothing to build/test/lint this session)
- worktree: none
- `.claude/settings.local.json` has local uncommitted changes (permission-prompt settings) unrelated to
  this session's work — left as-is, not part of this commit.
