import { eq, and, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pantryItems } from '../db/schema.js';
import { getExpiryStatus } from '../utils/expiry.js';
import { getStaticFreezeExtension } from '../utils/freezeDefaults.js';
import { lookup } from './shelfLifeService.js';

function enrichWithExpiry(item) {
  if (item.expiryDate) return item;
  const result = lookup(item.name);
  if (!result) return item;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + result.recommendedDays);
  return { ...item, expiryDate: d.toISOString() };
}

export async function getAll(householdId, { expiringWithin } = {}) {
  const conditions = [
    eq(pantryItems.householdId, householdId),
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

export async function create(householdId, data) {
  const enriched = enrichWithExpiry(data);
  const [row] = await db.insert(pantryItems).values({ ...enriched, householdId }).returning();
  return row;
}

// Two-step ownership: find by id first (→ 404), then check householdId (→ 403).
export async function update(householdId, id, data) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  await db.update(pantryItems)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(pantryItems.id, id));

  const [item] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok', item };
}

export async function remove(householdId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  await db.delete(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok' };
}

export async function markUsed(householdId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

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
export async function toggleFreeze(householdId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

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

// Inserts items independently — best-effort, non-atomic. One failure does not roll back others.
export async function bulkCreate(householdId, items) {
  const results = [];
  for (const item of items) {
    try {
      const enriched = enrichWithExpiry(item);
      const [row] = await db.insert(pantryItems).values({ ...enriched, householdId }).returning();
      results.push(row);
    } catch (err) {
      console.error('[pantryService] bulkCreate: failed to insert item:', item?.name, err.message);
    }
  }
  return results;
}

export async function getWasteSaved(householdId, since) {
  const sinceDate = since || getStartOfWeek();
  const [result] = await db
    .select({ count: sql`count(*)` })
    .from(pantryItems)
    .where(and(
      eq(pantryItems.householdId, householdId),
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
