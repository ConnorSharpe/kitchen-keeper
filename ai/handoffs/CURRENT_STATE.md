# Task

Spec-drafting session for `ai/tasks/TASK-045-spec.md` — a mobile onboarding-tour bug Connor found by hand
("hamburger menu tour" doesn't keep the sidebar open for the duration, so the Pantry nav-item tooltip has
nothing to point at). This was an audit-only session: the spec went through three rounds of GPT architect
review and is now fully approved. **Zero application code has been touched — implementation has not
started.**

# Current Status

**Spec Complete: TASK-045-spec.md is DRAFT-3, 10/10, APPROVED FOR IMPLEMENTATION.**
**Implementation: not started — this is the next session's work.**

## What the bug actually is

Root cause is a re-entrancy race in `client/src/components/onboarding/productTour.js`'s `goToStep()`:
driver.js doesn't await `onNextClick`/`onPrevClick`, so tapping "Next" again before a previous
`goToStep` call's async chain (sidebar toggle → 200ms transition wait → `navigate()` → `waitForElement()`)
finishes starts a second overlapping call. The two calls' `setMobileNavOpen()`/`driverObj.moveTo()` calls
can resolve out of order, desyncing the sidebar's actual open/closed state from whatever step driver.js
ends up displaying.

**Reproduced live**, not just hypothesized — see TASK-045-spec.md's Codebase Reality Check for the full
methodology (scripted rapid clicks against `HouseholdPage.jsx`'s "Preview: new household" tour replay at a
375×812 viewport). Rapid tapping (80ms apart) produced the exact reported symptom: popover showing
"Pantry" while the sidebar was closed. At a deliberate pace, the same script showed the interleaved
nav/content step design working correctly — so the fix is narrowly the race, not the tour's design.

Ruled out along the way: TASK-044's unreproduced Pantry-page crash recurring (Connor confirmed no
"Something went wrong" fallback screen appeared — ruled out via direct question, not assumed), and a
CSS-transition-timing race (the original hypothesis before live reproduction disproved it).

## The approved fix (not yet implemented)

One file, `client/src/components/onboarding/productTour.js`: add an `isAdvancing` boolean guard around
`goToStep` (ignore new calls while one is already in flight, cleared in `finally`), plus a `catch` block
that ends the tour cleanly on any unexpected exception — matching the file's existing convention that
every abnormal exit path (element-not-found timeout, route divergence, back-button divergence) already
ends the tour rather than leaving it in an undefined state. Full code, and the reasoning for rejecting a
queue or a cancel-and-restart approach, is in the spec's Decision section. Read the spec directly before
implementing — don't reimplement from this summary alone.

# Files Created / Changed (this session)

**New**: `ai/tasks/TASK-045-spec.md`.
**Modified**: `ai/handoffs/CURRENT_STATE.md` (this file).
**Not touched**: any application code — this was a spec-only session.

Nothing deployed. Both new/changed files are docs; safe to commit and push directly (see Context Notes
re: `.claude/settings.local.json`, which stays uncommitted as always).

# Decisions Made

- **Chose a drop-the-tap guard over a queue or cancel-and-restart** for the race fix — a short, fixed-step
  tour doesn't need either's added complexity (a pending-index queue, or cancelling in-flight navigation/
  sidebar-animation/`waitForElement` work and resyncing driver.js's internal state). Architect review
  agreed on both rejections across all three rounds.
- **Unexpected exceptions in `goToStep` destroy the tour cleanly** (`catch` → `finish()`/`driverObj.destroy()`)
  rather than propagating as an unhandled promise rejection that would leave the tour frozen mid-step with
  no user-visible signal anything went wrong. Verified (not just asserted) that this matches every other
  abnormal exit path already in the file — see the spec's round-2 audit table for the full per-path
  breakdown, including why the `abortController` early-returns and the `isInitial`+missing-`STEPS[0]` case
  are not counterexamples.
- **Declined routing the new `catch`'s error through TASK-044's `/api/client-errors` reporting pipeline**
  (raised as an optional enhancement in round 2, not a requirement). Reasoning kept in the spec: that
  pipeline is wired into `ErrorBoundary.componentDidCatch`, which only ever catches React render/lifecycle
  exceptions — never async/event-handler throws like this one — so it was never in that pipeline's domain.
  Adding a second `fetch`-based reporting call here would expand this task's scope and introduce a new
  failure mode (a `fetch` that can itself throw/hang) inside a handler meant to stay simple.
- **Fixed a pre-existing, unrelated local dev-environment issue to enable live reproduction**: see Side
  Effect below. Confirmed with Connor before touching anything (read-only inspection first, explicit
  go-ahead before the actual insert).

# Known Risks

Carried into the implementation session:

- **Extra rapid taps during a transition are silently dropped with no visual feedback** (Known Risk 1 in
  the spec) — accepted as intentional UX ("the tour behaves like a temporarily disabled wizard"), not a
  regression to fix. Worst-case drop window is bounded by `WAIT_FOR_ELEMENT_TIMEOUT_MS` (2000ms), not just
  the common 200ms sidebar-transition case.
- **This fix does not touch `SIDEBAR_TRANSITION_MS` or the interleaved step list** — both were confirmed
  working correctly at a deliberate pace during reproduction; if a future device genuinely needs longer
  than 200ms for the CSS transition even without a tap race, that would be a separate, currently
  unobserved bug (see spec's Out of Scope).
- **Acceptance criteria require live device/viewport testing**, not just lint/build — this project verifies
  onboarding-tour changes via manual smoke testing (same precedent as TASK-024/025/026/043/044), not an
  automated suite. The spec's Acceptance Criteria checklist (7 items: deliberate pace, rapid Next, rapid
  Prev, mixed Next/Prev, exit-while-in-flight, real onboarding flow, desktop regression) should all be
  walked through before considering this done.

## Side effect: local dev DB migration-tracking drift fixed (unrelated to TASK-045 itself)

While trying to reproduce the bug locally, `npm run dev`'s server startup failed with `NeonDbError: type
"onboarding_flow" already exists`. Root cause: `drizzle.__drizzle_migrations` was missing tracking rows for
`0018_user_onboarding` and `0019_drop_users` even though both were already fully applied to the actual
schema (confirmed via read-only queries before touching anything) — same underlying drift class already
documented for `0017_platform_settings` in `0018_user_onboarding.sql`'s own comment and
`TASK-040-spec.md`. **Flagged to Connor that `server/.env.local` points at the same shared Neon database
the deployed app uses, not an isolated local branch** — he confirmed proceeding. Fixed by inserting the
two missing tracking rows (sha256 hash of each migration file, matching drizzle's own hashing, + each
migration's `_journal.json` `when` timestamp) — pure bookkeeping, no schema change. Local dev now starts
cleanly. `0017` itself is still untracked in the journal (pre-existing, undisturbed) — no action taken,
matches TASK-040's original note.

# Context Notes

- branch: `staging`.
- worktree: none.
- `.claude/settings.local.json` continues to have pre-existing local uncommitted changes (permission-prompt
  settings) unrelated to this or any prior session's work — left as-is, same note carried in every handoff
  since TASK-040.
- Local dev DB migration drift (see Side Effect above) is now fixed — `npm run dev` should start cleanly
  next session without hitting the `onboarding_flow` migration error.
- This session used the Browser preview tool's `server`/`client` launch configs (`.claude/launch.json`) at
  a 375×812 mobile viewport to reproduce the bug via `HouseholdPage.jsx`'s onboarding-preview replay
  feature — the same approach is the fastest path to exercising TASK-045's Acceptance Criteria next
  session, no new setup needed.
- **Environment gotcha worth knowing before trusting visual output in this environment**: this session's
  Browser pane did not composite frames (`screenshot` calls failed with "the Browser pane is not
  displayed"), and `getComputedStyle(el).transform` returned stale/frozen values that contradicted the
  element's actual (correct) CSS class for over a second of polling — a tooling artifact, not a real bug.
  Verify DOM/CSS state via `element.classList` or React fiber `memoizedState` inspection instead of
  screenshots or computed-transform reads if the pane reports it isn't compositing.

# Recommended Next Action

Implement `ai/tasks/TASK-045-spec.md` exactly as approved:
1. Add the `isAdvancing` guard + `catch`/`finally` to `goToStep` in
   `client/src/components/onboarding/productTour.js`, per the spec's Decision section code block.
2. Walk the spec's full Acceptance Criteria checklist live (mobile viewport, `HouseholdPage.jsx`'s
   onboarding preview replay for the scripted/rapid-tap checks; a real fresh-account tour for the "real
   onboarding flow" check; desktop viewport for the regression check).
3. Commit and, once verified, deploy per this project's normal `staging` → `main` → Vercel flow — no new
   process beyond what TASK-042/044 already established.
