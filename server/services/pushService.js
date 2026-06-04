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
