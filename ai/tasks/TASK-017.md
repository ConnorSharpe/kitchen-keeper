# TASK-017 — Post-Clerk Follow-On Fixes

**Status:** APPROVED v5 — architect approval received (Round 4); ready for implementation  
**Author:** ConnorSharpe + Claude Sonnet 4.6  
**Date:** 2026-06-22  
**Depends on:** TASK-016B complete and deployed  
**Priority order:** Issue 1 → Issue 2 → Issue 4 → Issue 3

---

## Architect Review Summary (Round 2)

**Approved:** Issue 1, Issue 2 (members card stays hidden), Issue 3.  
**Blocked:** Issue 4 — two blockers raised.

**Claude's assessment of Round 2:**

**Round 3 approved:** Issue 1, Issue 2, Issue 3. Issue 4 conditionally approved pending three fixes.

*Blocker 1 (ownership audit) — resolved by codebase evidence, not deferred to an acceptance criterion.*
Grepped the full server service layer. Every service (`pantryService`, `chatService`, `dietaryService`, `mealLogService`, `shoppingService`, `householdService`) queries exclusively by `householdId`. The only `clerkUserId` references are `getOrCreate` (household creation), `getAiConfig` (returns the *household's* owner ID for BYOK resolution — not the requester's), and `resolveProvider`. The BYOK check is subtle but correct: `getAiConfig` returns `row.clerkUserId` from the `households` table (the household owner), so `resolveProvider` compares the household owner against `OWNER_CLERK_ID`, not the requesting member. A member on Connor's household gets the platform key; a member on any other household gets that household's BYOK key. **Audit result: all services clean — no data access uses `clerkUserId`.**

*Blocker 2 (disposable household definition drifts) — architect's Option A adopted.*
Replace the hardcoded five-table check with `isDisposableHousehold(householdId)`: `created_at < 5 minutes ago` + zero pantry items. Future-proof; won't drift as tables are added.

*ON CONFLICT DO NOTHING false success — valid catch, fixed.*
Check for existing `householdMembers` row before the transaction. If found → 409 immediately, never touch H1. Only delete H1 inside the same transaction as the INSERT, after confirming the INSERT will succeed.

*Schema uniqueness self-corrected by architect: `UNIQUE(clerk_user_id)` already covers duplicate member rows. No change needed.*

*`getMembers()` naming — noted in route comment only. UI stays hidden.*

**Changes in v4:**
- Issue 4: ownership audit resolved by evidence (confirmed clean)
- Issue 4: `isDisposableHousehold()` helper replaces hardcoded table list (Option A: time + pantry items)
- Issue 4: join transaction is now check-first, fail-fast (409 if membership exists; delete H1 and INSERT are atomic)
- Issue 4: acceptance criteria updated to reflect all three fixes

**Changes in v5 (final observations from Round 4 — no blockers):**
- Issue 4: `isDisposableHousehold()` gets explicit comment documenting the intentional pantry-only heuristic
- Issue 4: guard added for joining your own household (target.id === currentHouseholdId → 409)
- Issue 4: BYOK write path audited by grep — `setAiApiKey`/`removeAiApiKey` both use `req.user.householdId` at the route level and `householdId` as the service parameter. Write path clean.
- Issue 4: acceptance criterion strengthened to name specific data types the member can access

---

## Goal

Four issues were deferred from TASK-016B. This task resolves all of them:

1. **Push subscriptions crash** — FK type mismatch breaks subscribe/unsubscribe for all users (HIGH)
2. **Members list always empty** — queries dead `users` table (LOW)
3. **Production Clerk keys** — still on dev instance keys (MEDIUM, pre-launch)
4. **Invite/join flow broken** — new users have no Clerk-aware path to join an existing household (LOW)

---

## Allowed Files

### Server
- `server/db/schema.js`
- `server/db/migrations/0011a_push_household_add.sql` (new)
- `server/db/migrations/0011b_push_household_finalize.sql` (new)
- `server/db/migrations/0012_household_members.sql` (new — Issue 4)
- `server/routes/push.js`
- `server/routes/household.js`
- `server/services/pushService.js`
- `server/services/householdService.js`
- `server/services/emailService.js`

### Client
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/JoinPage.jsx` (new — Issue 4)
- `client/src/App.jsx` (add `/join` route — Issue 4)

### Ops
- Vercel environment variable console (Issue 3)
- Clerk Dashboard (Issue 3)

---

## Forbidden Files

- `server/middleware/clerkAuth.js` — call site unchanged; behavior change is internal to `householdService`
- `server/services/aiService.js`
- `server/services/ai/*`
- `server/db/migrations/0001–0010`
- `client/public/sw.js`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

---

## Constraints

1. `server/middleware/clerkAuth.js` is not modified. It continues to call `householdService.getOrCreate(clerkUserId)`. The internal behavior of `getOrCreate` changes; the call site does not.
2. All DB migrations are additive — no column drops until the prior phase is deployed and verified
3. Issue 1 is two-phase: Phase A (add column, backfill) → deploy → Phase B (SET NOT NULL, drop old column)
4. `households.clerkUserId` is the authoritative owner identifier. `householdMembers` stores non-owner members only — no owner rows are inserted into `householdMembers`
5. `req.user` shape is unchanged: `{ id: clerkUserId, householdId }` across all routes and services
6. Push cron endpoint (`GET /api/push/cron`) must continue working after Issue 1
7. The `users` table is not deleted in this task
8. Members card in `HouseholdPage` stays hidden until Clerk display names are retrievable
9. All migrations applied against Neon before corresponding code deploy

---

## Issue 1 — Push Subscriptions (HIGH)

### Root Cause

`pushSubscriptions.userId` is `integer NOT NULL REFERENCES users(id)`. After TASK-016B, `req.user.id` is a Clerk string (`user_xxx`). Every subscribe call throws a Postgres FK violation. The `users` table has no Clerk rows, so the cron fan-out query returns zero recipients regardless.

### Schema change — `server/db/schema.js`

Replace `userId` (integer FK → users) with `householdId` (integer FK → households).

```js
export const pushSubscriptions = pgTable('push_subscriptions', {
  id:          serial('id').primaryKey(),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  endpoint:    text('endpoint').notNull().unique(),  // per-device, globally unique — unchanged
  p256dh:      text('p256dh').notNull(),
  auth:        text('auth').notNull(),
  createdAt:   text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

**On endpoint uniqueness:** `endpoint` remains `UNIQUE` and `onConflictDoUpdate` targets it. A push endpoint is a globally unique browser/device URL. Per-device isolation is preserved — one row per device, multiple devices per household each have their own row. Unsubscribing one device deletes exactly one row. This is unchanged semantics.

### Migration — Phase A: `server/db/migrations/0011a_push_household_add.sql`

```sql
-- Add nullable column (old code still writes user_id during transition)
ALTER TABLE push_subscriptions
  ADD COLUMN household_id INTEGER REFERENCES households(id) ON DELETE CASCADE;

-- Backfill from users table
UPDATE push_subscriptions ps
SET household_id = u.household_id
FROM users u
WHERE u.id = ps.user_id;

-- Pre-finalization check (run manually before Phase B):
-- SELECT COUNT(*) FROM push_subscriptions WHERE household_id IS NULL;
-- If non-zero, orphaned rows exist: DELETE FROM push_subscriptions WHERE household_id IS NULL;
```

Deploy new application code after Phase A.

### Migration — Phase B: `server/db/migrations/0011b_push_household_finalize.sql`

Applied after Phase A is deployed and verified.

```sql
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM push_subscriptions WHERE household_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'Rows with NULL household_id exist — resolve before applying NOT NULL';
  END IF;
END $$;

ALTER TABLE push_subscriptions ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE push_subscriptions DROP COLUMN user_id;
```

### Rollback Plan

Phase A is safe to roll back (drop column). Phase B removes `user_id`, so if Phase B needs to be reversed, restore from a Neon DB backup taken before Phase B was applied. Do not attempt to reconstruct `user_id` from `household_id` — multiple legacy users may share a household and the mapping is ambiguous.

### Route changes — `server/routes/push.js`

**subscribe:** Replace `req.user.id` with `req.user.householdId`.

```js
// Pre-delete stale cross-household binding for this endpoint
await tx
  .delete(pushSubscriptions)
  .where(and(
    eq(pushSubscriptions.endpoint, endpoint),
    ne(pushSubscriptions.householdId, req.user.householdId),
  ));

// Upsert — on same-endpoint conflict, update keys only
await tx
  .insert(pushSubscriptions)
  .values({
    householdId: req.user.householdId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    createdAt: new Date().toISOString(),
  })
  .onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: { p256dh: keys.p256dh, auth: keys.auth },
  });
```

**unsubscribe:** Scope delete to `householdId` + `endpoint`.

```js
await db
  .delete(pushSubscriptions)
  .where(and(
    eq(pushSubscriptions.endpoint, endpoint),
    eq(pushSubscriptions.householdId, req.user.householdId),
  ));
```

### Service changes — `server/services/pushService.js`

Remove the `users` join. Join `pushSubscriptions` directly to `pantryItems` via `householdId`:

```js
.from(pantryItems)
.innerJoin(pushSubscriptions, eq(pushSubscriptions.householdId, pantryItems.householdId))
```

Remove the `users` import from this file.

---

## Issue 2 — Members List Always Empty (LOW)

### Decision

Remove the members card and `GET /api/household/members` call from `HouseholdPage.jsx`. The server route (`GET /api/household/members`) and `getMembers()` are left in place — Issue 4 will update `getMembers()` to query `householdMembers`. The UI card is not reintroduced in this task; Clerk display names are not accessible server-side without the Clerk backend SDK, and showing raw Clerk user IDs is worse than no card.

### Client changes — `client/src/pages/HouseholdPage.jsx`

1. Remove `members` state and `setMembers`
2. Remove `api.get('/api/household/members')` from `load()` — single `api.get('/api/household')` call only
3. Remove the "Household members" `<section>` block (lines 242–259)

---

## Issue 3 — Production Clerk Keys (MEDIUM, pre-launch ops)

### No code changes — ops checklist

**Order is critical — follow exactly.**

**Step 1: Create production Clerk instance**
- Clerk Dashboard → Add instance → Production
- Configure same social/email auth providers as Dev instance

**Step 2: Configure allowed domains (commonly missed — auth will fail without this)**
- Clerk Dashboard → Production instance → Domains:
  - Allowed Origins: `https://[vercel-production-domain]`
  - Sign-in redirect URL: `https://[vercel-production-domain]`
  - Sign-up redirect URL: `https://[vercel-production-domain]`

**Step 3: Rotate Vercel env vars (Production environment only)**
- `CLERK_SECRET_KEY` → `sk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY` → `pk_live_...`

**Step 4: Deploy** — trigger a manual Vercel redeploy to pick up new env vars

**Step 5: Update OWNER_CLERK_ID**
- Sign in on production domain
- Clerk Dashboard → Production → Users → copy new user ID (`user_...`)
- Update `OWNER_CLERK_ID` in Vercel env vars
- Redeploy
- **Skipping this step causes `NO_API_KEY` errors for Connor's household until corrected**

**Step 6: Verify**
- Sign in on production domain → pantry loads, AI responds, push notifications subscribe successfully

---

## Issue 4 — Invite / Join Flow (LOW)

### Architecture (v3)

#### Ownership model

`households.clerkUserId` is and remains the sole authoritative owner identifier. The new `householdMembers` table tracks **non-owner members only**. Owner rows are never inserted into `householdMembers`. This eliminates split-brain ownership entirely.

Resolution order inside `getOrCreate` (internal refactor — `clerkAuth` call site unchanged):
1. Check `householdMembers.clerkUserId` → if found, return that `householdId` (non-owner member)
2. Check `households.clerkUserId` → if found, return that household (owner)
3. Neither found → create new household, assign `clerkUserId` as owner, return it

The `clerkAuth` middleware continues calling `getOrCreate(clerkUserId)` with no changes to the middleware file.

#### Onboarding model (Model A — create-then-delete)

A new invited user who clicks a join link goes through this sequence:

1. User signs up via Clerk
2. First authenticated request (`POST /api/household/join`) → `clerkAuth` → `getOrCreate`:
   - Step 1: no `householdMembers` row → skip
   - Step 2: no `households.clerkUserId` row → skip
   - Step 3: create empty Household H1; assign `clerkUserId`
3. Route handler receives `req.user.householdId = H1.id`
4. Route handler: check for existing membership (guard against double-submit) → 409 if found, H1 untouched
5. Route handler: `isDisposableHousehold(H1.id)` → 409 if false (H1 has data or is too old)
6. In a single transaction: DELETE H1 → INSERT into `householdMembers` for target household H2 (if INSERT fails, H1 deletion rolls back)
6. `req.user.householdId` is stale for this request; client is redirected to `/` and the next request resolves to H2 via `householdMembers`

**Trade-off acknowledged:** H1 is created and deleted in the same request. This is architectural waste but is acceptable for a portfolio project. The alternative (threading a pending join code through middleware) is significantly more complex and not justified at this scale. This will be a natural cleanup candidate if the membership model is ever hardened.

If the user navigates away after sign-up and returns later (never calling `POST /api/household/join`), they remain the owner of H1. If they eventually join via code, H1 must still be empty for the join to succeed.

### New schema — `householdMembers`

Added to `server/db/schema.js`:

```js
export const householdMembers = pgTable('household_members', {
  id:          serial('id').primaryKey(),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull().unique(), // one membership per Clerk user
  role:        text('role').notNull().default('member'), // 'member' only; owners are in households.clerkUserId
  joinedAt:    text('joined_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

### Migration — `server/db/migrations/0012_household_members.sql`

```sql
CREATE TABLE household_members (
  id           SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TEXT NOT NULL
);

-- No seed of existing owners — owners are resolved via households.clerkUserId
```

**Deployment sequence (order is critical):**
1. Apply migration 0012 (table must exist before code deploy)
2. Deploy application code
3. Verify: existing owner can sign in, `req.user.householdId` resolves correctly via Step 2 of `getOrCreate`

### `householdService.getOrCreate` — internal refactor

The function signature and call site in `clerkAuth` are unchanged. Internal logic changes:

```js
export async function getOrCreate(clerkUserId) {
  // Step 1: non-owner member lookup
  const [membership] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.clerkUserId, clerkUserId));
  if (membership) {
    return { id: membership.householdId };
  }

  // Step 2: owner lookup
  const [owned] = await db
    .select()
    .from(households)
    .where(eq(households.clerkUserId, clerkUserId));
  if (owned) return owned;

  // Step 3: create new household (existing join-code collision retry logic preserved)
  return createHousehold(clerkUserId);
}
```

Extract existing creation + retry logic into a private `createHousehold(clerkUserId)` helper within the same file.

### `isDisposableHousehold(householdId)` — `server/services/householdService.js`

Single source of truth for "safe to delete." A household is disposable if it was auto-created within the last 5 minutes and has zero pantry items. Future-proof — new content tables do not require this function to be updated.

```js
export async function isDisposableHousehold(householdId) {
  const [row] = await db
    .select({ createdAt: households.createdAt })
    .from(households)
    .where(eq(households.id, householdId));
  if (!row) return false;

  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  if (ageMs > 5 * 60 * 1000) return false; // older than 5 minutes

  const [{ count }] = await db
    .select({ count: sql`COUNT(*)` })
    .from(pantryItems)
    .where(eq(pantryItems.householdId, householdId));

  // Disposable household heuristic — checks pantry items only.
  // A user could theoretically have shopping lists, chat history, or meal logs
  // and still satisfy this. Intentional trade-off for simplicity at portfolio scale.
  // Revisit before expanding household-sharing features.
  return Number(count) === 0;
}
```

### New endpoint — `POST /api/household/join` in `server/routes/household.js`

```
Body: { code: string }
Auth: clerkAuth (fires getOrCreate → creates H1 if brand new user)

Logic:
1. Look up household by joinCode → 404 "Invalid join code" if not found

2. Guard A — self-join:
   if (target.id === req.user.householdId)
   → 409 "Already in this household"
   H1 is NOT touched. Return immediately.

3. Guard B — existing membership (double-submit / already joined):
   Check householdMembers for req.user.id
   → 409 "Already a member of a household" if found
   H1 is NOT touched. Return immediately.

4. Guard C — disposable household:
   isDisposableHousehold(req.user.householdId)
   → 409 "Your household already has data — cannot join another household" if false
   H1 is NOT touched. Return immediately.

5. Transaction (atomic — if INSERT fails, DELETE is rolled back):
   a. DELETE FROM households WHERE id = req.user.householdId
      (ON DELETE CASCADE removes push_subscriptions, chat_messages, etc.)
   b. INSERT INTO household_members (householdId, clerkUserId, role)
      VALUES (target.id, req.user.id, 'member')
      -- No ON CONFLICT: unique violation rolls back (a). Guard A makes this impossible in the normal path.

6. Return { householdId: target.id, householdName: target.name }
```

New service function: `householdService.joinByCode(clerkUserId, currentHouseholdId, code)`

### Updated `getMembers()` — `server/services/householdService.js`

Replace the dead `users` query with a `householdMembers` query. Returns non-owner members only; owner is resolved separately if the caller needs it.

```js
export async function getMembers(householdId) {
  return db
    .select({
      clerkUserId: householdMembers.clerkUserId,
      role:        householdMembers.role,
      joinedAt:    householdMembers.joinedAt,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
}
```

The `GET /api/household/members` route is not called from the UI in this task. The function is updated so the route returns real data; the UI card is deferred until display names are available.

### Updated invite email — `server/services/emailService.js`

Send a magic link. Remove `fromName` (fixes `req.user.name = undefined` latent bug from TASK-016B):

```
Subject: You're invited to join a Kitchen Keeper household
Body:
  You've been invited to join a Kitchen Keeper household.

  Click to join: https://[VITE_APP_URL]/join?code=[joinCode]

  Or enter the code manually in the app: [joinCode]
```

### New client page — `client/src/pages/JoinPage.jsx`

- Reads `?code=` from URL query param; stores in component state
- If not authenticated: renders Clerk `<SignIn>` / `<SignUp>` with invitation context
- After Clerk auth: calls `POST /api/household/join` with code; on success redirects to `/`
- Error states:
  - 404 → "Invalid join code. Check the link and try again."
  - 409 → "Your household already has data. Contact the person who invited you for help."

### `client/src/App.jsx`

Add `/join` as a public route — no `PrivateRoute` wrapper. Clerk auth completes on the page itself.

---

## Dependency Chain

### Editing
- `server/db/schema.js`
- `server/routes/push.js`
- `server/routes/household.js`
- `server/services/pushService.js`
- `server/services/householdService.js`
- `server/services/emailService.js`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/JoinPage.jsx` (new)
- `client/src/App.jsx`

### Requires (read-only)
- `server/middleware/clerkAuth.js` — confirm `getOrCreate` call site shape only
- `server/db/migrations/0010_clerk_byok.sql` — reference for migration style
- `server/db/client.js` — confirm Drizzle client import pattern

### Irrelevant
- `server/services/ai/*`
- `server/services/aiService.js`
- `client/public/sw.js`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

---

## Acceptance Criteria

### Issue 1 — Push
- [ ] `POST /api/push/subscribe` returns 201 for an authenticated Clerk user
- [ ] `POST /api/push/unsubscribe` returns 200 for an authenticated Clerk user
- [ ] `GET /api/push/cron` delivers notifications when test expiry data exists
- [ ] No reference to `users` table in `pushService.js`
- [ ] Phase A applied; Phase B applied after Phase A is verified; `user_id` column gone

### Issue 2 — Members UI
- [ ] `HouseholdPage` load is a single `GET /api/household` call — no `/members` call
- [ ] Members section not present in DOM

### Issue 3 — Prod Keys
- [ ] Vercel env vars show `sk_live_` / `pk_live_` keys
- [ ] Production domain in Clerk allowed origins and redirect URLs
- [ ] Sign-in, pantry, and AI features confirmed working on production domain
- [ ] `OWNER_CLERK_ID` updated to production Clerk user ID

### Issue 4 — Join Flow
- [ ] `household_members` table exists; no owner rows seeded
- [ ] `getOrCreate` resolves existing owner via `households.clerkUserId` (Step 2) without creating a duplicate household
- [ ] `getOrCreate` resolves existing member via `householdMembers` (Step 1) without creating a duplicate household
- [ ] New user with no existing household: `getOrCreate` creates household (Step 3)
- [ ] Invite email contains `https://[app-url]/join?code=XXXX` link; no `undefined` in body
- [ ] `/join?code=XXXX` shows Clerk auth for unauthenticated users
- [ ] After auth, `POST /api/household/join` succeeds; user redirected to `/` with correct household
- [ ] Original owner's access completely unaffected after a member joins
- [ ] Member can access existing pantry items, shopping lists, meal logs, recipes, and chat history belonging to the owner's household
- [ ] Joining your own household's join code → 409 "Already in this household"
- [ ] Invalid join code → 404 displayed
- [ ] User with existing household data or household older than 5 minutes → 409 "cannot join" displayed
- [ ] User who has already joined a household → 409 "already a member" displayed; their current household is untouched
- [ ] `GET /api/household/members` returns rows from `householdMembers` (not `users`)
- [ ] Membership audit: grep confirms no service resolves household data through `clerkUserId` — confirmed clean in v4 review

---

## Verification Steps

```
Issue 1:
1. Apply 0011a; confirm push_subscriptions has household_id column (nullable)
2. Sign in as Clerk user → enable notifications → confirm 201; check Neon row
3. Trigger /api/push/cron with CRON_SECRET → confirm sent > 0
4. Run null check: SELECT COUNT(*) FROM push_subscriptions WHERE household_id IS NULL → must be 0
5. Apply 0011b; confirm user_id column gone

Issue 2:
1. Load /household → network tab: single GET /api/household, no /members call

Issue 3:
1. Vercel dashboard: confirm sk_live_ / pk_live_ keys
2. Sign in on production domain → confirm pantry, AI, push

Issue 4 — deployment sequence:
1. Apply migration 0012 FIRST
2. Deploy application code
3. Verify existing owner resolves correctly (sign in → pantry loads → req.user.householdId correct)
4. Send invite email → confirm link format, no "undefined" in body
5. Open link in incognito → complete Clerk sign-up → confirm redirect to correct household
6. Original owner signs in → confirm data intact
7. GET /api/household/members → returns householdMembers rows (not users)
8. Attempt join with invalid code → 404
9. Attempt join from household with pantry data → 409
```

---

## Known Risks

- **Issue 1 Phase B:** Orphaned `push_subscriptions` rows (no matching `users.household_id`) will have `NULL household_id` after Phase A backfill. Run the null check before Phase B; delete orphans manually if any exist.
- **Issue 4 deployment order:** Migration 0012 must be applied before code deploy. Reversing this order causes `getOrCreate` to fail on the `householdMembers` query (table doesn't exist) for all authenticated requests.
- **Issue 4 double-submit:** `POST /api/household/join` called twice: Guard A (membership existence check) catches this and returns 409 before any transaction begins. H1 is safe.
- **Issue 4 user navigates away after sign-up:** If an invited user completes Clerk sign-up but never submits the join code (e.g. closes the tab), they become the owner of an empty household H1. They can still join later as long as H1 remains empty. If they add data to H1, the 409 guard blocks the join.
- **Issue 3 OWNER_CLERK_ID:** Must be updated immediately after signing in on production. AI features return `NO_API_KEY` until corrected.

---

## Remaining Work After This Task

- Receipt vision benchmark (≥85%, 5 receipts) — pending from TASK-016A
- Behavioral regression B1–B8 for Connor's household in production
- Members card with display names — deferred; requires Clerk backend SDK or display name stored at join time

---

## Context Notes

- branch: main (no worktree needed)
- worktree: none
- context pressure: low

## PowerShell Merge Block

N/A — working directly on main.
