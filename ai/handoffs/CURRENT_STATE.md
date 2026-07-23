# Task

Implementation session for TASK-041 — 12-step tour expansion to page-level action buttons, side-effect-free
onboarding-tour replay from the Household page, mobile hamburger/title overlap fix, iOS redundant
camera-picker fix, a Chat capabilities info icon, and a dead-code sweep closing out `task_8893cd9f`. Built
from `ai/tasks/TASK-041-spec.md` DRAFT-3 (approved for implementation, written in the prior session), Design
Parts A–F in order, per that spec's own Recommended Next Action. Followed by two small user-requested
follow-ups after hands-on verification.

# Current Status

**Implemented, hands-on verified against the user's own real account (not just lint/test/build), and
deployed to both `staging` and `main`/production.** All six spec parts are done and match the spec's file
list exactly:

- Part A (12-step interleaved tour, cross-route advancement) ✅
- Part B (Household-page replay preview) ✅
- Part C (shared `PageHeader`, mobile offset) ✅
- Part D (iOS camera-picker fix) ✅
- Part E (Chat info icon) ✅
- Part F (dead-code sweep) ✅

`npm run lint`, `npm test` (96/96 passing), and `npm run build` all pass clean.

**Real bug found and fixed during hands-on verification** (not something lint/build/tests could catch):
`OnboardingPreview` was originally mounted inside `HouseholdPage`, per the spec's own file list. Since the
tour it drives navigates across routes, the first cross-route step unmounted `HouseholdPage` (and
`OnboardingPreview` with it) — the tour's completion callback (advancing Welcome → Tour → Checklist) then
fired against a stale, unmounted component instance, so the staples checklist silently never appeared after
the last tour step. Fixed by lifting `OnboardingPreview` to `AppLayout` (a sibling of `<Outlet/>`, exactly
where `OnboardingGate` already lives, for the same reason) — `previewFlow` state moved there too, passed
down to `HouseholdPage` via `useOutletContext`. Re-verified the full 12-step tour end-to-end afterward; the
checklist now appears correctly.

**Two follow-up fixes, requested by the user after the above verification pass**:
1. Household naming is now explicitly skippable during tour replay. `WelcomeStep.jsx` gained a new
   `allowNaming` prop (default `true`); `OnboardingPreview.jsx` passes `allowNaming={false}` so replaying the
   tour never shows a rename field for a name that deliberately never saves (robust — an explicit flag, not
   inferred from `flow` or from which callback was injected).
2. Removed the barcode-scanning feature entirely, at the user's explicit request after asking whether it
   actually worked. It did (real camera scan via `html5-qrcode` + a live Open Food Facts lookup), but wasn't
   judged worth keeping. Removed: the button and its state/handlers in `PantryPage.jsx`, the
   `scan-barcode` tour step (tour is now **11 steps**, not 12), `BarcodeScanner.jsx` and `openFoodFacts.js`
   (deleted outright, zero other importers), and the `html5-qrcode` dependency (`npm uninstall` — also
   dropped the 335KB lazy-loaded chunk it shipped in).

# Files Created / Changed (this session)

Matches `TASK-041-spec.md`'s Design Parts A–F file list, plus the two follow-ups above:

- **New**: `client/src/components/layout/PageHeader.jsx`, `client/src/components/onboarding/OnboardingPreview.jsx`.
- **Modified**: `client/src/components/onboarding/productTour.js` (12→11 steps after barcode removal),
  `OnboardingGate.jsx`, `WelcomeStep.jsx` (`allowNaming` prop), `StaplesChecklist.jsx`,
  `client/src/components/layout/AppLayout.jsx` (owns `previewFlow` now, not `HouseholdPage`), `Sidebar.jsx`
  (paired comment), `client/src/pages/PantryPage.jsx` (new `data-tour` attrs, barcode code removed),
  `RecipesPage.jsx` (new `data-tour` attrs), `ShoppingPage.jsx`, `DashboardPage.jsx`, `HouseholdPage.jsx`
  (preview section + `useOutletContext`), `ChatPage.jsx` (info icon + modal),
  `client/src/components/recipes/RecipeUpload.jsx` (label-based inputs + `/sign-in` fix),
  `client/src/components/pantry/ReceiptUpload.jsx` (same), `client/src/components/recipes/RecipeUrlImport.jsx`
  (`/sign-in` fix only), `client/package.json`/`package-lock.json` (dropped `html5-qrcode`).
- **Deleted**: `client/src/components/layout/ProtectedRoute.jsx` (dead code, zero importers),
  `client/src/components/pantry/BarcodeScanner.jsx`, `client/src/utils/openFoodFacts.js`.

No server-side/migration changes this session — TASK-041 was entirely client-side.

Committed as `390327e` on `staging`, then fast-forward merged and pushed to `main`.

# Decisions Made

- All six parts' design decisions were made in the prior (spec) session — see `TASK-041-spec.md`'s own
  "Decisions" section and Architect Review History table; nothing was re-litigated this session, the spec
  was implemented as approved.
- **The `OnboardingPreview` mount-location fix (above) deviates from the spec's literal file list**, which
  named `HouseholdPage.jsx` as the sole new-UI location and didn't call out `AppLayout.jsx` for this part.
  This was a correctness bug the spec's own design didn't anticipate — surfaced only by actually running the
  tour, not by code review — so it was fixed directly rather than left broken to match the letter of an
  approved-but-incomplete spec.
- **Deployed to production this session**, not held at staging — same pattern as TASK-040: no schema/migration
  risk (client-only change), lint/test/build clean, and this time also hands-on verified against a real
  logged-in account (a stronger bar than TASK-040's health-check-only verification, since Claude has no
  Clerk credentials of its own and relied on the user signing in this session).

# Known Risks (carried forward from the spec; not re-verified this session)

- Part D's iOS camera-picker fix is based on published guidance and matches the user's original screenshot,
  but needs an actual iPhone check — not done this session (no physical device available).
- Tour cancellation mid-navigation-wait, and browser-Back-button divergence mid-tour, were implemented per
  spec but not explicitly exercised this session (the 12-step interleaved tour's normal forward/backward
  path was; the two "abnormal exit" verification steps were not).
- Mobile viewport for the full tour (steps 1–11, sidebar open/close transitions) was checked for the header
  offset only (Part C), not walked step-by-step on a mobile viewport.
- Mobile orientation changes mid-tour remain unsupported, unchanged from TASK-040's own accepted risk.

# Separately flagged (not part of TASK-041, unrelated pre-existing issue)

`GET /api/household/members` returned a transient 500 during this session's local dev verification (reproduced
once, then succeeded on retry with no code changes). Not investigated — this endpoint is untouched by
TASK-041. Worth a look if it recurs on production.

# Files Required Next

None for TASK-041 itself — implementation, hands-on verification, and production deploy are all complete.
Remaining risks (above) are lower-priority spot-checks, not blockers.

# Recommended Next Action

None outstanding. If the iPhone camera-picker check (Part D) or the abnormal-tour-exit paths surface anything
on production, triage as a fix commit on `staging` first, per the usual staging-then-production order.

# Context Notes

- branch: `staging` (working branch restored here after the `main` merge/push completed).
- `main` and `staging` are both at `390327e` as of this session — in sync, no drift.
- Production (`kitchenkeeper.kitchen`) confirmed live and healthy post-deploy (`/` and `/api/health` both
  return 200).
- worktree: none.
- `.claude/settings.local.json` has pre-existing local uncommitted changes (permission-prompt settings)
  unrelated to this session's work — left as-is, not part of any commit this session (same as noted in the
  TASK-040 handoff).
