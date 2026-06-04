# TASK-009 — PWA Push Notifications

Version: DRAFT-6 (APPROVED)
Status: Implementation-ready.

---

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial design |
| DRAFT-2 | Not approved | Cron auth documented; date format explicit; ownership scope; SW init fixed; AC #12 fixed |
| DRAFT-3 | Not approved | Date domain fixed (::date + integer offset); query.secret normalized; SW registration extracted |
| DRAFT-4 | Not approved | GET method; schema citations; null date guard; query.secret normalized |
| DRAFT-5 | Not approved | Transaction wrapping subscribe mutation; verification step GET fix |
| DRAFT-6 | APPROVED | See below |

## DRAFT-5 → DRAFT-6 Changes

### Issue 1 (subscribe race condition) — Adopted

The pre-delete + upsert in `/api/push/subscribe` was not atomic. Two concurrent
requests could interleave: one deletes the other's row before the other re-inserts,
producing a transient ownership flip. Wrapped both operations in a Drizzle transaction:

```js
await db.transaction(async (tx) => {
  await tx.delete(...).where(cross-user condition);
  await tx.insert(...).onConflictDoUpdate(...);
});
```

The "deterministic ownership" guarantee is now enforced atomically.

### Issue 2 (verification step POST → GET) — Adopted

Verification step 10 incorrectly said `POST /api/push/cron`. Changed to `GET`.

## DRAFT-4 → DRAFT-5 Changes

### Must-Fix #1 (cron HTTP method) — ARCHITECT CORRECT, adopted

Official Vercel documentation (last updated 2026-06-02) states:

> "Vercel makes an **HTTP GET request** to your project's production deployment URL"

Every code example in the Vercel security docs uses `export function GET(...)`.
Vercel Cron Jobs **always invoke GET**. Our `router.post('/cron', ...)` would silently
404 on every production invocation — notifications would never fire.

Changed to `router.get('/cron', ...)`. The `?secret=` fallback query param continues
to work naturally with GET.

Note on prior CRON_SECRET dispute: the Vercel docs also explicitly confirm:
> "The value of the variable will be automatically sent as an `Authorization` header
> when Vercel invokes your cron job."
That mechanism was always correct. The GET method was the real bug.

### Must-Fix #2 (schema assumptions) — FALSE ALARM, cited explicitly

Both columns are confirmed live in `server/db/schema.js`:
- `isFrozen`: line 31 — `boolean('is_frozen').notNull().default(false)`
- `householdId`: line 23 — `integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' })`

Items are household-scoped, not user-scoped. The JOIN `pantry_items → users via householdId`
is correct. Explicit citations added to Constraint 5 so this is no longer an assumption.

### Should-Fix (null date casting) — Adopted

`LEFT(NULL, 10)::date` throws in Postgres. The WHERE clause now guards with
`IS NOT NULL` checks on `expiryDate` and `readyDate` before the cast:

```sql
expiryDate IS NOT NULL AND LEFT(expiryDate,10)::date IN (...)
readyDate  IS NOT NULL AND LEFT(readyDate,10)::date  = CURRENT_DATE
```

This prevents a malformed or NULL date from aborting the entire cron batch.

## DRAFT-3 → DRAFT-4 Changes

### Must-Fix #1 (date arithmetic type domain) — Adopted

`CURRENT_DATE + INTERVAL '1 day'` returns `timestamp` in PostgreSQL. Since
`LEFT(col,10)::date` produces a `date`, the comparison crossed type domains and relied
on implicit coercion — brittle across drivers and planners.

Fix: use integer date offsets, which stay in the `date` domain:

```sql
LEFT(col, 10)::date = CURRENT_DATE + 1   -- date + integer → date
LEFT(col, 10)::date = CURRENT_DATE + 3
```

All `INTERVAL` references removed from the query. Comparisons are now type-homogeneous.

### Must-Fix #2 (req.query.secret normalization) — Adopted

`req.query.secret` can be `string | string[] | ParsedQs` in Express when the key
appears multiple times. `=== secret` silently fails for an array. DRAFT-4 normalizes:

```js
const querySecret = Array.isArray(req.query.secret)
  ? req.query.secret[0]
  : req.query.secret;
```

### Should-Fix (duplicate SW registration) — Adopted

`navigator.serviceWorker.register('/sw.js')` appeared in both the `useEffect` and
`subscribe()`. Extracted to a shared `getSWRegistration()` helper. Both paths call
the same function; registration is still idempotent but the call site is unified.

## DRAFT-2 → DRAFT-3 Changes

### Must-Fix #1 (Vercel cron auth) — FALSE ALARM; spec hardened defensively

Vercel's documented behavior IS to inject `Authorization: Bearer {CRON_SECRET}` when the
`CRON_SECRET` env var is set in the project. The architect's claim that this "does not
happen" is incorrect. The primary check is unchanged.

However, since the architect has raised this twice and plan/version variance is a
legitimate concern, DRAFT-3 implements **both mechanisms**:
- Primary: `Authorization: Bearer {CRON_SECRET}` (Vercel's documented CRON_SECRET injection)
- Fallback: `?secret=CRON_SECRET` query parameter (architect's Option A)

The route accepts either. `vercel.json` configures the path without a query param
(Vercel injects the header); a manual or alternative caller can use `?secret=`.
This closes the debate without abandoning the correct design.

### Must-Fix #2 (date string slicing) — Adopted with corrected SQL idiom

The architect's suggested `DATE(col)` is not valid PostgreSQL syntax. The correct idiom
is `col::date` (Postgres cast) or `CAST(col AS date)`.

DRAFT-3 changes all date comparisons to:

```sql
LEFT(col, 10)::date = CURRENT_DATE + INTERVAL '...'
```

This:
1. Casts the extracted date string to a proper PostgreSQL `date` type
2. Uses `CURRENT_DATE` server-side, eliminating JavaScript date computation and
   JavaScript/SQL clock sync concerns entirely
3. Satisfies the architect's intent (SQL-native date comparison)

`utcDateString()` helper is removed from `pushService.js`.

### Must-Fix #3 (subscription ownership) — Adopted

Blind upsert with `set: { userId }` allowed silent device ownership migration:
User B subscribing on User A's device would steal User A's endpoint.

DRAFT-3 introduces an explicit pre-delete for cross-user endpoint conflicts:

```js
// Delete stale cross-user binding before upsert (device reuse scenario)
await db.delete(pushSubscriptions).where(
  and(eq(pushSubscriptions.endpoint, endpoint), ne(pushSubscriptions.userId, req.user.id))
);
// Upsert: conflict = same user re-subscribing (only update keys, not userId)
await db.insert(...).onConflictDoUpdate({ set: { p256dh, auth } });
```

Rule: an endpoint always belongs to the most-recently-subscribing user on that device.
Old subscription is cleaned up deterministically; no ghost subscriptions.

### Must-Fix #4 (fanout definition) — Explicit constraint added

Added Constraint 15: "Fanout unit is the subscription row." Documents that the query
naturally produces (qualifying item × subscription) rows, one notification sent per row.
A household with 3 users × 2 devices = 6 notifications per qualifying item. Intentional.
No DISTINCT needed — the JOIN produces no duplicates by construction.

### Should-Fix #2 (SW non-JSON payload) — Adopted

Added try/catch around `event.data.json()` in the service worker push handler.

### Should-Fix #4 (sequential cron sends) — Acknowledged, kept sequential for MVP

Sequential `await` in the send loop is the explicit MVP choice. For households of
typical size (<50 subscriptions), the sequential loop completes in milliseconds.
A `TODO` comment marks the parallelization upgrade point for future scale.

---

# Goal

Deliver opt-in push notifications to household members when pantry items are expiring
soon or have become ready to use. Users subscribe via a permission prompt surfaced as
a banner on the Pantry page. A Vercel Cron job fires daily and sends targeted
notifications to all subscribed devices.

Primary use cases:
- "⚠️ Milk expires tomorrow" — expiry-1-day warning
- "⚠️ Chicken expires in 3 days" — expiry-3-day warning
- "✅ Avocado is ready to use" — readyDate reached today (requires TASK-006 for users
  to set ready dates; cron queries the column regardless)

---

# Allowed Files

**Creating:**
- `server/db/migrations/0004_push_subscriptions.sql`
- `server/routes/push.js`
- `server/services/pushService.js`
- `client/public/sw.js`
- `client/src/hooks/usePushNotifications.js`
- `client/src/components/push/PushNotificationBanner.jsx`

**Editing:**
- `server/db/schema.js` — add `pushSubscriptions` table
- `server/app.js` — mount push router; update required env vars
- `vercel.json` — add `crons` block
- `client/src/pages/PantryPage.jsx` — mount banner

---

# Forbidden Files

- `server/routes/auth.js`, `server/routes/pantry.js` — unrelated
- `server/middleware/auth.js` — imported but not modified
- `client/src/api/index.js` — not modified (DELETE body limitation resolved by route design)
- `client/src/context/AuthContext.jsx` — no changes needed
- `client/src/components/pantry/*` — unrelated
- All recipe, shopping, AI, household routes/services/components

---

# Constraints

## 1. Vercel Cron invocation + CRON_SECRET

Vercel Cron sends **`GET {path}`** on schedule (confirmed: vercel.com/docs/cron-jobs,
last updated 2026-06-02: "Vercel makes an HTTP GET request to your project's production
deployment URL"). The cron route is `router.get('/cron', ...)`.

When `CRON_SECRET` is set as a project
environment variable, Vercel **automatically** injects:

```
Authorization: Bearer {CRON_SECRET}
```

into every cron invocation. This is Vercel's documented CRON_SECRET mechanism.

The cron route validates using whichever mechanism is present:

```
Authorization: Bearer {CRON_SECRET}  ← Vercel-injected (primary)
?secret={CRON_SECRET}                ← query param (manual invoke / alternative callers)
```

Either is accepted; both absent → 401.

Verification: Vercel dashboard → Project → Settings → Cron Jobs shows last invocation
status. A consistent 401 means the secret is missing or mismatched.

Required env var: `CRON_SECRET` (high-entropy random string,
e.g. `openssl rand -hex 32`).

## 2. Cron endpoint is an Express route, not a separate Vercel function

All `/api/*` routes to `api/index.js` → Express. `POST /api/push/cron` is a new route
in `server/routes/push.js`. Consistent with project architecture.

## 3. Date storage format and SQL comparison (explicit)

All date columns (`expiryDate`, `readyDate`, `purchaseDate`) are `text()` in
`server/db/schema.js` storing full ISO 8601 UTC timestamps:

```
'2026-06-05T00:00:00.000Z'
```

Date comparisons in the cron query use SQL-native date casting and pure integer offsets:

```sql
LEFT(col, 10)::date = CURRENT_DATE + 1   -- date + integer → date (type-homogeneous)
LEFT(col, 10)::date = CURRENT_DATE + 3
LEFT(col, 10)::date = CURRENT_DATE
```

`LEFT(col, 10)` extracts the `YYYY-MM-DD` prefix. `::date` casts it to a PostgreSQL
`date` type. Offset arithmetic uses integer addition (`+ 1`, `+ 3`) rather than
`INTERVAL`, keeping all operands in the `date` domain and avoiding implicit timestamp
coercion. All arithmetic is evaluated server-side in Postgres — no JavaScript date
computation involved.

This approach:
- Uses a SQL-native type for comparison (satisfies index optimization compatibility)
- Eliminates JavaScript/SQL clock synchronization concerns
- Remains correct if storage type is later changed (the `LEFT/cast` pattern documents
  the format assumption explicitly)

## 4. VAPID keys stored in env vars only

Required: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Never in code. Generated once via `npx web-push generate-vapid-keys`.
`VAPID_SUBJECT` format: `'mailto:owner@example.com'`.

## 5. Schema citations for cron query columns

Both columns used in the cron query are confirmed live in `server/db/schema.js`:

```js
// pantryItems table (server/db/schema.js)
householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),  // line 23
isFrozen:    boolean('is_frozen').notNull().default(false),                                                // line 31
```

Pantry items are **household-scoped**, not user-scoped. The JOIN
`pantry_items → users (via householdId)` is correct and verified.
`isFrozen` is a non-null boolean with a default — safe to compare without a null check.

## 7. Service worker at root scope

`client/public/sw.js` serves at `/sw.js` (Vite serves `public/` at root; built to
`dist/`). No Vite plugin required. Scope is `/` by default.

## 8. Notification triggers (daily 08:00 UTC, individual per item — intentional)

Each qualifying item fires a **separate notification** to each subscribed device.
This is the explicit MVP choice. Aggregation is deferred (see Out of Scope).

Triggers (Postgres `CURRENT_DATE` at cron run time, UTC; integer offsets → `date` domain):
- `LEFT(expiryDate,10)::date = CURRENT_DATE + 1`, not frozen, not consumed
  → `"⚠️ {name} expires tomorrow"`
- `LEFT(expiryDate,10)::date = CURRENT_DATE + 3`, not frozen, not consumed
  → `"⚠️ {name} expires in 3 days"`
- `LEFT(readyDate,10)::date  = CURRENT_DATE`, not consumed
  → `"✅ {name} is ready to use"`

## 9. One subscription per endpoint (UNIQUE + explicit ownership rule)

`endpoint` column is UNIQUE. Ownership rule:

**An endpoint always belongs to the most-recently-subscribing user on that device.**

On `POST /api/push/subscribe`:
1. If the endpoint exists with a **different** `user_id`: delete the old row (device
   reuse — old user no longer has this device). Then insert fresh.
2. If the endpoint exists with the **same** `user_id`: upsert, updating keys only
   (normal re-subscribe after SW reinstall or permission reset).
3. If the endpoint is new: insert.

`userId` is never updated in the `onConflictDoUpdate` set — it is only assigned at
insert time. Cross-user cleanup is handled by the pre-delete (step 1).

## 10. Fanout unit is the subscription row (explicit)

The cron query produces one row per `(qualifying pantry item × push_subscriptions row)`.
One `sendNotification()` call per result row. Therefore:

```
household: 3 users × 2 devices each
qualifying item: 1
notifications sent: 6
```

This is correct and intentional. Each device independently receives the notification.
The JOIN structure produces no spurious duplicates — the UNIQUE constraint on
`endpoint` and the FK chain `item → household → users → subscriptions` are
collision-free.

## 11. Graceful send failures — permanent failures delete the row

```
410 Gone / 404 Not Found / 403 Forbidden → subscription permanently expired or revoked
  → delete the row, increment removed counter
Other errors → log + skip, continue
```

The cron job does not fail-fast. All subscription rows are attempted.

Sequential send loop is the explicit MVP choice. A `// TODO: parallelize`
comment marks the upgrade point for scale. For typical household sizes (<50
subscriptions), sequential completes in under a second.

## 12. Subscription deletion scoped to owner

`POST /api/push/unsubscribe` deletes WHERE `endpoint = ? AND user_id = req.user.id`.
Cannot delete another user's subscription.

## 13. `api.delete()` does not support a request body

Confirmed from `client/src/api/index.js:53`:
```js
delete: (path) => request('DELETE', path)
```
Unsubscribe uses `POST /api/push/unsubscribe`. `api/index.js` not modified.

## 14. `web-push` added to `server/package.json`

Not root-level. Consistent with all other server deps.

## 15. No notification deduplication across runs

An item expiring in 3 days fires Monday; same item (now 1 day) fires Wednesday.
Intentional.

## 16. Banner dismissal is session-only

Plain `useState(false)` local to `PushNotificationBanner`. Not stored anywhere.
Banner reappears on next mount.

## 17. No notification icon for MVP

`/icon-192.png` does not currently exist in `client/public/`. The `showNotification`
call omits `icon` and `badge` fields. Graceful degradation. Revisit when an asset exists.

---

# Dependency Chain

Creating:
- `server/db/migrations/0004_push_subscriptions.sql`
- `server/routes/push.js`
- `server/services/pushService.js`
- `client/public/sw.js`
- `client/src/hooks/usePushNotifications.js`
- `client/src/components/push/PushNotificationBanner.jsx`

Editing:
- `server/db/schema.js`
- `server/app.js`
- `vercel.json`
- `client/src/pages/PantryPage.jsx`

Irrelevant:
- `server/routes/auth.js`, `server/routes/pantry.js`, `server/middleware/auth.js`
- `server/services/aiService.js`, `server/services/pantryService.js`
- `client/src/context/AuthContext.jsx`, `client/src/api/index.js`
- `client/src/utils/expiry.js` (reference only)
- All recipe, shopping, AI, household routes/services/components

---

# Implementation Plan

## 1. `server/db/migrations/0004_push_subscriptions.sql` — NEW

```sql
-- Migration: push_subscriptions table for Web Push API (VAPID)
-- Run manually in the Neon SQL Editor.
-- One row per device (browser+origin) per user.
-- Endpoint is UNIQUE: re-subscription and device-reuse are handled at the app layer.

CREATE TABLE "push_subscriptions" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint"   TEXT    NOT NULL UNIQUE,
  "p256dh"     TEXT    NOT NULL,
  "auth"       TEXT    NOT NULL,
  "created_at" TEXT    NOT NULL
);

CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
```

---

## 2. `server/db/schema.js` — Modify

Add after the `chatMessages` table:

```js
export const pushSubscriptions = pgTable('push_subscriptions', {
  id:        serial('id').primaryKey(),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint:  text('endpoint').notNull().unique(),
  p256dh:    text('p256dh').notNull(),
  auth:      text('auth').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

---

## 3. `server/services/pushService.js` — NEW

```js
import webPush from 'web-push';
import { db } from '../db/client.js';
import { pushSubscriptions, pantryItems, users } from '../db/schema.js';
import { eq, and, isNull, sql } from 'drizzle-orm';

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// Permanent push provider failure codes — subscription is expired or revoked.
// Delete the row and do not retry.
const PERMANENT_FAILURE_CODES = new Set([410, 404, 403]);

// Fetch all (subscription, notification payload) pairs that fire today.
// Date comparisons use PostgreSQL CURRENT_DATE evaluated at query time (UTC on Neon).
// LEFT(col, 10)::date casts the 'YYYY-MM-DD' prefix of the stored ISO timestamp
// to a proper PostgreSQL date type. See Constraint 3.
export async function getNotificationsForToday() {
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh:   pushSubscriptions.p256dh,
      auth:     pushSubscriptions.auth,
      subId:    pushSubscriptions.id,
      itemName: pantryItems.name,
      trigger:  sql`
        CASE
          WHEN ${pantryItems.expiryDate} IS NOT NULL
               AND LEFT(${pantryItems.expiryDate}, 10)::date = CURRENT_DATE + 1
               AND ${pantryItems.isFrozen} = false THEN 'expiry_1d'
          WHEN ${pantryItems.expiryDate} IS NOT NULL
               AND LEFT(${pantryItems.expiryDate}, 10)::date = CURRENT_DATE + 3
               AND ${pantryItems.isFrozen} = false THEN 'expiry_3d'
          WHEN ${pantryItems.readyDate} IS NOT NULL
               AND LEFT(${pantryItems.readyDate}, 10)::date = CURRENT_DATE THEN 'ready_today'
        END
      `.as('trigger'),
    })
    .from(pantryItems)
    .innerJoin(users, eq(users.householdId, pantryItems.householdId))
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
    .where(
      and(
        isNull(pantryItems.consumedAt),
        sql`(
          (${pantryItems.expiryDate} IS NOT NULL
           AND LEFT(${pantryItems.expiryDate}, 10)::date IN (CURRENT_DATE + 1, CURRENT_DATE + 3)
           AND ${pantryItems.isFrozen} = false)
          OR
          (${pantryItems.readyDate} IS NOT NULL
           AND LEFT(${pantryItems.readyDate}, 10)::date = CURRENT_DATE)
        )`,
      )
    );

  return rows.filter(r => r.trigger !== null);
}

const MESSAGE_FOR = {
  expiry_1d:   (name) => ({ title: 'Pantry reminder', body: `⚠️ ${name} expires tomorrow` }),
  expiry_3d:   (name) => ({ title: 'Pantry reminder', body: `⚠️ ${name} expires in 3 days` }),
  ready_today: (name) => ({ title: 'Pantry update',   body: `✅ ${name} is ready to use` }),
};

// Send all notifications for today.
// Sequential send loop — explicit MVP choice for simplicity.
// TODO: parallelize with concurrency limit (e.g. p-limit) if household scale grows.
export async function sendDailyNotifications() {
  const notifications = await getNotificationsForToday();

  let sent = 0, skipped = 0, removed = 0;

  for (const row of notifications) {
    const payload = MESSAGE_FOR[row.trigger]?.(row.itemName);
    if (!payload) { skipped++; continue; }

    const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload));
      sent++;
    } catch (err) {
      if (PERMANENT_FAILURE_CODES.has(err.statusCode)) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.subId));
        removed++;
      } else {
        console.error(`Push send failed for sub ${row.subId}:`, err.message);
        skipped++;
      }
    }
  }

  return { sent, skipped, removed };
}
```

---

## 4. `server/routes/push.js` — NEW

```js
import { Router } from 'express';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { sendDailyNotifications } from '../services/pushService.js';

const router = Router();

// GET /api/push/vapid-public-key — returns the VAPID public key to the client.
// requireAuth: banner only renders for authenticated users; no reason to expose publicly.
router.get('/vapid-public-key', requireAuth, (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — register a push subscription for the authenticated user.
// Body: { endpoint: string, keys: { p256dh: string, auth: string } }
//
// Ownership rule (Constraint 7):
//   1. endpoint bound to DIFFERENT user → pre-delete old row (device reuse)
//   2. endpoint bound to SAME user      → upsert updates keys only
//   3. endpoint is new                  → insert
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body;

  if (
    typeof endpoint !== 'string' || !endpoint ||
    typeof keys?.p256dh !== 'string' || !keys.p256dh ||
    typeof keys?.auth !== 'string' || !keys.auth
  ) {
    return res.status(422).json({ error: 'Invalid subscription object' });
  }

  // Atomic: pre-delete cross-user binding + upsert in a single transaction.
  // Without a transaction, concurrent requests could interleave the delete and insert,
  // producing a transient ownership flip. The transaction enforces the deterministic
  // ownership guarantee (Constraint 9).
  await db.transaction(async (tx) => {
    // Step 1: remove any stale cross-user binding for this endpoint.
    await tx
      .delete(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.endpoint, endpoint),
        ne(pushSubscriptions.userId, req.user.id),
      ));

    // Step 2: upsert. On same-endpoint conflict (same user re-subscribing), update keys only.
    // userId is intentionally absent from the conflict update set.
    await tx
      .insert(pushSubscriptions)
      .values({ userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth },
      });
  });

  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe — remove a subscription by endpoint.
// Uses POST because api.delete() in the client wrapper does not support a body
// (confirmed: client/src/api/index.js:53).
// Scoped to req.user.id — cannot delete another user's subscription (Constraint 10).
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(422).json({ error: 'endpoint required' });
  }

  await db
    .delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.endpoint, endpoint),
      eq(pushSubscriptions.userId, req.user.id),
    ));

  res.json({ ok: true });
});

// GET /api/push/cron — invoked by Vercel Cron daily at 08:00 UTC.
// Vercel Cron always uses GET (confirmed: vercel.com/docs/cron-jobs).
//
// Authentication (Constraint 1):
//   Primary:  Authorization: Bearer {CRON_SECRET}
//             Vercel automatically injects this when CRON_SECRET env var is set.
//   Fallback: ?secret={CRON_SECRET} query parameter
//             For manual invocation or alternative cron callers.
//   Either is accepted. Both absent → 401.
router.get('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(401).json({ error: 'Unauthorized' });

  const authHeader  = req.headers['authorization'];
  // Normalize: req.query.secret can be string | string[] | ParsedQs in Express
  const rawQuery    = req.query.secret;
  const querySecret = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  const validHeader = authHeader === `Bearer ${secret}`;
  const validQuery  = querySecret === secret;

  if (!validHeader && !validQuery) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await sendDailyNotifications();
  console.log(`Push cron: ${JSON.stringify(result)}`);
  res.json(result);
});

export default router;
```

---

## 5. `server/app.js` — Modify

```js
import pushRouter from './routes/push.js';
// after existing imports...

app.use('/api/push', pushRouter);
```

Update required env var list:

```js
const REQUIRED_ENV = [
  'GEMINI_API_KEY', 'JWT_SECRET',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
];
// CRON_SECRET: validated at route level (optional for local dev)
```

---

## 6. `vercel.json` — Modify

```json
{
  "buildCommand": "npm run vercel-build",
  "outputDirectory": "client/dist",
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/index" },
    { "source": "/(.*)",       "destination": "/index.html" }
  ],
  "functions": {
    "api/index.js": { "maxDuration": 60 }
  },
  "crons": [
    {
      "path":     "/api/push/cron",
      "schedule": "0 8 * * *"
    }
  ]
}
```

Vercel invokes `POST /api/push/cron` at 08:00 UTC and injects
`Authorization: Bearer {CRON_SECRET}` (primary auth path, Constraint 1).

---

## 7. `client/public/sw.js` — NEW

Push + notification display only. No cache logic.

```js
self.addEventListener('push', (event) => {
  let data = { title: 'Kitchen Keeper', body: 'You have a pantry update.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // malformed payload — use default message
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/pantry') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/pantry');
    })
  );
});
```

---

## 8. `client/src/hooks/usePushNotifications.js` — NEW

```js
import { useState, useEffect } from 'react';
import { api } from '../api/index.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Shared registration helper — idempotent; both mount init and subscribe() use this.
// Ensures a single registration call site for easier debugging.
async function getSWRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

export function usePushNotifications() {
  const [permission,   setPermission]   = useState(Notification.permission);
  const [subscription, setSubscription] = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  // On mount: register SW (idempotent via getSWRegistration), then check for existing sub.
  // Register first — navigator.serviceWorker.ready hangs indefinitely on first visit
  // if no SW has ever been registered. Using the returned registration is deterministic.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    getSWRegistration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscription(sub))
      .catch(() => {});
  }, []);

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const { publicKey } = await api.get('/api/push/vapid-public-key');

      const reg = await getSWRegistration();
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setPermission(Notification.permission);
      setSubscription(sub);

      await api.post('/api/push/subscribe', sub.toJSON());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    if (!subscription) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;

  return { isSupported, permission, subscription, loading, error, subscribe, unsubscribe };
}
```

---

## 9. `client/src/components/push/PushNotificationBanner.jsx` — NEW

```jsx
import { useState } from 'react';
import { usePushNotifications } from '../../hooks/usePushNotifications.js';

export default function PushNotificationBanner() {
  const { isSupported, permission, subscription, loading, error, subscribe } =
    usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  if (!isSupported || permission === 'denied' || subscription || dismissed) return null;

  return (
    <div className="mb-4 flex items-start justify-between rounded-lg bg-blue-50 border
                    border-blue-200 px-4 py-3 text-sm gap-3">
      <span className="text-blue-800 flex-1">
        🔔 Get notified when items are expiring or ready to use.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={subscribe}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold
                     hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Enabling…' : 'Enable'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          disabled={loading}
          className="text-blue-400 hover:text-blue-600 text-base leading-none disabled:opacity-50"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
```

---

## 10. `client/src/pages/PantryPage.jsx` — Modify

```jsx
import PushNotificationBanner from '../components/push/PushNotificationBanner.jsx';

// In the render, above the pantry table:
<PushNotificationBanner />
```

---

# State Flow Summary

```
Subscription flow (client):
  Mount:
    SW register('/sw.js') (idempotent) → getSubscription()
    → existing sub → setSubscription(sub) → banner hidden
    → no sub → banner renders (if supported, not denied, not dismissed)

  "Enable" clicked:
    → GET /api/push/vapid-public-key (requireAuth)
    → SW register + ready
    → pushManager.subscribe({ applicationServerKey, userVisibleOnly: true })
    → OS permission prompt → granted → PushSubscription
    → POST /api/push/subscribe { endpoint, keys }
        → pre-delete any cross-user binding for this endpoint
        → upsert (same-user: update keys only)
        → 201
    → banner hides

  "✕" clicked:
    → setDismissed(true) → banner hides for session (no server call)

  Unsubscribe:
    → POST /api/push/unsubscribe { endpoint }
        → DELETE WHERE endpoint=? AND user_id=req.user.id
    → subscription.unsubscribe()
    → setSubscription(null) → banner re-renders

Push delivery (server, daily 08:00 UTC):
  Vercel Cron → GET /api/push/cron
  Authorization: Bearer {CRON_SECRET}  (Vercel injects automatically)
    → validate: header OR ?secret= param
    → getNotificationsForToday()
         LEFT(expiryDate,10)::date = CURRENT_DATE + 1 (not frozen, not consumed) → expiry_1d
         LEFT(expiryDate,10)::date = CURRENT_DATE + 3 (not frozen, not consumed) → expiry_3d
         LEFT(readyDate,10)::date  = CURRENT_DATE     (not consumed)             → ready_today
    → for each row: webPush.sendNotification(subscription, payload)  [sequential]
        success           → sent++
        410 / 404 / 403  → delete sub row, removed++
        other             → log + skipped++
    → return { sent, skipped, removed }

Service worker:
  'push' → try JSON parse → showNotification({ title, body })
  'notificationclick' → focus /pantry or open /pantry
```

---

# Acceptance Criteria

1. **Migration applied:** `push_subscriptions` table + `user_id` index exist in Neon.

2. **Env vars configured:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `CRON_SECRET` set in Vercel project settings.

3. **Service worker active:** After opt-in, DevTools → Application → Service Workers
   shows `sw.js` active.

4. **Banner renders** for authenticated users with no subscription and permission
   not denied. Shows "Enable" and "✕" dismiss buttons.

5. **Dismiss hides banner** for session. Refresh/remount → banner reappears.

6. **Permission denied:** `permission === 'denied'` → banner not rendered.

7. **Subscribe persists:** Row in `push_subscriptions` after opt-in. Same-endpoint
   re-subscribe updates keys, no duplicate.

8. **Cross-user device reuse:** User A subscribes. User B subscribes on same device
   (same endpoint). User A's row is deleted. User B's row is inserted. DB has exactly
   1 row for that endpoint, owned by User B.

9. **Unsubscribe removes own row:** Scoped to `req.user.id`. Another user's row with
   the same endpoint (if any) is unaffected.

10. **Cron rejects unauthenticated:** `POST /api/push/cron` with no header and no
    `?secret=` → 401.

11. **Cron accepts Bearer header:** `Authorization: Bearer {CRON_SECRET}` → proceeds.

12. **Cron accepts query param:** `POST /api/push/cron?secret={CRON_SECRET}` → proceeds.

13. **Expiry-1d notification sent:** Item with `expiryDate` = tomorrow UTC, not frozen,
    not consumed → notification "⚠️ {name} expires tomorrow" received on device.

14. **Expiry-3d notification sent:** Same but `expiryDate` = today+3d.

15. **Frozen items excluded:** Frozen item expiring tomorrow → no notification.

16. **Consumed items excluded:** `consumedAt IS NOT NULL` → excluded.

17. **Ready-today notification:** `readyDate` = today UTC → "✅ {name} is ready".

18. **Household fanout:** 2 users × 1 device each, 1 qualifying item → 2 notifications.

19. **Permanent failure cleanup (code review):** Confirm `PERMANENT_FAILURE_CODES`
    includes 410, 404, 403; that branch deletes the row and increments `removed`;
    other errors log and increment `skipped`.

20. **SW non-JSON resilience (code review):** Confirm push handler wraps
    `event.data.json()` in try/catch and falls back to a default message.

21. **No regression:** All existing flows unaffected. `npm run build` passes.
    SW does not intercept or cache API calls.

---

# Verification Steps

```
Setup:
1.  Run migration in Neon SQL Editor.
    Confirm push_subscriptions table + index in Neon inspector.

2.  Generate VAPID keys:
    npx web-push generate-vapid-keys
    Add to Vercel env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
    Add CRON_SECRET = (openssl rand -hex 32)

3.  npm run build — no errors.

Opt-in:
4.  PantryPage (logged in): blue banner with "Enable" + "✕" visible.
    Click "✕" → hides. Refresh → reappears.

5.  Click "Enable" → OS permission prompt → grant → banner disappears.
    DevTools → Application → Service Workers → sw.js active.
    DevTools → Network → POST /api/push/subscribe → 201.
    Neon: push_subscriptions row with correct userId.

6.  Re-subscribe (clear SW, re-grant):
    → POST /api/push/subscribe → 201, still 1 row (keys updated, no duplicate).

7.  Cross-user device reuse:
    → Log out as User A, log in as User B on same browser.
    → Subscribe → POST /api/push/subscribe.
    → Neon: only 1 row for that endpoint, userId = User B's id.

8.  Deny permission → refresh → banner not rendered.

Cron:
9.  GET /api/push/cron (no auth) → 401.

10. GET /api/push/cron with Authorization: Bearer {CRON_SECRET} → 200 { sent, skipped, removed }.

11. GET /api/push/cron?secret={CRON_SECRET} (no header) → 200.

12. Add item with expiryDate = tomorrow UTC, not frozen, not consumed.
    → Invoke cron → notification: "⚠️ {name} expires tomorrow".
    → Click → /pantry focused or opened.

13. Add item with expiryDate = today+3d → "⚠️ {name} expires in 3 days".

14. Freeze expiring item → cron → no notification.

15. Mark item used → cron → no notification.

16. Add item with readyDate = today UTC → "✅ {name} is ready to use".

17. Code review pushService.js:
    → PERMANENT_FAILURE_CODES = new Set([410, 404, 403]) ✓
    → catch branch: delete row + removed++ ✓
    → else: console.error + skipped++ ✓
    → SW handler: try/catch around event.data.json() ✓

18. Vercel deployment:
    → Dashboard → Project → Cron Jobs → entry for /api/push/cron visible.
    → After 08:00 UTC: invocation log shows 200.

19. Spot-check all existing flows: unaffected.
```

---

# Known Risks / Open Questions

1. **Vercel plan.** Hobby supports up to 2 cron jobs at daily-or-slower frequency.
   Confirm project tier in Vercel dashboard before deploying.

2. **TASK-006 dependency.** `ready_date` column is live. Cron queries it correctly.
   Ready-date notifications are useful only once TASK-006's UI ships. Recommend
   shipping TASK-006 before or alongside.

3. **Notification fatigue.** Large pantry → multiple notifications per run.
   Explicit MVP trade-off (Constraint 6). Aggregation deferred.

4. **Multi-device volume.** N users × M devices = N×M notifications per item
   (Constraint 8). Acceptable for typical household scale.

5. **Vercel cold-start.** Neon serverless HTTP driver handles cold-start connection
   initialization. No structural risk; first cron after long idle may be marginally
   slower.

6. **HTTPS requirement.** Web Push requires HTTPS. Localhost/dev exempt. Vercel always
   HTTPS. No issue.

7. **Browser compatibility.** Push supported: Chrome 50+, Firefox 44+, Edge 17+,
   Safari 16.4+. `isSupported` guard handles older browsers (banner never renders).

---

# Out of Scope (Deferred)

- Notification aggregation ("4 items expire tomorrow" vs 4 separate messages)
- Per-type notification preferences
- Quiet hours / timezone-aware delivery
- In-app notification history
- "Ready in Xd" advance warnings (fires only on the ready day)
- Weekly digest
- Push subscription management UI (list/remove devices)
- PWA install prompt / full offline manifest
- Idempotent "already notified today" per-item tracking
- Notification icon (deferred until `/icon-192.png` asset exists)
- Parallel send with concurrency limit (deferred until household scale warrants)
