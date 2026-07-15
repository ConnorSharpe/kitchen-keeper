import { db } from '../db/client.js';
import { recipeBlocklist } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export async function getAll(householdId) {
  return db
    .select()
    .from(recipeBlocklist)
    .where(eq(recipeBlocklist.householdId, householdId))
    .orderBy(desc(recipeBlocklist.blockedAt));
}

// Returns the inserted row, or undefined if (household_id, source, source_id) already exists.
export async function add(householdId, { source, sourceId, name }) {
  const [row] = await db
    .insert(recipeBlocklist)
    .values({ householdId, source, sourceId, name })
    .onConflictDoNothing({ target: [recipeBlocklist.householdId, recipeBlocklist.source, recipeBlocklist.sourceId] })
    .returning();
  return row;
}

// Two-step ownership: find by id first (→ 404), then check householdId (→ 403).
export async function remove(householdId, id) {
  const [existing] = await db.select().from(recipeBlocklist).where(eq(recipeBlocklist.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  await db.delete(recipeBlocklist).where(eq(recipeBlocklist.id, id));
  return { status: 'ok' };
}

// Freshly-constructed Set per call — callers must treat it as read-only (not cached/shared).
export async function getBlockedKeys(householdId) {
  const rows = await db
    .select({ source: recipeBlocklist.source, sourceId: recipeBlocklist.sourceId })
    .from(recipeBlocklist)
    .where(eq(recipeBlocklist.householdId, householdId));
  return new Set(rows.map((r) => `${r.source}:${r.sourceId}`));
}
