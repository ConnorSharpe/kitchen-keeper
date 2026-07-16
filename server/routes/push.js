import { Router } from 'express';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import { and, eq, ne } from 'drizzle-orm';
import { clerkAuth } from '../middleware/clerkAuth.js';
import { sendDailyNotifications } from '../services/pushService.js';

const router = Router();

// GET /api/push/vapid-public-key — returns the VAPID public key to the client.
// clerkAuth: banner only renders for authenticated users; no reason to expose publicly.
router.get('/vapid-public-key', clerkAuth, (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — register a push subscription for the authenticated user.
// Body: { endpoint: string, keys: { p256dh: string, auth: string } }
//
// Ownership rule (Constraint 9):
//   1. endpoint bound to DIFFERENT user → pre-delete old row (device reuse)
//   2. endpoint bound to SAME user      → upsert updates keys only
//   3. endpoint is new                  → insert
router.post('/subscribe', clerkAuth, async (req, res) => {
  const { endpoint, keys } = req.body;

  if (
    typeof endpoint !== 'string' || !endpoint ||
    typeof keys?.p256dh !== 'string' || !keys.p256dh ||
    typeof keys?.auth !== 'string' || !keys.auth
  ) {
    return res.status(422).json({ error: 'Invalid subscription object' });
  }

  // Sequential (non-transactional): drizzle-orm/neon-http has no interactive transaction
  // support (TASK-035 Part A2). Delete-then-upsert, run as two independent statements.
  // Accepted residual risk: two concurrent subscribe calls for the identical push endpoint
  // from two different households could interleave into a transient ownership flip — narrow
  // enough (single-endpoint-double-subscribe, browser+device+origin-specific) to accept
  // rather than reach for a raw-SQL CTE. No retry loop — retrying either statement would
  // widen this same window rather than close it.
  //
  // Step 1: remove any stale cross-household binding for this endpoint.
  await db
    .delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.endpoint, endpoint),
      ne(pushSubscriptions.householdId, req.user.householdId),
    ));

  // Step 2: upsert. On same-endpoint conflict (same household re-subscribing), update keys only.
  await db
    .insert(pushSubscriptions)
    .values({ householdId: req.user.householdId, endpoint, p256dh: keys.p256dh, auth: keys.auth, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth },
    });

  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe — remove a subscription by endpoint.
// Uses POST because api.delete() in the client wrapper does not support a body
// (confirmed: client/src/api/index.js:53).
// Scoped to req.user.id — cannot delete another user's subscription (Constraint 12).
router.post('/unsubscribe', clerkAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(422).json({ error: 'endpoint required' });
  }

  await db
    .delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.endpoint, endpoint),
      eq(pushSubscriptions.householdId, req.user.householdId),
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
