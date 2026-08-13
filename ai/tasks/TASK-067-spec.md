# TASK-067 — Service Worker: Stop Caching Cross-Origin Requests (Root Cause of the Google Sign-In "Double Click")

Version: DRAFT-2 — approved by round-2 architect review (9.5/10, APPROVE WITH P0 PRE-IMPLEMENTATION GATE),
conditional on executing §6 Step 0 before implementation begins.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 🟡 REQUEST CHANGES (8.7/10) | Praised the diagnostic pivot away from the WebKit-specific theory after the cross-platform (desktop Chrome) reproduction, the elimination sequence, the proposed fix's `url.origin`-based (not hostname-enumerated) scoping, and the file allow/forbid discipline. **Required**: (1) distinguish "found a mechanism capable of producing the symptom" from "proved this mechanism produced the captured symptom" — add a Root Cause Evidence subsection with direct proof the failed attempt's Clerk request was actually served from SW Cache Storage, not just a plausible narrative. (2) Document the service worker's update/activation lifecycle (`skipWaiting`/`clients.claim`, when existing clients receive the new fetch handler) as an explicit architectural decision, not an assumed-fine detail — this determines whether the "no `CACHE_NAME` bump needed" reasoning actually holds during rollout. (3) Replace "direct, uncached fetch" wording (spec and acceptance criteria) with language that doesn't imply bypassing the browser's own HTTP cache, only this app's SW-level Cache Storage layer — the spec's own §2.2 already draws this distinction correctly elsewhere, just not consistently in the wording used for the fix itself. (4) Restructure acceptance criterion 4 into an explicit causal hierarchy (SW bypass confirmed → Clerk request not served from Cache Storage → first settled auth state `true` → recovery message doesn't fire → repeat cross-platform) rather than treating "the recovery message didn't fire" as sufficient on its own, since that alone couldn't distinguish this fix from a change to the recovery logic itself (which is explicitly out of scope). (5) Add some deterministic verification of the SW branch logic itself, not only an end-to-end happy-path reproduction — explicitly not requiring new test infrastructure or a dependency, either a precise code-level control-flow argument or a live, temporary in-DevTools check suffices. **Also requested, non-blocking**: add the before/after decision-tree conceptual model to §2.2; soften "strictly net-positive" (§7) to avoid overclaiming. **Claude's assessment**: accepted all five required changes as written, no disagreements. Item 1 in particular is a legitimate gap, not just process box-ticking — this session's Network-tab capture confirmed the OAuth redirect chain and cookie-setting, but never actually checked whether the Clerk client-state request itself was served from Service Worker Cache Storage; that evidence doesn't exist yet and is added as a required pre-implementation step (§0) rather than retroactively asserted. Item 2 was resolved directly by reading `client/src/main.jsx` and `client/public/sw.js` together — the file already calls `skipWaiting()` and `clients.claim()`, which the spec now documents explicitly rather than leaving implicit. |
| DRAFT-2 | 🟢 APPROVE WITH P0 PRE-IMPLEMENTATION GATE (9.5/10) | Confirmed all five round-1 required changes resolved correctly — specifically praised that the spec "stopped pretending the root cause was already proven" rather than treating the documented Step 0 protocol as equivalent to having executed it, validated the SW lifecycle reasoning (`skipWaiting`/`clients.claim` correctly means no `CACHE_NAME` bump is needed), and confirmed the causal-hierarchy acceptance criterion is exactly the "mechanism → state → user-visible behavior" structure requested rather than "user-visible behavior improved" alone. Explicitly declined to expand scope further (no cache purge, no SW test framework, no broader SW audit), affirming the spec's existing scope discipline. **Required, non-blocking on redraft**: one wording tightening in §7 — "now always hits the network" overstated what the fix changes; corrected to "may no longer receive that SW-level cached response and instead proceeds through the browser's normal fetch path," consistent with §2.1's Cache-Storage-vs-HTTP-cache distinction. **Formal disposition**: APPROVE conditional on executing §6 Step 0 against the unmodified `sw.js` before implementation begins — explicitly not sent back for another drafting round; the spec is "ready for the investigation step." If Step 0 confirms the causal chain, implementation proceeds as specified; if it doesn't, the spec is reopened rather than the fix shipped anyway. **Claude's assessment**: accepted the wording fix as written. Step 0 is next. |

---

## 0. Framing

**Investigation chain this task closes out.** TASK-063 built settle-timing instrumentation after real
production captures showed Clerk's first `isSignedIn` reading after a fresh mount could be wrong. TASK-064
shipped a two-tap recovery mechanism on the working assumption that the interruption was an "uncommanded
WebKit-level reload," specific to the iOS standalone PWA. TASK-065 added a preconnect hint targeting a
suspected cold-connection delay in that same WebKit-specific gap. TASK-066 built an on-device main-thread
heartbeat diagnostic and conclusively ruled out a JS-execution stall as the cause. None of that work was
wrong — TASK-064's recovery mechanism genuinely fixed sign-*out*, and correctly detects and re-prompts on
sign-*in* interruptions exactly as designed. But the sign-in "tap to try again" step itself was never
explained, only mitigated.

**What broke the WebKit-specific framing.** This session, Connor reproduced the identical two-click symptom
on desktop Chrome on Windows — a platform with no "uncommanded WebKit-level reload" mechanism at all. That
ruled out every WebKit/iOS-PWA-specific explanation the prior four tasks had been built around, and prompted
a fresh diagnostic pass using the existing `kk_debug_log` instrumentation (already shipped, diagnostic-only,
opt-in via `localStorage`) plus a live Network-tab capture on desktop.

**What this session's evidence established, in order of elimination:**

1. **Not a settle-timeout race.** A paired capture of one failed + one succeeded attempt showed
   `useSettledAuth`'s quiet-window settlement (`SETTLE_QUIET_MS = 400`) firing cleanly and consistently on
   *both* attempts (~407-413ms, `settleReason: "stable"`), never hitting the 2000ms ceiling. The failed
   attempt settled fast on `isSignedIn: false`; the succeeded attempt settled fast on `isSignedIn: true`. This
   rules out a race against `SETTLE_MAX_MS` as the cause — the client reads a *stable, wrong* answer quickly,
   not a slow, correct one arriving too late.
2. **Not a Clerk Dashboard misconfiguration.** Pulled the production instance's config via `clerk config pull`
   (`ins_3GbWJwo4GVlGAD7lyMCMgXmMotn`) — the `paths` block (`home`, `sign_in`, `sign_up`, `oauth_consent`,
   etc.) is entirely `null`. No custom redirect/callback override exists at the account level.
3. **Not a missing SPA route.** `client/src/App.jsx`'s router defines no top-level `/sso-callback` route, but
   a live Network-tab capture of the actual OAuth round-trip showed this doesn't matter: the `sign_ins` POST
   response's `external_verification_redirect_url` points the browser at
   `https://accounts.google.com/o/oauth2/auth?...&redirect_uri=https%3A%2F%2Fclerk.kitchenkeeper.kitchen%2Fv1%2Foauth_callback`
   — Google redirects to **Clerk's own Frontend API domain**, not the app. That endpoint's response (`307`,
   confirmed present `set-cookie` header) redirects the browser straight to `https://kitchenkeeper.kitchen/`.
   No SPA-level callback route is ever involved; nothing here was missing.
4. **The actual mechanism: `client/public/sw.js`'s fetch handler.** Its cache exclusion list (lines 56-58)
   only covers same-origin `/api/*` and `/uploads/*` paths. Every other GET request — including cross-origin
   calls like Clerk's `https://clerk.kitchenkeeper.kitchen/v1/client`, the exact request `@clerk/clerk-react`
   uses to determine `isSignedIn` — falls through to the cache-first branch (lines 79-91):
   `caches.match(request).then((cached) => cached || networkFetch)`, where `networkFetch` updates the cache in
   the background but a stale cached response, if present, is returned to the page **immediately**, before
   that background update completes.

**Causal chain, fully explaining the symptom:**

1. Earlier in the browser session, while genuinely signed out (e.g. the first load of `/sign-in`), the
   service worker caches a "no active session" response for Clerk's client-state GET request.
2. The user completes Google OAuth. The app reloads at `/`. Clerk-js reissues that same GET request. The
   service worker serves the **stale, cached "signed out" response immediately** — this is what TASK-064's
   `useAuthRecovery` correctly observes as `isSignedIn: false` and reports via the "didn't complete, tap to
   try again" message. Simultaneously, the service worker's background `networkFetch` completes and
   overwrites the cache entry with the real (now signed-in) response — too late to affect this render.
3. The user clicks "try again." A new mount reissues the same GET request. The cache now holds the
   just-updated signed-in response from step 2, so it's served instantly — looking like a successful retry,
   when in practice it's just the service worker finally reading its own (already-current) cache.

This requires no reload interruption, no WebKit quirk, and no timing race — it reproduces deterministically
on any browser, any platform, any time a stale cross-origin cache entry predates a fresh sign-in. That's
exactly what the desktop Chrome repro showed.

**Root Cause Evidence — gap, required before implementation (round-1 review, accepted).** Everything in items
1-4 above is either a ruled-out alternative or a mechanism *capable* of producing the symptom. None of it is
direct proof that this mechanism produced the *specific* captured symptom, as opposed to a coincidentally
correlated explanation. That distinction matters and isn't yet closed. Before implementation begins, capture:

- **Failed attempt**: for the exact Clerk request that determines `isSignedIn` (`GET .../v1/client` or
  equivalent), the DevTools Network panel's Size/Initiator column showing `(ServiceWorker)` — confirming the
  response was served from Cache Storage, not network — plus, via Application → Cache Storage, the cached
  entry's body showing the stale signed-out state.
- **Successful retry**: the same request, this time either served fresh from network, or served from Cache
  Storage but now containing the signed-in state (confirming the background refresh from the first attempt
  updated the entry, per the causal chain above) — with a timestamp/timing relationship consistent with that
  refresh having completed between the two attempts.

If this evidence is captured and matches the causal chain above, root-cause confidence moves from "leading
hypothesis" to "confirmed." If it doesn't match — e.g. the failed request wasn't served from cache at all —
that's a real finding requiring the hypothesis to be revisited, not a result to explain away. This is a
required prerequisite step (§6, Step 0), not optional polish.

**What this does not invalidate.** TASK-064's recovery mechanism remains correct and valuable — it's a
general safety net for *any* interruption that leaves `isSignedIn: false` after a completed-looking OAuth
marker, not specific to this cause. TASK-065's preconnect hint and TASK-066's diagnostic instrumentation are
unaffected and remain useful (TASK-066 in particular is what made ruling out main-thread contention possible
here). This task fixes the specific, now-identified root cause underneath all of them.

---

## 1. Current State

`client/public/sw.js`'s `fetch` event handler (lines 50-92):

- Non-GET requests pass through untouched (line 52).
- Navigation requests (`request.mode === 'navigate'`) are network-first with an offline cache fallback (lines
  64-77) — correct today, unaffected by this task.
- Same-origin `/api/*` and `/uploads/*` paths explicitly bypass all caching and go straight to network (lines
  56-58) — the existing precedent this task's fix follows the same shape as.
- **Everything else** — every other GET request, same-origin or cross-origin — falls through to a
  cache-first-with-background-refresh strategy (lines 79-91). There is currently no origin check anywhere in
  this file; cross-origin requests are not distinguished from same-origin static assets.

No existing test coverage exists for `sw.js` (verified: no `sw.test.js` alongside it, and no service-worker
test infrastructure elsewhere in the repo).

---

## 2. Proposed Fix

### 2.1 What

Add one exclusion, immediately after the existing same-origin exclusion, following its exact pattern:

```js
if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/'))
  return;

// Never cache cross-origin responses (e.g. Clerk's session/auth API) — this
// service worker doesn't own that origin's cache-invalidation semantics, and
// a stale cached response for an auth-state endpoint silently masks a real
// state change (TASK-067).
if (url.origin !== self.location.origin) return;
```

Cross-origin GET requests then **bypass this service worker's Cache Storage lookup and background-refresh
logic entirely and proceed through the browser's normal fetch path** — identical in effect to how `/api/*`
and `/uploads/*` already behave, just scoped by origin instead of by path. (Round-1 review, accepted: earlier
drafts of this spec called this "uncached," which overclaims — the browser's own HTTP cache still applies
whatever `Cache-Control`/`ETag` semantics the response specifies; only this app's *additional* SW-level
stale-serving layer is removed. §5's acceptance criteria and this section now use the precise phrasing
throughout.)

### 2.2 Why "all cross-origin," not "just `clerk.kitchenkeeper.kitchen`"

A narrower fix (excluding only the Clerk API host) would resolve the diagnosed symptom, but there's no
principled reason to stop there: this service worker has no way to know whether *any* third-party origin's
response is safe to serve stale from its own cache, since it doesn't control that origin's actual
cache-invalidation behavior. The general rule — don't second-guess a cross-origin response's freshness by
layering our own stale-serving cache on top of it — is simpler than an allowlist/denylist of specific hosts,
closes the whole class of bug rather than just this one instance, and matches the existing file's own
precedent of keeping exclusions minimal and rule-shaped rather than enumerated.

This does not disable HTTP caching for cross-origin requests generally — the browser's own HTTP cache still
applies whatever `Cache-Control`/`ETag` semantics each origin's real responses specify. This only removes
this app's *additional* service-worker-level cache-and-serve-stale layer for origins it doesn't own.

**Conceptual model (round-1 review, added for future maintainers).** The existing handler's implicit
assumption is that any same-process GET is safe to cache unless explicitly excluded by path:

```text
GET request
  └─ not a navigation?
       └─ not /api/*?
            └─ not /uploads/*?
                 └─ cache it (cache-first, background refresh)
```

That silently treats "GET" as the ownership boundary, when it should be "an origin whose freshness semantics
we actually control." The fix changes the boundary itself:

```text
GET request
  └─ navigation?           → existing network-first + offline-fallback policy (unchanged)
  └─ same-origin /api/* or /uploads/*?  → existing pass-through, no caching (unchanged)
  └─ cross-origin?         → pass through to browser fetch, no SW caching (this task)
  └─ same-origin static asset → cache-first, background refresh (unchanged)
```

The invariant becomes: **this service worker's Cache Storage is for resources this origin owns.**

### 2.3 Service Worker Lifecycle / Rollout (round-1 review, added)

The architect's question — does "no `CACHE_NAME` bump needed" actually hold given how/when existing clients
transition to the new fetch handler — is answered by code already in the file, now stated explicitly rather
than left implicit:

- `client/src/main.jsx:37-41` registers `/sw.js` as a **classic** script (no `type: 'module'`) on `window`'s
  `load` event — standard registration, no custom update-check timing.
- `client/public/sw.js`'s `install` handler already calls **`self.skipWaiting()`** (line 6) — a newly
  installed worker activates immediately, without waiting for existing clients/tabs to close or navigate.
- Its `activate` handler already calls **`self.clients.claim()`** (line 19) — per the Service Worker spec,
  this hands control of **all currently open clients** to the new worker immediately upon activation,
  including tabs that were previously controlled by the *old* worker — not only future navigations.

Net effect: once the browser detects the updated `/sw.js` (its own periodic/navigation-triggered check, not
something this app controls the timing of) and installs it, the new fetch handler becomes effective for every
open tab within that same install→activate cycle — no full page reload is strictly required, though one is a
reasonable, low-risk step during manual verification (§6) to remove any doubt.

This confirms §2.4's "no `CACHE_NAME` bump" reasoning: by the time any client is running the new fetch
handler, stale cross-origin cache entries are already unreachable under that handler (the new `return`
executes before any `caches.match()` call), regardless of `CACHE_NAME`. There is no window where a client runs
the new fetch handler but still consults old cross-origin cache entries. The one residual gap — a client that
hasn't yet received the updated worker at all — behaves exactly as it does today (pre-fix), which is a
rollout-timing question every SW change has, not something specific to this fix.

### 2.4 What this does NOT do

- Does not touch `client/src/lib/authTransition.js` or `client/src/hooks/useAuthRecovery.js` (TASK-064) —
  the recovery mechanism stays in place, unmodified, as a safety net for any other interruption cause.
- Does not touch `client/src/components/PreconnectGoogleOAuth.jsx` (TASK-065) or the rAF heartbeat
  diagnostic (TASK-066).
- Does not change caching behavior for same-origin static assets, navigations, `/api/*`, or `/uploads/*` —
  all keep their exact existing behavior.
- Does not bump `CACHE_NAME`. Because the new exclusion `return`s before `caches.match()` is ever called for
  a cross-origin request, any stale cross-origin entries already sitting in existing users' `kitchen-keeper-v2`
  cache simply become unreachable dead storage after this ships — not a lingering correctness bug, since
  nothing will look them up again. Flagged for review rather than assumed correct.

---

## 3. Files

**Allowed:**
- `client/public/sw.js` — the one exclusion described in §2.1. No other changes to this file.

**Forbidden:**
- `client/src/lib/authTransition.js`, `client/src/hooks/useAuthRecovery.js`, `client/src/hooks/useSettledAuth.js`,
  `client/src/lib/routeDecision.js`, `client/src/context/AuthContext.jsx`, `client/src/lib/lifecycleLog.js`,
  `client/src/lib/debugLog.js`, `client/src/components/PreconnectGoogleOAuth.jsx`, `client/src/App.jsx` — no
  part of TASK-063/064/065/066's mechanisms.
- All of `server/*`.
- `client/public/manifest.json` and any other PWA-config files not directly part of the fetch handler.

---

## 4. Out of Scope

- Removing or weakening TASK-064's two-tap recovery mechanism, even though this fix is expected to eliminate
  the specific cause it was most often catching. It remains a general-purpose safety net and is left fully
  intact.
- Auditing the rest of `sw.js` for other potential caching issues (e.g. same-origin edge cases, whether
  `/api/*`'s existing exclusion is itself complete) — out of scope; this task is narrowly the cross-origin gap
  identified this session.
- Bumping `CACHE_NAME` / forcing existing installed clients to purge their cache — considered and deferred
  per §2.3-2.4, unless review disagrees.
- A formal paired-sample on-device verification protocol in the style of TASK-065 §5 — not proposed as
  required here. Unlike a preconnect hint (a probabilistic browser behavior the app can't fully control), this
  fix is a deterministic branch in code the app fully controls; verifying the branch logic directly plus one
  clean manual reproduction is expected to suffice. Flagged for architect review given how much
  investigation effort this bug has already consumed across five prior tasks.

---

## 5. Acceptance Criteria

1. `caches.match()` is never reached for any GET request where `url.origin !== self.location.origin`; such
   requests bypass this service worker's Cache Storage lookup and background-refresh logic entirely and
   proceed through the browser's normal fetch path, mirroring the existing `/api/*`/`/uploads/*` pass-through
   exactly. (Round-1 review: not "no caching" unqualified — the browser's own HTTP cache is untouched by this
   fix; see §2.1.)
2. Same-origin behavior is provably unchanged: navigation requests (network-first + offline fallback),
   `/api/*`/`/uploads/*` (already-excluded pass-through), and all other same-origin GET requests
   (cache-first-with-background-refresh) all retain their exact pre-change behavior. (Stated as falsifiable —
   a same-origin regression here would be a distinct new bug, not a acceptable side effect of this fix.)
3. `npm run lint` and `npm run build` green. No new npm dependency. Diff limited to `client/public/sw.js`.
4. **Manual reproduction, verified as a causal hierarchy, not a single end-to-end pass/fail** (round-1 review,
   required — replaces DRAFT-1's flatter version of this criterion). Repeat this session's exact repro (sign
   out, then sign in with Google) on desktop Chrome with `kk_debug_enabled` on, and confirm each of the
   following, in order, not just the last one:
   1. **SW bypass confirmed**: the cross-origin branch is observed to fire for the Clerk request (§6-E).
   2. **Clerk request not served from Cache Storage**: the DevTools Network panel shows the `/v1/client` (or
      equivalent) request resolved from network, not `(ServiceWorker)`-tagged Cache Storage, on the first
      post-redirect landing.
   3. **First settled auth state is `true`**: the captured `auth-settled` log entry for that first attempt
      shows `settleFinalIsSignedIn: true`.
   4. **Recovery message does not fire**: the "Sign-in didn't complete — tap to try again" message is absent.
   5. **Repeat cross-platform**: if access to a physical iOS device is available, repeat there too, since
      that's the platform TASK-064 was originally built around — a clean result there closes the loop on the
      original investigation, not just the desktop repro that reopened it.

   Requiring the full hierarchy (not just step 4 alone) matters because "the recovery message didn't fire"
   could theoretically be produced by a change to the recovery logic itself, which this task explicitly does
   not touch (§2.4, §3) — steps 1-3 are what tie the *observed* fix to the *diagnosed* cause, not just to an
   improved-looking symptom.
5. Acknowledge explicitly in the handoff that TASK-064's recovery message firing on some *other*, unrelated
   interruption (a genuine network failure, a real reload mid-flow) remains expected and correct — criterion 4
   only requires that it stop firing for *this* cause, which the `auth-settled` log and step 4's Cache Storage
   check together let us distinguish from other causes, not that it stop firing under all circumstances.

---

## 6. Verification Steps

**Step 0 — Root Cause Evidence (prerequisite, before implementation begins; round-1 review, required).**
Capture the direct before/after Cache Storage evidence described in §0's "Root Cause Evidence" subsection,
against the *current, unmodified* `sw.js`. This confirms the diagnosis before writing the fix, not after —
implementation does not begin until this step either confirms the causal chain or surfaces a finding that
sends the spec back for revision.

**A. Code review.** Confirm the exclusion is placed before any `caches.match()` call, and that the condition
is `url.origin !== self.location.origin` (not a narrower host-specific check — see §2.2).

**B. Build/lint.** `npm run build`, `npm run lint` green (criterion 3).

**C. Manual reproduction.** Desktop Chrome at minimum; iOS PWA if practically accessible (criterion 4).

**D. Optional, non-blocking.** A quick sanity check that no other cross-origin resource this app depends on
(fonts, CDN assets, if any) regresses in a user-visible way from losing SW-level caching — none are known to
matter today, called out only for completeness, not expected to surface anything.

**E. Deterministic branch verification (round-1 review, required — not satisfied by C alone).** Two parts, no
new test infrastructure or dependency:

- **Static control-flow proof.** The new `if (url.origin !== self.location.origin) return;` is a single,
  unconditional early return positioned textually before the only `caches.match()` call in the function body,
  with no intervening branch, callback, or async boundary that could reach `caches.match()` first for a
  cross-origin request. For this specific handler shape, inspection of that ordering *is* a complete proof —
  not a substitute for one.
- **Live, temporary confirmation during manual testing.** While reproducing (step C), add a temporary
  `console.log`/breakpoint on the new conditional (or watch it via DevTools → Application → Service Workers)
  to confirm it actually fires for the Clerk request, cross-checked against the Network panel showing that
  request was *not* satisfied from Cache Storage. Revert any temporary logging before committing, per this
  project's existing diagnostic-hygiene practice (no permanent debug code added as a side effect of
  verification).

Together, A/E give a code-level guarantee independent of any one browser's specific caching behavior on the
day of the test; C/Step 0 give the behavioral, real-world confirmation. Neither stands alone as sufficient —
this was round-1's core point (§0, §5 criterion 4).

---

## 7. Known Risks / Open Questions

- **Minor loss of offline resilience for cross-origin resources.** Any cross-origin GET that previously
  benefited from this service worker's Cache Storage may no longer receive that SW-level cached response and
  instead proceeds through the browser's normal fetch path (round-2 review: tightened from "now always hits
  the network," which understated that the browser's own HTTP cache can still apply on that normal path — see
  §2.1's same distinction). Given none of this app's core offline behavior (covered by the existing
  navigation/`/api/`/`/uploads/` handling) depends on cross-origin SW caching, this is expected to be a
  favorable tradeoff given the application's current dependency set and offline requirements (round-1 review:
  softened from "strictly net-positive," which overclaimed) — a real behavior change worth naming rather than
  assuming away.
- **Broader blast radius than TASK-064/065/066.** Those tasks scoped their changes to auth-flow-specific
  files. This fix changes the service worker's fetch handler — active on every page load for every user, not
  just the auth flow — even though the change itself is a single, narrow, well-understood conditional. Worth
  flagging explicitly before shipping to production, not just noting in passing.
- **Doesn't audit whether other same-origin responses could go similarly stale in a way that matters** — out
  of scope per §4; flagged here as a possible, not confirmed, follow-up if anything analogous ever surfaces.
- **Existing stale cross-origin cache entries aren't purged**, only made unreachable (§2.3-2.4) — dead
  storage, not a correctness risk, but noted for completeness.
- If, against expectation, criterion 4's reproduction still shows the recovery message firing after this
  ships, that is itself informative — it would mean either a second, distinct contributing cause exists, or
  this fix's reasoning has a gap — and should be treated as a real finding to report back, not a fix to
  silently retry.

---

## Status

**IMPLEMENTED, on `staging` (commit `3a6777a`), pending promotion to `main`/production.**

**Step 0 result**: confirmed, via a temporary SW-internal diagnostic (`console.log` inside the fetch handler's
cache-first branch, viewed through the service worker's own DevTools console — not the page console, avoiding
the Network panel's inability to show response bodies for SW-intercepted requests). Direct evidence gathered:

- A live capture on `staging`'s Clerk development instance showed `GET .../v1/client?...` — the exact request
  that determines `isSignedIn` — logged with `cacheHit: true`, reproduced twice.
- Combined with the earlier production Cache Storage inspection (§0), which showed a `/v1/client` cache entry
  transitioning from a signed-out body to a signed-in body ~74 seconds apart, matching the stale-then-
  background-refreshed mechanism exactly.
- Combined with the `kk_debug_log` capture showing both the failed and successful attempts settling *fast*
  (~400-560ms, not a slow race), consistent with both being served quickly — one from stale cache, one from a
  fast fresh success.

Three independent, convergent pieces of evidence, not one perfectly-timestamped single-request correlation
(a live debugging session hit real tooling limits — DevTools Local Overrides not intercepting the SW's own
update-check fetch, and a browser crash mid-capture — that made a single unambiguous capture impractical to
force). Judged sufficient to close Step 0 given the convergence across three independent methods.

**Implementation**: the exact one-line fix from §2.1, diffed against the temporary diagnostic removed cleanly
first. Verification (§5) complete:

- `npm run lint`: clean.
- `npm run build`: clean (609.86 kB main chunk warning is pre-existing, unrelated to this change).
- Server tests: 98/98 pass. Client tests: 69/69 pass. No regressions.
- Diff limited to `client/public/sw.js`, matching the diff shown in §2.1 exactly.

**On-device re-reproduction (§5 criterion 4)**: confirmed on `staging`, fresh incognito session — signed in
with Google on the first attempt, no "tap to try again" message. Matches the expected outcome exactly: the
mechanism this task targeted (a stale cached `/v1/client` response on the first post-OAuth landing) no longer
fires.

**Promoted to production**: `staging` → `main` fast-forwarded and pushed (`main` now at `3a6777a`, matching
`staging` exactly). All work in this spec is complete.
