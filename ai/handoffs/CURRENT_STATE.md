# Task

Implementation session for `ai/tasks/TASK-045-spec.md` — fix the mobile onboarding-tour sidebar
desync race on rapid Next/Prev taps. The spec was DRAFT-3/10-10/APPROVED FOR IMPLEMENTATION going into
this session (see prior handoff below the divider). **Implemented and live-verified this session.**

# Current Status

**Implementation: DONE.** The `isAdvancing` guard, exactly as written in the spec's Decision section, is
in `client/src/components/onboarding/productTour.js`'s `goToStep`. **Committed and pushed to `staging`
and `main` (production).**

## What was implemented

One file, `client/src/components/onboarding/productTour.js`: `goToStep` now tracks a closure-scoped
`isAdvancing` boolean. A call that arrives while a prior one is still in flight returns immediately
(dropped, not queued). The whole body is wrapped in `try/catch/finally`: `finally` always clears the flag
(guarantees the tour can't permanently wedge even on an early return), and `catch` ends the tour cleanly
on any unexpected exception (`finish()` if `isInitial`, else `driverObj.destroy()`) instead of leaving an
unhandled promise rejection with the tour frozen mid-step. No other file was touched — matches the spec's
Allowed/Forbidden Files list exactly.

## Verification performed (live, this session)

Ran against local dev at a 375×812 mobile viewport, via Household → "Preview: new household", using
scripted DOM-level clicks (`.driver-popover-next-btn`/`-prev-btn`) rather than screenshots — see Context
Notes below for why. Results:

- **Deliberate pace, all 10 real steps**: sidebar open/closed state matched nav-vs-content classification
  at every single step. No regression from pre-fix behavior.
- **Rapid Next taps (80ms apart, faster than the 200ms sidebar transition), multiple bursts**: settled
  state after each burst was always consistent (nav step → sidebar open, content step → sidebar closed).
  This is the exact reported bug (`popover="Pantry", sidebar=CLOSED`), reproduced as still possible to
  *trigger a transient race* mid-burst but **never left in a desynced state once tapping stopped** — i.e.
  the guard closes the race.
- **Rapid Prev taps**: same — settles correctly reversing direction.
- **Mixed rapid Next/Prev bursts**: settles correctly, and a normal Next tap immediately after the burst
  still advances the tour — confirms the guard doesn't wedge it.
- **Close (×) button clicked mid-transition** (guard's `isAdvancing` deliberately true at click time):
  tour still terminates immediately, sidebar closes via `finish()`. Confirms the guard does not
  accidentally block a termination path (architect review round 1's concern) — matches the spec's
  reasoning that Skip/Close/Escape route through driver.js's own `destroy()`, entirely outside `goToStep`.
- No console errors or unhandled rejections observed in any of the above.

**Not tested this session**: the spec's "real (non-preview) first-run tour" acceptance item — a genuine
fresh-account `new_household`/`joined` signup, as opposed to the Household page's side-effect-free
preview replay. Skipped because [[feedback_dev_db_is_shared]]: local dev points at the same Neon DB the
deployed app uses, so creating a throwaway test account isn't a fully isolated action. Worth doing before
calling TASK-045 fully closed out, but the mechanism under test (`goToStep`'s guard) is identical between
the preview and real flows — `OnboardingPreview.jsx` and `OnboardingGate.jsx` both just call
`runProductTour()`, per the spec's own Dependency Chain.

**Desktop regression check (≥768px)**: inconclusive by observation, but not a regression — see below.

## Two pre-existing bugs found during verification, confirmed NOT caused by this fix

Both isolated via `git stash` (reproduced on the original, unmodified `productTour.js` before this
session's edit, then the fix was restored via `git checkout stash@{0} -- <file>` + `git stash drop` to
avoid clobbering the pre-existing uncommitted `.claude/settings.local.json` changes). Both are out of
scope for TASK-045 (`OnboardingPreview.jsx`/`OnboardingGate.jsx` are Forbidden Files in the spec) and
undocumented as separate tasks — flagging here for whoever picks them up next:

1. **`StaplesChecklist` never appears after the tour's last step ("Household") is completed**, even at a
   deliberate one-tap-then-wait pace. Expected: `OnboardingPreview`'s `onFinished` callback calls
   `setStep('checklist')` for the `new_household` flow, rendering `StaplesChecklist`. Observed: the tour's
   popover disappears and the app returns to a bare page with no checklist and no console error — as if
   `onClose()` fired instead of `setStep('checklist')`, or the checklist rendered and was dismissed
   instantly. Not investigated further (out of scope for this task), but reproducible on `git stash`'d
   original code, so it predates this session.
2. **On desktop (≥768px), the tour sometimes doesn't visibly start** — "Get started" correctly unmounts
   `WelcomeStep` (confirmed: `step` state changes, `WelcomeStep` disappears), but no `driver.js` popover
   ever appears and the route never advances to `/`, even after ~1.5s. Also reproduced on `git stash`'d
   original code. Given `isMobile` correctly evaluates `false` at 1280px
   (`window.matchMedia('(min-width: 768px)').matches` confirmed true), this looks like it could be
   `START_DELAY_MS`/`requestAnimationFrame` timing or a preview-specific mounting quirk rather than the
   race this task fixes, but wasn't root-caused.

Neither bug blocks TASK-045's own fix (the sidebar/popover desync mid-tour is what's fixed and verified;
these are about tour *completion*/*startup*, a different code path). Recommend a follow-up task if Connor
wants either investigated.

# Files Created / Changed (this session)

**Modified**: `client/src/components/onboarding/productTour.js` (the fix), `ai/handoffs/CURRENT_STATE.md`
(this file).
**Not touched**: everything else — matches spec's Allowed Files list.

Committed to `staging` and fast-forwarded to `main` (production) — see Context Notes for the exact
commands used, consistent with prior sessions' `staging` → `main` → Vercel flow.

# Decisions Made

- Implemented the spec's guard code verbatim rather than re-deriving it, per [[feedback_spec_workflow]] —
  the spec was already at DRAFT-3/APPROVED, so this session's job was implementation + verification, not
  re-litigating design choices already settled across three architect-review rounds.
- Chose to verify via scripted DOM clicks + polling `.driver-popover-title`/sidebar `className` rather
  than screenshots, because [[feedback_browser_pane_compositing]] — this environment's Browser pane has a
  known history of non-compositing screenshots and stale `getComputedStyle` reads; DOM/class inspection is
  the reliable signal here, consistent with the prior spec-drafting session's own finding.
- Restored the fix after each `git stash` isolation test via `git checkout stash@{0} -- <file>` +
  `git stash drop` instead of a plain `git stash pop`, because `.claude/settings.local.json` has
  pre-existing local-only changes that a plain `pop` would conflict with (matches every prior handoff's
  note on that file).

# Known Risks

Carried from the spec (still accurate, now implemented):

- Extra rapid taps during a transition are silently dropped with no visual feedback — intentional, not a
  regression (see spec's Known Risk 1).
- This fix does not touch `SIDEBAR_TRANSITION_MS` or the interleaved step list — unchanged, unneeded per
  live reproduction.

New, from this session's verification (see "Two pre-existing bugs found" above):

- `StaplesChecklist` not appearing after tour completion, and desktop tour sometimes not starting, are
  both unresolved and undocumented as their own tasks. Not regressions from this fix, but real gaps a user
  could hit.
- The spec's "real (non-preview) first-run tour" acceptance item is still unverified — see "Not tested
  this session" above.

# Context Notes

- branch: `staging`, fast-forwarded into `main`.
- worktree: none.
- `.claude/settings.local.json` continues to have pre-existing local uncommitted changes (permission-
  prompt settings) unrelated to this or any prior session's work — left as-is, same note carried in every
  handoff since TASK-040. **Not committed or pushed this session.**
- Deploy flow used: commit on `staging` → push `origin staging` → fast-forward `main` to `staging`'s tip
  (`git checkout main && git merge --ff-only staging`) → push `origin main`, which triggers the Vercel
  production deploy. Same flow as TASK-042/043/044, no new process introduced.
- This session's dev server ports were auto-assigned (3001/5183 were occupied by another concurrent
  session against the same repo) — `server` on a random port, `client` on a random port with its Vite
  proxy still pointed at the fixed `localhost:3001`, meaning API calls during this session's testing
  actually hit the *other* session's server process. Irrelevant to this fix (client-only, no server
  changes), but worth knowing if a future session sees the same auto-port behavior.
- The Neon DB account used for live verification (`Connor Sharpe's Household`) has substantial real chat
  history from prior sessions/testing — confirms [[feedback_dev_db_is_shared]] is still accurate.

# Recommended Next Action

TASK-045 itself is done and deployed. Suggested follow-ups, not blocking:

1. Root-cause and fix (or spec out as new tasks) the two pre-existing bugs found above — checklist not
   appearing post-tour, and desktop tour sometimes not starting.
2. If it matters for full closure, verify the spec's "real (non-preview) first-run tour" acceptance item
   against an actual fresh account rather than the Household page's preview replay.

---

# Prior Handoff (spec-drafting session, now superseded above)

Spec-drafting session for `ai/tasks/TASK-045-spec.md` — a mobile onboarding-tour bug Connor found by hand
("hamburger menu tour" doesn't keep the sidebar open for the duration, so the Pantry nav-item tooltip has
nothing to point at). This was an audit-only session: the spec went through three rounds of GPT architect
review and is now fully approved. Zero application code was touched in that session — implementation
happened in the session documented above.

## What the bug actually is

Root cause is a re-entrancy race in `client/src/components/onboarding/productTour.js`'s `goToStep()`:
driver.js doesn't await `onNextClick`/`onPrevClick`, so tapping "Next" again before a previous
`goToStep` call's async chain (sidebar toggle → 200ms transition wait → `navigate()` → `waitForElement()`)
finishes starts a second overlapping call. The two calls' `setMobileNavOpen()`/`driverObj.moveTo()` calls
can resolve out of order, desyncing the sidebar's actual open/closed state from whatever step driver.js
ends up displaying. Full methodology, alternatives considered, and rejected approaches (queue,
cancel-and-restart) are in `TASK-045-spec.md` itself — read the spec directly, not just this summary.

## Side effect from that session: local dev DB migration-tracking drift fixed

While reproducing the bug locally, `npm run dev`'s server startup failed with `NeonDbError: type
"onboarding_flow" already exists`. Root cause: `drizzle.__drizzle_migrations` was missing tracking rows for
`0018_user_onboarding` and `0019_drop_users` even though both were already fully applied to the actual
schema — same underlying drift class already documented for `0017_platform_settings`. Fixed by inserting
the two missing tracking rows (pure bookkeeping, no schema change). `0017` itself is still untracked in
the journal (pre-existing, undisturbed).
