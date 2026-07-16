import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mealLogs } from '../db/schema.js';

export async function create({
  householdId,
  pantryItemId,
  itemName,
  category,
  purineLevel,
  wasExpiring,
  quantityBefore,
  quantityAfter,
  source,
}) {
  const [row] = await db
    .insert(mealLogs)
    .values({
      householdId,
      pantryItemId: pantryItemId ?? null,
      itemName,
      category: category ?? 'Other',
      purineLevel: purineLevel ?? 'medium',
      wasExpiring: wasExpiring ?? null,
      quantityBefore: quantityBefore ?? null,
      quantityAfter: quantityAfter ?? null,
      loggedAt: new Date().toISOString(),
      source: source ?? 'agent',
    })
    .returning();
  return row;
}

// Last N entries sorted DESC — for display.
export async function getRecentLimit(householdId, n = 7) {
  return db
    .select()
    .from(mealLogs)
    .where(eq(mealLogs.householdId, householdId))
    .orderBy(desc(mealLogs.loggedAt))
    .limit(n);
}

// All entries since isoTimestamp, sorted DESC, no LIMIT — for purine classification.
// ::timestamptz cast on both sides makes the TEXT-based invariant code-enforced.
export async function getRecentSince(householdId, isoTimestamp) {
  return db
    .select()
    .from(mealLogs)
    .where(
      and(
        eq(mealLogs.householdId, householdId),
        sql`(${mealLogs.loggedAt})::timestamptz >= (${isoTimestamp})::timestamptz`
      )
    )
    .orderBy(desc(mealLogs.loggedAt));
}
