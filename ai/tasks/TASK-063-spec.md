# TASK-063 — iOS PWA Double Sign-In/Sign-Out: Don't Trust Clerk's First Post-Mount Reading

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (architect review round 3). Implementation must still satisfy
the Final Acceptance Checklist below (Section 9) and the real on-device verification in Section 7 before this
task is considered done — approval covers the architecture/spec, not a confirmed fix.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🔴 REQUEST CHANGES | Central idea (don't trust the first post-mount reading) approved. Rejected gating correctness on unverified `navigation.type === "reload"`. Required an explicit `loading/settling/settled` state machine, concrete provider placement, removal of `OAuthReturnGuard`, oscillating-trace tests, expanded diagnostics. **Claude's assessment**: accepted nearly all changes; resolved an internal tension the review left ambiguous (re-enter settling on `isLoaded` reverting vs. don't debounce legitimate transitions) by making `settled` terminal per mount; independently verified the review's Clerk-docs citation via WebFetch rather than trusting it, confirming `isLoaded` can revert to `false` but only via `setActive()`/Organizations, which this codebase doesn't use. |
| DRAFT-2 | 🟡 REQUEST CHANGES (~9.2/10, close to approval) | Approved: the `loading→settling→settled` architecture, no navigation-type gate, single shared provider, terminal-per-mount settlement, `OAuthReturnGuard` removal. Required: demonstrate the 2000ms fail-open ceiling doesn't reproduce the original bug via a *slow* legitimate sign-in (settle-false-then-correct-true-after-timeout); rename "fail-open" to avoid implying a directional preference; define exact behavior when `isSignedIn` is `undefined` during settling; state precisely when the quiet-timer starts and that it reads the latest raw value, not a stale closure; reword "same React commit" to a provider-snapshot invariant; add route-level (not just hook-level) regression tests for the actual double-sign-in symptom; add `settleInitialIsSignedIn`/`settleFinalIsSignedIn` diagnostics; label the bfcache-eviction explanation more explicitly as interpretation. **Claude's assessment, incorporated below**: accepted the terminology, invariant-definition, diagnostics, and wording changes directly. On the 2000ms question: added the requested boundary-timing tests, but stated explicitly that no synthetic test can *prove* 2000ms is safe against real Google OAuth/network latency — that's an empirical claim, not a code-logic one — and added the one directly relevant real data point available (122ms observed OAuth-completion latency, log 3) rather than a synthetic stand-in. On route-level tests: checked `client/package.json` and found zero React-component-rendering test infrastructure anywhere in this codebase; rather than silently add `@testing-library/react`/`jsdom` as a side effect of an auth-timing fix, extracted the routing decision into a pure function testable with the existing plain-`node:test` setup, matching this codebase's own established pattern (`splitNdjsonLines` in `api/index.js`). On the `undefined` question: fetched Clerk's docs directly and found no fifth "loaded but undefined" variant documented among its four state shapes — treating the added handling as defensive hardening against an undocumented SDK edge case, not as closing a demonstrated gap, and said so explicitly rather than overstating it. |
| DRAFT-3 | 🟢 APPROVED FOR IMPLEMENTATION | Independently re-verified the `isLoaded`/`isSignedIn` Clerk contract and confirmed DRAFT-3's handling matches it. Agreed the 2000ms question is a production-observation question, not a unit-test question — no further draft required over it. Agreed with keeping the pure `resolveRouteDecision()` function over adding React Testing Library. Two non-blocking implementation notes carried into Section 3.1.2/3.2 below rather than requiring a DRAFT-4: (1) the "latest raw value" must be implemented via a mutable ref updated synchronously on every Clerk change, not a value closed over by the effect that scheduled the timer — already implied by DRAFT-3's wording, now stated as a hard implementation requirement; (2) `resolveRouteDecision()` must stay a pure function of an already-produced auth snapshot — no knowledge of timers, Clerk, or OAuth inside it, so it can't drift into being a second copy of the state machine. One wording softening applied per review: `SETTLE_MAX_MS`'s relationship to the observed 1261ms latency is now phrased as "exceeds it" rather than "has headroom over it," to avoid reading as if 2000ms were empirically validated rather than merely un-contradicted by the one data point available. Full 19-item final acceptance checklist added as Section 9, to be checked off literally during implementation and verification, not just implied by the prose above it. |

---

## 0. Framing

Third investigation of the same user-facing symptom. TASK-061 (auth-redirect race) and TASK-062 (iOS PWA
OAuth-return reload heuristic) both shipped to production, both green on their own tests, and the bug
persisted. This round added opt-in, on-device diagnostic logging (`client/src/lib/debugLog.js`,
`client/src/lib/lifecycleLog.js`, instrumentation in `OAuthReturnGuard`, `authorizedFetch`, and a new
`AuthStateLogger`) and captured three real repro sequences directly from Connor's installed iOS PWA against
production. Every draft of this spec is written from that same captured evidence, refined by two rounds of
architect review that each caught real design gaps before implementation — not from new hypotheses each
time.

**Both prior fixes are confirmed, from real captured logs, not to be the mechanism causing this**:
- TASK-061's retry-then-redirect logic (`authorizedFetch` in `client/src/api/index.js`) engaged correctly in
  every repro that hit it — 6 concurrent `401`s all retried and succeeded once, with no bounce (log 2,
  21:36:01–04). It is not implicated. Untouched by this spec.
- TASK-062's `OAuthReturnGuard` (`client/src/App.jsx:59-95`) never fired in any of the three repros —
  `fromCallback` was `false` and `decision` was `"noop"` on every single evaluation across all three logs,
  **including during an actual completed Google sign-in**. Its detection premise (referrer matching
  `/sign-in/sso-callback`) simply never matched what production actually does. Removed in this draft
  (Section 3.3).

---

## 1. Current State — What Exists Today

`PrivateRoute` and `PublicRoute` (`client/src/App.jsx:31-52`) render Clerk's own `<SignedIn>`/`<SignedOut>`
components directly, with no intermediate state. The moment Clerk's `useAuth()`-backed context reports
`isLoaded: true`, whatever `isSignedIn` reads *at that exact instant* is trusted immediately for the
redirect decision — there is no settling window, no re-check, no distrust of a just-resolved value.

`OAuthReturnGuard` (`client/src/App.jsx:59-101`) and the diagnostic-only `AuthStateLogger`
(`client/src/App.jsx:110-124`) both call Clerk's raw `useAuth()` independently, each getting their own
subscription to the same underlying Clerk context — not a shared, coordinated read.

---

## 2. Evidence — What the Captured Logs Actually Show

*(Content unchanged from DRAFT-1/2 except finding 8, new in DRAFT-3, and finding 2's wording tightened per
review point 14.)*

### Observed (directly captured, three separate repro sessions, all on Connor's installed iOS PWA against
production `kitchenkeeper.kitchen`)

1. **Every state flip (correct or incorrect) coincides with a page reload with no matching call anywhere in
   the codebase.** A repo-wide grep found exactly one `window.location.reload()` call in the entire client
   (`OAuthReturnGuard`'s own), and its logged `decision` was `"noop"` — never `"reload"` — in every single
   evaluation across all three captured logs. The reloads are not caused by our own code.
2. **The reloads are directly preceded by a silent backgrounding signal.** Every `app-boot` in the third log
   is preceded, 30–140ms earlier, by `lifecycle-pagehide` (`persisted: true`) and `visibilitychange:
   "hidden"`. `persisted: true` establishes only that the browser flagged the document as eligible for
   back/forward-cache at that moment — it does not by itself establish *why* the subsequent navigation
   produced a fresh document rather than a restored one (`lifecycle-pageshow` firing with `persisted: false`
   and a fresh `app-boot`/`main.jsx` re-execution is what confirms a real reload happened, separately from
   the `persisted: true` signal). The "evicted from bfcache" framing is offered as interpretation of that
   combination, not as an established causal fact (see Hypothesis, below).
3. **These cycles are too fast and too frequent to be Connor manually backgrounding the app.** Four such
   cycles occurred within 26 seconds of ordinary, continuous sign-in/sign-out interaction ("no other
   screens" — confirmed directly with Connor). Each individual hidden→reload gap was ~30-140ms; the
   ~5-13s gaps are between distinct user actions (tap sign-in, tap sign-out), not between a background and a
   return.
4. **Only one of the four observed reload cycles corresponded to a visible interruption Connor could
   describe** — a brief flash on the very first Google sign-in tap, consistent with iOS's normal
   `ASWebAuthenticationSession` sheet for Google OAuth (expected behavior, not itself a bug). Connor
   explicitly confirmed **no** visible flash for the sign-out-related cycles — those are entirely silent from
   the user's perspective, yet still show the same pagehide/reload signature.
5. **A cross-domain Clerk cookie-sync redirect is ruled out.** Production's Clerk publishable key (extracted
   from the live, already-public production JS bundle, then base64-decoded) resolves to
   `clerk.kitchenkeeper.kitchen` — a proper same-site custom domain, not Clerk's default
   `*.clerk.accounts.dev` host. No cross-domain handshake should be required.
6. **Reload is not the only failure mode — the same instability happens without any reload at all.** In the
   second captured log, Clerk resolved `isSignedIn: true` at `21:46:36.675` with no reload in between, then
   independently corrected to `isSignedIn: false` at `21:46:37.936` — 1261ms later — with zero `lifecycle-*`
   or `app-boot` events anywhere in that window. **This is the single most important finding for the fix's
   design**: it directly disproves any design that only distrusts the first reading on reload-classified
   navigations. The instability is a property of *fresh Clerk resolution*, not of *reload specifically*.
7. **`authorizedFetch`'s retry can go unresolved and unlogged when this happens mid-flight.** In that same
   window, a burst of 6 concurrent `401`s fired but neither `auth-fetch-retry-succeeded` nor
   `auth-fetch-redirect` was logged for any of them — consistent with `window.Clerk.session` becoming `null`
   while `forceRefreshToken()` was in flight, throwing an unhandled error that escaped `authorizedFetch()`
   before either log line was reached (already hardened to log this — see `client/src/api/index.js:47-56` —
   but no capture has confirmed it yet).
8. **New in DRAFT-3, relevant to the 2000ms ceiling question raised in review round 2**: the actual observed
   latency from a real, successful Google OAuth completion to Clerk reporting `isSignedIn: true` was
   **122ms** — log 3, `app-boot` at `21:55:52.185` (the reload landing back from Google) to
   `isSignedIn: true` at `21:55:52.307`. One sample, presumably good network conditions, does not bound
   worst-case latency under degraded conditions — but it is real production evidence that legitimate
   resolution is, at least sometimes, nowhere near the 2000ms ceiling, not a guess.

### Hypothesis (plausible mechanism, not verified against WebKit internals)

Something at the iOS/WebKit level — plausibly memory-pressure-driven bfcache eviction of the standalone PWA's
WKWebView, though the exact trigger could not be determined from client-side JavaScript alone — periodically
hides and reloads the page well within the span of ordinary use, imperceptibly to the user in most cases.
Independent of that, Clerk's own client SDK appears to sometimes report an optimistic/cached `isSignedIn`
value on first resolution after a fresh mount, correcting itself shortly after. **The fix below does not
depend on which of these is the root physical cause, and does not depend on whether a given mount happens to
be classified as a "reload" by the browser either.** It depends only on the confirmed, repeated observation
that the *first* `isLoaded === true` reading after a fresh mount is not reliable, full stop.

---

## 3. Proposed Fix

### 3.1 `useSettledAuth()` — a shared auth-settlement state machine

New hook + provider, `client/src/hooks/useSettledAuth.js`. Explicit three-state model:

```text
status: "loading" | "settling" | "settled"
isSignedIn: boolean | undefined   // meaningful only once status === "settled"
```

State transitions, scoped explicitly to **initial mount only** (Section 3.1.1):

```text
loading   — Clerk's own isLoaded is still false. Mirrors Clerk directly.
    ↓ (Clerk's isLoaded first becomes true)
settling  — isLoaded is true, but this is the FIRST time it has been true this mount.
            Publicly exposes isSignedIn: undefined regardless of Clerk's current raw value.
    ↓ (see 3.1.2 for the exact settlement condition)
settled   — isSignedIn is now exposed as trustworthy and current.
            TERMINAL for this mount's lifetime (Section 3.1.1).
```

No navigation-type check anywhere in the correctness path. Every mount goes through `settling`,
unconditionally. `performance.getEntriesByType('navigation')[0]?.type` is still captured, but purely as
diagnostic metadata (Section 3.4), never as a gate.

Constants: `SETTLE_QUIET_MS = 400`, `SETTLE_MAX_MS = 2000`. Both explicitly provisional. `SETTLE_MAX_MS`
exceeds the directly observed 1261ms self-correction latency (Section 2 finding 6) and the observed real
OAuth-completion latency of 122ms (finding 8) — but that observation is not treated as a worst-case bound
under degraded network conditions, which is not something a synthetic test can establish either (Section 8).
`SETTLE_QUIET_MS` has no independent justification beyond "some quiet period is better than none." Both are
expected to be retuned from the `settleElapsedMs` telemetry (Section 3.4) once real usage data exists.

#### 3.1.1 Why `settled` is terminal per mount, not re-entrant

Clerk's own docs confirm `isLoaded` can revert to `false` after first becoming `true` — but the only
documented trigger is switching organizations via `setActive()` (verified directly via Clerk's docs, not
taken on faith from the review's citation). This codebase never calls `setActive()` and doesn't use Clerk
Organizations anywhere (confirmed by grep across `client/src`) — so that specific trigger cannot occur here
today. Re-entering `settling` every time `isLoaded` blips would risk silently re-debouncing a legitimate,
deliberate sign-out or sign-in by up to 2 seconds.

Decision: `settled` is reached once per mount and is terminal. After that point, `isSignedIn` changes (sign
in, sign out, or — if it were ever to happen — an `isLoaded` blip from some future Clerk feature) pass
through to consumers immediately and unbuffered, identical to today's pre-fix behavior. Safe by construction
even if the documented trigger becomes reachable later: the worst case reverts to today's existing (unfixed
but not newly broken) behavior for that specific follow-on transition, never reintroducing settling delay
where a user is actively waiting on a deliberate action.

#### 3.1.2 Settlement condition — exact semantics (new in DRAFT-3, per review point 5/7)

Precise definition, to close the implementation ambiguity the review flagged — this is exactly the kind of
detail a naive `useEffect` + `setTimeout` implementation could get wrong via a stale closure:

- The provider maintains an **internal** "latest raw Clerk `isSignedIn`" value at all times, updated
  synchronously on every Clerk context change, regardless of `status`. **Implementation requirement (round-3
  review):** this must be a mutable ref (e.g. `useRef`), updated directly on every Clerk change, not a value
  captured by whatever closure scheduled the settlement timer/effect — a `setTimeout` callback that reads
  `isSignedIn` from its enclosing effect's closure instead of from the ref is exactly the stale-value bug
  this invariant exists to prevent.
- The quiet timer's anchor: it starts (or restarts) **the instant the internal raw value changes** — not at
  the moment `isLoaded` first becomes `true`. If `isSignedIn` resolves directly to a stable boolean with no
  further changes, the timer starts once, at that first resolution, and settlement occurs `SETTLE_QUIET_MS`
  later (or at `SETTLE_MAX_MS`, whichever is sooner).
- The max-deadline anchor is different and fixed: `SETTLE_MAX_MS` is always measured from the moment
  `settling` was entered (i.e. `isLoaded` first became `true`), never reset by subsequent changes — this is
  what makes it a hard ceiling rather than something oscillation could push out indefinitely.
- **When the quiet timer or the max deadline fires, the value it publishes is always the current internal
  raw value read at that instant** — never a value captured in a closure when the timer was scheduled. This
  is the specific bug class the review was flagging; stated here as a hard implementation requirement, not
  left implicit.
- `isSignedIn === undefined` while `isLoaded === true`: Clerk's docs describe exactly four state shapes
  (Loading, Signed-out, Signed-in-with-org, Signed-in-without-org) as a discriminated union — there is no
  documented fifth "loaded but undefined" variant, so this combination isn't expected to occur in practice.
  Treated as defensive hardening against an undocumented SDK edge case, not as a demonstrated gap: if it ever
  occurs, it does not count as a stable value for the quiet-timer's purposes (does not start or satisfy the
  quiet window) and does not itself terminate `settling` — only the max deadline can settle on it, exactly
  like any other never-stabilizing value (Section 3.1's transition rules already cover this case without
  a special branch).

#### 3.1.3 Terminology (per review point 3)

The behavior at `SETTLE_MAX_MS` is **not** described as "fail-open" anywhere in this draft — that phrasing
wrongly implies a directional preference (e.g. "prefer authenticated"). It is a **bounded fallback to the
latest observed Clerk state**: whatever the internal raw value is at the instant the deadline fires, in
either direction, with no bias toward signed-in or signed-out. The only guarantee is that settlement always
occurs by `SETTLE_MAX_MS` — never that it resolves to any particular value.

### 3.2 `PrivateRoute` / `PublicRoute` — branch on `status`, via a pure, independently-testable decision
function (per review point 11/12, reframed — see Section 7 for why)

Both currently branch on Clerk's `<SignedIn>`/`<SignedOut>` components directly (`client/src/App.jsx:31-52`).
Change to explicit conditionals against `useSettledAuth()`. To make the actual *routing decision* — not just
the hook's internal state machine — independently regression-testable without introducing any new test
infrastructure, extract it as a pure function in the same file:

```js
// exported for testing; not part of the public component API
export function resolveRouteDecision({ status, isSignedIn }, { hasPublicHome, pathname }) {
  if (status !== 'settled') return 'render-nothing';
  if (isSignedIn) return 'render-children';
  if (hasPublicHome && pathname === '/') return 'render-public-home';
  return 'redirect-to-sign-in'; // PrivateRoute; PublicRoute's own call site inverts the isSignedIn check
}
```

(Exact shape/signature is implementation's call — the requirement is that the redirect/render decision
itself is a plain function taking primitive inputs and returning a primitive result, callable from
`node:test` with no DOM, mirroring `splitNdjsonLines`'s existing precedent in `api/index.js`.) `PrivateRoute`
and `PublicRoute` become thin wrappers that call this function and render accordingly.

**Implementation requirement (round-3 review):** `resolveRouteDecision()` must stay a pure function of an
already-produced auth snapshot (`status`, `isSignedIn`, plus route-level inputs like `pathname`) — it must
not know anything about timers, Clerk, settlement internals, or OAuth. Its only job is "given this snapshot,
what should this route do." Keeping it pure this way is what makes it independently testable without DOM
infrastructure (Section 7) and prevents it from drifting into a second, competing copy of the state machine
in `useSettledAuth()`.

### 3.3 `OAuthReturnGuard` — removed

- Its detection premise (referrer starting with `/sign-in/sso-callback`) never matched once across three
  real repro sessions, **including a session containing an actual, successfully completed Google sign-in** —
  direct evidence the premise doesn't hold in this app's actual production OAuth flow, not just "wrong
  scenario captured so far."
- It calls `window.location.reload()` unconditionally when its (evidently wrong) condition is met. Leaving
  that capability live in the same auth-critical path as the new settlement state machine is a real
  coexistence risk — an uncontrolled reload firing during an active `settling` window was never tested for.
- The new mechanism addresses the same stale-auth-timing class without relying on the callback-referrer
  heuristic or forcing a page reload (reworded per review point 9 — not claimed as a strict behavioral
  superset, since the old guard could force a reload and the new mechanism deliberately never does).

`EXPECTED_OAUTH_CALLBACK_PATH`, `cameFromOAuthCallback()`, `isStandalonePwa()`, and
`OAUTH_RELOAD_MARKER_KEY` in `client/src/lib/oauthReturn.js` are removed along with it. `isStandalonePwa()`
is also used by `main.jsx`'s `app-boot` diagnostic log — keep that one usage by relocating just that function
to `client/src/lib/debugLog.js` or inlining it, implementation's call.

### 3.4 Diagnostics

Add to the existing `app-boot`/`clerk-auth-state` diagnostic events (all still gated behind the existing
opt-in `isDebugEnabled()` — no change to who sees this):
- `navigationType` — `performance.getEntriesByType('navigation')[0]?.type`, captured for correlation, not
  used for any correctness decision.
- On each settlement: `isSettled`, `settleElapsedMs`, `settleReason` (`"stable"` | `"timeout"`), and — new
  per review point 13 — `settleInitialIsSignedIn` (the raw value at the moment `settling` was entered) and
  `settleFinalIsSignedIn` (the value actually published at settlement). Together these let a future capture
  read directly as e.g. `settle: initial=false final=true elapsed=742ms reason=stable navigationType=reload`
  without having to reconstruct it from separate raw `clerk-auth-state` events.

---

## 4. Files

**Allowed Files:**
- `client/src/hooks/useSettledAuth.js` (new)
- `client/src/hooks/useSettledAuth.test.js` (new — state-machine unit tests)
- `client/src/context/AuthContext.jsx` — mount `SettledAuthProvider` **inside** `AuthProvider`'s existing
  tree position. Exact resulting order: `ClerkProvider` (main.jsx, unchanged) → `AuthProvider` →
  `SettledAuthProvider` → the rest of the app. Mounted exactly once for the application's lifetime.
- `client/src/App.jsx` — `PrivateRoute`, `PublicRoute` (switch to settled state + extracted decision
  function, Section 3.2); removal of `OAuthReturnGuard` and its import. `AuthStateLogger` untouched (still
  reads raw `useAuth()` — diagnostic-only, should keep showing real unsettled values for comparison).
- `client/src/App.test.js` or similar (new — pure decision-function tests, Section 3.2/7)
- `client/src/lib/debugLog.js` and/or `main.jsx` (diagnostic field additions, Section 3.4; relocating
  `isStandalonePwa()` per Section 3.3).
- `client/src/lib/oauthReturn.js` — deleted.

**Forbidden Files:** `client/src/api/index.js` (TASK-061's surface, already correct per Section 2 — no
change proposed), `server/*` (no server-side change proposed), any other client file. **No new
dependencies** — the extracted pure-function approach in Section 3.2 exists specifically so this holds
(no `@testing-library/react`, no `jsdom`, no DOM-rendering test infrastructure of any kind).

---

## 5. Out of Scope

- Determining the actual OS/WebKit-level cause of the silent reload cycles — not knowable from client-side
  JavaScript. The fix is deliberately cause-agnostic.
- Removing or replacing the diagnostic logging added earlier this investigation (`debugLog.js`,
  `lifecycleLog.js`, the `AuthStateLogger` component, the hardened error logging in `authorizedFetch`) — a
  future cleanup task once this fix is confirmed working, not this one.
- Any change to `authorizedFetch`'s retry/redirect policy itself (TASK-061's surface, Section 2 finding 7).
- Handling for `isLoaded` reverting via Clerk Organizations/`setActive()` — not reachable in this codebase
  today (Section 3.1.1).
- **Proving, via any unit test, that `SETTLE_MAX_MS = 2000` is safe against real-world Google OAuth/network
  latency.** This is explicitly out of scope because it is not something a synthetic test *can* establish —
  it's an empirical claim about third-party SDK and network timing, not a code-logic property. Addressed
  instead via Section 2 finding 8's real data point and the on-device verification step in Section 7.

---

## 6. Acceptance Criteria

1. **Every mount goes through `settling` before `settled`** — no navigation-type-based bypass exists in the
   correctness path. Legitimate fresh launches incur up to `SETTLE_QUIET_MS` of added time before rendering,
   same as any other mount; `navigationType` is logged so this cost is measurable from real usage.
2. **Neither `PrivateRoute` nor `PublicRoute` may redirect on an unsettled reading.** Covers, at minimum:
   - `false → true` (stable) — settles on `true` once quiet.
   - `true → false` (stable) — settles on `false` once quiet — the directly observed 1261ms case (Section 2
     finding 6).
   - `true → false → true` — resets the quiet timer on each change, ultimately settles `true`.
   - `false → true → false` — same, ultimately settles `false`.
   - `false → true` at ~1500ms and at ~1900ms after entering `settling` — both settle `true`, exercising the
     debounce-reset mechanic right up against the `SETTLE_MAX_MS` boundary (per review point 2/12; see
     Section 8 for what this test does and does not prove).
   - A value that never stabilizes settles at exactly `SETTLE_MAX_MS` on whatever the current raw value is at
     that instant (bounded fallback, Section 3.1.3, no hang).
   - `isSignedIn === undefined` while `isLoaded === true` never satisfies the quiet window on its own
     (Section 3.1.2).
3. **Legitimate sign-in is not slowed by settlement machinery beyond the initial mount** — after first
   reaching `settled`, a user-initiated sign-in on the same mount reflects immediately, not re-debounced.
4. **Legitimate sign-out is not slowed by settlement machinery beyond the initial mount** — same, for
   sign-out. Matters specifically because the repro used to verify this fix *is* sign-in-then-sign-out on one
   continuous mount.
5. **All consumers read the same settled-auth snapshot from the single `SettledAuthProvider`** — no
   independent per-consumer settlement timers or states (reworded per review point 10; this is the invariant
   that actually matters, not an implementation-level claim about React's commit scheduling).
6. **The `resolveRouteDecision`-equivalent pure function (Section 3.2) correctly reflects the double-sign-in
   fix at the routing-decision level**, not just at the hook's internal state-machine level — specifically:
   during `settling` with a stale `false` about to correct to `true`, the decision is `render-nothing`, never
   `redirect-to-sign-in`; during `settling` with a stale `true` about to correct to `false`, the decision is
   never `render-children` for a route that should be gated.
7. `OAuthReturnGuard` and `client/src/lib/oauthReturn.js` are removed with no orphaned imports/exports
   remaining.
8. No new npm dependencies added.
9. `npm run build`, `npm run lint`, `npm test` all green.

---

## 7. Verification Steps

- Unit tests for `useSettledAuth()`/`SettledAuthProvider` covering every trace in Acceptance Criterion 2.
- Unit tests for the extracted routing-decision function (Acceptance Criterion 6) — plain `node:test`, no
  DOM, no new dependencies, consistent with this codebase's existing testing style (mirrors
  `splitNdjsonLines` in `client/src/api/index.js`, tested the same way in
  `client/src/api/index.ndjson.test.js`). This is deliberately *not* a rendered-component/route integration
  test — the project has no React-component-testing infrastructure today (checked `client/package.json`
  directly), and adding one is a bigger infrastructure decision than this bugfix should make unilaterally. If
  Connor wants that instead of the pure-function approach, that's a explicit call to make before
  implementation, not something to default into.
- Regression check: TASK-061's adversarial concurrent-401 test
  (`client/src/api/index.authRetry.test.js`) must still pass unmodified — this spec does not touch
  `api/index.js`.
- Confirm no remaining reference to `OAuthReturnGuard`, `oauthReturn.js`, `cameFromOAuthCallback`,
  `EXPECTED_OAUTH_CALLBACK_PATH`, or `OAUTH_RELOAD_MARKER_KEY` anywhere in `client/src` after removal, except
  the relocated `isStandalonePwa()` usage.
- **On-device verification, same repro Connor already has a working recipe for** (sign in, sign out, no
  other screens), with debug logging enabled: confirm the captured log now shows `settling`→`settled`
  transitions suppressing the incorrect reads previously visible as raw `clerk-auth-state` flips, and record
  the actual `settleElapsedMs`/`settleReason`/`navigationType`/`settleInitialIsSignedIn`/
  `settleFinalIsSignedIn` distribution from this real attempt — the first real data toward validating or
  retuning the two provisional constants, and the only way to actually answer the 2000ms-safety question
  raised in review round 2 (Section 8).

---

## 8. Known Risks / Open Questions

- **Whether `SETTLE_MAX_MS = 2000` is safe against real-world Google OAuth/session-restoration latency is
  not resolved by this draft, and cannot be resolved by any unit test** — that's the review's central round-2
  concern, and it's a fair one. The added boundary tests (Acceptance Criterion 2) prove the debounce-reset
  mechanic works correctly right up to the ceiling; they do not and cannot prove 2000ms is long enough for a
  real slow OAuth completion under bad network conditions, because that's an empirical fact about Clerk and
  the network, not about this code. The one real data point available (122ms, Section 2 finding 8) is
  reassuring but is a single sample under presumably good conditions. This is genuinely only resolvable by
  the on-device verification step (Section 7) and, more robustly, by real `settleElapsedMs` distribution data
  after shipping — flagged here explicitly rather than glossed over as solved.
- **`SETTLE_QUIET_MS`/`SETTLE_MAX_MS` remain provisional**, tied to new telemetry for future tuning.
- **Every mount now incurs some settlement latency**, including the common, non-buggy case — an accepted UX
  cost, not a free change; `navigationType` + `settleElapsedMs` logging exists so this cost is visible and
  revisitable.
- **`isLoaded` reverting via Clerk Organizations is out of scope** because it's unreachable in this codebase
  today, not because it's been solved.
- **`isSignedIn === undefined` handling (Section 3.1.2) is defensive, not evidence-based** — Clerk's
  documented state shapes don't include this combination; the handling exists in case the SDK's actual
  runtime behavior diverges from its documented shape, not because this has been observed.
- **Section 2 finding 7 (unhandled `forceRefreshToken()` rejection) is still not addressed by this spec** —
  already-shipped diagnostic hardening only.
- This is the third fix attempt at the same user-facing symptom, and the third draft of this attempt
  specifically — two rounds of architect review have each caught a real design gap (the reload-gating premise
  in round 1, the undefined settlement semantics and unverified timeout-safety claim in round 2) before
  either shipped. That's a materially different situation than TASK-061/062's single-pass process, but the
  2000ms question above is explicitly still open, not resolved by revision alone.

---

## 9. Final Acceptance Checklist (round-3 review, approved for implementation)

Verify each item literally during implementation and code review — this list exists specifically so
approval doesn't rely on the prose above being remembered correctly:

- [ ] No `navigation.type` dependency anywhere in correctness logic (diagnostic-only use is fine).
- [ ] Single `SettledAuthProvider`, mounted exactly once, inside `AuthProvider`.
- [ ] `loading → settling → settled` implemented as an explicit state, not an inferred boolean combination.
- [ ] Every initial mount goes through `settling` — no bypass.
- [ ] Quiet timer resets on every raw `isSignedIn` change (Section 3.1.2).
- [ ] Maximum deadline is anchored to entry into `settling`, never reset by subsequent changes.
- [ ] Timeout/settlement always reads the latest value from a ref, never a closure-captured value.
- [ ] `isSignedIn === undefined` cannot satisfy the quiet period on its own.
- [ ] Settlement is terminal per mount — no re-entering `settling` later on the same mount.
- [ ] Post-settlement sign-in reflects immediately, not re-debounced.
- [ ] Post-settlement sign-out reflects immediately, not re-debounced.
- [ ] `PrivateRoute`/`PublicRoute` cannot redirect while `status !== "settled"`.
- [ ] `resolveRouteDecision()` (or equivalent) is a pure function, independently tested, with no knowledge of
      timers/Clerk/OAuth internals.
- [ ] `OAuthReturnGuard` and `client/src/lib/oauthReturn.js` fully removed, no orphaned references.
- [ ] No new npm dependencies added.
- [ ] TASK-061's `client/src/api/index.authRetry.test.js` untouched and still green.
- [ ] Diagnostics capture `navigationType`, `settleInitialIsSignedIn`, `settleFinalIsSignedIn`,
      `settleElapsedMs`, `settleReason`.
- [ ] `npm run build`, `npm run lint`, `npm test` all green.

Deployment verification gates (required before treating TASK-063 as solved, not before merging the code):

- [ ] Real iOS PWA repro performed after deploying (sign in, sign out, no other screens — Connor's existing
      recipe).
- [ ] Captured log confirms `settling`→`settled` behavior actually suppresses the incorrect reads previously
      visible as raw `clerk-auth-state` flips.
- [ ] Observed `settleElapsedMs` distribution from that real attempt recorded, as the first real input toward
      deciding whether `SETTLE_QUIET_MS`/`SETTLE_MAX_MS` need retuning.
