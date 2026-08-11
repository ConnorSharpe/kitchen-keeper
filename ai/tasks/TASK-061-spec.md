# TASK-061 — Auth Session Race: Spurious Post-Sign-In Redirects

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (pending Connor's own final sign-off). Section 3.1 has
already been implemented in the working tree (uncommitted, not deployed) as an immediate fix during live
debugging; it is included here for retroactive review rather than having skipped review entirely. Section
3.2 is approved but not yet implemented.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-2 | 9.7/10 — APPROVE, one minor clarification requested | Confirmed all eight DRAFT-1 required/recommended items closed, specifically praising the empirically-grounded retry-safety argument, `authorizedFetch()` as "probably the strongest design decision in DRAFT-2," the single-flight refresh's `.finally()` reset, and the RCA's Observed/Hypothesis split as "architecturally mature." Explicitly declined to add further scope (lazy loading, server Clerk config, retry libraries, exponential backoff, React Query/SWR, etc.), confirming the two-file boundary is correct. One non-blocking clarification, accepted: the code sketch in 3.2.2 already guarded against a literal `Bearer undefined` header (`if (freshToken) retryHeaders['Authorization'] = ...`), but left the case of `forceRefreshToken()` resolving to no token at all only implicit — it would still fire a headerless retry that's guaranteed to 401 again, reaching the same redirect outcome but via one wasted round-trip. Changed to short-circuit directly to `redirectToSignIn()` when no fresh token comes back, skipping the pointless retry fetch entirely (Section 3.2.2). |
| DRAFT-1 | 9.0/10 — revise before approval | Confirmed the Issue A/Issue B framing as architecturally correct and asked that it be kept as the conceptual model (kept, unchanged). Confirmed `skipCache: true` is a real, documented Clerk mechanism (kept), with one correction accepted: `getClerkToken()` itself is an uncached *wrapper*, but the underlying Clerk `getToken()` is normally cached and only hits the network near expiry — DRAFT-1's "thin, uncached wrapper" phrasing conflated the two (Section 1, reworded). Five required changes, all accepted: (1) **POST/PATCH/DELETE retry safety — verified empirically rather than accepted on the review's suggested wording.** Read the actual server code rather than asserting the "Preferred" resolution by assumption: `clerkAuth` (`server/middleware/clerkAuth.js:6-9`) is mounted via `router.use(clerkAuth)` ahead of every handler in all 12 route files (confirmed by grep across `server/routes/*.js`), and returns 401 before its own only side-effecting call (`householdService.getOrCreate`) ever runs — so a 401 provably means the route handler never executed. A repo-wide grep for every other `401` in the server found exactly one more source (`push.js`'s cron-secret check), which the client's `request()`/`postStream()` never calls. Retry is safe for all methods in this codebase specifically — now stated as a verified fact with file:line citations, not an assumed default (Section 3.2.1). (2) **accepted, reworded** — "a genuinely expired session will fail both attempts" no longer implies a second 401 *proves* invalidity; restated as a conservative redirect policy (Section 3.2, Section 6). (3) **accepted, no longer left as a judgment call** — designed a concrete shared `authorizedFetch()` helper owning token acquisition, the 401 retry, and the redirect decision, with `request()`/`postStream()` reduced to calling it and handling their own response bodies (JSON vs. stream) (Section 3.2.2). (4) **accepted as mandatory, per the review's own conditional ("if the observed failure really produces the dozen-plus simultaneous 401s described in the RCA") — the RCA does describe exactly that** — added a single-flight forced-refresh promise so N concurrent 401s trigger exactly one `skipCache` call, not N (Section 3.2.3). (5) **accepted** — added a redirect-dedup guard alongside the single-flight refresh: without it, single-flight only fixes the refresh-call fan-out, not a still-possible fan-out of *redirect* attempts if the refreshed token is retried by many callers and still fails for all of them. Not explicitly requested by the review, but the same concurrency concern the review raised in Section 7 applies to the redirect step, not just the refresh step (Section 3.2.3). Two verification/acceptance-criteria strengthenings, both accepted: PublicRoute's criterion now states the redirect must happen via client-side routing, not a hard reload (Section 6); acceptance criterion 3 split into Case A (expired session: both attempts 401, exactly one redirect) and Case B (valid session, endpoint-specific 401: same outcome, no infinite loop) (Section 6); an adversarial concurrent-401 test added to Verification Steps (Section 7). RCA restructured into explicit Observed-fact vs. Hypothesis subsections per the review's suggestion (Section 2). |

---

## 0. Framing

Found during a TASK-059 production smoke-test session, not from a bug report: Connor signed in with Google
on both production and a local dev instance and landed back on what looked like the sign-in page each time,
despite Clerk itself registering a real, successful authentication event. Live investigation (browser
console/network, server logs, `window.Clerk` state, and reading the actual client code) traced this to two
distinct, compounding issues — one routing gap, one request-handling race. Both are client-only; no schema
or server-side change is proposed. This spec covers exactly those two issues and nothing else found during
the same smoke-test session (button styling, rate limits, etc. are tracked separately in
[TASK-059-smoke-tests.md](TASK-059-smoke-tests.md) and are not in scope here).

---

## 1. Current State — What Exists Today

Read directly from the code, as of this session:

- **Issue A — no guard against an already-authenticated user landing on `/sign-in` or `/sign-up`.**
  [`client/src/App.jsx`](../../client/src/App.jsx) registered these as plain, unconditional routes:
  ```jsx
  <Route path="/sign-in/*" element={<SignIn routing="path" path="/sign-in" />} />
  <Route path="/sign-up/*" element={<SignUp routing="path" path="/sign-up" />} />
  ```
  Every other route in the app is wrapped in a `PrivateRoute` helper that checks Clerk's `<SignedIn>`/
  `<SignedOut>` and redirects appropriately — `/sign-in` and `/sign-up` were the only two routes with no
  equivalent check in the *other* direction (bounce away once already signed in). If the app ever renders
  `/sign-in` while a session is actually valid, nothing moves the user off it.

- **Issue B — the real root cause: a single racy 401 anywhere triggers a hard, unconditional redirect.**
  [`client/src/api/index.js`](../../client/src/api/index.js)'s `request()` (lines 8-30) and `postStream()`
  (lines 69-84) each independently contain:
  ```js
  if (res.status === 401 && !window.location.pathname.startsWith('/sign-in')) {
    window.location.href = '/sign-in';
    throw new Error('Session expired');
  }
  ```
  identical logic, duplicated rather than shared. Any single 401, from any one API call, immediately does a
  full-page `window.location.href` navigation back to sign-in — there is no retry and no distinction between
  "this session is genuinely gone" and "this one request lost a timing race."

- **Why the race exists.** [`App.jsx`](../../client/src/App.jsx) imports every page eagerly (`DashboardPage`,
  `PantryPage`, `RecipesPage`, `ShoppingPage`, `ChatPage`, `HouseholdPage` — no route-based code-splitting
  anywhere). The moment Clerk's `<SignedIn>` flips true (confirmed via `PrivateRoute`, so pages provably
  cannot mount before Clerk itself reports the user signed in), every one of those pages mounts in the same
  render pass, and each page's data hook fires its own API call independently on mount — confirmed by
  reading [`usePantry.js`](../../client/src/hooks/usePantry.js) (`fetchItems()` in a bare `useEffect`, no
  auth-readiness gating beyond the `SignedIn` wrapper one level up) and
  [`useRecipes.js`](../../client/src/hooks/useRecipes.js) (same shape). This produces a burst of a
  dozen-plus simultaneous `window.Clerk.session.getToken()` calls immediately after a brand-new session is
  created. `getClerkToken()` itself (`api/index.js:4-6`) is a thin wrapper with no retry of its own —
  **correction from DRAFT-1's review:** the wrapper isn't what's cached; Clerk's underlying
  `session.getToken()` is normally cached client-side and only makes a network call once the token nears
  expiry, so most of these concurrent calls resolve from cache almost instantly. The race is specifically
  about the subset that don't.
  - Server-side, [`server/app.js:35`](../../server/app.js) uses `@clerk/express`'s `clerkMiddleware()` with
    default configuration — no custom clock-skew tolerance or verification tuning.
  - Installed SDK: `@clerk/clerk-react@5.61.8`.

- **Live evidence gathered this session** (not hypothetical): on production, `__client_uat` (Clerk's own
  "a client was authenticated at this time" cookie) showed a real sign-in event at the exact time of the
  reported attempt, while `window.Clerk.user`/`.session` were simultaneously `null` — a session was created
  and then lost. Locally, the dev server's own request log showed a full batch of successful authenticated
  calls (`/api/pantry`, `/api/recipes`, `/api/onboarding`, `/api/ai/chat/history` — 200s, then cached 304s,
  repeated) immediately followed by the browser console logging a burst of `401 (Unauthorized)` errors and
  the app landing back on the signed-out landing page. Both environments show the identical pattern:
  real success, then a spurious bounce.

---

## 2. Root Cause Analysis

Per DRAFT-1's review, observed fact and inferred mechanism are separated explicitly — the proposed fix in
Section 3 depends only on the observed pattern, not on which server-side mechanism actually causes it.

### Observed (directly measured this session, both environments)

1. User completes sign-in (email/password or Google OAuth) — `client_uat` updates, confirming Clerk itself
   registers a real authentication event.
2. The server logs a full batch of successful authenticated requests immediately afterward (200s, then
   cached 304s, repeated across `/api/pantry`, `/api/recipes`, `/api/onboarding`, `/api/ai/chat/history`).
3. In the same window, the browser console logs a burst of `401 (Unauthorized)` errors.
4. The app ends up back on the signed-out landing page, and `window.Clerk.user`/`.session` read as `null`
   even though a session was just confirmed to exist.
5. `api/index.js` treats **any single** 401 from **any one** of the many concurrent calls as proof the whole
   session is invalid and hard-redirects the entire app — discarding every other request that succeeded in
   the same burst.
6. Because of Issue A, landing back on `/sign-in` with no away-redirect guard, the user is stuck looking at
   a sign-in form with no self-correcting path.

### Hypothesis (plausible mechanism, not verified against Clerk's internals)

`SignedIn` flips true → every eagerly-imported page mounts in the same render pass (Section 1) → a
dozen-plus concurrent `getToken()` calls fire near-simultaneously against a session created moments earlier
→ it's plausible for the backend to transiently reject one or two of those many simultaneous tokens (freshly
minted token propagation, clock-skew, JWKS timing) while the rest succeed. This is the only mechanism
consistent with every observed fact above, but it is *inferred*, not confirmed line-by-line against Clerk's
implementation. **The fix in Section 3.2 does not depend on this hypothesis being correct** — it only
depends on the observed pattern (a transient single-request 401 co-occurring with an otherwise-valid
session), which is independently confirmed regardless of the underlying cause.

Issue A and Issue B compound each other: B causes the spurious bounce, A is why the bounce is a dead end
instead of self-correcting.

---

## 3. Proposed Fix

### 3.1 Sign-in/Sign-up redirect guard (already implemented this session, included for review)

Added a `PublicRoute` helper to `App.jsx`, mirroring the existing `PrivateRoute` pattern:

```jsx
function PublicRoute({ children }) {
  return (
    <>
      <SignedIn>
        <Navigate to="/" replace />
      </SignedIn>
      <SignedOut>{children}</SignedOut>
    </>
  );
}
```

`/sign-in/*` and `/sign-up/*` now wrap their `<SignIn>`/`<SignUp>` elements in `PublicRoute`. Reuses the
existing `SignedIn`/`SignedOut`/`Navigate` primitives already imported in this file — no new dependency.

### 3.2 Retry once with a forced-refresh token before redirecting (proposed, not yet implemented)

On a 401 from any authenticated API call, retry that request once with a forced-refresh token before
treating it as a real session expiry. A second 401 after that retry is treated **as sufficient evidence to
preserve the existing session-expired redirect behavior — not as logical proof the session is invalid**
(DRAFT-1's review: a second 401 could also mean a server-side authorization bug, an endpoint-specific issue,
or a transient condition outlasting the retry window; the current behavior already treats any single 401 as
expiry, so this is strictly a reduction in false positives, not a definitive validity check).

#### 3.2.1 Why retrying is safe here, including for POST/PATCH/DELETE

Verified against the actual server code, not assumed: `clerkAuth` (`server/middleware/clerkAuth.js:4-22`)
is mounted via `router.use(clerkAuth)` ahead of every route handler in all 12 route files
(`server/routes/*.js`, confirmed by grep — the two routes that don't use the router-level form,
`push.js`'s `/vapid-public-key` and `/subscribe`/`/unsubscribe`, still list `clerkAuth` as the first
per-route middleware argument). `clerkAuth` returns 401 (`clerkAuth.js:6-9`) before its own only
side-effecting call (`householdService.getOrCreate`, line 12) ever executes, and before calling `next()` to
reach the actual route handler. A repo-wide grep for every `401` response in `server/routes`, `server/
services`, and `server/middleware` found exactly one other source: `push.js`'s cron-secret check on
`GET /api/push/cron` (lines 107, 117), which is invoked by Vercel Cron, never by the client's `request()`/
`postStream()`. **Conclusion: in this codebase, a 401 from any client-invoked endpoint provably means the
route handler never ran — retrying is safe for all methods, not just GET.**

#### 3.2.2 Shared auth-retry helper (no longer a judgment call — DRAFT-1's review required this)

`request()` and `postStream()` currently duplicate the same six-line 401-redirect block byte-for-byte; adding
retry + single-flight refresh + redirect-dedup to both independently would duplicate meaningfully more
complex logic. A shared `authorizedFetch()` owns everything auth-policy-related; `request()`/`postStream()`
keep owning only their own response handling (JSON parsing vs. stream reading):

```js
// api/index.js

let refreshPromise = null;

// Single-flight: N concurrent 401s trigger exactly one forced network refresh, not N.
function forceRefreshToken() {
  if (!refreshPromise) {
    refreshPromise = window.Clerk.session
      .getToken({ skipCache: true })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

let redirecting = false;

// Dedup: if many callers' retries all still 401 (Case A, Section 6), redirect exactly once.
function redirectToSignIn() {
  if (redirecting || window.location.pathname.startsWith('/sign-in')) return;
  redirecting = true;
  window.location.href = '/sign-in';
}

async function authorizedFetch(path, opts = {}) {
  const token = await getClerkToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(path, { ...opts, headers });
  if (res.status !== 401) return res;

  // Forced refresh itself throwing (network error, not a 401) is not evidence of an
  // invalid session — propagate that error normally, do not redirect.
  const freshToken = await forceRefreshToken();

  // No token at all means Clerk has nothing to give us — a retry would just send an
  // unauthenticated request guaranteed to 401 again. Skip the pointless round-trip and
  // go straight to the same outcome a second 401 would produce.
  if (!freshToken) {
    redirectToSignIn();
    throw new Error('Session expired');
  }

  const retryHeaders = { ...(opts.headers || {}), Authorization: `Bearer ${freshToken}` };
  res = await fetch(path, { ...opts, headers: retryHeaders });

  if (res.status === 401) {
    redirectToSignIn();
    throw new Error('Session expired');
  }
  return res;
}
```

`request()` becomes: build `opts` (method/headers/body) as today, call `const res = await
authorizedFetch(path, opts)`, then keep its existing `res.json()` / error-shaping logic unchanged.
`postStream()` becomes: build its `opts` (method/headers/body/signal) as today, call the same
`authorizedFetch()`, then keep its existing NDJSON stream-reading logic unchanged. Neither function
duplicates the 401/refresh/retry/redirect policy anymore — it lives in exactly one place.

#### 3.2.3 Concurrency: single-flight refresh and redirect de-duplication

DRAFT-1's review identified a second-order problem with a naive per-request retry: if the RCA's hypothesized
dozen-plus concurrent calls all lose the race and all get a first 401, a naive implementation would fire a
dozen-plus independent `skipCache` network calls. `forceRefreshToken()` above collapses that to exactly one
in-flight refresh, shared by every concurrent caller. Extending the same concern one step further (not
explicitly requested by the review, but the identical fan-out risk applies here too): if the freshly
refreshed token is *still* rejected for every one of those callers (Case A in Section 6 — a real expired
session), each would otherwise independently decide to redirect. `redirectToSignIn()`'s `redirecting` flag
ensures exactly one redirect fires regardless of how many concurrent callers reach that branch.

---

## 4. Files

**Allowed Files:**
- `client/src/App.jsx` (Section 3.1 — already touched)
- `client/src/api/index.js` (Section 3.2)

**Forbidden Files:** everything else, including all of `server/*` (no server-side change proposed) and any
other client file. This spec is scoped to the auth-redirect race only.

---

## 5. Out of Scope (explicitly deferred, not part of this spec)

- **Route-based code-splitting / lazy-loading pages.** Would reduce the size of the concurrent-request burst
  on every login (less backend load, marginally smaller race window) but doesn't change correctness once
  3.2 lands, and is a materially larger, unrelated change across the whole router. Worth its own future task
  if the login-time request volume ever becomes a real performance concern; no task number assigned yet
  (058 and 060 are already reserved for Shopping mobile layout and the CRUD-modal migration respectively —
  do not reuse either).
- **Server-side clock-skew/token-verification tuning** (`clerkMiddleware()` options in `server/app.js`) —
  not proposed; only pursue if 3.2's client-side retry turns out empirically insufficient during
  implementation/verification.
- Any other TASK-059 smoke-test finding unrelated to this specific auth race.

---

## 6. Acceptance Criteria

1. Visiting `/sign-in` or `/sign-up` while already signed in redirects to `/` **via client-side routing
   (`Navigate`), not a hard page reload** — this validates the actual React routing behavior, not just
   navigation after a fresh page load.
2. Signing in (both email/password and Google OAuth) reliably reaches the authenticated app without a
   spurious bounce back to `/sign-in`, specifically re-tested under the concurrent-mount-burst condition
   that reproduced this bug — a single clean manual test is not sufficient evidence this is fixed.
3. Session-expiry redirect behavior, split into both cases:
   - **Case A — genuinely expired/invalidated session:** the first attempt 401s, the forced-refresh retry
     also 401s, and the app redirects to `/sign-in` **exactly once** even if many concurrent requests hit
     this path simultaneously (not once per failing request).
   - **Case B — valid session, one endpoint returns a 401 for an unrelated reason:** same mechanical
     outcome (retry once, redirect if still failing) and explicitly **no infinite redirect loop** — this is
     a regression check on existing behavior, not a new requirement; 3.2 must not weaken real session-expiry
     handling.
4. `postStream` (chat) goes through the identical `authorizedFetch()` policy — a race there does not
   silently interrupt an in-flight chat response, and does not duplicate the retry/redirect logic
   separately from `request()`.
5. Exactly one forced-refresh network call (`getToken({ skipCache: true })`) occurs even when many
   concurrent requests 401 at once (Section 3.2.3) — not one per failing request.
6. `npm run build`, `npm run lint`, `npm test` all green.

---

## 7. Verification Steps

- Reproduce the original bug pre-fix (sign in, observe the console 401 burst and the bounce) to confirm the
  repro is real and understood, then confirm the fix suppresses it under the same conditions.
- Force a real session expiry (revoke/clear the session directly, not just wait) and confirm the app still
  redirects to `/sign-in` correctly — this must not regress.
- **Adversarial concurrent-401 test** (added per DRAFT-1's review — directly exercises the architecture
  Section 3.2 introduces, not just "sign in and see if it works"): deliberately fire 10+ authenticated
  requests concurrently against an endpoint forced to return 401 (e.g. temporarily invalidate the token
  client-side, or point requests at a session known to be stale), then verify: exactly one forced-refresh
  call occurs; all 10+ requests retry; the requests that should succeed after retry do succeed; `postStream`
  is not aborted mid-response by a concurrent 401 elsewhere; and if the retries still fail, exactly one
  redirect fires, with no redirect loop.
- Follow CONVENTIONS.md's canonical order (local → staging → production); this is a client-only change with
  no migration, so MIGRATION_LEDGER.md does not apply.
- Once deployed, re-run the relevant rows from
  [TASK-059-smoke-tests.md](TASK-059-smoke-tests.md): AUTH-1–5 and ERR-4 specifically.

---

## 8. Known Risks / Open Questions

- Single-flight refresh (3.2.3) means each 401'd request still does its own retried `fetch()` even though
  they all share one refreshed token — this is intentional (each request is for a different resource/body,
  only the token-fetch is shareable) but worth stating explicitly so it isn't mistaken for an oversight.
- Whether `getToken({ skipCache: true })` reliably resolves outside the race window, versus theoretically
  being able to lose the same race under sufficiently extreme load, has not been verified empirically before
  writing this draft — implementation-time testing (specifically the adversarial concurrent-401 test in
  Section 7) should confirm this actually closes the race in practice, not just in theory.
- If the eager-mount request burst grows over time, the deferred lazy-loading follow-up (Section 5) becomes
  more valuable — not because correctness degrades (3.2.3's single-flight/dedup holds regardless of burst
  size), but because backend load from every login scales with it.
