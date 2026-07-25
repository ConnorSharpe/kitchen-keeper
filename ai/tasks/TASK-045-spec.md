# TASK-045 — Fix Mobile Tour Sidebar Desync on Rapid Next/Prev Taps

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.4/10 — approve with one minor revision | Praised: disciplined elimination of alternative root causes (crash, CSS timing, driver.js behavior, interleaved design) before landing on the actual async race; single-file/single-closure-variable implementation scope; behavior-oriented acceptance criteria; the guard-vs-queue and guard-vs-cancel-and-restart tradeoffs already documented in DRAFT-1. Required: specify what happens when `goToStep` throws unexpectedly (`navigate()`, `driverObj.moveTo()`/`drive()`, `waitForElement()` all as candidates) — DRAFT-1 correctly cleared `isAdvancing` via `finally` but left the tour's resulting state undefined. Non-blocking suggestions: state explicitly that rapid taps are *intentionally* dropped during a transition (the tour behaves like a temporarily disabled wizard) rather than leaving that as an implied side effect of the guard; add an acceptance criterion confirming Skip/Close/ESC still work if triggered mid-transition, since a re-entrancy guard *could* accidentally block a termination path if it shared code with `goToStep` (on inspection here it doesn't — driver.js's own `destroy()` handles those independently — but worth verifying empirically rather than asserting from a code read); reword "ignore the new call outright" to name user intent, not just implementation. |
| DRAFT-2 | 9.9/10 — approved pending one documentation check | Confirmed the exception policy, the explicit "temporarily disabled wizard" framing, and the new Skip/Close/Escape acceptance criterion all resolved round 1's concerns. Raised one follow-up: the claim that the new `catch` block "matches this file's existing convention" of ending the tour on any anomaly should be verified against every actual abnormal exit path in the file, not asserted — flagged as a documentation-accuracy check, not a design objection. Also raised, explicitly as an optional enhancement rather than a required change: whether the `catch` block's `console.error` should instead (or also) flow through TASK-044's `/api/client-errors` reporting pipeline for better observability. |
| DRAFT-3 | 10/10 — APPROVED FOR IMPLEMENTATION | Confirmed the round-2 convention audit turns the "matches existing convention" claim into a proven argument rather than an assertion, including that the `abortController` checks and the unreachable `!target`/`isInitial` case were correctly identified as non-counterexamples. Confirmed the TASK-044 reporting decision as sound scope discipline: different failure domain (async orchestration vs. React render/lifecycle), and adding a second reporting path would expand scope while introducing a new failure mode inside the handler itself. No further changes requested — implementation surface, design choices (guard over queue/cancel-restart, terminate-on-exception, documented intentional tap-dropping), and acceptance criteria all stand as written. |

---

## Bug Report — What Actually Happened

Connor reported that on a phone, taking the first-run product tour of the hamburger main menu, the
sidebar "does not stay open for the duration of the menu tour," so by the time the tour reaches the
Pantry nav-item tooltip, there's no sidebar visible for it to point at. Per his own account, once this
happened the sidebar stayed closed for the rest of the tour (not just a one-step flicker), and the app
otherwise behaved normally — no crash, no fallback screen, pages still navigated fine.

That last detail ruled out the most serious alternative explanation: [TASK-044-spec.md](TASK-044-spec.md)
documented an unreproduced full-page crash on the Pantry page during a different onboarding session the
day before, and TASK-044 shipped crash reporting specifically so a repeat would be diagnosable. If this
bug were that crash recurring, `ErrorBoundary` (wraps the whole app — [App.jsx:34](../../client/src/App.jsx:34))
would have unmounted the sidebar entirely and shown "Something went wrong." Connor confirmed he saw
neither — the app stayed normal, just without a sidebar. So this is a separate, tour-specific bug.

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| The tour driver | `client/src/components/onboarding/productTour.js` | `runProductTour()` builds a `driver.js` instance over an interleaved step list — nav items (`nav-chat`, `nav-dashboard`, `nav-pantry`, `nav-recipes`, `nav-shopping`, `nav-household`) mixed with page-content items (`scan-receipt`, `add-item`, `upload-recipe-image`, etc.). `isNavStep()` decides which steps need the mobile sidebar open. |
| The advance function | `productTour.js`'s `goToStep(targetIndex, isInitial)` | Called from `onNextClick`/`onPrevClick`. On mobile, it: calls `setMobileNavOpen(showSidebar)`, awaits a 200ms `setTimeout` (matches `Sidebar.jsx`'s `duration-200` CSS transition) if opening, then `navigate()`s to the step's route if needed, then `await waitForElement(...)`, then calls `driverObj.moveTo()`/`drive()`. This is a multi-await async chain with **no re-entrancy guard**. |
| Where the sidebar's open state lives | `client/src/components/layout/AppLayout.jsx:9` | `mobileNavOpen`/`setMobileNavOpen` — a single `useState` passed to both `Sidebar` and (via `OnboardingGate`/`OnboardingPreview`) to the running tour. |
| Live reproduction | `HouseholdPage.jsx`'s "Preview onboarding" → "Preview: new household" (calls `OnboardingPreview`, which reuses `runProductTour` exactly, side-effect-free) | Used to reproduce this against local dev at a 375×812 mobile viewport, by scripting rapid clicks on driver.js's own `.driver-popover-next-btn`. |

### Confirmed root cause: overlapping `goToStep` calls race each other

`onNextClick`/`onPrevClick` are not awaited by driver.js — they're fire-and-forget from its perspective.
Nothing on our side stops a second `goToStep` call from starting while an earlier one is still mid-flight
in its 200ms sidebar-transition wait, its `navigate()`, or its `waitForElement()`. When that happens, two
overlapping calls' `setMobileNavOpen(...)` and `driverObj.moveTo(...)` calls can resolve out of order,
leaving the sidebar's actual open/closed state desynced from whichever step driver.js ends up displaying.

**Reproduced live** by scripting rapid `.driver-popover-next-btn` clicks (80ms apart — faster than the
200ms sidebar transition the code waits out) against the mobile-viewport `OnboardingPreview` replay:

```
after-click-6:  popover="Pantry", sidebar=CLOSED   <-- the reported bug, reproduced exactly
after-click-7:  popover="Pantry", sidebar=CLOSED
after-click-10: popover="Add an item", sidebar=OPEN <-- the inverse desync also occurs
```

At a deliberate, one-click-then-wait pace, the same script showed the sidebar correctly OPEN for every
nav step and CLOSED for every page-content step — the interleaved design itself is correct. The bug only
appears under rapid tapping, which is an entirely ordinary way for someone to move through a tour on a
phone, especially past steps whose nav item they already understand.

This also explains "stayed closed" rather than "flickered once": nothing re-synchronizes the sidebar
state to the currently-displayed step after a desync — whichever overlapping call's `setMobileNavOpen`
happens to resolve last simply wins and sticks, regardless of which step driver.js is actually showing
by the time the user stops tapping.

### Ruled out

- **The TASK-044 Pantry crash** — see Bug Report above; Connor confirmed no crash screen appeared.
- **The interleaved nav/content step design itself** — reproduced as working correctly at a normal pace;
  this is not a request to stop interleaving nav items with their page actions.
- **A fixed-timeout/CSS-transition-timing race** (the original hypothesis before reproduction) — the
  200ms wait is long enough at a deliberate pace; the actual trigger is re-entrancy, not the wait
  duration itself.

---

## Decision: Add a re-entrancy guard to `goToStep`

**Recommendation: track an in-flight flag inside `runProductTour`'s closure. While a transition is
already in progress, ignore additional Next/Prev requests rather than let them race it.**

```js
let isAdvancing = false;

async function goToStep(targetIndex, isInitial = false) {
  if (isAdvancing) return; // a transition is already in flight — drop this tap rather than race it
  isAdvancing = true;
  try {
    const target = STEPS[targetIndex];
    if (!target) {
      if (!isInitial) driverObj.destroy();
      return;
    }

    const showSidebar = isMobile && isNavStep(target);
    if (isMobile) {
      setMobileNavOpen?.(showSidebar);
      if (showSidebar) {
        await new Promise((resolve) => setTimeout(resolve, SIDEBAR_TRANSITION_MS));
        if (abortController.signal.aborted) return;
      }
    }

    if (target.route !== window.location.pathname) navigate?.(target.route);

    const found = await waitForElement(target.element, {
      timeoutMs: WAIT_FOR_ELEMENT_TIMEOUT_MS,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) return;

    if (!found) {
      if (isInitial) finish();
      else driverObj.destroy();
      return;
    }

    if (isInitial) driverObj.drive(targetIndex);
    else driverObj.moveTo(targetIndex);
  } catch (err) {
    // Matches this file's existing convention of ending the tour cleanly on any
    // anomaly (see the not-found-element path above, onHighlightStarted's route
    // check, and onPopState) rather than leaving it in an undefined state — an
    // unexpected throw here (driver.js internals, a torn-down DOM mid-navigation)
    // is just one more anomaly class, not a special case (architect review round 1).
    console.error('[productTour] goToStep failed, ending tour:', err);
    if (isInitial) finish();
    else driverObj.destroy();
  } finally {
    isAdvancing = false;
  }
}
```

### Why a drop-the-tap guard, not a queue or a cancel-and-restart

A guided tour has a small, fixed number of steps and each transition is sub-second — there's no real cost
to a user's extra rapid taps being silently absorbed while the current transition finishes, and the very
next tap (once `isAdvancing` clears) advances normally. Queuing taps or cancelling-and-restarting
in-flight work would fix the same race but add meaningfully more state to reason about (a queue of
pending indices, or an abort-and-recompute path distinct from the tour-ending abort this file already
has) for a problem a simple boolean fully closes. This matches the single async chain `goToStep` already
is — the guard wraps the existing function rather than restructuring it.

This is a deliberate design principle, not just a side effect of the implementation: **the tour
intentionally behaves like a temporarily disabled wizard during each transition.** Taps that land while
`isAdvancing` is true are absorbed, not queued or replayed — the tour always reflects the most recent tap
it had a chance to start acting on, never a backlog of taps the user has since lost interest in.

### Why `finally`, not clearing the flag at each return point

`goToStep` has four separate early-return points (missing target, aborted after the sidebar wait, aborted
after `waitForElement`, element not found) plus its normal completion. A `finally` block guarantees
`isAdvancing` clears on every one of those paths without having to remember to reset it at each one
individually — missing even one would permanently wedge the tour (every subsequent tap silently dropped
forever, not just the desync this task fixes).

### Why unexpected exceptions destroy the tour instead of propagating uncaught

`goToStep` isn't awaited by driver.js (`onNextClick`/`onPrevClick` are fire-and-forget from its side), so
an uncaught throw here would become a silent unhandled promise rejection — `isAdvancing` would still clear
correctly via `finally`, but the tour itself would be left frozen mid-step: whatever popover/overlay
driver.js last rendered stays on screen, and the sidebar stays in whatever state the last successful call
left it, with no user-visible indication anything went wrong. That's a worse failure mode than the bug
this task fixes. Catching and destroying matches every other anomaly path already in this file — it's
extending an existing convention, not introducing a new one.

**Verified, not just asserted (architect review round 2):** every abnormal exit path in `productTour.js`
was re-inspected to confirm this claim is literally true, not just plausible:

| Path | Outcome |
|---|---|
| `waitForElement` timeout (`!found` in `goToStep`) | Ends the tour (`finish()` if `isInitial`, else `driverObj.destroy()`) |
| Route diverges from the active step (`onHighlightStarted`) | `driverObj.destroy()` |
| Route diverges via a native back-press (`onPopState`) | `driverObj.destroy()` |
| Unexpected throw in `goToStep` (this task's new `catch`) | `finish()` if `isInitial`, else `driverObj.destroy()` |

No path retries, silently ignores, or leaves the tour running past an anomaly — confirming Case A from the
round-2 review, not Case B. The two `if (abortController.signal.aborted) return;` checks inside `goToStep`
are **not** a fifth, competing policy: `abortController.abort()` only ever runs inside `finish()`, which
only ever runs after one of the four paths above has already ended the tour, so these checks are pure
idempotency guards against continuing work post-termination, not a separate anomaly-handling branch. One
edge case exists on paper — `goToStep`'s `if (!target)` branch calls neither `finish()` nor `destroy()`
when `isInitial` is simultaneously true (i.e. `STEPS[0]` itself is missing) — but `STEPS` is a non-empty
hardcoded constant (11 entries), so `STEPS[0]` is always defined and this branch is provably unreachable
at runtime, exactly as the file's own existing comment already states ("not reachable in practice"). Not a
real counterexample to the convention.

### Why `console.error`, not TASK-044's `/api/client-errors` reporting pipeline (round 2, considered and declined)

TASK-044 wired crash reporting into `ErrorBoundary.componentDidCatch` specifically — a React error
boundary catching synchronous render/lifecycle exceptions. React error boundaries do not catch errors
thrown from event handlers or from code running after an `await` in an async function, so this `catch`
block was never going to be something `ErrorBoundary`/`/api/client-errors` would have caught anyway; it's
a different failure domain (an onboarding-tour orchestration hiccup), not the class of app-wide render
crash that pipeline exists for. Wiring a second, duplicate `fetch('/api/client-errors', ...)` call into
this file — the exact pattern already living in `ErrorBoundary.jsx` — would also expand this task's scope
beyond the race-condition fix it's targeting, and would introduce a new failure mode (a `fetch` call that
can itself throw or hang) inside a `catch` block that's meant to stay simple and safe. `console.error` is
sufficient here for the same reason TASK-044 judged it sufficient generally: this is a small project,
`vercel logs` is the existing diagnostic tool, and this failure is non-user-blocking (the tour ends
cleanly; the rest of the app is unaffected) rather than the app-breaking case that motivated `/api/client-errors`
in the first place. If this `catch` is ever observed firing in real logs, that would be the trigger to
reconsider — not a reason to add the machinery speculatively now.

---

## What Does NOT Change

- The interleaved step list (`STEPS`) itself — nav items and page-content items stay mixed exactly as
  designed; reproduction confirmed this design works correctly once the race is fixed.
- `SIDEBAR_TRANSITION_MS` / the fixed 200ms wait — not the trigger for this bug (see Ruled Out above); no
  evidence it needs to change.
- `onPopState`'s back-button handling — independent of `goToStep`'s call stack, untouched.
- `OnboardingGate.jsx`, `OnboardingPreview.jsx`, `AppLayout.jsx`, `Sidebar.jsx` — none of them are where
  the race lives; `mobileNavOpen` state management itself is correct, it's just being fed conflicting
  calls in the wrong order.

## Allowed Files

- `client/src/components/onboarding/productTour.js` — add the `isAdvancing` guard to `goToStep`.

## Forbidden Files

- `client/src/components/layout/Sidebar.jsx`, `AppLayout.jsx` — sidebar state management is correct;
  no changes needed here.
- `client/src/components/onboarding/OnboardingGate.jsx`, `OnboardingPreview.jsx` — both just call
  `runProductTour()`; the fix is entirely inside that function.
- `client/src/components/layout/ErrorBoundary.jsx`, `server/routes/clientErrors.js` — unrelated to this
  bug (see Bug Report — Pantry crash was ruled out).

---

## Dependency Chain

Editing:
- `client/src/components/onboarding/productTour.js`

Reads (pattern reference only, do not modify):
- `client/src/components/layout/AppLayout.jsx` — confirms `mobileNavOpen` is a single shared `useState`,
  not per-consumer state that could itself be the desync source.
- `client/src/components/layout/Sidebar.jsx` — confirms the `mobileOpen` prop maps directly to the
  `translate-x-0` / `-translate-x-full` class, i.e. that fixing the caller's state is sufficient without
  any change here.
- `client/src/pages/HouseholdPage.jsx` — the "Preview: new household" replay button, used for
  verification (see Acceptance Criteria).

Irrelevant:
- Everything under `server/` — this is a client-only timing bug.

---

## Acceptance Criteria

Given this project verifies via live smoke testing rather than an automated test suite (per
TASK-024/025/026/043/044 precedent), exercise the following manually against local dev, at a 375px-wide
(or narrower) viewport, via Household → "Preview: new household":

- [ ] Tapping Next at a deliberate pace (waiting for each tooltip to render before tapping again) shows
      the sidebar open for every nav-item step (Chat, Dashboard, Pantry, Recipes, Shopping, Household) and
      closed for every page-content step (Scan a receipt, Add an item, Upload a recipe photo, Import from
      a URL, Find recipes online) — unchanged from current behavior, confirms no regression.
- [ ] Tapping Next rapidly (faster than ~200ms apart) through the whole tour never shows a nav-item
      tooltip (e.g. "Pantry") with the sidebar closed, and never shows a page-content tooltip with the
      sidebar open — the specific desync reproduced during this investigation.
- [ ] Rapidly tapping Next does not "skip" more than one step per actual tap once settled — i.e. dropped
      taps don't advance the tour further than the user actually tapped, only slower than raw tap count.
- [ ] Rapidly tapping Prev (after reaching a later step) shows the same guard behavior in reverse — no
      sidebar/tooltip desync when reversing quickly.
- [ ] Mixing rapid Next and Prev taps does not wedge the tour (Next still works normally after a rapid
      burst ends).
- [ ] Skip / the driver.js close (×) button / Escape still exit the tour immediately even when triggered
      while a transition is in flight (`isAdvancing` is true) — confirms the guard doesn't accidentally
      block a termination path (architect review round 1; expected to pass since these route through
      driver.js's own `destroy()` handling, entirely outside `goToStep`, but worth confirming directly).
- [ ] The real (non-preview) first-run tour — a fresh account via `new_household` or `joined` flow — still
      completes normally at both a deliberate and a rapid pace.
- [ ] Desktop tour behavior (≥768px viewport) is unchanged — no sidebar involved there, but confirm the
      guard doesn't introduce a new drop/skip issue for desktop's own rapid-click case.

---

## Known Risks / Implementation Notes

1. **Extra rapid taps are silently dropped, with no visual feedback.** Driver.js's Next/Prev buttons
   don't show a disabled/busy state while `isAdvancing` is true, so a user tapping rapidly won't see
   *why* some taps didn't register — only that the tour advances slightly slower than their tap count.
   The drop window is normally sub-second (bounded by `SIDEBAR_TRANSITION_MS` plus however long
   `navigate()`/`waitForElement()` take to settle) but is bounded above by `WAIT_FOR_ELEMENT_TIMEOUT_MS`
   (2000ms) in the pathological case where `waitForElement` runs all the way to its timeout — taps during
   that window are dropped too, same as any other in-flight transition (architect review round 1). Judged
   acceptable: the tour is short, taps aren't lost forever (the next one after the guard clears works
   normally), and wiring a visual disabled state through driver.js's config for this window is more
   machinery than this bug warrants. Revisit only if this becomes a reported complaint on its own.
2. **This fix is scoped to the race, not to `SIDEBAR_TRANSITION_MS` itself.** If a future device/browser
   turns out to need longer than 200ms to complete the CSS transition even without any tap race, that
   would be a separate, currently unobserved bug — see Ruled Out above for why this task doesn't touch it.

## Out of Scope (v1)

- Visual disabled/busy state on driver.js's Next/Prev buttons during a transition — see Known Risk 1.
- Any change to which steps are interleaved or how `isNavStep()` classifies them — the design itself
  reproduced correctly at a deliberate pace.
- Revisiting `SIDEBAR_TRANSITION_MS`'s value — no evidence it's wrong, only that it can be raced.
