import { eq, and, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pantryItems } from '../db/schema.js';
import { getExpiryStatus } from '../utils/expiry.js';
import { getStaticFreezeExtension } from '../utils/freezeDefaults.js';

export async function getAll(userId, { expiringWithin } = {}) {
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

  return db.select().from(pantryItems).where(and(...conditions));
}

export async function create(userId, data) {
  const [row] = await db.insert(pantryItems).values({ ...data, userId }).returning();
  return row;
}

// Two-step ownership: find by id first (→ 404), then check userId (→ 403).
export async function update(userId, id, data) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  await db.update(pantryItems)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(pantryItems.id, id));

  const [item] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok', item };
}

export async function remove(userId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  await db.delete(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok' };
}

export async function markUsed(userId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  const expiryStatus = getExpiryStatus(existing.expiryDate);
  const wasExpiring  = expiryStatus === 'warning' || expiryStatus === 'critical';

  await db.update(pantryItems)
    .set({
      consumedAt:  new Date().toISOString(),
      wasExpiring,
      updatedAt:   new Date().toISOString(),
    })
    .where(eq(pantryItems.id, id));

  return { status: 'ok' };
}

// Freeze ON: saves originalExpiryDate, extends expiryDate by category defaults.
// Freeze OFF: restores originalExpiryDate, clears all freeze fields.
export async function toggleFreeze(userId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  if (existing.isFrozen) {
    await db.update(pantryItems)
      .set({
        isFrozen:           false,
        frozenAt:           null,
        expiryDate:         existing.originalExpiryDate,
        originalExpiryDate: null,
        freezeNotes:        null,
        updatedAt:          new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id));
  } else {
    const { newExpiryDate } = getStaticFreezeExtension(existing.category, existing.expiryDate);
    await db.update(pantryItems)
      .set({
        isFrozen:           true,
        frozenAt:           new Date().toISOString(),
        originalExpiryDate: existing.expiryDate,
        expiryDate:         newExpiryDate,
        freezeNotes:        null,
        updatedAt:          new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id));
  }

  const [item] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok', item };
}

// Inserts multiple items atomically inside a transaction.
export async function bulkCreate(userId, items) {
  return db.transaction(async (tx) => {
    const results = [];
    for (const item of items) {
      const [row] = await tx.insert(pantryItems).values({ ...item, userId }).returning();
      results.push(row);
    }
    return results;
  });
}

export async function getWasteSaved(userId, since) {
  const sinceDate = since || getStartOfWeek();
  const [result] = await db
    .select({ count: sql`count(*)` })
    .from(pantryItems)
    .where(and(
      eq(pantryItems.userId, userId),
      eq(pantryItems.wasExpiring, true),
      sql`${pantryItems.consumedAt} >= ${sinceDate}`,
    ));
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
