# TASK-066 — Main-Thread-Blocking Diagnostic: Is the Sign-In Interruption Gap Ours or Downstream?

Version: DRAFT-4 — incorporating round-3 architect review (9.5/10, APPROVE WITH MINOR CHANGES).

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🟡 REQUEST CHANGES (8.6/10) | Praised the falsifiable framing (main-thread-blocked vs. not), the rejection of the fragile `Location.prototype.href` hook, scope discipline, and the Chrome-vs-Safari environment-fingerprint addition. **Required**: (1) soften "no stall → not attributable to anything on this thread" — rAF absence-of-stall is evidence the delay shifts downstream, not proof the main thread played no role; reworded per the review's own suggested phrasing. (2) Make explicit, as a required handoff calculation (not just "record the gap array"), how each recorded gap correlates against `tap→sign_ins` and `tap→pagehide` — a gap before `sign_ins` lands is a materially different finding than one overlapping the unexplained `sign_ins→pagehide` interval, and the spec previously left that classification implicit. (3) Don't treat every `>50ms` gap as equally meaningful — added severity bands. (4) Acceptance criterion 1's "zero behavior/perf impact for real users" doesn't distinguish debug-disabled (true zero) from debug-enabled (intentional overhead); reworded. (5) A second tap preempting an active heartbeat previously discarded the first attempt's partial data — exactly the case most likely to matter, since TASK-064's own recovery flow is "tap, fail, tap again." Changed to preserve the superseded attempt's partial data instead of silently dropping it. **Claude's assessment**: accepted all five as written — each identifies a real gap between what the spec claimed/required and what the design actually supported, not a stylistic preference. Also folded in three items the review flagged as good-but-not-blocking, since each was cheap and directly strengthened the required changes rather than expanding scope: an explicit objective early-stop rule for the paired-capture sampling (replacing "clear, consistent pattern," which the review correctly called subjective); a caveat that the 5000ms heartbeat safety ceiling is itself main-thread-scheduled and therefore best-effort, not exact, during a real stall; and `devicePixelRatio` plus an early-frame nominal-cadence baseline (computed from the heartbeat's own first frames, not a second always-on loop) so a 50-100ms gap can be read against the device's actual expected frame interval rather than an assumed 60Hz. |
| DRAFT-2 | 🟡 REQUEST CHANGES (9.1/10) | Confirmed all five round-1 items genuinely resolved, scope still excellent, second-tap/superseded-heartbeat design and failure-isolation contract explicitly praised as approved-as-written. **Required**: (1) **P0** — DRAFT-2's gap classification used a single mutually-exclusive bucket keyed on `startMs` alone (before/during/tail). A gap has duration; a long gap that *starts* before `signInsElapsedMs` but *extends* well into the target interval would be misclassified as "before" under that rule, potentially producing a wrong conclusion on exactly the most interesting case (a long stall spanning the boundary). Required switching to interval overlap (`gapEndMs = startMs + gapMs`) with non-exclusive overlap flags (`overlapsBeforeSignIns`/`overlapsTargetInterval`/`overlapsTail`) rather than forcing one bucket. (2) **P0** — `signInsElapsedMs`'s anchor (`sign_ins` Resource Timing `responseEnd`) needed to be explicitly named as a proxy for the start of the unexplained interval, not a direct timestamp of Clerk's promise resolution or the `href` assignment itself, so a future reader doesn't over-read precision the measurement doesn't have. (3) **P1** — `devicePixelRatio` does not indicate display refresh rate (it's pixel density, an unrelated property); DRAFT-2's rationale conflated the two. Keep the field as generic environment/repro context, drop the 60Hz/120Hz inference. Rename "nominal-cadence baseline" to "observed initial rAF cadence" and state plainly it's descriptive, not proof the initial frames were stall-free (a stall could occur before or between exactly those frames). (4) **P1** — require the handoff to preserve raw per-gap timing (`startMs`, `gapMs`) and the two anchor values, not only derived classifications, so a later threshold revision doesn't require repeating the on-device captures. Also flagged as good-but-not-required: state the `≥150ms` "significant" line is an operational decision-rule for this task, not a claim that shorter gaps are inherently harmless; soften §7's "a sustained stall proves something occupied the main thread" to name it as strong evidence, not proof. **Claude's assessment**: accepted all four required changes plus both non-blocking items — the P0s are genuine correctness fixes (the bucket-by-`startMs` bug specifically could have produced a confidently-wrong conclusion, which is worse than an inconclusive one), and the P1s cost nothing to fold in alongside them. |
| DRAFT-3 | 🟢 APPROVE WITH MINOR CHANGES (9.5/10) | Confirmed the DRAFT-2 fixes as genuinely resolved (interval overlap, `responseEnd`-as-proxy, DPR correction, raw-data preservation, second-tap handling, failure isolation, objective early-stop rule, 3-5 pair sample) and explicitly said it would not send this back for another broad redesign. **Required**: (1) **P0** — §2.1 item 2 said "compute the delta since the previous frame," undefined for the *first* rAF callback, which has no previous frame. A stall occurring immediately after tap (arguably the single most important case: main thread stalls, then rAF finally fires once freed) would be invisible under a naive frame-to-frame-only implementation — exactly the event this task exists to catch. Required treating `tapMs` as a synthetic checkpoint so the first gap is `firstRafMs - tapMs` (`startMs = 0`), recorded and thresholded identically to every subsequent frame-to-frame gap. (2) **P1** — `overlapsTargetInterval` and `overlapsTail` are non-exclusive by design (correctly), but the spec's decision rule for the final yes/no conclusion didn't account for a gap satisfying both simultaneously — a gap whose *only* meaningful overlap with the target interval is the final ~100ms could currently register as clean "yes" evidence for a main-thread stall, when that portion is exactly the region already named as expected/non-diagnostic. Required computing the overlap duration explicitly (`targetOverlapMs`) and requiring the *non-tail* portion of that overlap to independently clear the significance threshold before a gap counts as qualifying evidence. (3) **P1** — formalize the heartbeat's terminal states (`completed`/`superseded`/`timed-out`) explicitly, and require that a `superseded` or `timed-out` heartbeat can never subsequently emit a late `completed`/`pagehide` record. (4) **P1** — acceptance criterion 8's "yes" wording ("main-thread stall observed") claims more than the instrument directly measures; reworded to name the instrument's actual observation (a scheduling gap) and its evidentiary weight (strong evidence of disruption), matching the epistemic care already used for the "no" case. (5) **P1** — define what happens when the `sign_ins` Resource Timing anchor has zero or multiple matches, rather than leaving the matching implicit, since raw-data preservation (DRAFT-3's own addition) specifically exists to support later reanalysis and an ambiguous anchor would undermine that. **Claude's assessment**: accepted all five as written. The P0 is a real, serious gap — without it, the exact failure mode central to the original TASK-064-followup hypothesis (activation window expiring during a post-tap stall) could be silently invisible to this instrument, which would have made the entire task self-defeating. Folded the fix in alongside the round-2 "observed initial cadence" field (§2.3), since a synthetic `tapMs` checkpoint resolves both round-3's P0 and round-2's own concern about that field's determinism in one change, per the review's own §6 suggestion. Also accepted the review's explicit non-blocking note (§10, "don't add complexity to the 16-33ms framing beyond what's already there") by leaving that section unchanged. |

---

## 0. Framing

Follow-up to TASK-065 (preconnect-hint experiment shipped, early post-deploy signal suggests it did not
close the gap — see [CURRENT_STATE.md](../handoffs/CURRENT_STATE.md)). Across two on-device capture sessions
(TASK-064 follow-up, TASK-065 §0), the unexplained span sits **between Clerk's `sign_ins` response landing
and `pagehide` actually firing** — ~1235ms on failed attempts, ~79-285ms on succeeded ones, with **zero**
matching network activity in that gap. `@clerk/clerk-js`'s own source was traced and confirmed to call
`window.location.href = ...` synchronously the instant the `sign_ins` promise resolves (TASK-065 §0 item 5) —
so the gap is not clerk-js waiting on anything. What's never been established, in either session, is **where
in that gap the time actually goes**: before the JS-level assignment runs (main-thread contention — our own
code, or a dependency, blocking that callback from executing promptly), or after it runs (WebKit/browser-shell
navigation negotiation — downstream of anything our JS controls). This task's entire purpose is to build the
one diagnostic that distinguishes those two, since nothing shipped so far can.

**Important correction to this investigation's framing, from this session**: prior sessions referred to this
generically as a "WebKit standalone PWA" issue without confirming which browser was actually used to add the
app to the home screen. **Connor uses Chrome for iOS**, not Safari, to create the home-screen icon. This
matters and was checked, not assumed:

1. Apple requires every iOS browser — including Chrome — to render on WebKit; Chrome for iOS does not ship
   its own engine. This project's own prior research already established the practical consequence of that
   mandate: MDN's `browser-compat-data` marks iOS browser support as `"mirror"`ing Safari's for engine-level
   APIs (TASK-065 §0 item 7, re: the Long Tasks API). The same mirroring almost certainly holds for the newer
   Long Animation Frames API (`PerformanceLongAnimationFrameTiming`) — MDN lists it as limited-availability,
   non-Baseline — though this specific API's iOS compat row wasn't independently re-confirmed this session;
   stated as a reasonable inference from the established mirror pattern, not a re-verified fact.
2. Chrome's iOS "Add to Home Screen" **does** produce a genuine standalone web app (no browser chrome), not
   just a bookmark that reopens in Chrome's normal tab UI — but only since iOS 16.4 plus a corresponding
   Chrome update, using an Apple-provided API that generalized Safari's own standalone-launch mechanism to
   third-party WebKit-based browsers. ([Google Chrome Help: Use web apps](https://support.google.com/chrome/answer/9658361),
   [AlternativeTo: Chrome iOS home-screen web apps](https://alternativeto.net/news/2023/7/new-update-allows-addition-of-urls-and-web-apps-to-home-screen-on-ios-devices-via-google-chrome))
3. This does **not** mean Chrome's behavior is guaranteed identical to Safari's in every respect. Chrome adds
   its own application-shell code on top of WKWebView (its own navigation delegate, cookie/session handling,
   etc.); nothing in this investigation has verified that Chrome's shell handles a post-tap redirect identically
   to Safari's own standalone implementation. "Same rendering engine" is not the same claim as "identical
   navigation-handling behavior," and this task does not fully resolve that residual gap either — see §7.
4. One consequence worth acting on now, cheaply: `client/src/main.jsx`'s existing `app-boot` diagnostic log
   already captures `standalone: isStandalonePwa()` (added TASK-063) but **not** `navigator.userAgent` — so
   no capture to date has actually recorded, in the log itself, that the browser in use was Chrome, or
   confirmed the `standalone` flag actually read `true` on Connor's real device. Both are one-line additions
   (§2.3) and close a real gap in what prior captures can be trusted to show.

**What this task adds, and why it's a stronger diagnostic than the alternative considered and rejected:**

Considered: patching `Location.prototype.href`'s setter (via `Object.defineProperty` or a `Proxy` wrapping the
native descriptor) to timestamp the exact moment clerk-js's redirect assignment executes. **Rejected before
implementation**, based on verification rather than assumption: `href` is a non-configurable own property in
Chrome's engine family, and `Object.defineProperty` against a non-configurable property **silently no-ops**
rather than throwing — the hook would appear to install without error and simply never fire, which is
indistinguishable from "the assignment happens instantly." That failure shape is exactly the kind this
investigation has already been burned by once (TASK-065 §0 item 2 — a stale-bundle confound that silently
produced a diagnostic-free capture mistaken for real data at first). Building new instrumentation on a
property already documented as unreliable to override across engines is an avoidable repeat of that risk.
(Community references: [mock-location-href](https://glebbahmutov.com/blog/mock-location-href/),
[WHATWG thread on `Location` property forgeability](https://lists.whatwg.org/pipermail/whatwg-whatwg.org/2012-September/079712.html).)

Chosen instead: a **`requestAnimationFrame` cadence heartbeat**, started at the OAuth-button tap and read out
at `pagehide` (the same two points already instrumented). If the main thread is free, rAF callbacks land
roughly every 16-33ms; a real, unrestricted stall in that cadence during the gap is direct evidence something
synchronous is occupying the main thread. This is a standard, engine-agnostic technique (not tied to a
locked-down property, not blocked by WebKit's missing Long Tasks API — this is precisely the fallback
technique teams use in its absence) and works identically regardless of which WebKit-based browser is hosting
the page, so it doesn't need to be redone if the browser-in-use question above ever changes the answer.

**What this determines, stated precisely — not overclaimed (round-1 review, required change P0-1)**: rAF is a
scheduling signal, not a main-thread execution trace — its cadence can be affected by things other than a
conventional long-running JS task, so absence of a stall is evidence, not proof, that the main thread played
no role.

- A sustained, early stall in rAF cadence (well before `pagehide`) on a failed attempt → strong evidence a
  substantial period occurred during which the main thread could not service scheduling callbacks → the delay
  is (at least partly) attributable to JS running on this thread: our own code, a re-render storm, a
  dependency — i.e., **something in "our" stack**, though not necessarily our own application code
  specifically (could be Clerk's own SDK doing work off the promise chain, e.g. in an event listener).
- No stall (cadence stays nominal until very close to the eventual `pagehide`) → **"no sustained main-thread
  execution stall was observed by this instrument; the evidence therefore shifts the investigation downstream
  of JS execution"** — not "not attributable to anything on this thread," and not framed as proof the delay is
  entirely downstream. It's a probabilistic shift in where to look next, the same epistemic shape TASK-065 §0
  already used for its own negative result.
- **What this does not resolve**: if the delay does shift downstream, this diagnostic alone cannot further
  split "WebKit's own navigation/activation handling" from "Chrome's iOS shell code sitting on top of WebKit"
  — both are downstream of our JS and would look identical to this instrument. §7 names the follow-up that
  could split those two if it's ever needed.

---

## 1. Current State

- `client/src/lib/lifecycleLog.js` already instruments `pagehide` with `captureClerkNetworkTiming()`
  (Resource Timing for Clerk requests + `perfNowMs`), gated behind `isDebugEnabled()`. No continuous
  main-thread signal exists between tap and `pagehide` today — only two point-in-time snapshots.
- `client/src/lib/authTransition.js`'s `installOauthMarkerListener()` already has a capture-phase click
  listener matching Clerk's Google button (`GOOGLE_BUTTON_SELECTOR`, currently module-private) that records
  `perfNowMs` on tap via `oauth-marker-installed`. This is production recovery behavior, not diagnostics
  (file header comment, TASK-064) — this task does not add diagnostic logic here, only exports the existing
  selector constant so `lifecycleLog.js` can reuse it without a second, driftable copy of the same string.
- `client/src/main.jsx`'s `app-boot` log captures `standalone: isStandalonePwa()` but not `navigator.userAgent`
  (§0 item 4).
- No `requestAnimationFrame`-based instrumentation exists anywhere in the codebase today (grepped
  `client/src` for `requestAnimationFrame`, no matches).

---

## 2. Proposed Diagnostic

### 2.1 What

A main-thread heartbeat, diagnostic-only, gated behind the existing `isDebugEnabled()` (costs real users
nothing, same contract as every other instrument in `lifecycleLog.js`):

1. On a capture-phase click matching the Google button selector, record `tapMs = performance.now()` and start
   a `requestAnimationFrame` loop.
2. **`tapMs` is checkpoint zero — the first gap is `tapMs`-relative, not frame-to-frame-only (round-3 review,
   required change P0)**: computing gaps only as delta-since-previous-frame leaves the very first callback
   undefined, which means a stall occurring *immediately after tap* (main thread stalls, rAF only fires once
   freed) — arguably the single most important case this task exists to catch — would be invisible. Instead:
   on the first rAF callback, compute `firstGapMs = firstRafTimestamp - tapMs` and record it exactly like any
   other gap (`startMs: 0`, since its interval starts at the tap itself); on every subsequent callback, compute
   the delta from the previous callback as before. Both are subject to the same `50ms` threshold and recording
   rule below — the first gap is not a special case in the data model, only in how its start point is defined.
   `50ms` is the recording threshold — 60Hz's nominal frame interval is ~16.7ms, 120Hz's ~8.3ms, and iOS
   scheduling jitter alone can occasionally exceed 50ms without any single giant JS task, so **a `>50ms` gap is
   recorded as a candidate scheduling gap, not automatically classified as a blocking task** (round-1 review,
   required change P1-3). Record `{ startMs: <ms since tap>, gapMs: <delta> }` for every gap over threshold
   (including a qualifying first gap), plus a severity band computed at analysis time (not required to compute
   the band in the recording code itself — keeping the per-frame hot path minimal matters more, since heavier
   per-frame work would itself risk perturbing the exact signal being measured):
   - `50-150ms`: candidate scheduling gap
   - `150-500ms`: substantial gap
   - `500-1000ms`: strong evidence of a major interruption
   - `>1000ms`: highly significant
   Sub-threshold frames are not recorded individually — only the gaps, to keep the payload compact.
   **`150ms` is this task's operational cutoff for "significant" (round-2 review, P1)** — a decision rule
   needed to answer §2.2's yes/no question, not a claim that gaps below it can't affect the navigation
   transition; a series of smaller sub-150ms gaps could still matter and remains visible in the raw data
   (§5.7) even if it doesn't cross this task's significance line on its own.
3. Stop the loop on `pagehide` (page is unloading either way) or after a fixed safety ceiling (5000ms of
   elapsed time) if neither `pagehide` nor another tap arrives first, so a debug-enabled user who taps the
   button and never navigates away doesn't leave an rAF loop running indefinitely. **Caveat (round-1 review):**
   if implemented via `setTimeout`, that timer is itself main-thread-scheduled — during a genuine stall, actual
   cleanup may fire later than 5000ms, not at exactly 5000ms. That's not a bug to fix; a late-firing ceiling
   during a real stall is itself consistent with Pattern B, not a measurement error to guard against.
4. **A second tap while a heartbeat is already active does not discard it** (round-1 review, required change
   P1-5 — TASK-064's own recovery flow is "tap, fail, tap again," which is exactly the case most likely to
   produce a real Pattern-B capture, and silently overwriting it would erase the evidence this task exists to
   collect). Instead: finalize the active heartbeat immediately as `heartbeat-superseded` (its gap array +
   elapsed time up to that moment, tagged so the handoff can tell it apart from a heartbeat that ran to a real
   `pagehide`), then start a fresh heartbeat for the new tap.
5. At `pagehide`, include the accumulated gap array (plus total elapsed time and frame count observed) in the
   existing `lifecycle-pagehide` log entry, alongside the current `captureClerkNetworkTiming()` output.

**Heartbeat terminal states, formalized explicitly (round-3 review, required change P1):** a heartbeat has
exactly one of three mutually exclusive terminal outcomes, and once any one is reached the heartbeat is done —
none of the other two can subsequently fire for it.

```text
active
  ├── pagehide fires first       → completed   (§2.1 item 5's normal path)
  ├── safety ceiling fires first → timed-out   (§2.1 item 3)
  └── a second tap arrives first → superseded  (§2.1 item 4)
```

Concretely: a `superseded` or `timed-out` heartbeat's rAF loop and any pending safety timer must be fully torn
down (`cancelAnimationFrame`, timer cleared) at the moment it's finalized, so it can never later append to or
emit a `completed` record if `pagehide` happens to fire afterward on a page that, unusually, stayed alive past
the safety ceiling.

**Implementation contract (round-1 review, P2 — made explicit given TASK-064/065's own precedent of
diagnostic code needing to be failure-isolated from production behavior):**
- Diagnostic logic wrapped so a thrown error inside the heartbeat can never propagate into the real click
  handler or block the Google button's own click behavior — same failure-isolation contract as every other
  function in this file and in `authTransition.js`.
- No duplicate `requestAnimationFrame`/click-listener registration if `installLifecycleLogging()`-style setup
  ever runs more than once in a page lifetime.
- No heartbeat work of any kind when `isDebugEnabled()` is false — checked before the loop starts, not just
  before logging its result.
- No retained references (timers, rAF handles) surviving past `pagehide` or the safety ceiling — nothing to
  leak across repeated debug sessions in the same tab.

### 2.2 Interpretation guidance and required correlation (recorded here so a future reader doesn't have to re-derive it)

`requestAnimationFrame` callbacks are throttled/paused once `document.visibilityState` becomes hidden — this
is standard, expected browser behavior, not evidence of blocking. Near the very end of a failed attempt's
gap, right as the interrupting reload actually commits, the page backgrounds and rAF will naturally stop —
**that tail-end stop is not diagnostic and should not be read as a main-thread stall.** The signal that
matters is whether a stall shows up **early** in the window (starting shortly after `tapMs`, well before the
attempt's eventual `pagehide` timestamp) and **persists** rather than being a single frame's worth of
scheduling jitter.

**Required correlation against `sign_ins` (round-1 review, required change P0-2; classification method
corrected round-2, required change P0-1)**: the actual question this task exists to answer is narrower than
"did any gap occur between tap and pagehide" — it's specifically **whether a significant rAF gap overlaps the
unexplained `sign_ins → pagehide` interval** (the span with zero matching network activity, per TASK-065 §0
item 4). The spec previously left this classification implicit ("record the gap array"); it's now a required
calculation, not an optional observation. For each captured attempt, the handoff must compute, using
timestamps already produced by existing instrumentation (all on the same `performance.now()` timeline, so no
new capture point is needed):

```text
signInsElapsedMs = <sign_ins request's responseEnd, from captureClerkNetworkTiming()'s
                     Clerk resource-timing entries, matched by pathname containing "sign_ins"> - tapMs
pagehideElapsedMs = pagehideMs - tapMs
```

**Anchor selection when matches aren't exactly one (round-3 review, required change P1)**: if exactly one
Clerk resource-timing entry's pathname contains `sign_ins`, use its `responseEnd` as defined above. If more
than one matches (e.g. an edge case not seen in prior captures), use the **last** such entry chronologically
before `pagehide` — the one most plausibly tied to the tap being analyzed, consistent with
`captureClerkNetworkTiming()`'s existing `.slice(-10)` most-recent-first semantics. If zero match, do not
guess: mark that attempt `anchor-unavailable` in the handoff, retain whatever raw gap data was still captured
for it, and exclude it from the paired yes/no tally (§5.8) rather than computing `signInsElapsedMs` against an
unrelated or absent request.

**`signInsElapsedMs` is a proxy, stated precisely (round-2 review, required change P0-2):** `responseEnd` is
the network response landing — the available Resource Timing boundary. It is **not** a direct timestamp of
Clerk's promise resolution or the `window.location.href` assignment itself (TASK-065 §0 item 5 established
that assignment happens synchronously the instant the `sign_ins` promise resolves, but the promise's `.then()`
continuation is a microtask that itself needs the main thread free to run — if the main thread is stalled
between `responseEnd` and that continuation running, that stall falls *inside*, not outside, the interval this
task cares about). Treat `signInsElapsedMs` as marking the start of the window worth examining, not as a
timestamp of any specific step in Clerk's internal handoff to navigation.

**Classify by interval overlap, not by a gap's start point alone (round-2 review, required change P0-1 — the
prior single-bucket-by-`startMs` design would misclassify a long gap that starts before `signInsElapsedMs` but
extends well past it, exactly the "most interesting" case: a long stall spanning the boundary).** Each
recorded gap already carries `startMs` and `gapMs`; derive `gapEndMs = startMs + gapMs`. Rather than forcing
each gap into one exclusive bucket, compute three independent boolean overlap flags (a single gap can and
should set more than one, e.g. a 1000ms gap starting just before `sign_ins` lands can legitimately overlap
both the pre-`sign_ins` period and the target interval — losing that by forcing one bucket is exactly the bug
being fixed here):

```text
overlapsBeforeSignIns   = gapStartMs < signInsElapsedMs
overlapsTargetInterval  = gapStartMs < pagehideElapsedMs && gapEndMs > signInsElapsedMs
overlapsTail            = gapEndMs > (pagehideElapsedMs - 100)   // expected backgrounding per above, not diagnostic on its own
```

**Decision rule for what counts as qualifying evidence (round-3 review, required change P1)**: the two flags
above are intentionally non-exclusive, so a gap can — and legitimately does, in realistic cases — satisfy both
`overlapsTargetInterval` and `overlapsTail` at once (e.g. a gap that reaches into the final ~100ms while also
covering earlier target-interval time). Treating any `overlapsTargetInterval = true` gap as clean evidence
would let a gap whose *only* real overlap is that already-expected tail region masquerade as a genuine
mid-interval stall. Instead, compute the actual overlap duration and require its non-tail portion to
independently clear the significance threshold:

```text
targetOverlapStart    = max(gapStartMs, signInsElapsedMs)
targetOverlapEnd      = min(gapEndMs, pagehideElapsedMs)
targetOverlapMs       = max(0, targetOverlapEnd - targetOverlapStart)
nonTailOverlapEnd     = min(gapEndMs, pagehideElapsedMs - 100)
nonTailTargetOverlapMs = max(0, nonTailOverlapEnd - targetOverlapStart)
```

A gap counts as qualifying evidence for the "yes" conclusion only when `nonTailTargetOverlapMs >= 150` — i.e.
its overlap with the target interval, *excluding* the final ~100ms tail window, independently meets this
task's significance line (§2.1). This doesn't require persisting a new boolean field; `targetOverlapMs` and
`nonTailTargetOverlapMs` are derived at analysis time from the already-preserved raw values (§5.7), same as
the overlap flags themselves.

and answer explicitly, per attempt: **was there a gap meeting the qualifying-evidence rule above?** That
yes/no, across the paired captures (excluding any `anchor-unavailable` attempts), is the task's actual output
— not just "a gap array was recorded," and not merely "`overlapsTargetInterval` was true somewhere."

### 2.3 Environment fingerprint (closes §0 item 4)

Add `userAgent: navigator.userAgent` to the existing `app-boot` `logEvent()` call in `client/src/main.jsx`.
One line, no new capture point — `standalone` is already captured there; this just makes the next real
capture confirm (not assume) which browser and display mode were actually active.

Also add `devicePixelRatio: window.devicePixelRatio` to the same `app-boot` call — kept as generic
device/environment repro context (useful for reproducing the exact device configuration later), **not** as a
refresh-rate signal (round-2 review, required change P1-1: `devicePixelRatio` is pixel density, an unrelated
property from display refresh rate — DRAFT-2's rationale incorrectly implied it could distinguish a 60Hz
device from a 120Hz ProMotion one; that inference is dropped).

Additionally, have the heartbeat record the **observed initial rAF cadence** (renamed from DRAFT-2's
"nominal-cadence baseline," round-2 review) as three specific, deterministically-defined raw intervals —
tightened round-3 to remove the earlier ambiguous "first 2-3 frames" phrasing:

```text
tap → frame 1
frame 1 → frame 2
frame 2 → frame 3
```

recorded unconditionally (regardless of the `50ms` threshold — these three intervals are always captured as
context, distinct from the thresholded gap array), and via the same checkpoint-zero definition as §2.1 item 2
(`tap → frame 1` is the same value as a qualifying first gap would be, just recorded here regardless of size).
As before: this is descriptive context, not evidence bounding when a stall could or couldn't have started — a
stall could occur before frame 1 or between any of these three frames, and a handful of post-stall frames
would look identically "normal." This reuses the already-running tap-triggered loop rather than adding a
second, always-on background loop that would cost debug-enabled users continuous overhead outside of actual
sign-in attempts.

### 2.4 What this does NOT do

- Does not touch `client/src/lib/authTransition.js`'s marker read/write/expiry logic, `useAuthRecovery.js`, or
  any production auth-recovery behavior (TASK-064) — the only change there is exporting one existing constant.
- Does not touch TASK-065's preconnect hint or its route wrapper.
- Does not attempt to patch `Location.prototype.href` or any other locked-down browser property (§0,
  considered and rejected).
- Does not require a Mac or any additional hardware — see §7 for an optional, strictly more direct
  complementary check if one is available.

---

## 3. Files

**Allowed:**
- `client/src/lib/lifecycleLog.js` — add the rAF heartbeat (start on Google-button tap, read out at
  `pagehide`).
- `client/src/lib/authTransition.js` — export the existing `GOOGLE_BUTTON_SELECTOR` constant (no behavior
  change).
- `client/src/main.jsx` — add `userAgent` and `devicePixelRatio` to the existing `app-boot` log call.

**Forbidden:** `client/src/hooks/useAuthRecovery.js`, `client/src/lib/routeDecision.js`,
`client/src/context/AuthContext.jsx`, any change to `authTransition.js`'s marker logic, the preconnect wrapper
from TASK-065, all of `server/*`. No new npm dependency.

---

## 4. Out of Scope

- Actually fixing anything — this is diagnosis, same pattern as the TASK-064 follow-up session.
- Distinguishing WebKit-proper from Chrome's iOS shell code if the result comes back "not main-thread" (§0's
  stated limit; §7 names the follow-up).
- Re-running TASK-065's full ~10-per-condition timing-distribution protocol — this task's sample target is
  deliberately smaller (§5.5), since the question here is qualitative (does a stall happen, roughly where) not
  statistical.
- Any change to the preconnect hint itself or its scope (`/sign-in`/`/sign-up`).

---

## 5. Acceptance Criteria

1. rAF heartbeat implemented per §2.1-2.2, gated behind `isDebugEnabled()`. **No production behavior or
   measurable runtime overhead when debug diagnostics are disabled** (round-1 review, required change P1-4 —
   the original "zero behavior/perf impact for real users" didn't distinguish debug-disabled, which is
   genuinely zero, from debug-enabled, which intentionally incurs the heartbeat's overhead as the cost of
   collecting this diagnostic). Debug-enabled sessions may incur the intentional rAF diagnostic overhead.
   `npm run build` / `npm run lint` green, no new dependency.
2. `userAgent` and `devicePixelRatio` added to `app-boot` (§2.3).
3. `client/src/lib/authTransition.test.js` (existing 18/18 suite) still passes unaffected.
4. Terminal-state behavior verified (§2.1's `completed`/`superseded`/`timed-out` states, round-3 review): a
   second tap while a heartbeat is active produces a `heartbeat-superseded` log entry carrying the first
   attempt's partial gap data, not silent loss; and a `superseded` or `timed-out` heartbeat never subsequently
   emits a `completed` record.
5. **Paired on-device captures, alternating, smaller sample than TASK-065** (round-2 review of that spec
   established alternating as preferred methodology, and PWA-state hygiene — force-quit/relaunch, discard
   attempts missing diagnostic fields — carries over unchanged): target 3-5 pairs (failed/succeeded), not
   10-20 — this is a pattern check, and Connor already flagged wanting to step back from heavy manual grinding
   (see CURRENT_STATE.md). **Objective early-stop rule** (round-1 review, replacing the previous subjective
   "clear, consistent pattern" — required so a good-looking early result can't be cherry-picked into stopping
   sooner than the data actually supports): stop early once ≥3 failed attempts agree on whether they meet
   §2.2's qualifying-evidence rule (either consistently yes or consistently no) **and** ≥2 succeeded attempts
   provide the expected contrasting (no qualifying gap) baseline. Otherwise complete the full 3-5 pairs and
   report mixed/inconclusive rather than picking the cleaner-looking subset.
6. For each captured attempt, record: outcome, the existing tap→`sign_ins`/tap→`pagehide` timings, the gap
   array (including a qualifying first gap per §2.1 item 2's checkpoint-zero definition) with each gap's
   severity band and overlap flags (§2.2's required correlation), the three raw observed-initial-cadence
   intervals (§2.3), and the `standalone`/`userAgent`/`devicePixelRatio` fields from that session's `app-boot`
   entry. Any attempt where the `sign_ins` anchor was ambiguous or missing is recorded as `anchor-unavailable`
   (§2.2) with whatever raw data was still captured, rather than silently dropped or force-classified.
7. **Raw timing data preserved alongside derived classifications, not only the classifications themselves**
   (round-2 review, required change P1-2): `tapMs`, `signInsElapsedMs`, `pagehideElapsedMs`, and each gap's
   raw `startMs`/`gapMs` (and derived `gapEndMs`) must appear in the handoff, not just the `overlapsX` flags
   computed from them. Rationale: if a threshold (the `150ms` "significant" line, the `100ms` tail window)
   turns out to need revisiting after review, the existing captures can be reanalyzed without repeating the
   on-device sessions.
8. Explicit conclusion in the handoff, per §2.2's qualifying-evidence rule: for the failed attempts
   specifically (excluding `anchor-unavailable` ones), was there a gap meeting that rule? Answer one of
   **"yes — significant rAF scheduling gap observed overlapping the target interval, providing strong evidence
   of main-thread scheduling disruption"** (round-3-review-corrected phrasing — not "main-thread stall
   observed," which claims more than the instrument directly measures), **"no sustained main-thread execution
   stall was observed by this instrument; the evidence therefore shifts the investigation downstream of JS
   execution"** (the round-1-review-corrected phrasing for Pattern A — not "not attributable to anything on
   this thread"), or **"mixed/inconclusive across the captured pairs."** Not softened into an implied fourth
   option. State plainly, per round-3 review: this establishes an observed pattern from a small paired sample,
   not a statistically powered characterization of all sign-in attempts.
9. No automated test expected beyond #3 — this is a browser-timing instrument, same category as
   `lifecycleLog.js`'s existing untested diagnostics (precedent: TASK-064 §1).

---

## 6. Verification Steps

- `npm run build`, `npm run lint`.
- `node --test "src/lib/authTransition.test.js"` (client).
- On-device capture per §5.5-5.8, using the existing DebugPanel debug-mode toggle and the Chrome-for-iOS
  home-screen icon Connor actually uses (not Safari — matches real usage per §0's correction).

---

## 7. Known Risks / Open Questions

- **rAF cadence is a proxy, not a direct cause diagnosis (softened round-2 review — "proves" overstated it).**
  A sustained rAF scheduling gap is strong evidence that the page was unable to service animation callbacks for
  that period; it is consistent with main-thread contention but does not directly identify the underlying
  cause (our code vs. a dependency vs. GC). If Pattern B shows up and the specific cause matters for a fix, a
  follow-up would need actual profiling, not just gap detection.
- **The residual WebKit-vs-Chrome-shell ambiguity is real and not fully closed by this task** (§0). If the
  result comes back Pattern A (not main-thread), the next-best diagnostic — genuinely more direct than
  anything JS-level, verified feasible this session — is enabling Chrome's own Web Inspector support (Chrome
  115+/iOS 16.4+: Chrome Settings → Content Settings → Web Inspector, then Safari's Develop menu on a
  connected Mac shows the live Chrome tab, per
  [Chrome for Developers: Debugging websites in Chrome on iOS 16.4+](https://developer.chrome.com/blog/debugging-chrome-on-ios)).
  This reopens TASK-065 §6-B's original plan, which was shelved for lack of a Mac session that day — it was
  never established Connor lacks Mac access entirely. Worth asking directly before scoping a follow-up task,
  rather than assuming it's still unavailable.
- **Sample size (§5.5) is intentionally smaller than TASK-065's** — a real trade-off between rigor and asking
  for more manual cycles right after Connor asked to step back. If the pattern is genuinely inconsistent at
  3-5 pairs, that itself is a valid (if less satisfying) outcome to report, not a reason to silently keep
  going without saying so.
- No regression risk either way — TASK-064's recovery mechanism is untouched and remains the fallback
  regardless of this task's outcome.

---

**Status**: READY FOR IMPLEMENTATION. DRAFT-4 incorporated round-3 architect review (9.5/10, APPROVE WITH
MINOR CHANGES) in full — the P0 first-frame-gap fix (checkpoint-zero schema, unified with the
observed-initial-cadence field), the target/tail qualifying-evidence decision rule, formalized heartbeat
terminal states, the corrected "yes" conclusion wording, and the `sign_ins`-anchor-ambiguity rule. Round-3
explicitly said it would approve for implementation once the P0 and the target/tail P1 landed and would not
request another broad redesign; both are landed. Skipping a round-4 confirmation pass per Connor's direction —
implementer should treat §2-§5 as binding and flag anything DRAFT-4 didn't anticipate rather than improvising
silently.
