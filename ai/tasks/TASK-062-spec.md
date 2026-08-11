# TASK-062 — iOS Standalone PWA: Google OAuth Requires Signing In Twice

Version: DRAFT-4 — APPROVED FOR IMPLEMENTATION (9.5/10, pending Connor's own final sign-off). Section 7's
on-device navigation capture is a **blocking implementation prerequisite** for selecting the callback-path
constant (Section 3.1), not a reason to withhold architectural approval — if the captured flow doesn't expose
a usable same-origin referrer identifying the OAuth callback, implementation stops and returns with DRAFT-5
rather than substituting a lifecycle heuristic.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-3 | 8.8/10 — revise before approval | Confirmed root-cause framing, detect-and-reload strategy, `isLoaded` gate, standalone scoping, the now-independent single-shot marker, cancellation handling, and file scope as correct (kept, unchanged). Required, all accepted, and stronger than requested in one respect: (1) **the `/sign-in/sso-callback` detection target and the "no `navigate` prop" reasoning were reviewed against current Clerk docs and correctly flagged as needing on-device/version-specific verification rather than being asserted.** Rather than only checking docs, went further and inspected the actual installed `@clerk/clerk-react@5.61.8` package in `node_modules` directly (`client/package.json` confirms the version; `node_modules/@clerk/shared/dist/types/index.d.mts`'s `ClerkOptionsNavigation` type confirms the real router-integration props for this exact installed version are `routerPush`/`routerReplace`/`routerDebug` — `navigate` does not exist in this version's type surface at all, matching the review's point that Core 2 replaced it). `main.jsx` passes neither, only `publishableKey` — re-confirmed against the actual dependency, not paraphrased from docs (Section 3.1, Section 1). Also discovered and disclosed: `@clerk/clerk-js` (the package that actually executes OAuth/session logic in the browser) is hot-loaded from Clerk's CDN at runtime, per `IsomorphicClerkOptions`'s `clerkJSUrl`/`clerkJSVersion` fields — it is not present in `node_modules` and cannot be statically inspected from this repo, which is precisely why the review's Required 1 (capture the actual on-device navigation sequence before relying on any detector) cannot be shortcut by more source-reading and is retained as a blocking pre-implementation step, not softened (Section 3.1, Section 7). (2) **removed the `sessionStorage`-flag fallback from the spec** — accepted as stated: if on-device capture shows the referrer approach doesn't hold, this spec must be revised (DRAFT-5) with a detector redesigned around the actually-observed sequence, not quietly patched with the lifecycle heuristic DRAFT-1 was rejected for (Section 3.1). (3) **marker lifetime precision** — Section 3.3 now states explicitly that the marker must remain set through the reload's entire initialization and is only cleared once the reloaded page's `isLoaded` has resolved to `true` and the sign-in state has been conclusively read, not merely because the reloaded page mounted and observed the marker present (Section 3.3). (4) **acceptance criterion 1 strengthened** to describe the *first* post-OAuth application load reaching the dashboard with no further user action, closing the gap where a technically-eventual success could otherwise satisfy the old wording (Section 6). Two smaller items, both accepted: standalone-detection wording now states explicitly that the check targets `standalone === true`, not `iOS === true` (Section 3.2); `document.referrer` is now described as best-effort, policy-controlled browser evidence rather than a guaranteed signal, with the criterion restated as "available → exactly one reload; absent → no reload" (Section 6, Section 8). Adversarial "no reload during normal post-correction navigation" test added (Section 7). The "harmless future no-op" claim in Section 8 was narrowed to only what the guard design actually proves, per the review's point 12. |
| DRAFT-4 | 9.5/10 — **APPROVED FOR IMPLEMENTATION** | Confirmed every substantive item from DRAFT-3 as correctly resolved: the callback path treated as an empirical prerequisite rather than an assumption, `isLoaded` gate, standalone-only guard, referrer-only detection with no lifecycle heuristic, the no-fallback rule (stop and produce DRAFT-5 rather than improvising), independent `sessionStorage` loop guard, marker lifetime tied to `isLoaded`, cancellation and post-correction navigation coverage, TASK-061 isolation, file scope, and acceptance criterion 1's first-load framing — all kept unchanged. One non-blocking implementation note: Section 3.2's "if the marker happens to be set from an earlier attempt, clear it" reads ambiguously in isolation; the review instructed that Section 3.3's more precise rule (clear only after the reloaded page's `isLoaded` resolves, never merely because the marker was observed present) is authoritative if the two read as contradictory. No spec text change required — noted here for the implementer. Approval is conditioned on Section 7's on-device capture remaining a blocking prerequisite for the callback-path constant specifically (not for architectural approval as a whole) — if that capture doesn't expose a usable same-origin referrer, implementation stops for DRAFT-5 rather than substituting a lifecycle heuristic. |
| DRAFT-1 | 8.7/10 — revise before approval | Confirmed the diagnosis and the "reload `/`, don't restart auth" strategy as correct (kept, unchanged — Sections 0, 2, 6 of the fix's design). Required, all accepted: (1) **the OAuth-return detection mechanism must be resolved, not left as an implementation-time choice between a Clerk hook and a lifecycle heuristic.** Resolved by replacing the `beforeunload`/`pagehide`-flag design entirely with a passive `document.referrer` check against Clerk's own `sso-callback` redirect path — grounded in a confirmed, documented fact (`ClerkProvider` in `main.jsx` has no `navigate` prop wired to React Router, which per Clerk's docs means the `sso-callback` → `afterSignInUrl` transition is a real full-page navigation, not a client-side route change), not a generic tab-lifecycle guess (Section 3.1, replaces old 3.1/3.2/3.3). (2) **reload decision must not fire before Clerk's `isLoaded` is true** — added as an explicit, named invariant and acceptance criterion, not merely alluded to (Section 3.2, Section 6 criterion 6). (3) **workaround must be structurally scoped to the affected environment**, not just "false positives are harmless" — added an explicit `display-mode: standalone` / `navigator.standalone` guard as a required condition, not a defense-in-depth afterthought (Section 3.2). Two required items became largely moot as a side effect of replacing the detection mechanism rather than patching it: flag-consumption-on-cancellation (old concern 4) no longer applies because the referrer check is a passive per-load computation with no persisted state to leak across a cancelled attempt or back-navigation; verifying the marker "survives" the iOS OAuth transition (old concern 5) is reframed as verifying `document.referrer` itself survives that transition, now the primary empirical unknown (Section 8) — still flagged as required verification, not assumed. Both accepted as terminology/rigor improvements: "at most one automatic reload per OAuth initiation" (Section 3.3); two new acceptance criteria — normal signed-out `/` navigation must not trigger a reload, and the `isLoaded` gate (Section 6, criteria 4 and 6). Adversarial navigation/cancellation test added to Verification Steps (Section 7). |
| DRAFT-2 | 9.2/10 — approve after one required correction | Confirmed the referrer-based detection, `isLoaded` gate, standalone-only scoping, and scope discipline (no `navigate`-prop change, no TASK-061 overlap) as correct — all kept unchanged. One required change, accepted: **Section 3.3's loop guard incorrectly made single-shot safety depend on an unverified assumption about whether `window.location.reload()` changes `document.referrer`.** If reload turns out to preserve the referrer unchanged (plausible, previously only flagged as "must verify" rather than designed around), the referrer-only guard would re-satisfy its own trigger condition on the reloaded page and loop. Fixed by making the single-shot guarantee an explicit, independent `sessionStorage` marker (`kk_oauth_reload_consumed`) that is the sole authority for "has this OAuth return already spent its one reload" — completely decoupled from whatever `document.referrer` does or doesn't do across a reload (Section 3.2 step order, Section 3.3 rewritten). `document.referrer` behavior across `reload()` is now documented as a behavioral observation worth noting, not something correctness depends on (Section 8). Also accepted, a precision-only correction: Section 3.1's claim that the missing `navigate` prop "cannot" produce client-side routing was reworded from an asserted fact to an explicit, flagged inference — "the expected Clerk routing behavior for this configuration, which must be verified on-device" — since the review noted the spec already treats it as needing on-device verification and the wording should say so consistently rather than asserting it as settled. One acceptance-criterion strengthening, accepted: criterion on cancellation/loop safety now states explicitly that at most one automatic reload may occur for a single OAuth return, even if Clerk remains signed out after that reload (Section 6). |

---

## 0. Framing

Reported by Connor: on the installed iOS PWA (Add to Home Screen, `display-mode: standalone` — confirmed
from his screenshots by the total absence of browser chrome/URL bar), tapping "Log in" → "Continue with
Google" completes a real Google authentication, then lands the user back on the marketing `LandingPage`
instead of the authenticated app. Tapping "Log in" a second time succeeds instantly, with no password or
Google prompt — confirming the session was actually created by the first attempt and simply wasn't reflected
back into the app's rendered state.

This is a different mechanism from TASK-061 (auth session-race: concurrent 401s after an already-rendered
authenticated session). TASK-062 is specifically about the **initial OAuth redirect round-trip failing to
resolve into a signed-in render**, and is scoped to iOS standalone-PWA installs only — no report of this
happening in regular mobile/desktop Safari or Chrome tabs.

---

## 1. Current State — What Exists Today

- **No browser chrome in any of Connor's screenshots** — status bar only, confirming `display-mode:
  standalone` (the installed home-screen PWA), not a regular Safari tab.
- [`client/src/App.jsx`](../../client/src/App.jsx)'s `PrivateRoute` (lines 22-34) renders `LandingPage` as
  `publicHomeElement` at `/` whenever Clerk's `<SignedOut>` matches. `PublicRoute` (lines 36-45) does the
  mirror-image redirect away from `/sign-in`/`/sign-up` when `<SignedIn>` matches. Both rely entirely on
  Clerk's own `isLoaded`/session state at render time — neither route has any special handling for "just
  returned from an external OAuth redirect."
- [`client/src/main.jsx`](../../client/src/main.jsx) wraps the app in `<ClerkProvider publishableKey={...}>`
  with neither `routerPush` nor `routerReplace` wired to React Router (the actual router-integration props
  for the installed `@clerk/clerk-react@5.61.8` — confirmed directly against the installed package, see
  Section 3.1), and no standalone/PWA-specific configuration.
- Google's OAuth policy blocks sign-in from inside an embedded user-agent (WKWebView). Tapping "Continue
  with Google" from inside the standalone PWA forces iOS to hand the OAuth round-trip to a different browser
  context (observed directly in Connor's screenshots: the `accounts.google.com` step shows real Safari-style
  chrome, unlike the PWA's own chromeless screens either side of it) rather than completing inline. When
  Google redirects back to `kitchenkeeper.kitchen`, the returning navigation does not reliably rehydrate the
  original standalone app instance's in-memory/webview state, even though the session cookie itself is
  correctly written (proven by the second attempt succeeding immediately with no credentials).
- This is a documented, platform-level limitation of iOS "Add to Home Screen" apps combined with OAuth
  redirect flows — reproduced by other OAuth integrations (Firebase, Auth0, generic OAuth+PWA setups), not
  specific to Clerk or to this codebase. No corresponding Clerk configuration flag was found to resolve it
  directly.

---

## 2. Root Cause Analysis

### Observed (from Connor's report and screenshots)

1. User taps "Log in" inside the installed iOS PWA → lands on Clerk's hosted `/sign-in` (chromeless,
   confirming still inside the standalone app).
2. User taps "Continue with Google" → browser chrome appears (`accounts.google.com`), confirming iOS handed
   the OAuth flow to a different context than the standalone app's own webview.
3. Google authentication completes (passkey or password).
4. The app becomes visible again, chromeless once more — but rendering the **signed-out** `LandingPage`, not
   the dashboard.
5. Tapping "Log in" again immediately succeeds with no password/Google prompt — proving Clerk's session was
   genuinely created in step 3; only the app's rendered state failed to reflect it.

### Hypothesis (plausible mechanism, consistent with public reports of the same pattern elsewhere — not
verified against WebKit internals)

Returning from the OAuth hop restores the standalone app's webview from whatever state it captured going
in, rather than performing a full fresh evaluation of current cookies/storage — so Clerk's client-side SDK,
initializing inside that restored context, does not yet see the newly-written session. A subsequent fresh
navigation (the user's second tap) reads current storage correctly and resolves signed-in immediately. The
fix below does not depend on the exact WebKit mechanism — it only depends on the observed pattern (signed-out
render immediately post-OAuth-redirect, followed by an immediately-successful retry), the same
observed-fact-only dependency TASK-061 used for its own hypothesis section.

---

## 3. Proposed Fix

Detect-and-reload: when the app renders the signed-out branch at `/` immediately after an OAuth redirect
round-trip, treat that as **stale, not authoritative**, and force exactly one full page reload so the
webview re-evaluates current cookies/storage from scratch — rather than trusting the render the restored
webview state produced. This does not touch `/sign-in`/`/sign-up` again and does not require the user to
tap anything; the reload is transparent, comparable to a slightly slower first load.

DRAFT-1 designed this around a `sessionStorage` flag set by a page-lifecycle listener before the user left
for Google. The architect review correctly identified this as too weak a signal — a `pagehide`/`beforeunload`
event means "this browsing context is going away," for any reason (OAuth, back navigation, tab close, iOS
process suspension), not specifically "the user started an OAuth hop." DRAFT-2 replaces it with a passive,
computed-at-load-time signal instead of a stateful pre-navigation flag.

### 3.1 Detection: `document.referrer`, target path confirmed on-device before use

**Confirmed directly from the installed dependency, not docs paraphrase:** `client/package.json` pins
`@clerk/clerk-react@^5.61.8`; the actual installed package
(`client/node_modules/@clerk/shared/dist/types/index.d.mts`, `ClerkOptionsNavigation`) shows this version's
real `ClerkProvider` router-integration surface is `routerPush` / `routerReplace` / `routerDebug` — a
`navigate` prop does not exist anywhere in this version's type surface. (Per DRAFT-3's review, correcting
DRAFT-2's stale terminology: Clerk's Core 2 upgrade replaced the single `navigate` prop with this pair;
`@clerk/clerk-react@5.x` is post-Core-2.) [`client/src/main.jsx`](../../client/src/main.jsx) passes neither
— only `publishableKey` — re-confirmed against the real dependency this build actually uses, not an assumed
API surface. Per Clerk's documented behavior for this router-integration model, the expectation is that a
`<SignIn routing="path">` instance without `routerPush`/`routerReplace` wired falls back to full browser
navigation for its own internal step transitions, including whatever happens after the OAuth provider
completes.

**What "whatever happens after OAuth completes" actually is, is not something this repo can fully confirm by
reading source.** `@clerk/clerk-js` — the package that actually executes the OAuth/session logic in the
browser — is not a static dependency in `node_modules`; `IsomorphicClerkOptions`'s `clerkJSUrl`/
`clerkJSVersion` fields (same file) confirm it is hot-loaded from Clerk's CDN at runtime. The best available
*supporting* (not conclusive) evidence for a `/sso-callback`-shaped path comes from
`@clerk/shared`'s own type comment on `AuthenticateWithRedirectParams.redirectUrl`: *"Typically, this will be
a simple `/sso-callback` route that calls `Clerk.handleRedirectCallback` or mounts the
`<AuthenticateWithRedirectCallback />` component."* That documents Clerk's general convention for the
custom-flow API, not a proof that the prebuilt `<SignIn routing="path" path="/sign-in">` component used in
this codebase exposes `/sign-in/sso-callback` as the actual preceding document navigation.

**Per DRAFT-3's review, this must therefore be established empirically before implementation defines the
detector, not inferred and shipped.** Section 7's first verification step is a blocking prerequisite, not a
nice-to-have: capture the real browser-visible navigation sequence (URL, whether each step is a full
document navigation, `document.referrer`, `display-mode`, Clerk `isLoaded`/`isSignedIn`) for the actual
Google OAuth flow on the affected iOS PWA build, then define the detector against the *observed* path.
`/sign-in/sso-callback` is the expected value pending that capture — supported by the evidence above, not
asserted as settled fact — and the implementation should keep it as a single named constant so redefining it
against the observed value is a one-line change, not a redesign:

```js
// client/src/App.jsx (or a small new client/src/lib/oauthReturn.js if extracted)
// EXPECTED_OAUTH_CALLBACK_PATH: confirm via Section 7's on-device capture before relying on this default.
const EXPECTED_OAUTH_CALLBACK_PATH = '/sign-in/sso-callback';

function cameFromOAuthCallback() {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin && ref.pathname.startsWith(EXPECTED_OAUTH_CALLBACK_PATH);
  } catch {
    return false; // no referrer, or unparseable — treat as "not a known OAuth return"
  }
}
```

No flag to set, clear, or leak across a cancelled attempt: a load whose referrer isn't the expected callback
path (a plain visit to `/`, a cancelled OAuth attempt that returns to `/sign-in` instead, back-navigation)
simply never satisfies this check, with no persisted state involved. `document.referrer` is also inherently a
browser-policy-controlled value (Referrer-Policy can reduce or omit it) — this detector is **best-effort
browser navigation evidence, not a guaranteed signal**: when it's available and matches, exactly one reload
occurs; when it's absent or doesn't match, no reload occurs and the user sees today's behavior (tap "Log in"
again). See Section 6, criterion 6.

**No fallback heuristic is authorized in this spec.** Per DRAFT-3's review: if on-device capture in Section 7
shows the referrer-based approach doesn't hold on the actual affected build/device, implementation stops and
this spec is revised (DRAFT-5) with a detector redesigned around the actually-observed navigation sequence —
not patched with a `beforeunload`/`pagehide` lifecycle listener or similar. DRAFT-1 was correctly rejected
for exactly that kind of heuristic; re-introducing it as a quiet "fallback" would undo that correction.

### 3.2 Reload decision — full guard, all conditions required

The reload MUST NOT fire on any single condition alone (particularly not `!isSignedIn` by itself, since
Clerk's `isLoaded` is asynchronous and a mid-initialization read is indistinguishable from a real signed-out
state if not explicitly gated). All of the following must hold:

```text
running in installed iOS standalone PWA   (window.matchMedia('(display-mode: standalone)').matches
                                            || window.navigator.standalone === true)
AND current route is "/"
AND cameFromOAuthCallback() is true                   (Section 3.1 — identifies a *candidate* OAuth return)
AND Clerk isLoaded === true                           (never decide from a mid-initialization read)
AND isSignedIn === false
AND sessionStorage['kk_oauth_reload_consumed'] is NOT set   (Section 3.3 — the sole loop-prevention authority)
→ set sessionStorage['kk_oauth_reload_consumed'] = '1', then window.location.reload()
```

The standalone-PWA guard is a structural exclusion, not a defense-in-depth afterthought: a `/` load in a
regular desktop or mobile browser tab cannot satisfy it regardless of what `document.referrer` says, so the
workaround has no code path in non-affected environments at all. The check is intentionally `standalone ===
true`, not an OS/browser sniff for "is this iOS" — `navigator.standalone` is included only as the
iOS-specific compatibility signal for the same underlying condition `display-mode: standalone` expresses
generically; the guard doesn't need or attempt to identify the operating system itself.

If every condition holds except `isSignedIn === false` (i.e. Clerk resolves signed-in), no action is taken
— this is the common case once the underlying platform state is actually correct, and most OAuth returns
should land here even before any fix, per Connor's own report that the bug is intermittent-by-symptom-only
(second attempt always works). In this branch, if the marker happens to be set from an earlier attempt,
clear it — a successful resolution ends that OAuth return's lifecycle regardless of how it got there.

### 3.3 Single-shot guard — an explicit marker, independent of `document.referrer` behavior

Per DRAFT-2's review: single-shot safety must not depend on what `window.location.reload()` does to
`document.referrer`. Whether the reloaded page's referrer still reads `/sign-in/sso-callback` or reads
something else is **not load-bearing** for correctness — `document.referrer` (Section 3.1) only identifies a
*candidate* OAuth return; a separate, explicit `sessionStorage` marker (`kk_oauth_reload_consumed`) is the
sole mechanism that guarantees the corrective reload fires at most once:

1. On mount, if Section 3.2's guard is satisfied *and* the marker is absent: set the marker, then reload.
2. On the next load (the reload itself), the marker is present. **Per DRAFT-3's review, the marker must
   remain set for the entire duration of this reload's initialization** — it is not cleared merely because
   the page mounted and observed it present. While the marker is present, Section 3.2's `→ reload` branch is
   categorically unavailable, regardless of what `cameFromOAuthCallback()` or a not-yet-settled `isSignedIn`
   evaluate to during this window.
3. Only once this reloaded load reaches `isLoaded === true` — i.e. Clerk has conclusively resolved either
   signed-in or signed-out, not mid-initialization — is the marker cleared. Both outcomes clear it, since
   either way this OAuth return's lifecycle is over:
   - **Signed in:** normal render proceeds (3.2's "if signed in" branch); marker cleared as part of that
     branch.
   - **Still signed out** (a genuinely stale/failed session, not a timing race): marker cleared so a *later,
     unrelated* OAuth attempt in the same tab session isn't silently prevented from ever triggering its own
     corrective reload; the normal signed-out `LandingPage` renders, identical to today's behavior.
4. The failure mode this ordering specifically prevents: clearing the marker at mount-time (before `isLoaded`
   settles) would let a second, concurrent or rapid re-render during the reload's own initialization window
   re-satisfy Section 3.2's guard and trigger a second reload — exactly the loop this mechanism exists to
   rule out. Gating the clear on `isLoaded` closes that window.

This makes the invariant **structural, not empirical**: at most one automatic reload occurs per OAuth
return, true regardless of whatever `document.referrer` turns out to do across a same-document reload. A
genuinely failed/expired session, after that single reload, renders the normal signed-out `LandingPage` —
identical to today's behavior — not a repeated reload loop.

`document.referrer`'s behavior across `reload()` is still worth observing during implementation (see Section
8) but is now documented as a behavioral curiosity, not something this guard's correctness depends on.

### 3.4 Expected user-visible result

Per Connor's direct question during spec discussion: the user should **not** see `/sign-in` a second time.
The reload happens at `/`, not at `/sign-in` — Clerk resolves signed-in on the reloaded page and the app
renders the dashboard directly. A brief flash of `LandingPage` before the reload fires is possible (the
detection happens after React's first render, not before) and is treated as acceptable per Connor's prior
sign-off on this tradeoff; eliminating the flash entirely would require an inline pre-React-mount check in
`index.html`, deferred as unnecessary complexity unless the flash proves visually bad in practice (see
Section 5).

---

## 4. Files

**Allowed Files:**
- `client/src/App.jsx` (referrer-check-and-reload logic)
- A new small file if the detection logic is extracted rather than inlined (e.g.
  `client/src/lib/oauthReturn.js`) — exact structure left to implementation, per Architecture Preservation
  Rule (no speculative abstraction beyond what this fix needs)

**Forbidden Files:** everything else, including all of `server/*` (no server-side change — this is a
client-only rendering/timing issue, no schema or API involvement) and `client/src/api/index.js` (TASK-061's
surface — unrelated to this bug, do not touch).

---

## 5. Out of Scope (explicitly deferred, not part of this spec)

- **Eliminating the pre-reload `LandingPage` flash** via an inline pre-mount check in `index.html`. Adds
  complexity for a cosmetic, sub-second flash; revisit only if it proves visually jarring during
  verification.
- **Steering standalone-PWA users to email-code sign-in instead of Google OAuth** (the alternative "option
  2" discussed before drafting this spec) — a larger behavior change affecting the sign-in method offered to
  a subset of users, not pursued unless the reload approach proves unreliable in practice.
- **Any Android/Chrome PWA equivalent investigation** — Connor's report and screenshots are iOS-specific;
  this spec does not claim Android's installed-PWA + OAuth behavior has the same failure mode, and doesn't
  change anything for it.
- Non-OAuth sign-in paths (email/password, email code) — not reported as affected, not touched.
- **Wiring `routerPush`/`routerReplace` into `ClerkProvider`** (the actual router-integration props for the
  installed `@clerk/clerk-react@5.61.8` — see Section 3.1) **to give Clerk client-side-router integration.**
  Noticed while investigating that their absence is *why* the post-callback transition is expected to be a
  full navigation in the first place. Not pursued here: it wouldn't fix the actual bug (Google's own OAuth hop
  is still an unavoidable full top-level navigation away from and back to the origin, per Google's WKWebView
  policy — the return trip from the callback would still be a fresh page load regardless of Clerk's internal
  router integration), it's a broader change to how Clerk integrates with routing app-wide, and DRAFT-1's
  review already flagged mixing failure domains as something to avoid. Worth its own future investigation only
  if some other reason to want SPA-style Clerk transitions comes up independently.

---

## 6. Acceptance Criteria

1. **On the installed iOS PWA, after a successful Google OAuth authentication, the *first* post-OAuth
   application load reaches the authenticated dashboard, with no user interaction beyond the original
   sign-in flow.** (Per DRAFT-3's review: strengthened from "reaches the dashboard" to specifically the
   first corrective load, so an implementation cannot satisfy this criterion by eventually reaching the
   dashboard through some unrelated later action.)
2. The user does not see `/sign-in` rendered a second time as part of this flow — the self-correction
   happens at `/`.
3. A genuinely failed/expired OAuth attempt (e.g. user cancels the Google prompt) still lands on the normal
   signed-out `LandingPage`, with no repeated/looping reload. **At most one automatic reload may occur for a
   single OAuth return, even if Clerk remains signed out after that reload** — guaranteed by the explicit
   `sessionStorage` marker (Section 3.3), not by any assumption about `document.referrer` surviving a reload.
4. **The automatic reload occurs only in the affected standalone-PWA OAuth-return scenario.** Normal
   standalone-PWA navigation while signed out — including directly opening `/` with no prior OAuth
   round-trip — does not trigger a reload. This is structural (Section 3.2's guard has no path to fire
   without all conditions, including the referrer check, being true), not merely "unlikely."
5. Regular (non-standalone) mobile Safari and desktop browser sign-in — both email/password and Google OAuth
   — are unaffected; this fix must not change behavior for contexts that were not broken. The standalone-PWA
   guard in Section 3.2 makes this a structural exclusion for non-standalone contexts, not just an untriggered
   heuristic.
6. **`document.referrer` is best-effort browser navigation evidence, not a guaranteed signal.** When it is
   available and matches the expected callback path, exactly one reload occurs; when it is absent or doesn't
   match (e.g. stripped by a referrer policy), no reload occurs and the user experiences today's behavior
   (tap "Log in" a second time) — this is an explicit, acceptable degraded case, not a defect.
7. **The reload decision never fires before Clerk reports `isLoaded === true`.** A mid-initialization read of
   `isSignedIn` must never be treated as evidence of a stale post-OAuth session, and the single-shot marker
   (Section 3.3) is never cleared before `isLoaded` resolves on the reloaded page.
8. `npm run build`, `npm run lint`, `npm test` all green.

---

## 7. Verification Steps

- **Blocking capture step, mandatory before writing the detector (Section 3.1, per DRAFT-3's review):** on a
  real iOS device with the PWA installed, walk the actual Google OAuth flow and record, for each step: URL,
  whether it's a full document navigation, `document.referrer`, `display-mode`, Clerk `isLoaded`/
  `isSignedIn`. This answers the real question — "what is the actual browser-visible navigation immediately
  preceding the broken `/` load" — rather than assuming it. If the observed callback path matches the
  expected `/sign-in/sso-callback` (Section 3.1), proceed with the detector as designed, updating only the
  named constant if the exact path differs slightly. **If the observed sequence doesn't support a
  referrer-based detector at all** (e.g. no useful referrer ever appears, or the transition isn't a full
  navigation), stop implementation and bring the finding back for a DRAFT-5 redesign — do not substitute a
  lifecycle-event heuristic to keep moving (Section 3.1).
- Reproduce the original bug pre-fix on a real iOS device with the PWA installed (Connor, per this project's
  standing rule that account creation/credential entry is human-only, not agent-driven) to confirm the repro
  is current, then confirm the fix suppresses it under the same conditions.
- **Adversarial navigation/cancellation test** (added per DRAFT-1's review — directly exercises the
  detection mechanism's boundary, not just "sign in and see if it works"): from the installed iOS PWA, open
  `/sign-in`, start Google OAuth, cancel or back-navigate before completing it, return to `/sign-in`,
  navigate normally to `/`, and confirm **no unexpected reload** (referrer won't match the callback path, so
  the guard should not fire). Then complete a fresh, successful Google attempt and confirm the one-reload
  correction still fires if the stale-render bug still reproduces.
- **Post-correction navigation test** (added per DRAFT-3's review): after a successful corrective reload
  lands the user on the dashboard, manually navigate around the app (e.g. to `/pantry`, back to `/`) and
  confirm no additional automatic reload occurs — the marker's clearing (Section 3.3) must not leave the app
  in a state where ordinary navigation re-triggers the workaround.
- Confirm the single-shot guard directly, per its explicit-marker design (Section 3.3): candidate OAuth
  return detected → Clerk loaded → signed out → marker absent → marker set + reload → re-check on the
  reloaded page → confirm the marker's presence alone blocks a second reload, regardless of what
  `document.referrer` reads on that reloaded page and regardless of whether Clerk resolves signed-in after
  the reload. Also confirm the marker is cleared afterward (both the signed-in and still-signed-out outcomes)
  so a later, unrelated OAuth attempt in the same tab session isn't silently blocked.
- Confirm no regression on: desktop browser email/password sign-in; desktop browser Google OAuth; regular
  (non-installed) mobile Safari tab Google OAuth if feasible to test.
- Follow CONVENTIONS.md's canonical order (local → staging → production checks) even though this change
  carries no migration, consistent with how TASK-061 was verified — this is a client-only change, so
  MIGRATION_LEDGER.md does not apply.
- Given the standing rule that agent-driven browser sessions cannot perform real Google account
  authentication (per TASK-059's Forbidden Exploration and this project's operating rules), the actual
  device-level fix verification (including the feasibility check above) is human-driven; an agent session
  can verify the build/lint/test-green criteria and the non-OAuth regression checks it can reach with
  existing browser tooling.

---

## 8. Known Risks / Open Questions

- **Section 3.1's `/sign-in/sso-callback` target is still an expected value pending on-device confirmation,
  not a settled fact — but the evidence behind it is now as strong as static analysis of this repo allows.**
  Confirmed: the installed `@clerk/clerk-react@5.61.8`'s real router-integration props (`routerPush`/
  `routerReplace`) are unwired in `main.jsx`; `@clerk/shared`'s own type comments describe `/sso-callback` as
  Clerk's typical convention for this kind of redirect. Not confirmed, and not confirmable from this repo:
  the prebuilt `<SignIn routing="path">` component's exact internal behavior, because the code that actually
  executes it (`@clerk/clerk-js`) loads dynamically from Clerk's CDN and isn't present in `node_modules` to
  inspect. This is precisely why Section 7's on-device capture is a blocking prerequisite rather than an
  optional nice-to-have, and why DRAFT-3's review removed the speculative lifecycle-heuristic fallback rather
  than letting it quietly stand in if the capture disagrees. This risk is scoped to *detection* only —
  correctly identifying a candidate OAuth return — and does not affect loop-safety (Section 3.3), which no
  longer depends on any inference about Clerk's navigation behavior at all.
- **`window.location.reload()`'s effect on `document.referrer` is an open behavioral question, explicitly not
  load-bearing for correctness** (per DRAFT-2's review, reaffirmed in DRAFT-3) — the single-shot
  `sessionStorage` marker in Section 3.3 is the sole authority preventing a repeated reload, regardless of
  what the referrer does across a reload. Worth observing during implementation out of general interest, not
  because anything depends on the answer.
- **Root cause lives in WebKit/iOS platform behavior, not in this codebase** — this fix treats the symptom
  (stale render) rather than the underlying storage-sync timing, because there is no application-level fix
  for the platform behavior itself. Per DRAFT-3's review, narrowed to only what the guard design actually
  proves: **if** a future iOS/WebKit version resolves the underlying race such that Clerk is already
  signed-in by the time Section 3.2's guard evaluates, that guard's "if signed in, no action" branch makes
  the reload path a no-op for that specific case — this is provable from the design. It is not a blanket
  guarantee that every possible future platform change leaves the workaround inert; a platform change that
  altered the navigation/referrer shape without fixing the underlying race could still leave the detector
  evaluating against a changed environment, which is exactly why the on-device capture in Section 7 should be
  treated as a check to periodically re-run, not a one-time fact baked in forever.
- **Interaction with TASK-061 surface**: `App.jsx`'s `PrivateRoute`/`PublicRoute` (TASK-061 Section 3.1) are
  the same components this fix adds logic near. Implementation should re-confirm TASK-061's acceptance
  criterion 1 (already-signed-in visits to `/sign-in`/`/sign-up` redirect via client-side `Navigate`, not a
  hard reload) still holds — this spec's reload is scoped to the signed-out-at-`/`-post-OAuth case
  specifically, not a general replacement for that existing client-side redirect.
