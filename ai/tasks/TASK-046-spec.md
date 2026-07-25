# TASK-046 — Fix Two Pre-Existing Onboarding-Tour Completion Bugs

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.6/10 — approve after one revision | Confirmed both root-cause investigations, praised the dependency-inversion framing of the Bug 1 fix (own callback owns lifecycle, not `driver.js` timing) and the scope discipline. Required: run `finish()` before `driverObj.destroy()` at each call site (roll forward app state before third-party teardown, so a `destroy()` throw can't leave the app stuck); document `finish()`'s idempotency contract explicitly (`finished` commits before `onFinished()` runs, deliberately); confirm `destroy()` is synchronous; reword "may never fire" to "does not execute while backgrounded, preventing bootstrap until visibility returns" for `requestAnimationFrame`; promote "update all 5 destroy call sites" from an open question to a settled decision; add acceptance criteria for repeated tour runs and Back-button-after-completion. Also suggested dropping the proposed runtime `__activeStep` log as philosophically inconsistent with the fix's own dependency-inversion — accepted the outcome (removed) but for a different, stronger reason: re-checking the source turned up the actual `duration` default (400ms, `getConfig('duration')||400`), converting Known Risk 2 from "untraced, verify empirically" into a confirmed fact, which is what actually made the runtime check unnecessary. |
| DRAFT-2 | 9.9/10 — APPROVED | Confirmed all round-1 revisions land correctly, in particular that the ordering fix is now backed by an explicit architectural argument (application owns completion, library owns presentation) rather than just being a reordered call. No blocking changes. Two optional, non-blocking documentation enhancements requested and applied: (1) state explicitly, next to the "if `destroy()` were to throw" note, that this intentionally trades a recoverable cosmetic leak (a stray overlay element) for guaranteed onboarding completion, rather than leaving that tradeoff merely implied; (2) quantify Known Risk 1 — this task reduces the number of lifecycle-completion paths that depend on `driver.js`'s own `onDestroyed` timing from five (all of them, previously) to two (Escape and the × button, both entirely library-internal with no call site of ours to attach to). Neither changes any code decision, both are framing/documentation polish for future readers. |

---

## Bug Report — What Actually Happened

Both bugs were found (not by Connor, but during live verification of [TASK-045](TASK-045-spec.md)'s
sidebar-race fix) and are documented in `ai/handoffs/CURRENT_STATE.md`'s "Two pre-existing bugs found
during verification" section. Both were confirmed via `git stash` to reproduce on the **original,
unmodified** `productTour.js`, i.e. neither is a regression from TASK-045 — they predate it and are
independent of the re-entrancy guard that task added.

1. **`StaplesChecklist` never appears after the tour's last step ("Household") is completed**, even at a
   deliberate one-tap-then-wait pace. The tour's popover disappears and the app returns to a bare page —
   no checklist, no console error. Reproduced via `HouseholdPage.jsx`'s "Preview: new household" replay at
   a 375×812 mobile viewport.
2. **On desktop (≥768px), the tour sometimes doesn't visibly start.** "Get started" correctly unmounts
   `WelcomeStep` (confirmed via DOM/state inspection), but no `driver.js` popover ever appears and the
   route never advances, even after ~1.5s. `isMobile` was confirmed to correctly evaluate `false` at
   1280px. Flagged by the prior session as "inconclusive by observation, not confirmed a regression" —
   not root-caused at the time.

This task investigates both from scratch (static code + library-source analysis, corroborated by web
research on the relevant browser/library behaviors — this environment's shared dev DB and prior sessions'
[[feedback_dev_db_is_shared]] note make live reproduction something to do carefully, not a substitute for
reading the actual code paths first) and proposes fixes for architect review before any code changes land.

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| The tour driver | `client/src/components/onboarding/productTour.js` | Same file TASK-045 fixed. `runProductTour()` builds a `driver.js` (`^1.8.0`) instance; `goToStep()` advances/ends it. |
| Tour-finished callback | `productTour.js`'s `finish()` | Calls `abortController.abort()`, removes the `popstate` listener, closes the mobile sidebar, then calls `onFinished()` — the callback passed in by `OnboardingGate`/`OnboardingPreview`. Wired as `onDestroyed: finish` in the `driver({...})` config, and also called directly from `goToStep`'s `isInitial` failure paths. |
| Checklist hookup | `OnboardingPreview.jsx:24-27`, `OnboardingGate.jsx:50-60` | Both pass `runProductTour` an `onFinished` that calls `setStep('checklist')` for the `new_household` flow. Confirmed by reading both files directly: the `flow` value passed in (`'new_household'`, from `HouseholdPage.jsx:234`) matches the ternary's check exactly — ruled out as a naming/casing bug (see Ruled Out). |
| Desktop start gate | `productTour.js`'s `runProductTour()`, non-mobile branch | `requestAnimationFrame(() => setTimeout(start, START_DELAY_MS))` — defers the entire tour bootstrap (driver.js instance creation, `popstate` listener, first `goToStep(0, true)` call) behind one animation frame plus 100ms. The code's own comment states this is "cheap insurance against a future caller that skips [the Welcome step's Continue] click, not a fix for an observed bug" — i.e. not load-bearing on any known requirement. |
| `driver.js` bundled source | `client/node_modules/driver.js/dist/driver.js.mjs` | Read directly for this investigation (see below) — this is the actual shipped library code, not documentation, so its behavior here is a direct code read, not an inference from docs. |

### Confirmed root cause, Bug 1: `driverObj.destroy()` conditionally swallows `onDestroyed`

Reading `driver.js.mjs`'s destroy implementation (the function bound to the public `destroy()` method,
called via `destroy:()=>{h(!1)}`):

```js
function h(e = true) {
  let n = t.getState('__activeElement'),
      r = t.getState('__activeStep'),
      i = t.getState('__activeOnDestroyed'),
      a = t.getConfig('onDestroyStarted');
  if (e && a) { a(...); return; }               // not our path — no onDestroyStarted configured
  let o = r?.onDeselected || t.getConfig('onDeselected'),
      s = t.getConfig('onDestroyed');             // <- our finish()
  document.body.classList.remove(...);            // teardown runs unconditionally
  d(); /* ...more unconditional teardown... */
  if (n && r) {                                    // <- onDestroyed ONLY fires if BOTH are set
    o && o(...);
    s && s(...);                                   // <- our finish() call, gated on the line above
  }
}
```

Separately, `driver.js` maintains **two different "active" state generations** per step transition (both
directly observed in the bundled source, not inferred):

- `activeStep` / `activeElement` (no prefix) — set synchronously the instant a step transition **begins**.
- `__activeStep` / `__activeElement` (double-underscore) — set later, inside a `requestAnimationFrame`-driven
  transition loop, **only once the step's full CSS transition duration has elapsed** (`s >= r` where `s` is
  elapsed time and `r` is the configured transition duration). The same loop repositions/shows the popover
  itself roughly **halfway** through that same duration (`r - s <= r/2`), well before the double-underscore
  state is set.

`h()` (destroy) reads the double-underscore, **late-settling** pair. Our `goToStep` calls
`driverObj.destroy()` directly (bypassing `driver.js`'s own `moveTo()`/internal step-transition function
entirely) whenever `targetIndex` runs past the end of `STEPS` — i.e. when "Done" is clicked on the last
step. If that click lands in the window between "the popover looks fully settled" (halfway point) and
"`driver.js`'s own internal bookkeeping has caught up" (full duration), `destroy()` tears down the popover
and overlay DOM **unconditionally**, but silently **skips** the `onDestroyed` call — so `finish()`, and
therefore `onFinished()` → `setStep('checklist')`, never runs. No exception is thrown anywhere in this
path, which is exactly why the bug report notes "no console error."

This does not depend on how fast the user taps *between* steps (that's TASK-045's already-fixed race) —
it depends only on how soon after the **last** step's own popover-position update the "Done" click lands,
relative to that same step's still-in-flight settle timer. A user who clicks as soon as the popover looks
ready — completely ordinary behavior, not "rapid tapping" — can land in this window on essentially every
attempt if the transition duration is long enough relative to reaction time, which would explain "even at
a deliberate one-tap-then-wait pace" — confirmed below, not just estimated.

Why doesn't this affect steps 0–9's Next clicks? Because those call `driverObj.moveTo(targetIndex)` — a
**valid** index — which runs `driver.js`'s own internal step-transition function and does not depend on
`__activeStep`/`__activeElement` for anything (that pair only matters to the destroy path). Only the
specific "past the last step" `destroy()` call in our code is exposed to this condition, along with two
other paths inside this same file (see Decision section for why the fix generalizes to those too).

**The transition duration is confirmed, not estimated:** the same internal transition function reads
`e.getConfig('duration')||400` — `driver.js` defaults the highlight-transition duration to **400ms**, and
nothing in `runProductTour`'s config overrides it. So the vulnerable window (from "popover visually
repositioned, roughly halfway through the transition" to "`__activeStep`/`__activeElement` finally set, at
the full duration") is on the order of ~200ms out of every 400ms step transition, including the last one —
comfortably within ordinary human click-reaction time, which is consistent with this reproducing "even at
a deliberate one-tap-then-wait pace" rather than requiring unusually fast tapping.

**`driverObj.destroy()` is synchronous:** its full implementation (`h()` in the bundled source) runs
straight through — class list removal, DOM teardown, state reset, and the conditional `onDestroyed` call —
with no `Promise`, `await`, or `setTimeout` anywhere in its body. There is no async gap between calling
`.destroy()` and its teardown/callback effects being fully applied.

**The popover/overlay DOM is structurally independent of React's tree:** the popover wrapper is attached
via `document.body.appendChild(r.wrapper)` and the overlay SVG via `document.body.appendChild(r)` (both
directly observed in the bundled source) — i.e. both are plain children of `<body>`. `client/index.html`
confirms React is mounted into `<div id="root">`, a **sibling** of wherever `driver.js` appends its own
elements, not an ancestor. This matters directly for the Decision below: React re-rendering or unmounting
anything inside `#root` (including `OnboardingGate`/`OnboardingPreview`'s own tree) cannot structurally
interfere with `driver.js`'s own DOM nodes — so triggering our React state transition before or after
`driverObj.destroy()` is safe either way as far as the DOM is concerned; the ordering choice below is about
resilience to `destroy()` failing, not about DOM dependency.

### Confirmed root cause, Bug 2: `requestAnimationFrame` never fires in a backgrounded/inactive tab

Per Chrome's own engineering documentation (cited below) and MDN: `requestAnimationFrame` callbacks are
paused entirely — not merely throttled — while a tab/page is not the active, visible, foreground tab.
This has been Chrome's behavior since 2011 and is standard across major browsers, to save CPU/battery.

`runProductTour`'s desktop branch gates the **entire** tour bootstrap — driver.js instance creation, the
`popstate` listener, and the first `goToStep(0, true)` call (which itself issues the `navigate()` call to
the first step's route) — behind `requestAnimationFrame(() => setTimeout(start, START_DELAY_MS))`. More
precisely: `requestAnimationFrame` does not execute while the document is backgrounded, which prevents
`start()`'s bootstrap from ever running until visibility returns — the bug isn't a delayed animation frame,
it's application initialization not occurring at all while that condition holds. No popover, no route
change — exactly the reported symptom. This is env-sensitive
by nature (a background/inactive tab), which is consistent with the prior session's own verification being
"inconclusive by observation" rather than a clean, repeatable pass or fail, and is also independently
consistent with [[feedback_browser_pane_compositing]] — this environment's Browser pane has a known history
of not behaving like a normal focused, compositing tab, which is exactly the condition that would suppress
`requestAnimationFrame` entirely.

This is not purely a test-environment artifact, though: a real user who alt-tabs, switches virtual
desktops, or has the browser minimized in the instant after clicking "Get started" (before the tour has
visibly begun) would hit the same failure in production. The gate itself is not load-bearing — the code's
own comment already says it's speculative "insurance," not a fix for any observed timing requirement — so
removing the `requestAnimationFrame` dependency has no known downside.

### Ruled out

- **React 18 `StrictMode` double-invoking `startTour()`** — confirmed via `client/src/main.jsx` that the
  app uses `React.StrictMode`, but `StrictMode`'s dev-mode double-invocation applies to component render
  bodies and `useEffect`/`useLayoutEffect` mount/cleanup pairs, not to event handlers like `onContinue`'s
  `startTour` click callback. Not a factor for either bug.
- **Wrong `flow` value reaching `OnboardingPreview`** — traced `setPreviewFlow('new_household')` in
  `HouseholdPage.jsx:234` through to `OnboardingPreview`'s `flow === 'new_household'` ternary; the string
  matches exactly. Ruled out as the cause of Bug 1's "as if `onClose()` fired" symptom — the real cause is
  that `onFinished()` (whichever branch it would take) never gets called at all, not that it takes the
  wrong branch.
- **A rapid-tap/double-click "ghost click" landing on `StaplesChecklist`'s buttons underneath the just-torn-down
  popover** — an earlier hypothesis for Bug 1, ruled out specifically because the handoff notes this bug
  reproduces "even at a deliberate one-tap-then-wait pace," which a ghost-click/ tap-through explanation
  cannot account for (that class of bug requires two closely-spaced input events, not one deliberate tap).
- **`AppLayout` remounting on `navigate()` calls and resetting `previewFlow` to `null`** — would also break
  steps 0–9's route changes, which TASK-045's own verification confirmed work correctly across all 10 real
  steps; ruled out as inconsistent with that evidence.

---

## Decision

### Bug 1: Stop depending on `driver.js`'s `onDestroyed` firing for the paths this file itself triggers

**Recommendation: make `finish()` idempotent (a `finished` guard flag, same pattern as TASK-045's
`isAdvancing`), and call it directly — *before* `driverObj.destroy()` — at every point in this file where
*we* decide the tour should end, rather than trusting `driver.js`'s internal transition-settle timing to
fire `onDestroyed` for us. All five places in this file that currently call `driverObj.destroy()` expecting
`onDestroyed: finish` to follow get this same treatment — this isn't scope creep, it's one architectural
pattern (`destroy()` → implicitly hope `onDestroyed` fires → `finish()`) replaced consistently everywhere
it appears, not just at the one call site this task's reported bug happens to reach.**

```js
let isAdvancing = false;
let finished = false;

// finished commits BEFORE onFinished() runs, deliberately: completion is a one-time,
// irreversible transition (abort the tour's own async work, drop the popstate listener,
// close the sidebar), and it must not be reentrant even if onFinished() itself misbehaves.
// If onFinished() were to throw, the app-level completion (whichever branch the caller's
// callback takes) is already underway — a callback failure doesn't get a second chance to
// re-run the same completion logic, matching TASK-045's isAdvancing/finally idiom of
// committing state unconditionally rather than gating it behind something that could fail.
function finish() {
  if (finished) return; // idempotent — may be invoked from more than one of the paths below
  finished = true;
  abortController.abort();
  window.removeEventListener('popstate', onPopState);
  if (isMobile) setMobileNavOpen?.(false);
  onFinished();
}
```

```js
// goToStep's !target branch (this task's primary repro — last step "Done")
if (!target) {
  if (!isInitial) {
    finish();
    driverObj.destroy();
  }
  return;
}

// goToStep's !found branch (waitForElement timeout)
if (!found) {
  if (isInitial) finish();
  else {
    finish();
    driverObj.destroy();
  }
  return;
}

// goToStep's catch block
} catch (err) {
  console.error('[productTour] goToStep failed, ending tour:', err);
  if (isInitial) finish();
  else {
    finish();
    driverObj.destroy();
  }
} finally {
  isAdvancing = false;
}

// onHighlightStarted
onHighlightStarted: (_el, step) => {
  if (step?.route && step.route !== window.location.pathname) {
    finish();
    driverObj.destroy();
  }
},

// onPopState
function onPopState() {
  const activeIndex = driverObj?.getActiveIndex();
  const activeStep = activeIndex !== undefined ? STEPS[activeIndex] : undefined;
  if (activeStep && activeStep.route !== window.location.pathname) {
    finish();
    driverObj.destroy();
  }
}
```

`onDestroyed: finish` stays in the `driver({...})` config unchanged — `finish()`'s own `finished` guard
makes it harmless if `driver.js` also happens to fire it for the same completion (e.g. the settle race
didn't occur that time, so both our explicit call and the library's callback fire; the second is a no-op).
It remains the *only* path for the × close button and Escape key, which `driver.js` handles internally
without ever going through our `goToStep`/`onHighlightStarted`/`onPopState` code — we have no explicit call
site to attach a direct `finish()` to for those two triggers (see Known Risks).

### Why a guard flag instead of relying on `abortController.signal.aborted` for idempotency

`finish()` already runs `abortController.abort()`, and `goToStep` already checks
`abortController.signal.aborted` in two places — but those checks exist to stop `goToStep`'s *own*
in-flight async work from continuing post-termination, not to make `finish()` itself safe to call twice.
Reusing that signal for `finish()`'s idempotency would conflate two different concerns (this function
already runs after abort, so checking its own output as its guard is circular). A separate `finished`
boolean, following the exact pattern TASK-045 already established for `isAdvancing`, keeps the two
concerns distinct and matches this file's existing style.

### Why `finish()` runs before `driverObj.destroy()`, not after

Once our code has decided the tour is over, our code owns the lifecycle from that point — `driver.js` no
longer needs to determine anything, it just needs to tear down UI it owns. Running `finish()` first
guarantees the abort flag is set, the `popstate` listener is removed, and the app's own completion callback
has run *before* `driverObj.destroy()` gets a chance to do anything unexpected. If `destroy()` were to throw
(not observed, but not provably impossible either), the app has already moved forward — worst case is a
leaked `driver.js` DOM node, not a tour stuck in limbo with the app never having transitioned. This
intentionally trades a recoverable cosmetic leak (a stray overlay element, gone on the next page refresh
or navigation) for guaranteed onboarding completion — an orphaned `driver.js` node is a minor visual
defect; a permanently-incomplete onboarding flow is a user-facing dead end. This ordering
is confirmed safe rather than just convenient: see "The popover/overlay DOM is structurally independent of
React's tree" above — there is no dependency in either direction between our React state transition and
`driver.js`'s own `document.body`-level teardown.

### Why idempotent-and-explicit, not "figure out the exact settle timing and wait for it"

An alternative would be to poll or delay our `destroy()` calls until `driver.js`'s internal
`__activeStep`/`__activeElement` state is actually populated, guaranteeing `onDestroyed` fires naturally.
Rejected: this would mean reading and depending on two specifically-named, double-underscore-prefixed
internal state keys that `driver.js` does not document or expose as public API — a future patch version
could rename, restructure, or remove them without it being a breaking change by the library's own
contract, silently reintroducing this exact bug. Calling our own already-idempotent `finish()` directly is
equivalent in effect, strictly simpler, and depends on nothing but our own code.

### Bug 2: Replace the `requestAnimationFrame` gate with a plain `setTimeout`

**Recommendation:**

```js
if (isMobile) {
  start();
} else {
  setTimeout(start, START_DELAY_MS);
}
```

`setTimeout` is, at worst, throttled (not indefinitely paused) in a backgrounded tab under Chrome's
budget-based background-timer throttling — it will still fire, just possibly a little later than 100ms.
`requestAnimationFrame` does not execute while the document is backgrounded at all, so bootstrap simply
does not occur until the tab is foregrounded again — an indefinite, not merely delayed, wait in the
meantime. Since the existing comment already documents this delay as non-load-bearing "insurance," swapping the
primitive underneath it preserves the intended one-tick cushion while removing the one failure mode that
can make the desktop tour never start.

### Considered and declined: `document.hidden` + `visibilitychange` fallback

A more defensive version would check `document.hidden` and, if true, wait for a `visibilitychange` event
before calling `start()`, only using `requestAnimationFrame` when the page is confirmed visible. Declined
for v1: the tour only ever starts immediately after a user's own click (Welcome step's Continue), so the
tab is visible in the overwhelming majority of real cases by construction; the plain `setTimeout` swap
already removes the failure mode this task set out to fix, and the `visibilitychange` version adds a new
listener, a new state transition, and a new place for the tour to hang (if `visibilitychange` never fires
for some reason) for a scenario with no confirmed report. Revisit only if a backgrounded-tab-at-tour-start
case is ever actually observed in production.

---

## What Does NOT Change

- `STEPS`, `isNavStep()`, the interleaved nav/content design — untouched, unrelated to either bug.
- `SIDEBAR_TRANSITION_MS`, `WAIT_FOR_ELEMENT_TIMEOUT_MS` — no evidence either needs to change.
- TASK-045's `isAdvancing` guard — untouched; this task's `finished` guard is a separate, additive flag in
  the same closure, not a replacement.
- `onDestroyed: finish` in the `driver({...})` config — stays wired, still the only path for driver.js's
  own internally-triggered closes (× button, Escape).
- `OnboardingGate.jsx`, `OnboardingPreview.jsx`, `StaplesChecklist.jsx`, `HouseholdPage.jsx`,
  `AppLayout.jsx` — all read during this investigation to rule out alternative causes, none are where
  either bug actually lives; no changes proposed to any of them.

## Allowed Files

- `client/src/components/onboarding/productTour.js` — the `finished` guard, the direct `finish()` calls
  alongside each `driverObj.destroy()` this file triggers, and the `requestAnimationFrame` → `setTimeout`
  swap in `runProductTour`'s desktop branch.

## Forbidden Files

- `client/src/components/onboarding/OnboardingGate.jsx`, `OnboardingPreview.jsx`,
  `StaplesChecklist.jsx` — confirmed correct as written; both bugs are entirely inside `productTour.js`.
- `client/src/pages/HouseholdPage.jsx` — the preview-trigger buttons are correct (`flow` value confirmed
  to match exactly); used only for verification.
- `client/src/components/layout/AppLayout.jsx`, `Sidebar.jsx` — ruled out; `mobileNavOpen`/`previewFlow`
  state management is correct (see Ruled Out).
- `client/node_modules/driver.js/**` — third-party library; never modify vendored/installed packages.

---

## Dependency Chain

Editing:
- `client/src/components/onboarding/productTour.js`

Reads (pattern reference / investigation only, do not modify):
- `client/node_modules/driver.js/dist/driver.js.mjs` — source of the Bug 1 root-cause finding; not a
  dependency to import from, just what was read to understand `destroy()`'s actual behavior.
- `client/src/components/onboarding/OnboardingPreview.jsx`, `OnboardingGate.jsx` — confirms both simply
  call `runProductTour()`; the fix is entirely inside that function, same as TASK-045.
- `client/src/components/onboarding/StaplesChecklist.jsx` — confirms the component itself renders
  correctly once mounted; the bug is entirely in whether `setStep('checklist')` ever gets called.
- `client/src/pages/HouseholdPage.jsx` — the "Preview: new household"/"Preview: joined household" replay
  buttons, used for verification.
- `client/src/main.jsx` — confirms `React.StrictMode` usage, ruled out as a factor (see Ruled Out).

Irrelevant:
- Everything under `server/` — both bugs are client-only.

---

## Acceptance Criteria

Per TASK-024/025/026/043/044/045 precedent (manual smoke testing, no automated test suite for this app):

- [ ] Household → "Preview: new household" at a 375px-wide (or narrower) viewport: completing the tour at
      a deliberate, one-tap-then-wait pace (including the final "Done" click on the Household step) shows
      `StaplesChecklist` immediately after. Repeat at least 5 times to confirm this isn't merely reduced in
      frequency but actually fixed — Bug 1's repro was timing-window-dependent, not 100%-guaranteed on
      every single click in principle, even though the prior session reported it as consistently
      reproducing.
- [ ] Household → "Preview: joined household": completing the tour still calls `onClose()` correctly (this
      flow's `onFinished` branch was not observed broken, but confirm no regression from the `finished`
      guard).
- [ ] The real (non-preview) `new_household` first-run tour, run against an actual fresh account, shows
      `StaplesChecklist` after the last step — this was also TASK-045's own unverified acceptance item
      (real vs. preview flow); worth closing out here since this task touches the same completion path.
- [ ] Skip / the driver.js close (×) button / Escape still end the tour immediately, from any step
      (confirms the `finished` guard doesn't block or double-fire anything on the paths that still rely on
      `onDestroyed` alone).
- [ ] Desktop (≥1280px, or any ≥768px width): Household → "Preview: new household" (desktop skips the
      sidebar-open step but still runs steps 0–10), clicking "Get started" reliably shows the first
      popover and navigates to `/`. Repeat at least 5 times, including at least once immediately switching
      to another application/tab right after clicking "Get started" and switching back within ~2 seconds,
      to confirm the tour still starts once foregrounded again (rather than being permanently lost).
- [ ] Rapid Next/Prev tapping (TASK-045's own acceptance criteria) still passes unchanged — confirms this
      task's `finished` guard doesn't interact badly with TASK-045's `isAdvancing` guard.
- [ ] Run the full preview tour (Household → "Preview: new household") to completion, close the resulting
      `StaplesChecklist`, then immediately start another preview tour and complete it again — repeat 5
      times back to back. Confirms this task's change to *when* `finish()`/`removeEventListener` run
      doesn't leak a `popstate` listener or leave stale closure state across repeated runs.
- [ ] Complete a preview tour (reach `StaplesChecklist`), then immediately press the browser's Back button
      before interacting with the checklist. Confirms `onPopState`'s `popstate` listener was actually
      removed by `finish()` — a lingering listener firing post-completion would call
      `driverObj?.getActiveIndex()` against an already-destroyed `driver.js` instance.
- [ ] No new console errors introduced by either change.

---

## Known Risks / Implementation Notes

1. **The × close button and Escape key still depend on `driver.js`'s own `onDestroyed` wiring**, not a
   direct `finish()` call, because those triggers are handled entirely inside `driver.js` without ever
   calling back into our `goToStep`/`onHighlightStarted`/`onPopState` code. If a user closes the tour via
   × or Escape at the exact same "settled visually, not settled internally" moment described in Bug 1's
   root cause, the same silent-swallow could theoretically still occur for those two triggers. This is a
   pre-existing condition, not reported by anyone as an actual bug, and closing it fully would require
   configuring `onCloseClick` (not currently set — driver.js falls back to default internal handling) to
   bring that path under our own explicit control too. Deferred out of scope for this task; worth a
   follow-up if ever actually observed. Framed as a quantity, not just a residual: this task reduces the
   number of lifecycle-completion paths that depend on `driver.js`'s own `onDestroyed` timing from five
   (every path in this file, previously) to two (Escape and ×, both entirely library-internal) — a
   concrete reduction in the remaining technical debt, not a full elimination of it.
2. **Bug 2's fix removes a `requestAnimationFrame` call that may have been silently masking or preventing
   some other unrelated timing issue** — no evidence of this was found (the comment marks it as
   speculative insurance, not tied to any observed requirement), but it's the kind of "remove a delay and
   see what depended on it" change worth watching for regressions on the acceptance criteria above,
   particularly around whether the first popover's position is ever measured before the DOM has settled
   post-navigation.

## Resolved During Review

- **Scope of the `finished`-guard fix:** settled as all five `driverObj.destroy()` call sites in this
  file, not just the `!target` branch Bug 1's repro actually reaches. All five share the exact same
  underlying `driver.js` quirk (`destroy()` → implicitly hope `onDestroyed` fires → `finish()`), and the
  change at each site is mechanically identical — fixing one and leaving four structurally-identical latent
  copies would be incomplete root-causing, not scope discipline. Folded into the Decision section above.
- **Whether to add a `visibilitychange` fallback for Bug 2 in this task:** declined, per "Considered and
  declined" above — complexity with no demonstrated production need, revisit only if actually observed.
- **Whether to verify Bug 1's timing window with a temporary runtime log of `driverObj.getState('__activeStep')`:**
  dropped, but because the transition duration turned out to already be a confirmed fact in the bundled
  source (`getConfig('duration')||400` — see Bug 1 root cause above), not merely because logging against
  library-internal state would sit awkwardly next to a fix whose whole point is not depending on that
  state. Once the 400ms constant was in hand, the empirical check had nothing left to confirm.

## Out of Scope (v1)

- Configuring `driver.js`'s `onCloseClick` to bring the × button / Escape path under the same direct-
  `finish()` pattern — see Known Risk 1.
- The `visibilitychange`-based fallback for Bug 2 — see "Considered and declined" above.
- Re-verifying TASK-045's own still-outstanding "real (non-preview) first-run tour" acceptance item beyond
  what this task's own acceptance criteria already cover for the `new_household` completion path.
