# TASK-065 — iOS PWA Sign-In: Preconnect to Google's OAuth Endpoint

Version: DRAFT-3 — incorporating round-2 architect review (~9.3/10, APPROVE WITH MINOR CHANGE). Architect
stated round-2's remaining item was "implementation hygiene rather than architectural uncertainty" and that
resolving it should move this to approved; no further root-cause investigation requested before
implementation.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🟡 REQUEST CHANGES (~8.1/10) | Praised the evidence discipline, paired same-code timing comparison, Clerk source-tracing, and scope discipline (TASK-064 untouched). **Required**: (1) correct the `crossorigin` rationale — cited HTML spec preconnect algorithm showing default (no `crossorigin`) is the credentialed form, `crossorigin=anonymous` the non-credentialed form. (2) Flip the recommendation from Option A (static/global) to Option B (scoped to auth routes) — a PWA where most sessions are already authenticated shouldn't pay an unsolicited connection cost to a single-purpose third-party origin on every launch. (3) Verify `/sign-up`'s OAuth destination rather than presuming it, and fold into scope if confirmed same-origin rather than spinning up a follow-up task. (4) Define Option B's timing requirement as "initiated as early as reasonably possible, before the OAuth control is interactive," not "component mounted" — a performance requirement, not a prescribed React lifecycle hook. (5) Strengthen on-device verification from "more than one sample" to a controlled, paired before/after sample set. (6) Separate three distinct verification claims: hint present in the DOM, browser appears to have acted on it (where observable), and user-visible timing actually changed — don't conflate DOM presence with proof of effect. **Claude's assessment**: accepted 2-6 as written. Pushed back on 1's framing specifically — verified the HTML spec's actual preconnect algorithm text (`Let credentials be true; if corsAttributeState is Anonymous ... set credentials to false`) and confirmed DRAFT-1's stated *conclusion* (no `crossorigin`) and *mechanism* (`crossorigin` would produce a differently-credentialed, non-reusable connection) were already correct, not reversed — DRAFT-1 just used informal wording instead of the spec's own credentialed/anonymous terminology. Adopted the more precise, citable phrasing regardless, since it strengthens the spec either way. Also attempted the requested `/sign-up` verification via the same direct-API technique used for `/sign-in` (item 8, §0) — blocked by Clerk bot-protection (`captcha_missing_token`) that isn't enabled on `/sign-in`; this is a real constraint, not a shortcut taken, so `/sign-up`'s destination is included in scope on an architectural inference (same Clerk instance → same underlying Google OAuth app registration) rather than a verified fact, with that distinction stated plainly in §1 and gated in §2.2. |
| DRAFT-2 | 🟢 APPROVE WITH MINOR CHANGE (~9.3/10) | Confirmed all six round-1 items resolved; specifically validated the `crossorigin` rewrite against the HTML Standard's own algorithm text. **Required**: don't prescribe `document.head.appendChild()` inside a React render path (DRAFT-2 offered it as one option alongside `useLayoutEffect`) — DOM mutation during render is an impurity React doesn't guarantee runs once (Strict Mode's dev-mode double-invocation could produce duplicate `<link>` elements); state the behavioral requirement only and leave the lifecycle mechanism to implementation. Also: soften "absence of improvement rules out connection-setup time" to "reduces the likelihood it's the dominant contributor" — a negative result doesn't logically rule it out if WebKit simply declined to honor the hint. **Strongly recommended, not blocking**: promote alternating before/after sampling from optional to preferred methodology (blocked sampling confounds device/network drift with the change under test); explicitly prohibit interpreting success-rate alone as evidence, name the failure-side timing distribution as the primary metric. **Claude's assessment**: accepted all four points as written, no disagreements this round — all well-reasoned and cheap to fold in. Also added PWA-state hygiene notes to the sampling methodology (force-quit/relaunch discipline, discarding attempts missing diagnostic fields or showing unrelated network failures, retaining raw per-attempt data) as a natural extension of the review's alternating-sampling point, not separately requested but consistent with it. |

---

## 0. Framing

Follow-up to TASK-064 (shipped, on-device-confirmed working as designed: sign-in interruptions get an
explicit "tap to try again" re-prompt, by deliberate design — spec §3.3 rejected auto-retry). TASK-064
recovers *from* an interrupted sign-in. This task is a separate, narrower question: can the interruption
itself be made less likely, so fewer sign-ins need the second tap at all.

**What this session's investigation established, with real evidence (not speculation):**

1. Two on-device captures (2026-08-12, ~20:05-20:06 and ~20:18-20:19), the second with the first capture's
   confound removed (see below), each containing one failed and one succeeded sign-in attempt, timed via
   `perfNowMs` on the OAuth-button tap and `perfNowMs` + Resource Timing on `pagehide`
   (`client/src/lib/lifecycleLog.js`, `client/src/lib/authTransition.js`, shipped diagnostic-only in commit
   `2af6d6d`).
2. The first capture's failed attempt carried none of the new diagnostic fields, while its succeeded attempt
   did — evidence the standalone PWA's first launch that session ran a JS bundle from before `2af6d6d`
   (`client/public/sw.js`'s fetch handler is network-first for navigations but cache-first for everything
   else, so an already-cached HTML shell can reference stale-hash JS until the next navigation refreshes it).
   That capture's failed-attempt timing is therefore not trustworthy and is excluded below.
3. The second capture (Connor force-quit and relaunched before reproducing, so both attempts ran identical,
   current code — confirmed by both carrying the new diagnostic fields) gives a clean, paired comparison:

   | Attempt | Tap → `sign_ins` response | Tap → `pagehide`/redirect | Outcome |
   |---|---|---|---|
   | 1 | 473ms | **1708ms** | failed — bounced to `/`, signed out |
   | 2 | 269ms | **554ms** | succeeded — signed in |

   This splits cleanly either side of WebKit's ~1s transient-user-activation window (per
   [WebKit's own writeup](https://webkit.org/blog/13862/the-user-activation-api/)), confirming the
   activation-expiry hypothesis with real paired same-code data — not just correlation from a single earlier
   sample.
4. In the failed attempt, the `sign_ins` network call itself completed in a normal 473ms — the extra time is
   a ~1235ms gap between that response landing and `pagehide` actually firing, with **zero** matching network
   activity in between (vs. a 79ms equivalent gap in the succeeded attempt).
5. Traced `@clerk/clerk-js`'s actual source
   ([`SignIn.ts`](https://github.com/clerk/javascript/blob/main/packages/clerk-js/src/core/resources/SignIn.ts),
   [`clerk.ts`](https://github.com/clerk/javascript/blob/main/packages/clerk-js/src/core/clerk.ts),
   [`windowNavigate.ts`](https://github.com/clerk/javascript/blob/main/packages/shared/src/internal/clerk-js/windowNavigate.ts))
   on GitHub: the moment `create()` (the `sign_ins` POST) resolves, `authenticateWithRedirectOrPopup` calls
   `window.location.href = ...` synchronously, same tick, no `setTimeout`, no iframe, no cookie-sync
   handshake. **This rules out clerk-js's own processing as the source of the 1235ms gap** — the gap sits
   somewhere JS-invisible, either main-thread contention delaying that callback from running at all, or
   WebKit/iOS-level navigation negotiation after the call is made but before it commits to unloading the
   document. Also confirmed this app's Clerk setup (`client/src/main.jsx`, plain `<ClerkProvider
   publishableKey={...}>`, no `isSatellite`/`domain`) doesn't use cross-subdomain session-sync, ruling out an
   earlier iframe-handshake guess.
6. Verified directly against Clerk's live production Frontend API (`curl` mimicking the real browser
   request — `GET /v1/client` then `POST /v1/client/sign_ins` with `strategy=oauth_google`) that
   `first_factor_verification.external_verification_redirect_url` for this instance is
   `https://accounts.google.com/o/oauth2/auth?...&redirect_uri=https%3A%2F%2Fclerk.kitchenkeeper.kitchen%2Fv1%2Foauth_callback&...`
   — the browser navigates **directly to `accounts.google.com`**, not an intermediate Clerk-hosted hop. That
   origin has had zero prior contact from `/sign-in` at the point the redirect fires, so DNS+TLS setup to it
   is very plausibly cold. (Side effect of that verification call: one harmless, incomplete `sign_in_attempt`
   object was created in production Clerk and will auto-abandon per Clerk's own `abandon_at`; no user/session
   was created, nothing app-visible.)
7. Considered adding a `PerformanceObserver({entryTypes: ['longtask']})` diagnostic to distinguish
   main-thread-contention from WebKit-navigation-negotiation as the cause of the 1235ms gap. Confirmed via
   MDN's `browser-compat-data` (`api/PerformanceLongTaskTiming.json`: `"safari": {"version_added": false}`,
   `"safari_ios": "mirror"`) that WebKit has never implemented the Long Tasks API on desktop or iOS — the one
   platform this investigation is about. Not pursued; would have been dead code on the target platform.
8. (Round-1 review) Attempted the same direct-Frontend-API verification technique from item 6 against
   `/sign-up`'s `oauth_google` strategy, to confirm rather than presume it shares the same destination host.
   Blocked: `POST /v1/client/sign_ups` returned `400 captcha_missing_token` — Clerk has bot-protection enabled
   on sign-up (not on sign-in), which a scripted request can't satisfy the way a real browser session would.
   `/sign-up`'s destination is therefore an **architectural inference** (same Clerk instance → one configured
   Google OAuth app registration, shared across sign-in and sign-up — Clerk doesn't support per-flow OAuth
   app config within a single instance), not a directly verified fact. Stated plainly rather than presented as
   equally confirmed (see §1, §2.2).

**Confidence calibration, stated precisely**: items 1-6 above are directly evidenced; item 8's `/sign-up`
claim is an inference, not independently verified. What is **not** confirmed regardless: that a cold
connection to `accounts.google.com` is what actually fills the 1235ms gap, as opposed to main-thread
contention or WebKit-side navigation negotiation unrelated to connection setup (item 7 — the one diagnostic
that could have distinguished these wasn't feasible to build). This task is a **low-cost, evidence-based
optimization experiment** targeting the one concrete, verified variable in that gap (a cold connection to a
known-different origin) — not a proven fix for a fully diagnosed root cause, and not claimed as one anywhere
in this spec. Framing this honestly matters: TASK-061/062/063 each shipped a plausible-sounding fix at a
related symptom that didn't resolve it, before TASK-064's fourth attempt finally landed on the actual
mechanism. This task's success criterion (§5) is written to have value either way: a materially improved
timing distribution, or an explicit finding that reduces the likelihood connection setup is the dominant
contributor (round-2 review: a negative result doesn't *logically* rule connection setup out entirely — e.g.
WebKit could simply decline to honor the hint, per §6-B — so this is stated as a probabilistic update, not a
proof).

---

## 1. Current State

- No `<link rel="preconnect">` or `dns-prefetch` hint exists anywhere in this codebase today (verified —
  `client/index.html` has no such tag; grepped the rest of `client/src` for `preconnect`/`dns-prefetch`, no
  matches).
- `/sign-in` and `/sign-up` both render Clerk's hosted component directly inline in
  `client/src/App.jsx`'s `AppRoutes()` (`<SignIn routing="path" path="/sign-in" />`,
  `<SignUp routing="path" path="/sign-up" />`) — no dedicated wrapper/page component exists for either route
  today.
- TASK-064's `authTransition.js`/`useAuthRecovery.js` recovery mechanism already ships and independently
  handles the case where a redirect still gets interrupted despite this fix. This task doesn't touch or
  duplicate that mechanism — it's a separate, complementary latency mitigation, not a replacement.
- This investigation directly verified `/sign-in`'s Google-OAuth destination (§0 item 6). `/sign-up`'s
  destination is included in this task's scope on an architectural inference, not direct verification — a
  scripted check was attempted and blocked by Clerk's bot-protection on that endpoint (§0 item 8).

---

## 2. Proposed Experiment

### 2.1 What

Add `<link rel="preconnect" href="https://accounts.google.com">` — **no `crossorigin` attribute**, and this
draft states the mechanism precisely rather than informally (round-1 review correction, accepted): per the
HTML Standard's preconnect processing model, the credentials mode for the established connection defaults to
`true` (credentialed) when `crossorigin` is absent, and is explicitly set to `false` (anonymous) when
`crossorigin="anonymous"`/`crossorigin=""` is present. A normal top-level navigation — which is what the
Google OAuth redirect is — is a credentialed, non-CORS request. The default (no `crossorigin`) is therefore
the form that matches it; adding `crossorigin` would instead prepare an anonymous connection that a
subsequent credentialed navigation would not reuse (only DNS resolution carries over; the TCP+TLS handshake
would need to be redone), defeating the purpose. **Verified against the spec's own algorithm text directly
during this round**, not re-derived from memory.

### 2.2 Where

**Scoped to auth routes — `/sign-in` and `/sign-up`** (round-1 review, accepted; reverses DRAFT-1's Option-A
recommendation). This is a standalone PWA where most launches are by already-authenticated users who will
never visit either route in that session; an unconditional site-wide preconnect would mean every one of those
launches opens an unsolicited connection to a single-purpose third-party origin for a page that's never
rendered. That's a real, not merely theoretical, cost on mobile (battery/radio, not just bytes) — reason
enough to prefer the scoped form even though it's a slightly larger diff, since there's no existing
per-route wrapper component to attach it to today (§1).

`/sign-up`'s inclusion rests on the architectural inference in §0 item 8 (same Clerk instance, one configured
Google OAuth app registration shared across both flows), not a direct verification — the same direct-API
check used for `/sign-in` is blocked by Clerk's bot-protection on the sign-up endpoint specifically.
**Implementation-time gate**: before wiring the hint onto `/sign-up`, do the cheap on-device equivalent of
§0 item 6 for the currently-shipped code — trigger the Google button from `/sign-up` with debug mode on and
confirm `external_verification_redirect_url` (or, absent direct visibility into that value, the resulting
network activity) resolves to `accounts.google.com`. If it doesn't, scope this task to `/sign-in` only and
open a separate follow-up rather than shipping an unverified assumption onto a second route.

**Earliest-injection requirement, defined as behavior, not a lifecycle hook (round-1 review, accepted;
sharpened round-2, accepted)**: the actual requirement is that the hint's `<link>` element becomes
browsing-context-connected **as early as reasonably possible after the auth route becomes active, and before
the Google OAuth control becomes interactive** — not "the wrapper component has mounted," and not a specific
millisecond deadline relative to Clerk's own rendering (round-2 review: preconnect is a hint the browser may
fully honor, partially honor, or skip under resource constraints regardless of when the tag appears — the
application controls *when the hint is created*, not *whether/when WebKit actually opens the connection*;
this is exactly why §6's A/B/C verification model exists rather than a single pass/fail check on tag
placement). Concretely, since this is a client-rendered SPA with a single `index.html` shell (no SSR), there
is a hard floor on how early *any* JS-injected hint can appear: the JS bundle must load and execute, and
React Router must resolve to `/sign-in`/`/sign-up`, before any component-driven injection can run at all — no
lifecycle choice changes that floor.

**Round-2 correction, required**: DRAFT-2 suggested `document.head.appendChild()` called directly in a
component's render path as one option. Rejected — mutating the DOM during React render is an impurity React
doesn't guarantee runs exactly once (Strict Mode's intentional double-invocation in development is one
concrete way this could produce duplicate `<link>` elements), and ties a resource hint's lifecycle to
rendering for no benefit. **The specific lifecycle mechanism is an implementation detail, not part of this
spec** — a `useLayoutEffect` on a small route-level component is one reasonable candidate (fires before
paint, unlike `useEffect`), but implementation should pick whatever mechanism satisfies the behavioral
requirement above without mutating the DOM as a side effect of rendering. Acceptance criterion 1 (§5) checks
the outcome (hint present, early), not the technique used to get there.

### 2.3 What this does NOT do

- Does not touch `client/src/lib/authTransition.js` or `client/src/hooks/useAuthRecovery.js` (TASK-064's
  recovery mechanism) in any way.
- Does not change the `sign_ins` request path or anything on the `clerk.kitchenkeeper.kitchen` side — that
  leg of the round-trip was already fast in both captures (269-473ms).
- Does not move off Clerk's hosted `<SignIn/>` component onto a custom OAuth flow — considered and rejected
  this session specifically because §0 item 5 shows clerk-js already calls `window.location.href`
  synchronously the instant it has the URL; a custom flow would make the identical call at the identical
  moment, buying nothing.
- Does not guarantee the interruption stops happening — see §0's confidence calibration. If the 1235ms gap
  turns out to be dominated by main-thread contention or WebKit-side navigation negotiation rather than
  connection setup, this experiment will measurably do nothing, and TASK-064's two-tap recovery remains the
  safety net either way (no regression risk from that failure mode).

---

## 3. Files

**Allowed:**
- A new minimal wrapper (name/location tbd during implementation — e.g. a small component or a route-level
  effect) that injects the preconnect `<link>` as early as reasonably possible without mutating the DOM
  during React render (§2.2's earliest-injection requirement and round-2 correction) for the `/sign-in` and
  (conditionally, §2.2) `/sign-up` route elements in `client/src/App.jsx`, plus those routes' `element` props
  updated to use it.
- `client/src/App.jsx` — wiring the new wrapper into the two route elements.

**Forbidden:** `client/index.html` (superseded by the scoped approach — see §7 if this changes),
`client/src/lib/authTransition.js`, `client/src/hooks/useAuthRecovery.js`, `client/src/lib/routeDecision.js`,
`client/src/context/AuthContext.jsx`, `client/src/lib/lifecycleLog.js`, all of `server/*` — nothing about
TASK-064's recovery mechanism or the diagnostic instrumentation changes.

---

## 4. Out of Scope

- Root-causing the unattributed remainder of the 1235ms gap (§0 item 7 — no further diagnostic path was
  identified this session).
- Any change to TASK-064's recovery mechanism or its acceptance criteria.
- A custom/non-hosted OAuth flow (§2.3).
- Shipping the preconnect hint to `/sign-up` if the implementation-time on-device check (§2.2) doesn't
  confirm the same `accounts.google.com` destination — falls back to `/sign-in`-only scope plus a separate
  follow-up task, not an unverified assumption shipped anyway.
- TASK-064's "double tap by design" UX decision itself (its spec §3.3) — unchanged regardless of whether this
  experiment reduces how often the second tap is needed.

---

## 5. Acceptance Criteria

1. `<link rel="preconnect" href="https://accounts.google.com">` (no `crossorigin`) is injected synchronously
   during `/sign-in`'s (and, if confirmed per §2.2, `/sign-up`'s) initial render — satisfying §2.2's
   earliest-injection requirement, not merely "present somewhere in the DOM eventually."
2. No additional network requests are introduced by application code on any route other than the scoped auth
   route(s); no other route's rendered output or behavior changes. (Deliberately phrased as testable —
   round-1 review flagged "no performance change" as unfalsifiable.)
3. `npm run build`, `npm run lint` green. No new npm dependency.
4. **Controlled on-device comparison, not an anecdotal pass** (round-1 review, replacing DRAFT-1's "more than
   one sample"): using the existing debug-mode capture (already produces `perfNowMs` on tap and on
   `pagehide`, plus the `sign_ins` Resource Timing entry — §0 items 1-4), collect a paired before/after
   sample set under the same reproduction conditions used this session, recording for each attempt: outcome
   (succeeded/failed), tap→`sign_ins`-response, tap→`pagehide`, and the gap between the two (this session's
   two baseline numbers — 554ms success / 1708ms failure — are illustrative reference points, not statistical
   thresholds). Target ≥10 attempts per condition (before/after).
   - **Alternating is the preferred methodology (round-2 review, promoted from optional to preferred)**:
     `baseline → treatment → baseline → treatment → ...`, not 10 baseline then install then 10 treatment —
     network/device/browser state can drift over a session, and blocking the two conditions confounds that
     drift with the change being tested.
   - **PWA-state hygiene**: force-quit/relaunch the PWA where needed to control for the stale-bundle confound
     already found this session (§0 item 2); note in the raw data whether each attempt followed a fresh
     launch; discard (don't silently average in) attempts missing the diagnostic fields entirely or showing
     an unrelated network failure. Retain raw per-attempt measurements in the handoff, not only summary
     averages.
   - If fewer than ~10 per condition are practically obtainable, note that plainly in the handoff rather than
     presenting a smaller sample as if it met the target.
   - **Do not treat success-rate alone as evidence (round-2 review, required)**: e.g. "8/10 → 9/10 successful"
     is not persuasive at this sample size on its own. The primary comparison is the tap→`pagehide`/redirect
     timing distribution, specifically on the failure side — a real shift there (e.g. failures clustering
     near 600-800ms instead of 1700ms+) is the evidence that matters.
   - Conclude either "the failure-side timing distribution shifted down materially" or "it didn't" — both are
     valid, useful outcomes (§0's confidence calibration).
5. No automated test exists or is expected for this — it's a browser resource hint, not app logic (same
   category as `lifecycleLog.js`, which also has no test suite, per TASK-064 §1's Verification Results).

---

## 6. Verification Steps

Three distinct claims, verified separately rather than conflated (round-1 review):

**A. Hint exists.** `npm run build` / `npm run lint`, plus a DOM check (build output or live page) confirming
the tag is present at the required moment (§2.2's earliest-injection requirement, criterion 1).

**B. Browser appears to have acted on the hint**, where observable. If a Mac + Safari's remote Web Inspector
against the connected iPhone is available, check the Network panel timeline for connection activity to
`accounts.google.com` prior to the OAuth tap. This is genuinely optional — the HTML spec explicitly permits a
user agent to perform a partial handshake or skip preconnect under resource constraints, and WebKit doesn't
guarantee observability here either way. **If this isn't available or doesn't yield a clear signal, say so
explicitly in the handoff rather than silently skipping to C** — that's the honest outcome, not a gap to
paper over.

**C. User-visible timing changed.** The controlled on-device comparison (§5 criterion 4) against this
session's baseline captures.

A vs. B vs. C not all pointing the same direction is itself informative (e.g. hint present + no observable
connection change + no timing change → the gap likely isn't connection-setup time at all — a real, useful
negative result per §0's confidence calibration).

---

## 7. Known Risks / Open Questions

- **Unproven root-cause attribution** (§0's confidence calibration, restated): this experiment targets a
  verified variable, not a proven cause. Absence of measurable improvement is a real, useful finding — it
  reduces the likelihood connection setup is the dominant contributor and points attention back toward
  main-thread contention or WebKit navigation negotiation — but does not *logically* rule connection setup
  out on its own (round-2 review: WebKit declining to honor the hint at all, per §6-B, would look identical
  to "connection setup wasn't the cause" without being the same claim). Not necessarily evidence the
  implementation was wrong either way.
- **Preconnect is a hint, not a guarantee** — actual WebKit/iOS behavior (how long it holds the connection
  open, whether it holds it through the gap typically seen between page load and a user's tap) hasn't been
  verified empirically on this platform; standard practice elsewhere, unconfirmed here specifically (§6-B).
- **`/sign-up`'s destination is an inference, not a verification** (§0 item 8) — gated behind an
  implementation-time on-device check (§2.2) before the hint ships there; genuinely possible the check fails
  and `/sign-up` drops out of scope.
- **Sample-size target (§5 criterion 4) is a real cost** — up to ~20 manual on-device sign-in/out cycles
  against a real Google account is a meaningfully larger ask than DRAFT-1's "a few taps." Worth confirming
  with Connor this is an acceptable trade for the added rigor before implementation starts, rather than
  assuming it.
- If this experiment doesn't help, no regression results — TASK-064's recovery mechanism is unmodified and
  remains the fallback either way.

---

**Status**: ready for implementation. Round-2 architect review (~9.3/10, APPROVE WITH MINOR CHANGE) called
its remaining item "implementation hygiene rather than architectural uncertainty" and stated no further
root-cause investigation round was needed before implementation; this draft incorporates both required
changes and both strongly-recommended-but-not-blocking changes from that round. No further redesign expected
barring something implementation reveals that the spec didn't anticipate. Before implementation begins, flag
§7's sample-size cost (~20 manual on-device cycles) to Connor if not already confirmed acceptable.
