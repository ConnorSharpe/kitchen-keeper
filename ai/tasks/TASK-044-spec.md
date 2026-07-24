# TASK-044 — Fix False-Positive Join Rejection + Add Crash Reporting for First-Run Onboarding

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.5/10 — approve after revisions | Praised: disciplined separation of the three distinct problems (unredeemed invite, false-positive join rejection, unrelated crash) without overstating causal certainty; Decision 1's age→content reframing as the correct domain model; scope control (What Does NOT Change / Forbidden Files); crash reporting sized appropriately for a small project (`console.error` + `vercel logs`, no Sentry). Required: replace `COUNT(*)` with an existence check (`LIMIT 1`) since only presence/absence matters, not row count; explicitly document that every future household-owned content table must be added to the disposable check or joins could silently delete its data; include a deployment/commit identifier in crash logs so stack traces are attributable across deployments; add acceptance coverage for oversized-payload rejection. Also suggested (non-blocking): a `hasAnyRows()`-named helper instead of exposing raw count semantics, and a `request_id` on the new log line for consistency with the existing convention it's modeled on. |
| DRAFT-2 | 9.9/10 — APPROVED FOR IMPLEMENTATION | Applied all four required changes plus both suggestions: `isDisposableHousehold` now uses a `hasAnyRows()` helper backed by `.limit(1)` instead of `COUNT(*)`; `CONTENT_TABLES` carries an explicit maintenance-obligation comment; the log line includes `request_id` and a `deploy` field sourced from `VERCEL_GIT_COMMIT_SHA` (with a documented fallback and an implementation-time verification note); Acceptance Criteria gained an oversized-payload rejection check. Round 2 confirmed all four changes were correctly applied and flagged one remaining stale sentence — Decision 1's recommendation line still described the old `COUNT(*) === 0` approach after the implementation had already moved to an existence check — corrected to describe an existence check, matching the code. Noted but explicitly non-blocking: `Promise.all` over all six tables (no short-circuiting) is fine at this app's scale, not worth optimizing now. Approved as written. |

---

## Incident — What Actually Happened

Connor invited his wife via the fixed TASK-043 invite flow. She ended up in her own separate
household ("Holland", id 18) instead of his ("My Household", id 15) — confirmed by direct query
against production:

```
select id, name, join_code, clerk_user_id, created_at from households order by created_at desc limit 5;

 id | name             | join_code | clerk_user_id                        | created_at
 18 | Holland          | 291E262F  | user_3GvTORVczmLcnJf6VePJdPyzpHx     | 2026-07-23T23:56:52.679Z
 15 | My Household     | AFD85B2E  | user_3GqNHSFKpSVGdJbOn6XghbtxKU8     | 2026-07-22T04:37:36.445Z
```

She was prompted to *name* her household on first login — per `WelcomeStep.jsx:9`
(`showNaming = !joined && allowNaming`), that only happens on the `new_household` onboarding flow, never
`joined`. So she never actually redeemed the invite code at all; a 24-hour `vercel logs` search turned up
**zero** requests to `POST /api/household/join` anywhere. The most likely explanation: she hit the original
invite email before its `localhost` join-link bug (fixed separately, unrelated to this task) was fixed, the
link went nowhere on her phone, and she just signed up directly instead — which auto-creates a fresh
household via `getOrCreate`'s Step 3.

She also hit a full-page crash (React `ErrorBoundary` fallback, "Something went wrong") on the Pantry page
during this session, which persisted across reloads. It was not diagnosable: `componentDidCatch` only
`console.error`s in the browser — nothing is sent to the server, and there is no error-reporting service
(Sentry etc.) anywhere in this codebase (confirmed via grep). By the time this was raised, her stray
household (id 18) — the only place the crash's triggering data state could have been reproduced — had
already been deleted as part of manually merging her into Connor's real household (a necessary, deliberate
fix performed live against production, documented in this session's chat history). The exact cause is
unrecoverable now.

Once merged, retrying the join naturally would have hit a **second, independently real bug**: her stray
household was hours old by then, and `joinByCode`'s `isDisposableHousehold` guard rejects any join attempt
where the caller's current household is more than 5 minutes old — regardless of whether it actually contains
any data. This task fixes that guard (Decision 1, confirmed root cause, straightforward fix) and adds crash
reporting (Decision 2) so the *next* occurrence of a client-side crash like the one above is actually
diagnosable instead of a dead end.

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| The false-positive guard | `server/services/householdService.js:175-194` | `isDisposableHousehold()` — returns `false` (not disposable) if the household is more than 5 minutes old, *before* even checking for data. Own doc comment already flags this: *"Checks pantry items only — intentional trade-off for simplicity at portfolio scale. Revisit before expanding household-sharing features."* This task is that revisit. |
| Where it's used | `server/services/householdService.js:225-232` (`joinByCode`, Guard C) | Throws a `409` ("Your household already has data — cannot join another household") when `isDisposableHousehold` returns false. The message itself is about *data*, not age — the age check silently contradicts what the error message tells the user. |
| Household-scoped content tables | `server/db/schema.js` | Every table below has a direct `householdId` foreign key and represents real user-created content: `pantryItems`, `recipes`, `shoppingLists`, `chatMessages`, `recipeBlocklist`, `mealLogs`. `shoppingListItems` references `shoppingLists.listId`, not `householdId` directly, so checking `shoppingLists` emptiness already covers it (no orphan rows possible without a parent list). `pushSubscriptions` also has `householdId` but represents a device registration, not user content — deliberately excluded, see Constraint 1. |
| No error reporting exists | `client/src/components/layout/ErrorBoundary.jsx:13-15` | `componentDidCatch` only calls `console.error` — nothing leaves the browser. Confirmed via grep across `client/` and `server/` for `sentry`, `bugsnag`, `rollbar`, `logrocket`, and any existing `client-error`/`report-error`/`captureException` pattern — none exist. |
| Every route requires auth | `server/routes/*.js` | Every router in this app calls `router.use(clerkAuth)` (or applies `clerkAuth` per-route, e.g. `transcribe.js`) — 100% of existing endpoints are authenticated, no precedent for a public route. Relevant to Decision 2's design (see Constraint 3). |
| Structured error logging convention | `server/routes/household.js:66-80` (`/members`) | Existing precedent for a route logging `[kitchen-keeper] request_id=... function=... error=...` on failure — this task's new endpoint follows the same shape so it surfaces the same way in `vercel logs` that diagnosed everything else in this incident. |

---

## Decision 1: Replace the 5-minute age heuristic with a direct emptiness check across all content tables

**Recommendation: rewrite `isDisposableHousehold()` to perform an existence check (not a count) across every
household-scoped content table (`pantryItems`, `recipes`, `shoppingLists`, `chatMessages`, `recipeBlocklist`,
`mealLogs`), in parallel, with no age check at all.**

### Why age was the wrong proxy
The original check conflated "time since the household row was created" with "the user has started using
it" — but a real invite-acceptance flow can easily take longer than 5 minutes (Clerk email verification,
getting distracted, closing the tab and coming back later) without the user ever touching the app. The
household row is created as a side effect of the *first authenticated API call* (`clerkAuth` → `getOrCreate`
→ Step 3), which can happen well before the user does anything meaningful — exactly what happened here, and
exactly what would happen to the next person who takes their time accepting an invite.

### Why a direct emptiness check is strictly better, not just "looser"
The function's whole purpose is protecting real user data from being silently deleted out from under someone
when they join another household. "Does this household actually contain anything" is the literal thing being
protected — checking it directly removes the age heuristic's false-positive case (empty-but-old) without
introducing a new false-negative case (non-empty-but-new still correctly blocks, exactly as today). There's
no case where checking actual content is worse than checking elapsed time as a proxy for content.

---

## Decision 2: Add minimal crash reporting so the next occurrence is diagnosable

**Recommendation: add `POST /api/client-errors` (authenticated, like every other route in this app) that
logs a structured line via `console.error`, and wire `ErrorBoundary.componentDidCatch` to fire a
best-effort, non-blocking report to it.**

### Why this, instead of trying to root-cause the original crash now
The crash happened during her `new_household` onboarding session, and the only place its triggering data
state could have been reproduced — her stray household (id 18) — no longer exists; it was deleted as a
necessary part of merging her into Connor's real household. Every plausible code path was read in this
session (`PantryPage`, `PantryTable`, `usePantry`, `PantryContext`, `OnboardingGate`, `WelcomeStep`,
`StaplesChecklist`, `productTour.js`, `expiry.js`) without finding an unguarded crash — all of it is
defensively coded (try/catch around every async operation, null-safe rendering). Speculatively "fixing"
something without a reproduced failure risks patching the wrong thing while leaving the real cause live.
Since this app has zero error-reporting infrastructure, there is currently no way to ever get past this
dead end — this task closes that gap so the *next* crash (this one or a different one) is diagnosable via
`vercel logs`, the same tool that diagnosed everything else in this incident.

### Why authenticated, not a public endpoint
Every existing route in this app requires `clerkAuth` — there is no precedent for a public endpoint, and
introducing this app's first one is a bigger architectural deviation than the crash-reporting feature
itself warrants. The tradeoff (a crash during Clerk's own hosted `SignIn`/`SignUp` widgets, pre-auth, won't
be captured) is accepted — see Known Risks. The incident this task responds to happened post-auth, inside
the authenticated app shell, which is where a React render crash in this codebase's own components is going
to occur.

---

## What Does NOT Change

- `joinByCode`'s Guard A (self-join) and Guard B (already a member) — unrelated to this incident, both
  correct as-is.
- The `409` status code or its general shape for a genuinely non-disposable household — only the underlying
  *check* changes, not what the client sees when it correctly fires.
- `ErrorBoundary`'s fallback UI (the "Something went wrong" card) — unchanged; the new report is a side
  effect fired from `componentDidCatch`, not a change to what's rendered.
- No attempt to fix the original, now-unreproducible Pantry crash directly — see Decision 2's reasoning.

---

## Allowed Files

- `server/services/householdService.js` — rewrite `isDisposableHousehold()`.
- `server/routes/clientErrors.js` — new file, the reporting endpoint.
- `server/app.js` — mount the new router.
- `client/src/components/layout/ErrorBoundary.jsx` — fire the report from `componentDidCatch`.

## Forbidden Files

- `server/services/householdService.js`'s `joinByCode` Guards A/B, and everything else in the file — only
  `isDisposableHousehold()` changes.
- `client/src/pages/PantryPage.jsx`, `PantryTable.jsx`, `usePantry.js`, `PantryContext.jsx`,
  `OnboardingGate.jsx`, `WelcomeStep.jsx`, `StaplesChecklist.jsx`, `productTour.js`, `utils/expiry.js` — all
  read during this session's investigation, none implicated with reproducible evidence; do not speculatively
  edit any of them (see Decision 2).
- `client/src/api/index.js` — the crash report uses a raw `fetch`, not this helper (Constraint 2); do not
  modify this file to accommodate it.

---

## Constraints

1. **`isDisposableHousehold()` checks exactly these six tables via an existence check, not a count, and no
   age check:**
   ```js
   import { pantryItems, recipes, shoppingLists, chatMessages, recipeBlocklist, mealLogs } from '../db/schema.js';

   // Every table here has a direct householdId FK and represents real user-created
   // content — this list is the complete definition of "does this household have
   // data worth protecting." Whenever a new household-owned content table is added
   // to the schema, it MUST be added here too, or joinByCode's Guard C will
   // silently fail to protect it, letting a join delete real data out from under
   // someone (architect review round 1). pushSubscriptions is deliberately
   // excluded — it's a device registration, not content (see Codebase Reality
   // Check).
   const CONTENT_TABLES = [pantryItems, recipes, shoppingLists, chatMessages, recipeBlocklist, mealLogs];

   // LIMIT 1, not COUNT(*) — only presence/absence matters here, and COUNT(*)
   // forces Postgres to scan every matching row just to throw the number away
   // (architect review round 1).
   async function hasAnyRows(table, householdId) {
     const rows = await db
       .select({ id: table.id })
       .from(table)
       .where(eq(table.householdId, householdId))
       .limit(1);
     return rows.length > 0;
   }

   export async function isDisposableHousehold(householdId) {
     const results = await Promise.all(
       CONTENT_TABLES.map((table) => hasAnyRows(table, householdId))
     );
     return results.every((hasRows) => !hasRows);
   }
   ```
   The `households` row lookup and `createdAt` age math are removed entirely, not just relaxed.

2. **The client-error report is a raw `fetch`, not the `api` helper.** [client/src/api/index.js](client/src/api/index.js)'s
   `request()` redirects to `/sign-in` on a `401` and throws on any non-`2xx` response — acceptable for normal
   feature calls, but actively harmful here: a crash reporter that can itself throw or trigger a redirect
   mid-crash compounds the problem it's trying to diagnose. Use `fetch('/api/client-errors', {...})` directly,
   wrapped in its own `try { ... } catch {}`, and never `await` it before rendering the fallback UI — fire and
   forget:
   ```js
   componentDidCatch(error, info) {
     console.error('[ErrorBoundary] Uncaught error:', error, info);
     try {
       fetch('/api/client-errors', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           message: error.message,
           stack: error.stack,
           componentStack: info.componentStack,
           url: window.location.href,
           userAgent: navigator.userAgent,
         }),
       }).catch(() => {});
     } catch {
       /* reporting must never itself throw during a crash */
     }
   }
   ```
   Note this fires without a Clerk auth token attached — see Constraint 3 for why the server route still
   requires one anyway (Clerk's own client picks up the session cookie automatically for same-origin
   requests; no manual token attachment needed, matching how every other `fetch`/`api` call in this app
   already works).

3. **The server route requires `clerkAuth`, like every other route in this app, and logs a structured line
   with a `request_id` and a deployment identifier:**
   ```js
   import { randomUUID } from 'crypto';
   import express from 'express';
   import { z } from 'zod';
   import { clerkAuth } from '../middleware/clerkAuth.js';
   import { validate } from '../middleware/validate.js';

   const router = express.Router();
   router.use(clerkAuth);

   const reportSchema = z.object({
     message: z.string().max(2000),
     stack: z.string().max(8000).optional(),
     componentStack: z.string().max(8000).optional(),
     url: z.string().max(500).optional(),
     // Informational only — bounded, never parsed or relied on for logic
     // (architect review round 1).
     userAgent: z.string().max(500).optional(),
   });

   router.post('/', validate(reportSchema), async (req, res) => {
     const requestId = randomUUID().split('-')[0]; // matches household.js's /members convention
     // Vercel auto-populates this for Git-connected deployments, but whether it's
     // actually exposed to the runtime depends on the project's "Automatically
     // expose System Environment Variables" setting — verify during
     // implementation; falls back to 'unknown' rather than breaking the log line
     // if absent (architect review round 1).
     const deploy = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown';
     console.error(
       `[kitchen-keeper] request_id=${requestId} client_error deploy=${deploy} ` +
         `householdId=${req.user.householdId} userId=${req.user.id} url=${req.body.url ?? 'n/a'} ` +
         `message=${req.body.message}\n` +
         `componentStack=${req.body.componentStack ?? 'n/a'}\nstack=${req.body.stack ?? 'n/a'}`
     );
     res.status(204).end();
   });

   export default router;
   ```
   Length caps on every field prevent an oversized payload from bloating logs — matches this codebase's
   existing pattern of bounding free-text input (e.g. `household.js`'s `name: z.string().max(100)`).

4. **Mount the new router in `server/app.js` alongside the others**, before the global error handler:
   ```js
   import clientErrorsRouter from './routes/clientErrors.js';
   // ...
   app.use('/api/client-errors', clientErrorsRouter);
   ```

---

## Dependency Chain

Editing:
- `server/services/householdService.js`
- `server/routes/clientErrors.js` (new)
- `server/app.js`
- `client/src/components/layout/ErrorBoundary.jsx`

Reads (pattern reference only, do not modify):
- `server/db/schema.js` — confirm which tables have a direct `householdId` FK
- `server/routes/household.js:66-80` — structured error-logging convention to match
- `client/src/api/index.js` — confirm why it's deliberately *not* reused here (Constraint 2)
- `server/middleware/joinRateLimit.js` — confirm join-attempt rate limiting is unrelated/already sufficient;
  no new rate limiting added for `/api/client-errors` (see Out of Scope)

Irrelevant:
- Every file listed in Forbidden Files
- `client/src/pages/JoinPage.jsx` — the join UI itself is correct; only the server-side guard was wrong

---

## Acceptance Criteria

- [ ] A join attempt where the caller's current household is older than 5 minutes but has zero rows in
      every content table now succeeds (previously incorrectly `409`'d)
- [ ] A join attempt where the caller's current household has at least one row in any single content table
      (test each of the six independently, local dev only) still correctly returns `409` with the existing
      "Your household already has data" message, regardless of how recently the household was created
- [ ] Locally, temporarily throw inside a component wrapped by `ErrorBoundary` — confirm a `POST
      /api/client-errors` request fires, returns `204`, and the message/component stack appear in server
      logs in the `[kitchen-keeper] client_error ...` format
- [ ] With the network blocked/offline (local dev, simulate via browser devtools), the same forced crash
      still renders the existing "Something went wrong" fallback UI without any additional error or delay —
      the failed report never blocks or breaks the fallback
- [ ] An unauthenticated request to `POST /api/client-errors` (no Clerk session) returns `401`, consistent
      with every other route in this app
- [ ] A request to `POST /api/client-errors` with `message` exceeding 2000 characters (or `stack`/
      `componentStack` exceeding 8000, or `url`/`userAgent` exceeding 500) returns `400` via the existing
      `validate` middleware, not a silent truncation or acceptance — confirms the length caps in Constraint 3
      actually reject rather than merely exist unenforced
- [ ] The logged line for a real forced crash includes a `deploy` value — either a short commit SHA or the
      literal `unknown` if `VERCEL_GIT_COMMIT_SHA` isn't populated in this environment; confirm which case
      applies during implementation and note it in the handoff

Given this project verifies via live smoke testing rather than an automated test suite (per
TASK-024/025/026/043 precedent), exercise the above manually against local dev.

---

## Known Risks / Implementation Notes

1. **Pre-auth crashes aren't captured.** A crash during Clerk's own hosted `SignIn`/`SignUp` components
   (rendered before any authenticated session exists) won't reach `/api/client-errors`, since it requires
   `clerkAuth`. Accepted per Decision 2's reasoning — matches this app's 100%-authenticated-routes convention,
   and the incident that motivated this task happened post-auth. Revisit only if a pre-auth crash is
   specifically reported later.
2. **This does not fix the original Pantry crash.** It makes the *next* occurrence diagnosable; the one that
   already happened is permanently unreproducible since its triggering household (id 18) was deleted as part
   of the manual production fix performed earlier in this incident. If the same crash recurs, `vercel logs
   --level error` should now surface it directly.
3. **Removing the age check means a genuinely months-old empty household could be silently deleted on a
   join.** This is judged correct, not a regression: if every content table is empty, there is by definition
   nothing to lose, regardless of how long the row has existed. The guard's actual job — protect real data —
   is served strictly better by checking for real data directly than by using age as a stand-in for it.
4. **`CONTENT_TABLES` is a maintenance obligation, not a one-time list.** Flagged in round 1 review: any new
   household-owned content table added to the schema in the future must be added to `CONTENT_TABLES` too, or
   `isDisposableHousehold()` will silently stop protecting it — a join could then delete real data in that
   table without the guard ever noticing. The in-code comment on `CONTENT_TABLES` (Constraint 1) states this
   explicitly so it's visible at the exact place a future author would be adding a table, not just in this
   spec.

---

## Out of Scope (v1)

- Rate-limiting `/api/client-errors` — requires an authenticated session same as every other route, so abuse
  requires a real account; not a practical concern at this app's scale (mirrors the reasoning already
  accepted for other endpoints in this codebase, e.g. TASK-026's declined request-scoped cache).
- A real error-tracking service (Sentry, Bugsnag, etc.) — `console.error` + `vercel logs` is the tool this
  entire incident was diagnosed with and is sufficient at this app's scale; revisit if crash volume ever
  makes grepping logs impractical.
- Actually fixing the unreproduced Pantry crash — see Known Risks #2; there is nothing to fix without a
  reproduction, and guessing risks patching the wrong thing.
- Retrying/queuing a failed client-error report (e.g. if the user is fully offline) — best-effort only, per
  Constraint 2; a lost report on a rare offline crash is an acceptable gap at this app's scale.
