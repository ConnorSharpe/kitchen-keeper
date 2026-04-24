import { eq, and, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pantryItems } from '../db/schema.js';
import { getExpiryStatus } from '../utils/expiry.js';
import { getStaticFreezeExtension } from '../utils/freezeDefaults.js';

// Only active (non-consumed) items. Optional expiringWithin filters to items
// expiring within N days — used by the ExpiryStrip in Phase 5.
export function getAll(userId, { expiringWithin } = {}) {
  const conditions = [
    eq(pantryItems.userId, userId),
    isNull(pantryItems.consumedAt),
  ];

  if (expiringWithin != null) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() + expiringWithin);
    cutoff.setUTCHours(23, 59, 59, 999);
    conditions.push(isNotNull(pantryItems.expiryDate));
    conditions.push(lte(pantryItems.expiryDate, cutoff.toISOString()));
  }

  return db.select().from(pantryItems).where(and(...conditions)).all();
}

// Single insert — returning().get() fetches the new row in one round-trip.
export function create(userId, data) {
  return db.insert(pantryItems).values({ ...data, userId }).returning().get();
}

// Two-step ownership: find by id first (→ 404), then check userId (→ 403).
// Returns { status: 'ok', item } | { status: 'not_found' } | { status: 'forbidden' }
export function update(userId, id, data) {
  const existing = db.select().from(pantryItems).where(eq(pantryItems.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  db.update(pantryItems)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(pantryItems.id, id))
    .run();

  return { status: 'ok', item: db.select().from(pantryItems).where(eq(pantryItems.id, id)).get() };
}

export function remove(userId, id) {
  const existing = db.select().from(pantryItems).where(eq(pantryItems.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  db.delete(pantryItems).where(eq(pantryItems.id, id)).run();
  return { status: 'ok' };
}

// Marks item as used (cooked/eaten). Sets consumedAt and wasExpiring.
// wasExpiring is true only for 'warning' or 'critical' — expired items were already wasted.
export function markUsed(userId, id) {
  const existing = db.select().from(pantryItems).where(eq(pantryItems.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  const expiryStatus = getExpiryStatus(existing.expiryDate);
  const wasExpiring  = expiryStatus === 'warning' || expiryStatus === 'critical';

  db.update(pantryItems)
    .set({
      consumedAt:  new Date().toISOString(),
      wasExpiring,
      updatedAt:   new Date().toISOString(),
    })
    .where(eq(pantryItems.id, id))
    .run();

  return { status: 'ok' };
}

// Toggles freeze on/off.
// Freeze ON:  saves originalExpiryDate, extends expiryDate by category defaults.
// Freeze OFF: restores originalExpiryDate, clears all freeze fields.
export function toggleFreeze(userId, id) {
  const existing = db.select().from(pantryItems).where(eq(pantryItems.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  if (existing.isFrozen) {
    db.update(pantryItems)
      .set({
        isFrozen:           false,
        frozenAt:           null,
        expiryDate:         existing.originalExpiryDate,
        originalExpiryDate: null,
        freezeNotes:        null,
        updatedAt:          new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id))
      .run();
  } else {
    const { newExpiryDate } = getStaticFreezeExtension(existing.category, existing.expiryDate);
    db.update(pantryItems)
      .set({
        isFrozen:           true,
        frozenAt:           new Date().toISOString(),
        originalExpiryDate: existing.expiryDate,
        expiryDate:         newExpiryDate,
        freezeNotes:        null, // AI enriches this in Phase 5+
        updatedAt:          new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id))
      .run();
  }

  return { status: 'ok', item: db.select().from(pantryItems).where(eq(pantryItems.id, id)).get() };
}

// Inserts multiple items atomically. A single bad item won't leave partial rows.
export function bulkCreate(userId, items) {
  const insertMany = db.transaction((rows) =>
    rows.map((item) =>
      db.insert(pantryItems).values({ ...item, userId }).returning().get()
    )
  );
  return insertMany(items);
}

// Counts items saved from waste since the given ISO date string.
// Defaults to start of the current week (Monday 00:00 UTC).
export function getWasteSaved(userId, since) {
  const sinceDate = since || getStartOfWeek();
  const result = db
    .select({ count: sql`count(*)` })
    .from(pantryItems)
    .where(and(
      eq(pantryItems.userId, userId),
      eq(pantryItems.wasExpiring, true),
      sql`${pantryItems.consumedAt} >= ${sinceDate}`,
    ))
    .get();
  return Number(result?.count ?? 0);
}

function getStartOfWeek() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon…
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}
