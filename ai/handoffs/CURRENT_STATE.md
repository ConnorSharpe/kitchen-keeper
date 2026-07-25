# Task

Implementation session for `ai/tasks/TASK-046-spec.md` — fix two pre-existing onboarding-tour
completion bugs found during TASK-045's own verification (see prior handoff below the divider):
`StaplesChecklist` never appearing after the last tour step, and the desktop tour sometimes not
starting. The spec went through two rounds of GPT architect review (9.6/10 → 9.9/10 APPROVED) in this
same session before implementation. **Implemented and live-verified this session.**

# Current Status

**Implementation: DONE.** Both fixes are in `client/src/components/onboarding/productTour.js`.
**Committed and pushed to `staging` and `main` (production).**

## What was implemented

One file, `client/src/components/onboarding/productTour.js`:

1. **Bug 1 (checklist not appearing):** root-caused by reading `driver.js`'s own bundled source
   (`client/node_modules/driver.js/dist/driver.js.mjs`, `^1.8.0`) — its public `destroy()` only fires
   the configured `onDestroyed` callback if two internal, double-underscore-prefixed state fields are
   already populated, and those aren't set until a step's CSS transition fully completes (confirmed:
   400ms default duration), even though the popover is already visually in place around the halfway
   point. Calling `destroy()` in that ~200ms gap — exactly what happens clicking "Done" as soon as the
   last step's popover looks ready — tears down the UI but silently skips `onDestroyed`, so the tour
   never completes. Fix: added a `finished` idempotency guard (same pattern as TASK-045's
   `isAdvancing`) and call `finish()` directly, before `driverObj.destroy()`, at all five places in this
   file that end the tour (`goToStep`'s `!target`/`!found`/`catch` branches, `onHighlightStarted`,
   `onPopState`) — no longer depending on `driver.js`'s internal transition-settle timing for
   `onDestroyed` to fire. `onDestroyed: finish` stays wired for the × button/Escape, which route through
   `driver.js` internally with no call site of ours to attach to.
2. **Bug 2 (desktop tour sometimes not starting):** the desktop bootstrap was gated behind
   `requestAnimationFrame(() => setTimeout(start, START_DELAY_MS))`. `requestAnimationFrame` doesn't
   run at all while the tab is backgrounded (confirmed live this session, see Verification below) —
   swapped to a plain `setTimeout(start, START_DELAY_MS)`, which is at most throttled, never
   indefinitely paused.

## Verification performed (live, this session)

Same DOM/JS-level approach as TASK-045's session, not screenshots — see
[[feedback_browser_pane_compositing]]. Ran against local dev via Household → "Preview: new
household"/"Preview: joined household":

- **Bug 1**: completed the `new_household` preview tour to the last step ("Household") at a deliberate
  pace, 6+ times back-to-back — `StaplesChecklist` appeared every time (previously never did). No
  degradation or errors across repeated runs.
- **Back-button-after-completion**: pressed browser Back immediately after reaching the checklist — no
  console errors, confirming the `popstate` listener was actually removed by `finish()`.
- **Bug 2, with direct live proof**: this session's Browser pane tab reports `document.hidden === true`
  even while being actively driven. Confirmed live that a `requestAnimationFrame` callback never fired
  in 3 full seconds under that condition, while a `setTimeout` callback fired immediately — the exact
  mechanism the spec predicted, now empirically observed rather than just inferred from research. With
  the fix, the desktop (1280×800) tour started reliably (popover + route change) despite `document.hidden`
  staying `true` throughout.
- **TASK-045 regression check**: rapid 80ms-apart taps still show no sidebar/tooltip desync, and the
  tour still completes correctly (checklist shown) after a rapid burst — the `finished` guard doesn't
  interact badly with `isAdvancing`.
- **"joined" flow**: completes and returns to the Household page correctly (the other `onFinished`
  branch — calls `onClose()`, not `setStep('checklist')` — unaffected by either fix).
- No console errors observed across the entire session.

**Not tested this session** (same class of deferral as TASK-045's own handoff): the × close button and
Escape key (still `onDestroyed`-dependent by design — see Known Risks in the spec), and the real
(non-preview) fresh-account first-run tour (would require a throwaway account against the shared dev
DB — [[feedback_dev_db_is_shared]] — same deferral TASK-045 already made).

# Files Created / Changed (this session)

**Created**: `ai/tasks/TASK-046-spec.md` (spec, DRAFT-1 → DRAFT-3/APPROVED across two architect review
rounds).
**Modified**: `client/src/components/onboarding/productTour.js` (both fixes), `ai/handoffs/CURRENT_STATE.md`
(this file).
**Not touched**: `OnboardingGate.jsx`, `OnboardingPreview.jsx`, `StaplesChecklist.jsx`,
`HouseholdPage.jsx`, `AppLayout.jsx`, `Sidebar.jsx` — all read to rule out alternative causes per the
spec's Ruled Out section, none needed changes.

Committed to `staging` and fast-forwarded to `main` (production) — same `staging` → `main` → Vercel flow
as every prior session since TASK-042.

# Decisions Made

- Implemented the spec's design verbatim (dependency inversion: application owns completion, `driver.js`
  owns presentation) rather than re-deriving it, per [[feedback_spec_workflow]] — the spec was already
  DRAFT-3/APPROVED going into this session.
- Generalized the `finished`-guard fix to all five `driverObj.destroy()` call sites in the file, not just
  the one Bug 1's repro reaches — settled during architect review as one architectural pattern replaced
  consistently, not scope creep (see spec's "Resolved During Review" section).
- Declined a `document.hidden`/`visibilitychange`-based fallback for Bug 2 in favor of the simpler plain
  `setTimeout` swap — no demonstrated production need beyond what the simpler fix already resolves (spec's
  "Considered and declined" section).
- Reused the same DOM/JS-level verification approach as TASK-045 rather than screenshots, per
  [[feedback_browser_pane_compositing]] — this session additionally used that same environment quirk
  (`document.hidden === true` in this Browser pane) as direct empirical confirmation of Bug 2's root
  cause, rather than working around it.

# Known Risks

Carried from the spec (still accurate, now implemented):

- The × close button and Escape key still depend on `driver.js`'s own `onDestroyed` wiring, not a direct
  `finish()` call — those triggers are handled entirely inside `driver.js` without ever calling back into
  this file's code. Same underlying `driver.js` quirk could theoretically still affect those two paths;
  not reported as an actual bug, deferred as a follow-up if ever observed (would require configuring
  `onCloseClick`).
- The real (non-preview) first-run tour's completion path is still unverified against an actual fresh
  account — same unresolved item carried from TASK-045's own handoff, now doubly relevant since this
  task touches the same completion path.

# Context Notes

- branch: `staging`, fast-forwarded into `main`.
- worktree: none.
- `.claude/settings.local.json` continues to have pre-existing local uncommitted changes (permission-
  prompt settings) unrelated to this or any prior session's work — left as-is, same note carried in every
  handoff since TASK-040. **Not committed or pushed this session.**
- Deploy flow used: commit on `staging` → push `origin staging` → fast-forward `main` to `staging`'s tip
  (`git checkout main && git merge --ff-only staging`) → push `origin main`, which triggers the Vercel
  production deploy. Same flow as TASK-042 through TASK-045, no new process introduced.
- This session reused an already-running `server` process on port 3001 (left over from a concurrent
  session against the same repo, confirmed healthy via `/api/health`) rather than starting a redundant
  second server instance, since the client's Vite proxy is hardcoded to `localhost:3001` regardless of
  which port the client dev server itself lands on. Matches the port-conflict behavior TASK-045's handoff
  already flagged as something to expect in this environment.
- The Neon DB account used for live verification (`Connor Sharpe's Household`) has substantial real chat
  history from prior sessions/testing — confirms [[feedback_dev_db_is_shared]] is still accurate.

# Recommended Next Action

TASK-046 itself is done and deployed. Suggested follow-ups, not blocking:

1. If it matters for full closure, verify the real (non-preview) first-run tour's completion path
   against an actual fresh account — carried over from TASK-045, still open.
2. Bring the × close button / Escape key under the same direct-`finish()` pattern (configuring
   `onCloseClick`) only if the underlying `driver.js` timing quirk is ever actually observed on those
   paths — currently theoretical, not reported.

---

# Prior Handoff (TASK-045 implementation session, now superseded above)

Implementation session for `ai/tasks/TASK-045-spec.md` — fix the mobile onboarding-tour sidebar
desync race on rapid Next/Prev taps. The spec was DRAFT-3/10-10/APPROVED FOR IMPLEMENTATION going into
this session (see prior handoff below the divider). **Implemented and live-verified this session.**

## What was implemented

One file, `client/src/components/onboarding/productTour.js`: `goToStep` now tracks a closure-scoped
`isAdvancing` boolean. A call that arrives while a prior one is still in flight returns immediately
(dropped, not queued). The whole body is wrapped in `try/catch/finally`: `finally` always clears the flag
(guarantees the tour can't permanently wedge even on an early return), and `catch` ends the tour cleanly
on any unexpected exception (`finish()` if `isInitial`, else `driverObj.destroy()`) instead of leaving an
unhandled promise rejection with the tour frozen mid-step. No other file was touched — matches the spec's
Allowed/Forbidden Files list exactly.

## Two pre-existing bugs found during verification, confirmed NOT caused by this fix

Both isolated via `git stash` (reproduced on the original, unmodified `productTour.js` before this
session's edit). Both are now fixed — see TASK-046 above:

1. `StaplesChecklist` never appears after the tour's last step ("Household") is completed.
2. On desktop (≥768px), the tour sometimes doesn't visibly start.

## Side effect from that session: local dev DB migration-tracking drift fixed

While reproducing the bug locally, `npm run dev`'s server startup failed with `NeonDbError: type
"onboarding_flow" already exists`. Root cause: `drizzle.__drizzle_migrations` was missing tracking rows for
`0018_user_onboarding` and `0019_drop_users` even though both were already fully applied to the actual
schema — same underlying drift class already documented for `0017_platform_settings`. Fixed by inserting
the two missing tracking rows (pure bookkeeping, no schema change). `0017` itself is still untracked in
the journal (pre-existing, undisturbed).
