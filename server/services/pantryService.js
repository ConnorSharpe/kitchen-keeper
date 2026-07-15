import { eq, and, isNull, isNotNull, lte, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pantryItems } from '../db/schema.js';
import { getExpiryStatus } from '../utils/expiry.js';
import { getStaticFreezeExtension } from '../utils/freezeDefaults.js';
import { lookup } from './shelfLifeService.js';

// Single shared expiry calculation (TASK-031 Decision 1). Every input is explicit — behavior
// never depends on which function is calling this.
//   source: 'manual'      — existingExpiry is a value a human just typed in *this* request.
//           'ai_estimate' — existingExpiry is algorithm-produced (or absent), eligible for override.
export function computeExpiryForStorage({ name, category, storageLocation, purchaseDate, existingExpiry, source }) {
  if (source === 'manual' && existingExpiry != null) return existingExpiry;

  const result = lookup(name, storageLocation);
  if (result) {
    const base = purchaseDate ? new Date(purchaseDate) : new Date();
    base.setUTCHours(0, 0, 0, 0);
    base.setUTCDate(base.getUTCDate() + result.recommendedDays);
    return base.toISOString();
  }

  return existingExpiry ?? null;
}

function enrichWithExpiry(item, source) {
  const expiryDate = computeExpiryForStorage({
    name:            item.name,
    category:        item.category,
    storageLocation: item.storageLocation,
    purchaseDate:    item.purchaseDate,
    existingExpiry:  item.expiryDate ?? null,
    source,
  });
  return { ...item, expiryDate };
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

// source: 'manual' | 'ai_estimate' — caller states explicitly, per Decision 1's presence-check rule.
export async function create(householdId, data, source) {
  const enriched = enrichWithExpiry(data, source);
  const [row] = await db.insert(pantryItems).values({ ...enriched, householdId }).returning();
  return row;
}

// Two-step ownership: find by id first (→ 404), then check householdId (→ 403).
// Editing storageLocation recomputes expiry from purchaseDate (Decision 4); any other edit
// (e.g. quantity, notes) passes through untouched.
export async function update(householdId, id, data) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  const patch = { ...data };

  if ('storageLocation' in data) {
    const hasManualExpiry = 'expiryDate' in data;
    patch.expiryDate = computeExpiryForStorage({
      name:            existing.name,
      category:        existing.category,
      storageLocation: data.storageLocation,
      purchaseDate:    existing.purchaseDate ?? existing.createdAt,
      existingExpiry:  hasManualExpiry ? data.expiryDate : existing.expiryDate,
      source:          hasManualExpiry ? 'manual' : 'ai_estimate',
    });
  }

  await db.update(pantryItems)
    .set({ ...patch, updatedAt: new Date().toISOString() })
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

// storageLocation === 'freezer' is the single source of truth for "is this frozen" (Decision 2).
// isFrozen is no longer read or written here — deprecated, kept only for schema compat.
// Freeze ON: snapshots preFreezeStorageLocation + originalExpiryDate, extends expiryDate via
//   FoodKeeper's freezer day-count when known, falling back to the static category table (Decision 3).
// Freeze OFF: restores storageLocation to whatever preFreezeStorageLocation recorded (not a fixed
//   default), recomputing expiry for that location rather than blindly replaying the stale snapshot.
export async function toggleFreeze(householdId, id) {
  const [existing] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  const purchaseDate = existing.purchaseDate ?? existing.createdAt;
  const isFrozen = existing.storageLocation === 'freezer';

  if (isFrozen) {
    const restoreTo = existing.preFreezeStorageLocation ?? 'refrigerator';
    const expiryDate = computeExpiryForStorage({
      name:            existing.name,
      category:        existing.category,
      storageLocation: restoreTo,
      purchaseDate,
      existingExpiry:  existing.originalExpiryDate,
      source:          'ai_estimate',
    });
    await db.update(pantryItems)
      .set({
        storageLocation:          restoreTo,
        preFreezeStorageLocation: null,
        frozenAt:                 null,
        expiryDate,
        originalExpiryDate:       null,
        freezeNotes:              null,
        updatedAt:                new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id));
  } else {
    const matched = lookup(existing.name, 'freezer') != null;
    const expiryDate = matched
      ? computeExpiryForStorage({
          name:            existing.name,
          category:        existing.category,
          storageLocation: 'freezer',
          purchaseDate,
          existingExpiry:  existing.expiryDate,
          source:          'ai_estimate',
        })
      : getStaticFreezeExtension(existing.category, existing.expiryDate).newExpiryDate;

    await db.update(pantryItems)
      .set({
        storageLocation:          'freezer',
        preFreezeStorageLocation: existing.storageLocation ?? 'refrigerator',
        frozenAt:                 new Date().toISOString(),
        originalExpiryDate:       existing.expiryDate,
        expiryDate,
        freezeNotes:              null,
        updatedAt:                new Date().toISOString(),
      })
      .where(eq(pantryItems.id, id));
  }

  const [item] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
  return { status: 'ok', item };
}

// TASK-032: split a row's quantity across two storage locations.
//
// Race-safety: this driver (drizzle-orm/neon-http) has no transaction support at all — confirmed
// in server/node_modules/drizzle-orm/neon-http/session.js, NeonHttpSession.transaction() throws
// unconditionally ("No transactions support in neon-http driver"). That's a stronger limitation
// than the spec's architect review assumed (it took shoppingService.buildFromRecipes()'s
// db.transaction() usage as a working precedent to copy — that call is almost certainly broken
// too, and is the likely real cause of this repo's long-standing unexplained
// `POST /api/shopping/build` 500). So instead of "atomic UPDATE + insert, wrapped in a
// transaction," the atomic conditional UPDATE below is the *entire* race-safety mechanism: its
// `quantity >= splitQuantity` WHERE guard is a single indivisible Postgres statement, so two
// concurrent splits on the same row can never both succeed against more quantity than exists.
// The follow-up insert/in-place-conversion statement is not itself race-prone — by the time it
// runs, the decrement has already durably claimed the split-off quantity, so no concurrent
// request can interfere with it. The only residual risk (disclosed, not fixed here) is a process
// crash between the two statements, which this driver has no way to close without moving off
// neon-http entirely — out of this task's scope.
// TASK-033: converts a servings-based split request into a unit quantity ahead of the split logic
// below, rounded to 6 decimal places to absorb ordinary floating-point noise (e.g. 0.1 + 0.2
// artifacts) without meaningfully constraining legitimate precision for any realistic purchase
// unit. Extracted as a named helper (rather than inlined in splitItem) purely for future reuse —
// e.g. consume-by-servings or recipe-servings math, should either ever need this same conversion.
export function computeSplitQuantityFromServings(splitServings, servingsPerPurchaseUnit) {
  return Math.round((splitServings / servingsPerPurchaseUnit) * 1e6) / 1e6;
}

export async function splitItem(householdId, id, { splitQuantity, splitServings, storageLocation }) {
  let quantity = splitQuantity;

  // splitServings requires a lookup first (to convert against the item's own
  // servingsPerPurchaseUnit) — this read is not itself part of the race-safety mechanism, only
  // the atomic conditional UPDATE below is (see the module-level comment above).
  if (splitServings != null) {
    const [item] = await db.select().from(pantryItems)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.householdId, householdId)));
    if (!item) return { status: 'not_found' };
    if (item.servingsPerPurchaseUnit == null) return { status: 'no_servings_configured' };
    quantity = computeSplitQuantityFromServings(splitServings, item.servingsPerPurchaseUnit);
  }

  const [decremented] = await db.update(pantryItems)
    .set({ quantity: sql`${pantryItems.quantity} - ${quantity}`, updatedAt: new Date().toISOString() })
    .where(and(
      eq(pantryItems.id, id),
      eq(pantryItems.householdId, householdId),
      gte(pantryItems.quantity, quantity),
    ))
    .returning();

  if (!decremented) {
    const [existing] = await db.select().from(pantryItems)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.householdId, householdId)));
    return { status: existing ? 'invalid_quantity' : 'not_found' };
  }

  const purchaseDate = decremented.purchaseDate ?? decremented.createdAt;
  const expiryDate = computeExpiryForStorage({
    name:            decremented.name,
    category:        decremented.category,
    storageLocation,
    purchaseDate,
    existingExpiry:  null,
    source:          'ai_estimate',
  });

  if (decremented.quantity === 0) {
    await db.update(pantryItems)
      .set({ storageLocation, expiryDate, updatedAt: new Date().toISOString() })
      .where(eq(pantryItems.id, id));
    const [original] = await db.select().from(pantryItems).where(eq(pantryItems.id, id));
    return { status: 'ok', original, created: null };
  }

  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...clonable } = decremented;
  const [created] = await db.insert(pantryItems)
    .values({ ...clonable, householdId, quantity, storageLocation, expiryDate })
    .returning();

  return { status: 'ok', original: decremented, created };
}

// Inserts items independently — best-effort, non-atomic. One failure does not roll back others.
// Always source: 'ai_estimate' — receipt candidates' expiryDate is algorithm-produced (an
// estimatedExpiryDays-derived guess), never a human-typed value, regardless of it being present
// on the request body (Decision 1).
export async function bulkCreate(householdId, items) {
  const results = [];
  for (const item of items) {
    try {
      const enriched = enrichWithExpiry(item, 'ai_estimate');
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
