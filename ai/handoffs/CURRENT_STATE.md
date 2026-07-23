# Task

Spec-drafting session for TASK-041 — tour expansion to page-level buttons, side-effect-free onboarding-tour
replay from the Household page, mobile hamburger/title overlap fix, iOS redundant camera-picker fix, a Chat
capabilities info icon, and a dead-code sweep closing out `task_8893cd9f`. Raised by the user directly in
conversation as a follow-up to TASK-040. No implementation this session — planning/spec only.

# Current Status

**`ai/tasks/TASK-041-spec.md` is written, has been through two rounds of architect review, and is DRAFT-3 —
APPROVED FOR IMPLEMENTATION.** No code has been touched yet; this session was spec drafting and review only.

- DRAFT-1: initial draft, grounded in the actual code (not assumed) for all six parts, plus targeted web
  research for the two genuinely uncertain technical questions (iOS file-input/camera-picker behavior,
  cross-route driver.js tour continuation — neither has a known library-level solution). Three decisions were
  resolved by the user before drafting: full 12-step interleaved tour (not 6, not two separate tours);
  side-effect-free Household-page preview (no server mutation, ever); extract a shared `PageHeader` component
  rather than patching six pages individually.
- DRAFT-2 (round 1 review, 9.2/10 → approve after revision on Parts A/B): split the onboarding-tour replay
  into its own `OnboardingPreview` component instead of overloading `OnboardingGate` with a preview mode;
  replaced internal `previewMode` branching in `WelcomeStep`/`StaplesChecklist` with injected callback props
  (`onSaveHouseholdName`, `onAddItems`) so the real vs. no-op behavior lives at the call site, not inside the
  presentational components; collapsed Part A's tour-advancement logic from 12 separate per-step handlers
  into one shared `advanceTo()`; swapped a `requestAnimationFrame` polling loop for a cancellable
  `MutationObserver`-based `waitForElement()`; established that a Back-button press mid-tour reuses the
  existing `onDestroyed`-is-truth rule from TASK-040 (no new state needed) rather than special-casing it.
  Declined, with reasoning recorded in the spec's own Architect Review History table: a page-level
  `useEffect`-based tour-readiness coordinator (would make `RecipesPage`/`PantryPage` tour-aware — exactly
  the coupling `OnboardingGate` exists to avoid, and unnecessary since every tour-target button in this app
  renders synchronously, confirmed by reading the code, not assumed); a formal tour state-machine
  abstraction (reviewer itself called it non-mandatory, doesn't fit this codebase's repeated preference
  against introducing abstractions at this scale); re-testing mobile orientation changes mid-tour (already
  raised and explicitly declined in TASK-040 itself).
- DRAFT-3 (round 2 review, 9.8/10 → approved): two small polish items, both adopted — `waitForElement`'s
  timeout now has a defined failure path (`driver.destroy()`, reusing the same early-exit path as every other
  way the tour can end) instead of leaving a partially-active overlay undefined; `onSaveHouseholdName`/
  `onAddItems` are now explicitly documented as promise-returning contracts so a future "simplify the no-op"
  edit can't silently change `await`-dependent timing behavior in their callers.

**Full design is locked; nothing in the six parts is still open.** See the spec's own "Decisions (resolved
by user, 2026-07-22)", "Out of Scope", and "Known Risks" sections for the complete picture — not
re-summarized here to avoid drift between this handoff and the spec itself.

# Files Created / Changed (this session)

- **New**: `ai/tasks/TASK-041-spec.md` (the spec itself, DRAFT-3/approved).
- **Modified**: `ai/handoffs/CURRENT_STATE.md` (this file).

No application code touched this session.

# Decisions Made

All six parts' design decisions are recorded in `TASK-041-spec.md` itself (its own "Decisions" section plus
its Architect Review History table for the two review rounds) — not duplicated here.

# Known Risks

Carried forward from the spec, not re-litigated this session — see `TASK-041-spec.md`'s own "Known Risks"
section. Highest-risk item flagged there: Part A's cross-route tour-continuation logic is genuinely bespoke
(no driver.js API for it), and worth prototyping first during implementation rather than last.

# Files Required Next

Implementation of `TASK-041-spec.md`'s six Design parts, in the file lists each part already specifies:

- **Part A** (tour → page buttons): `productTour.js`, `OnboardingGate.jsx`, `RecipesPage.jsx`,
  `PantryPage.jsx` (new `data-tour` attributes).
- **Part B** (Household-page replay preview): new `OnboardingPreview.jsx`; `WelcomeStep.jsx`,
  `StaplesChecklist.jsx` (new callback props), `HouseholdPage.jsx` (new UI section), `AppLayout.jsx`
  (`useOutletContext` for `setMobileNavOpen`), `OnboardingGate.jsx` (supply the two new callbacks).
- **Part C** (mobile header fix): new `PageHeader.jsx`; adopted in `PantryPage.jsx`, `RecipesPage.jsx`,
  `ShoppingPage.jsx`, `DashboardPage.jsx`, `HouseholdPage.jsx`, `ChatPage.jsx`; paired comment in
  `Sidebar.jsx`.
- **Part D** (iOS camera-picker fix): `RecipeUpload.jsx`, `ReceiptUpload.jsx`.
- **Part E** (Chat info icon): `ChatPage.jsx` (new modal + `PageHeader` `actions` slot).
- **Part F** (dead-code sweep): `RecipeUpload.jsx`, `ReceiptUpload.jsx`, `RecipeUrlImport.jsx` (`/login` →
  `/sign-in` fix); delete `client/src/components/layout/ProtectedRoute.jsx`.

# Recommended Next Action

Start an implementation session against `TASK-041-spec.md` directly — Design Parts A–F in order, per the
spec's own file lists above. Per the spec's own Known Risks, prototype Part A (cross-route tour continuation)
early rather than last, since it's the one genuinely novel piece with no library-level precedent to lean on.
Verification Steps are already written in the spec (11 steps) — run through all of them before considering
this task done, same discipline as TASK-040.

# Context Notes

- branch: `staging`
- worktree: none
- `.claude/settings.local.json` has pre-existing local uncommitted changes (permission-prompt settings),
  unrelated to this session's work — left as-is, not part of any commit this session (same as noted in the
  TASK-040 handoff).
