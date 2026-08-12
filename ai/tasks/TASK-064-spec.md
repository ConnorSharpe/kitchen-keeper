# TASK-064 — iOS PWA Double Sign-In/Sign-Out: Auth Transition Verification Around an Uncommanded Mid-Action Reload

Version: DRAFT-6 — APPROVED WITH MINOR CHANGES (~9.5/10) by architect review; this draft incorporates the
three required edits plus two precision points from that approval pass. No architectural redesign expected
beyond this point.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🔴 REQUEST CHANGES (~7.5/10) | **P0**: the proposed sign-out marker was deleted on `signOut()` resolve, defeating the mechanism entirely (the observed failure is specifically a reload landing *after* resolve). **P1s**: redefine the marker as an unverified transition, not an in-flight promise; hard one-retry cap; layer strictly after TASK-063's terminal state; don't render signed-in UI before recovery; explicit cleanup matrix; resolve sign-in Option A/B now (Option B); separate diagnostics from production logic; separate markers; fresh-boot-only scope; race-focused tests.
| DRAFT-2 | 🟡 REQUEST CHANGES (~8.9/10) | Approved the overall diagnosis and abstraction. **P0 #1**: a single `startedAt` can't correctly bound both the original transition and a subsequent repair. **P0 #2**: requiring another external reload to ever clear a marker after an already-successful repair leaves stale metadata indefinitely. **P1s**: distinguish promise-resolved / runtime-verified / cross-boot-verified explicitly; define `recovering` precisely; state OAuth-marker-after-settlement explicitly; Google-specific selector, not generic social-button; fail-closed malformed-storage handling with schema version; clarify exhausted-signout UX; two missing regression tests; soften message language; reframe accessibility and cross-tab wording.
| DRAFT-3 | 🟡 REQUEST CHANGES (~9.3/10) | Confirmed both DRAFT-2 P0s genuinely fixed. **New P0**: a *successful* sign-out with no reload could still leave its marker alive (nothing consumed it until the next settle cycle), and if the user quickly signed back in before any reload occurred, a later unrelated reload would see `isSignedIn: true` + an unexpired `attempt:0` marker and incorrectly interpret a brand-new, successful session as "the old sign-out failed" — triggering a destructive, unwanted automatic sign-out of the new session. **P1s**: marker needs identity beyond a timestamp (time isn't identity); narrow the "raw Clerk state is trustworthy" claim to exactly what's evidenced (same-session, no remount — not a universal claim); define exhausted-message UI ownership/API shape explicitly; tighten "no added latency" into Required/Allowed/Forbidden framing; state persistence-write-failure as best-effort, never blocking the actual auth action; document (don't solve) the same-session-OAuth-cancellation gap. **P2s**: concrete `closest()`-based Google-selector matching (the captured element was a child span, not the button itself); reframe accessibility as "must not regress," not just "out of scope"; make `attempt`/`startedAt`/`attemptStartedAt` monotonicity explicit; three more named tests. **Claude's assessment**: accepted all of it. For the P0, adopted something stronger than the review's own suggested `transitionId` (a P1, not mandatory if same-session consumption is correct) — instead of an arbitrary generated ID, the marker stores Clerk's actual **session ID** active at sign-out time, since that's the real question at stake ("is this still the same session that failed to sign out, or a genuinely new one") and Clerk already exposes it via `useAuth()`. Paired with a cheap, continuously-reactive "raw `isSignedIn` false clears any signout marker immediately" rule as the fast path for the common case, with the session-ID comparison as the correctness backstop for the specific coalesced-transition race the review identified.
| DRAFT-3 (parallel review) | 🟡 REQUEST CHANGES (~9.3/10) | A second, independent review of DRAFT-3 (arriving after DRAFT-4 had already been drafted) reached the same core P0 by a different route — proposed fix: an inline same-session raw-state check performed once, directly after `signOut()` resolves/throws in `logout()` itself, rather than DRAFT-4's session-ID-comparison approach. **Claude's assessment**: traced this review's exact reproduction scenario against DRAFT-4's mechanism and confirmed DRAFT-4 already covers it — Rule 1 (continuously-reactive, not a one-off inline check) would very likely clear the marker before a user could sign back in, and even in the narrower case where Rule 1 hasn't fired yet, the session-ID comparison independently prevents the destructive auto-signout by recognizing the new session as different from the one the marker concerned. Kept DRAFT-4's mechanism rather than switching, since the inline-only version this review proposes doesn't cover the coalesced-update case. Incorporated this review's genuinely new points not yet in DRAFT-4: writes need the same best-effort/non-blocking guarantee already stated for reads (a storage write failure must never prevent the actual `signOut()` call); a required new diagnostic event (`oauth-marker-installed`, fired on every successful match) so a future Clerk markup regression is observable rather than silently invisible, plus an optional debug-only `oauth-marker-selector-miss` (not required for this draft — only worth adding if a low-cost detection approach presents itself during implementation); reworded "zero added latency" to "zero perceptible latency" (a raw-state read is real, if trivial, work); added the Context/Question/Source table clarifying which state source answers which question, at the same-runtime vs. post-reload boundary.
| DRAFT-5 | 🟢 APPROVE WITH MINOR CHANGES (~9.5/10) | Confirmed the session-ID mechanism as the right defense (explicitly preferred over an inline-only post-`signOut()` check, since the latter doesn't cover the coalesced-update race). **Three required edits**: (1) `sessionId === null` was not explicitly excluded from the repair-eligibility check — a marker written without a captured session ID (shouldn't normally happen while signed in, but must fail safe) could otherwise satisfy `null === null` and trigger an unwarranted repair; now explicitly ineligible, unconditionally. (2) `useAuthRecovery()`'s side effects (Rule 1/Rule 2) must have exactly one production call site (`App()`) rather than being independently callable from both `PrivateRoute` and `PublicRoute` — today's routing happens to make them mutually exclusive, but that's coincidental, not a designed invariant, and a future third consumer could create duplicate recovery controllers; routes now receive `recovering` as a prop instead. (3) Reconciled a wording mismatch between the review-history summary and §3.5's actual text — `oauth-marker-installed` is required, `oauth-marker-selector-miss` is optional; the history entry read as if both were equally required. Also tightened Rule 1's "full stop" phrasing to the narrower, evidenced claim, and added an explicit synchronous-only requirement for the click listener. **Claude's assessment**: accepted all five points as written — no disagreements or alternate framings this round. Overall verdict from this pass: architecturally approved, no further redesign expected.

---

## 0. Framing

Fourth investigation round of the same user-facing symptom; see prior TASK-061/062/063 attempts, all shipped
green and none resolving it. This round's evidence (three real on-device captures, Section 2) separated the
symptom into one unified mechanism: an unpredictable, uncommanded, OS/WebKit-level reload that can land at
any point during an auth action, silently discarding whatever hadn't yet started or hadn't yet become
durable.

**Confidence calibration, unchanged since DRAFT-1**: the *mechanism* is backed by direct, repeated, consistent
on-device evidence. *Why* the reload fires (WebKit-internal) and *which specific layer* of Clerk's sign-out
isn't yet durable both remain unconfirmed — the design doesn't depend on resolving either.

**Three distinct concepts, and a fourth added by this draft's own review cycle:**

```text
signOut() promise resolved       -- proves nothing about durability, or even about Clerk's own
                                     runtime state; only that the call didn't throw
        |
Current runtime state, verified  -- trustworthy for THIS specific question: "did the transition I
without remounting                  just initiated take effect in the current, uninterrupted
                                     runtime" -- narrower than a general claim that raw Clerk state
                                     is always trustworthy; intentionally distinct from TASK-063's
                                     mount-time-instability problem, not a re-litigation of it
        |
State survives a subsequent boot -- the only thing that actually proves durability across the
                                     specific lifecycle interruption Section 2's evidence shows
        |
Same session identity, verified  -- (new, round-3 finding) an observed "still/again signed in"
                                     reading is only evidence the ORIGINAL sign-out failed if it's
                                     the SAME session that sign-out targeted; a genuinely new
                                     sign-in produces a new session ID and must not be mistaken for
                                     a repair-worthy failure of the old one
```

**Conceptual model, revised (review round 3 §13)** — the marker's purpose is not "sign-out hasn't been
confirmed." It's:

> **"Sign-out hasn't been confirmed across the lifecycle boundary that could interrupt it, for the specific
> session it was signing out of."**

```text
AUTH TRANSITION
      |
      +-- Promise resolution            -- NOT sufficient
      |
      +-- Same-session verification     -- can finalize an uninterrupted transition
      |
      +-- Cross-boot verification       -- required to detect the lifecycle interruption itself
      |
      +-- Session-identity verification -- required to avoid mistaking a NEW session for the OLD
                                            one's unresolved failure
```

---

## 1. Current State — What Exists Today

- `client/src/context/AuthContext.jsx`'s `logout()` calls `await signOut()` with diagnostic logging but no
  defensive behavior — a resolved promise is trusted as complete and durable, which Section 2's evidence shows
  is false.
- `client/src/hooks/useSettledAuth.js`'s `SettledAuthProvider` buffers Clerk's raw `isSignedIn` for up to
  `SETTLE_QUIET_MS`/`SETTLE_MAX_MS` after every fresh mount. This task does not modify that file.
- `client/src/lib/lifecycleLog.js`'s `installClickLogging()` observes taps on Clerk's hosted Google button,
  diagnostic-only.
- Zero `window.location.reload()` calls exist anywhere in this codebase. Every reload observed in every
  capture is uncommanded by our own code.

---

## 2. Evidence — What the Captured Logs Actually Show

*(Unchanged from DRAFT-1/2/3 — three real on-device captures, 2026-08-11 23:39-23:40, 2026-08-11 23:52
(click-logging not yet live, superseded), and 2026-08-12 16:15-16:16.)*

### Sign-out mechanism (confirmed, 4 instances across 2 fully-instrumented captures)

**Pattern A — undone:**
```text
signout-start -> signout-resolved (no error, 200-310ms)
  -> uncommanded reload (pagehide persisted:false -> app-boot, 50-800ms after resolve)
  -> freshly-booted app reads isSignedIn: true (stale)
```

**Pattern B — succeeds:** same shape, but no reload lands in the vulnerable window — `isSignedIn: false`
correctly. Gap-to-reload timing does **not** reliably predict which pattern occurs (one Pattern-A instance:
~800ms gap; one Pattern-B instance: ~32ms gap) — a race between two independent async processes.

### Sign-in mechanism (confirmed, 1 clean instance, 2026-08-12 16:15:49-52)

```text
pointerdown + click on Clerk's "Continue with Google" button (isTrusted: true, both taps, both captures)
  -> 1.8s later: uncommanded reload, referrer is same-origin ("/") -- not Google, not /sign-in
  -> lands at "/", still signed out -- the redirect to Google never started
```

Captured `className` on the clicked element: `cl-socialButtonsBlockButtonText
cl-socialButtonsBlockButtonText__google 🔒️ cl-i` — note this was a **child `<span>`** inside the actual
button, not the button element itself (relevant to Section 3.5).

Rules out both earlier hypotheses: not a lost tap (click fires correctly both times), not Clerk's
transfer-to-signup mechanism (`signInStatus`/`signUpStatus` stayed `null` throughout).

---

## 3. Proposed Fix

### 3.1 Marker semantics and schema

A marker represents an auth transition initiated but not yet verified as durable **for the specific session it
concerns**. Written the instant the transition begins; **retained through `signOut()` resolving or throwing**
— clearing it early was DRAFT-1's bug.

```js
// localStorage key: kk_pending_signout
{
  version: 1,
  sessionId: <string | null>,   // Clerk's session ID active at the moment sign-out was initiated --
                                 // the session this marker concerns, not just "a" recent sign-out
  startedAt: <ms epoch>,        // immutable once written
  attempt: 0 | 1,               // monotonic: 0 -> 1 only, never decremented, never exceeds 1
  attemptStartedAt: null | <ms epoch>,  // written exactly once, when attempt becomes 1
}

// localStorage key: kk_pending_oauth
{
  version: 1,
  startedAt: <ms epoch>,
}
```

**Implementation note**: `sessionId` is read from Clerk's `useAuth()` (standard Clerk React SDK field,
alongside `isSignedIn`/`isLoaded`) at the moment `logout()` is called — confirm against the installed SDK
version during implementation, following this codebase's established practice of verifying Clerk's actual API
shape rather than assuming it (e.g. TASK-063's direct doc verification).

**Monotonicity invariants (review round 3 §11), stated explicitly:**
- `startedAt` never changes after the marker is first written.
- `attempt` moves `0 -> 1` at most once; never decremented; never exceeds `1`.
- `attemptStartedAt` is written exactly once, the instant `attempt` becomes `1`.
- `sessionId` never changes after the marker is first written — it identifies the session this specific
  marker concerns, for the lifetime of the marker.

`PENDING_ACTION_MAX_AGE_MS` (provisional, proposed 5000ms) is a garbage-collection safety bound, not proof of
causal relationship. Checked against `startedAt` for an `attempt: 0` marker, and against `attemptStartedAt`
for an `attempt: 1` marker found already-set on a later boot (this second check never causes a second retry —
`attempt: 1` is unconditionally exhausted regardless of age — it only decides whether a stale exhausted-repair
message is still worth surfacing).

**Persistence failure contract, covering both reads and writes:** *auth operations are authoritative;
transition persistence is advisory recovery metadata that must never gate them.*
- Malformed JSON, unknown/missing `version`, invalid `sessionId`/`startedAt`/`attemptStartedAt`, or `attempt`
  outside `{0, 1}` → treat as **absent**, clear the key.
- `localStorage.getItem`/`removeItem` throwing or unavailable → treat as absent; no recovery action.
- `localStorage.setItem` throwing or unavailable (writing a marker) → **the calling code must catch this and
  proceed with the real auth action regardless** — `logout()` must still call `signOut()` even if writing
  `kk_pending_signout` failed first, and the click listener must not let a failed `kk_pending_oauth` write
  block or delay the tap it's observing. A storage write failing means this specific transition simply won't
  be recoverable if interrupted — an acceptable degradation, never a blocker. No retry of any storage
  operation within the same runtime.

Lives in `client/src/lib/authTransition.js` (not `lifecycleLog.js` — diagnostics and production auth-recovery
behavior stay separated so a future "strip debug logging" cleanup can't delete load-bearing behavior). Pure
read/write/clear/expiry functions, unit-testable with plain `node:test`.

### 3.2 Sign-out: two complementary rules, not one

**Which state source answers which question** — the recurring point of confusion across every review round,
stated once as a table rather than re-derived per section:

| Context | Question | Source |
|---|---|---|
| Same continuous runtime, no remount | "Did Clerk actually reach the state this action intended?" | raw live Clerk state (`useAuth()`, unbuffered) |
| Fresh mount, first reading | "What state can I safely trust after mount-time instability?" | TASK-063's settled snapshot |
| Immediately after the repair call | "Did the repair actually change current runtime state?" | raw live Clerk state |
| Subsequent boot | "Did the state survive the lifecycle interruption?" | TASK-063's settled snapshot |

**Rule 1 — fast-path, continuously reactive (closes the round-3 P0 for the common case):** whenever Clerk's
raw (unbuffered) `isSignedIn` is observed as `false`, any existing `kk_pending_signout` marker's job is done —
clear it immediately, independent of settling, independent of which boot or session wrote it. Precisely:
`isSignedIn === false` establishes that there is no currently active Clerk session in this runtime, so a
pending sign-out marker cannot require further sign-out recovery — a narrower claim than a general statement
about Clerk's auth durability, deliberately.

**Rule 2 — bounded repair, once per mount after TASK-063 settles:**

```text
TASK-063 settled, marker present, unexpired (per Section 3.1's age rules):

  settled isSignedIn === false
    -> Rule 1 has very likely already cleared this; harmless no-op if somehow not yet.

  settled isSignedIn === true, marker.sessionId === null
    -> NOT eligible for automatic repair, unconditionally, regardless of attempt. No session
       identity was captured for this marker (should not normally happen while signed in, but
       fail safe rather than fail permissive) -- there is nothing to verify a match against, so
       treating this as "same session" by a null-equals-null coincidence would be exactly the kind
       of fail-open ambiguity this mechanism exists to eliminate. Clear the marker silently, no
       repair, no message.

  settled isSignedIn === true, marker.sessionId !== current session ID (and marker.sessionId is
  non-null, per the branch above)
    -> NOT evidence the original sign-out failed -- this is a genuinely different (newer) session.
       Clear the marker silently. No repair. (Round-3 P0 fix: this is what distinguishes "the old
       sign-out never took effect" from "the user successfully signed back in since.")

  settled isSignedIn === true, marker.sessionId === current session ID (both non-null), attempt === 0
    -> REPAIR: write { ...marker, attempt:1, attemptStartedAt: now }, recovering = true,
       call signOut() again. Rule 1 will independently notice and clear the marker once/if this
       succeeds -- no separate verification step is duplicated here. recovering returns to false
       once the repair call itself settles (resolve or throw).

  settled isSignedIn === true, marker.sessionId === current session ID (both non-null), attempt === 1
    -> exhausted (a prior repair was attempted, possibly interrupted before Rule 1 could clear it).
       Never a second automatic retry, regardless of elapsed time. Clear marker; if recent enough
       per attemptStartedAt, show the exhausted message; if too stale, clear silently (abandoned).
```

Marker expiry (via `startedAt`, `attempt: 0` case) is checked before any of the above; an expired `attempt: 0`
marker is dropped silently, no message.

Runs strictly after `useSettledAuth()` reaches `status: 'settled'`; never modifies `useSettledAuth.js`'s
reducer or timers.

**Latency requirement, precisely stated**: "zero added latency" means zero *perceptible* latency, not zero
CPU/microtask execution — a synchronous `localStorage` read and a raw-state comparison are real, trivial work,
not literally nothing.
- **Required**: no-marker path is `settled -> synchronous marker check -> route resolves immediately`.
- **Allowed**: a synchronous state computation/render resulting from that check.
- **Forbidden**, on the no-marker path specifically: `settled -> recovering=true -> async effect ->
  recovering=false -> route`. That shape would quietly recreate TASK-063's own settling-latency architecture
  under a different name for the overwhelming common case, which has no marker at all.

### 3.3 Sign-in: explicit re-prompt, no automatic repair

Resolves DRAFT-1's open question as Option B (round 1 §9) — auto-navigation risks being silently blocked by
iOS/WebKit's gesture-requirement restrictions outright, couples recovery to Clerk's DOM/event internals we
don't own, and a later automatic navigation isn't an equivalent substitute for the user's own deliberate tap.

**Marker lifecycle, evaluated strictly after TASK-063's terminal `settled` state** (stated here explicitly,
not only implied elsewhere — TASK-063 exists precisely because an unsettled Clerk reading isn't trustworthy,
and this marker's evaluation must respect that same rule):

| Event | Marker action |
|---|---|
| Google-button activation detected (Section 3.5) | write `{ version:1, startedAt: now }` |
| Settled, no marker | no-op |
| Settled, marker expired | clear, no message |
| Settled, marker present + unexpired + `isSignedIn === true` | success — clear silently, no message |
| Settled, marker present + unexpired + `isSignedIn === false` | clear marker, show message |

The success case's reasoning, stated explicitly for consistency with the sign-out side's semantics: the
attempt reached the expected signed-in outcome, so the original transition no longer requires recovery —
*regardless* of whether the intervening reload (if any) was actually causally related to this specific tap.
Same principle as Rule 1's sign-out clearing: the marker's job is done once the outcome it was protecting for
has been reached, independent of proving exact causality.

**Message**: "Sign-in didn't complete — tap to try again" — not "was interrupted" (the marker alone doesn't
prove the specific cause among reload-preemption, a genuine OAuth error, or a user-cancelled Google flow).

**Known, documented (not solved) limitation (review round 3 §7)**: a user who taps Google, then explicitly
cancels at Google's own screen, then returns to `/sign-in` **without any reload**, currently has no
same-session signal available to this task that would let it distinguish "cancelled" from "still pending" —
the marker won't be consumed until the next settled boot, meaning an unrelated later reload within the age
window could surface the "didn't complete" message for an already-abandoned attempt. This is intentionally
**not** solved by inferring cancellation from Clerk's `signIn.status` transitions, since TASK-063's own
history found no documented state shape for this and building logic on undocumented SDK behavior would be
exactly the kind of overclaiming this investigation has repeatedly had to walk back. Documented here as a
known, accepted limitation rather than silently absent.

No route-rendering gate needed (unlike sign-out) — the user is already on the public `/sign-in` page; nothing
sensitive to hide. Inline UI on that page, not a blocking transition.

### 3.4 Where recovery lives, the message API, and the rendering gate

New hook: `client/src/hooks/useAuthRecovery.js`. Reads `useSettledAuth()` (for the settled-state decision in
Rule 2 and for sign-in's check), Clerk's raw `useAuth()` (for Rule 1's continuous reactive check and
`sessionId`), and `useClerk()` (for the repair-path `signOut()` call).

**API, explicit (review round 3 §4):**
```js
{
  recovering: boolean,
  recoveryMessage: { type: 'signout-exhausted' | 'oauth-incomplete', text: string } | null,
}
```

**Single-owner requirement**: `useAuthRecovery()` has exactly **one** production call site — `App()` itself
in `App.jsx`, alongside `AuthStateLogger`/`SignFlowStateLogger`. Unlike `useSettledAuth()` (a pure
context-consumption hook, safe to call from many components since it has no side effects of its own),
`useAuthRecovery()` performs real side effects — Rule 1's marker-clearing effect and Rule 2's repair-triggering
effect. `PrivateRoute` and `PublicRoute` must **not** independently call `useAuthRecovery()` — they receive
its `recovering` value as a prop from `App()`. This isn't just about today's specific routes (React Router's
one-route-at-a-time rendering happens to make `PrivateRoute`/`PublicRoute` mutually exclusive in practice
already) — it's an explicit invariant so a future consumer added anywhere else in the tree can't accidentally
create a second recovery controller running duplicate side effects against the same `localStorage` keys.

**UI ownership, explicit**: `App()` surfaces a non-null `recoveryMessage` via the app's existing
`react-hot-toast` `Toaster` (already mounted in `App.jsx` — no new UI component or dependency). Both message
types render the same way; `type` exists for future differentiation/styling if needed, not required by this
draft.

**`recovering`, defined precisely (unchanged from DRAFT-3, restated)**: `true` only while Rule 2's repair
`signOut()` call is actively in flight. Never conflated with "a marker happens to exist" — a marker can be
expired, already-verified, exhausted, or session-mismatched without `recovering` ever becoming `true`.

`client/src/lib/routeDecision.js`'s `resolveRouteDecision()` gains one input:

```js
export function resolveRouteDecision({ status, isSignedIn, recovering }, { hasPublicHome, pathname }) {
  if (status !== 'settled' || recovering) return 'render-nothing';
  if (isSignedIn) return 'render-children';
  if (hasPublicHome && pathname === '/') return 'render-public-home';
  return 'redirect-to-sign-in';
}
```

`App()` calls `useAuthRecovery()` once and passes `recovering` down as a prop to `PrivateRoute`/
`PublicRoute` (each of which still calls `useSettledAuth()` directly themselves, same as today — that hook
has no side effects, so multiple call sites are fine). Recovery remains a distinct, composed layer —
`useSettledAuth.js` itself is untouched.

### 3.5 Click detection

Production `kk_pending_oauth`-writing listener, separate from `lifecycleLog.js`'s diagnostic
`installClickLogging()`, installed alongside it in `main.jsx`.

**Synchronous-only requirement**: the listener must never perform asynchronous work before the user's own
click/tap event finishes propagating. `event -> cheap selector match -> best-effort synchronous
localStorage write -> return`, never `event -> await something -> write`. This matters independently of the
persistence-failure contract (Section 3.1) — inserting any async step here risks delaying or interfering with
Clerk's own handler for the same click.

**Concrete matching requirement (review round 3 §8)**: the captured element (Section 2) was a child `<span>`
inside the actual button, not the button itself. The listener must use `event.target.closest(...)` to walk up
to the actual clickable control, matching an ancestor that carries **both** a social-button class **and** the
`__google` provider suffix (e.g. `closest('[class*="cl-socialButtonsBlockButton"][class*="__google"]')` or the
equivalent for whatever the real ancestor's class list turns out to contain) — not testing `event.target`'s
own class list directly, and not matching on the social-button prefix alone (which would also match
Apple/GitHub/etc. buttons).

**User-intent framing, not input-modality framing (review round 3 §9)**: the marker represents *an explicit
user-initiated Google sign-in activation*, regardless of input modality. Current detection only covers
`pointerdown`/`click` — **pointer/click activation is the only currently instrumented path; keyboard/
assistive-technology activation remains uncovered and is a known follow-up requirement. This task must not
regress or disable those activation paths** — it simply doesn't yet extend recovery coverage to them.

If Clerk's markup changes in a future SDK upgrade and the selector stops matching, the failure mode is "no
marker gets written, sign-in interruptions go back to being silently unrecoverable" — a regression to today's
behavior, not a new failure mode, flagged in a code comment. **Made observable, not just theoretically
acknowledged**: `logEvent('oauth-marker-installed', {})` on every successful match (so a real capture shows
whether the instrumentation itself is firing, not just whether a reload happened afterward — this task exists
specifically because this symptom has repeatedly evaded synthetic testing, so production observability of the
recovery mechanism's own health matters). Debug-only `logEvent('oauth-marker-selector-miss', {...})` is
optional and not required for this draft — worth adding only if a low-cost way to detect "a click landed near
where the Google button should be, but nothing matched" presents itself during implementation; not worth
engineering a new detection subsystem around.

### 3.6 Cross-tab / cross-context scope

Cross-context behavior is intentionally unspecified and not part of the correctness guarantee for this task.
`localStorage` is origin-wide; recovery logic only ever reads a marker during a fresh boot of the current PWA
context, with no cross-tab coordination attempted.

---

## 4. Files

**Allowed files:**
- `client/src/lib/authTransition.js` (new) — marker read/write/clear/expiry pure functions + constants,
  fail-closed parsing contract.
- `client/src/lib/authTransition.test.js` (new) — unit tests, plain `node:test`.
- `client/src/hooks/useAuthRecovery.js` (new) — Rules 1/2, message API, described in 3.2-3.4.
- `client/src/hooks/useAuthRecovery.test.js` (new, if usefully extractable as pure decision logic —
  implementation's call, matching this codebase's established pure-function-extraction preference).
- `client/src/context/AuthContext.jsx` — `logout()` writes the `kk_pending_signout` marker (including current
  `sessionId`); no longer clears it itself on resolve/throw.
- `client/src/lib/routeDecision.js` / `routeDecision.test.js` — `resolveRouteDecision()` gains `recovering`.
- `client/src/App.jsx` — `App()` is the single call site for `useAuthRecovery()`; passes `recovering` as a
  prop to `PrivateRoute`/`PublicRoute` rather than either calling the hook itself; renders `recoveryMessage` via
  the existing `Toaster`.
- `client/src/main.jsx` — installs the production Google-button click listener (Section 3.5).
- `client/src/lib/debugLog.js` — new diagnostic tags only, no structural change.

**Forbidden files:** `client/src/api/index.js`, all of `server/*`. `client/src/hooks/useSettledAuth.js` —
**must not be modified**. No new npm dependencies (the `Toaster`/`react-hot-toast` usage is already an
existing dependency, not a new one).

---

## 5. Out of Scope

- Determining the OS/WebKit-level cause of the reloads.
- Distinguishing same-session OAuth cancellation from other "didn't complete" causes (Section 3.3) —
  documented limitation, not solved.
- Keyboard/assistive-technology activation of the Google button (Section 3.5) — known coverage gap; must not
  regress those paths, doesn't yet cover them.
- Cross-tab/cross-context coordination (Section 3.6).
- Removing or replacing prior rounds' diagnostic logging.
- Any change to `authorizedFetch` (TASK-061) or `useSettledAuth.js`'s settling state machine (TASK-063).

---

## 6. Acceptance Criteria

**Sign-out recovery:**
1. The marker survives both `signOut()` resolving and throwing.
2. A successful sign-out with no reload has its marker cleared by Rule 1 without requiring any subsequent
   boot, and **cannot** later cause an automatic sign-out of a different, newer session (Rule 2's session-ID
   comparison).
3. A marker with `sessionId === null` is never eligible for automatic repair, unconditionally — never
   satisfies the session-match check via a `null === null` coincidence.
4. An uncommanded reload landing after a not-yet-durable `signOut()` triggers exactly one automatic repair.
5. A repair's own outcome is verified via Rule 1 within the same session — a second external reload is never
   required to clear a marker after an actually-successful repair.
6. If the repair itself is interrupted before Rule 1 can clear it, the next boot finds `attempt: 1` and never
   retries again under any circumstances.
7. The signed-in application is not rendered while `recovering` is true.
8. `recovering` is `true` only during an active repair call — never merely because a marker exists.
9. A sign-out with no intervening reload produces no additional user-visible latency or behavioral change;
   marker verification/cleanup occurs within the existing logout completion path (not literally zero
   execution — Section 3.2's latency requirement).
10. A boot with no pending marker adds no perceptible latency (Section 3.2's Required/Allowed/Forbidden
    framing).
11. After an exhausted repair, currently observed auth state is preserved as-is; a non-blocking toast is
    shown; the normal Sign Out control remains available.
12. Persistence failures — including a marker **write** failing, not only reads — never prevent or alter the
    underlying sign-out action; `logout()` still calls `signOut()` even if writing the marker first failed.

**Sign-in recovery:**
13. A Google-button tap followed by an uncommanded reload before the OAuth redirect starts produces the
    "Sign-in didn't complete — tap to try again" toast.
14. A successful OAuth round-trip clears the marker silently.
15. The marker never triggers an automatic navigation.
16. Malformed/unversioned/invalid persisted marker data (either kind) is treated as absent, cleared, never
    throws during boot.

**Compatibility:**
17. `useSettledAuth.js` is unmodified; TASK-063's own acceptance criteria continue to hold.
18. TASK-061's `client/src/api/index.authRetry.test.js` untouched and still green.
19. No new npm dependencies. `npm run build`, `npm run lint`, `npm test` all green.
20. `useAuthRecovery()` has exactly one production call site (`App()`); `PrivateRoute`/`PublicRoute` consume
    `recovering` as a prop, never call the hook themselves.

---

## 7. Verification Steps

**Named regression tests:**
- `signOut() resolving does not clear the pending-signout marker` (protects DRAFT-1's fix).
- `repair succeeds without requiring another reload` (protects DRAFT-2's fix).
- `reload interrupts the repair itself` → `attempt:1` found on next boot → cleared, message shown, **no
  second repair attempt**.
- **`sign-out marker cannot cause a later legitimate sign-in to be automatically undone`** — the P0 both
  review rounds independently converged on. Two variants required: (a) the fast path — successful sign-out,
  no reload, marker consumed via Rule 1 before any subsequent sign-in occurs; (b) the backstop — marker
  written with session A's ID, signOut resolves, **simulate Rule 1 not yet having fired**, user signs into
  session B, reload, boot settles `isSignedIn:true` with session B's ID → marker's stored session ID (A)
  differs from current (B) → cleared silently, **no repair triggered against session B**.
- **`marker storage failure never prevents the underlying auth action`**: `getItem`/`setItem`/`removeItem`
  each independently throwing, for both markers → `signOut()` still gets called / the OAuth tap is still
  observed normally either way → boot continues normally → no recovery state gets stuck → no exception
  escapes.
- **`a signed-in session with a null-sessionId marker is never repaired`**: `attempt:0`, `sessionId: null`,
  settled `isSignedIn: true` → cleared silently, no repair, no destructive `signOut()` call — protects against
  a `null === null` coincidence satisfying the session-match check.
- `boot + isSignedIn:false + attempt:0 marker` → cleared, no message (Rule 1 or Rule 2, either path).
- `boot + no marker` → pass-through, no state change, no added render.
- `boot + expired attempt:0 marker` → cleared silently, no recovery action.
- `boot + expired attempt:1 marker (attemptStartedAt beyond max age)` → cleared silently, no message.
- Equivalent set for `kk_pending_oauth`.

**On-device verification** remains the load-bearing check — this symptom has survived three previous "tests
pass, looks architecturally sound" rounds without resolving. A real repro (sign in, sign out, no other
screens, repeated enough times for a reasonable chance of the reload landing in the vulnerable window)
confirming the repair/message actually fires and resolves the symptom is required before treating this as
solved.

---

## 8. Known Risks / Open Questions

- **The fix reduces but does not mathematically eliminate the symptom** — a repair could in principle be
  caught by a second unlucky reload; bounded-retry prevents looping, but that occurrence falls through to the
  explicit-message path rather than silently resolving.
- **`PENDING_ACTION_MAX_AGE_MS` (5000ms) remains provisional**, same status as TASK-063's own constants.
- **Sign-in detection is coupled to Clerk's current DOM structure**, specifically the `__google`-suffixed
  class (Section 2/3.5) — a future SDK upgrade changing that markup could silently regress detection.
- **Same-session OAuth cancellation is a documented, unsolved gap** (Section 3.3) — not inferred from
  undocumented Clerk internals, deliberately.
- **Keyboard/assistive-technology sign-in activation is uncovered** (Section 3.5) — must not regress, doesn't
  yet extend coverage.
- **Cross-context behavior is intentionally unspecified**, not asserted correct (Section 3.6).
- **This is the fourth fix attempt at the same symptom**, now four review rounds deep on its own (two of
  which independently converged on the same P0). Real on-device evidence — and, this round, real
  architectural review catching genuine destructive-action bugs before they shipped, twice — has moved every
  round forward. Deployment plus a real repro remains mandatory before treating this as solved.

**Status**: architecturally approved (APPROVE WITH MINOR CHANGES, ~9.5/10) — this draft incorporates all
required changes from that approval. Ready for implementation; no further redesign expected barring something
implementation reveals that the spec didn't anticipate.
