import { del } from '@vercel/blob';
import { db } from '../db/client.js';
import { recipes } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

// JSON-serialized columns — stored as text in the DB for portability
const JSON_FIELDS = ['ingredients', 'steps', 'tags'];

function serialize(data) {
  const out = { ...data };
  for (const field of JSON_FIELDS) {
    if (out[field] !== undefined) {
      out[field] = JSON.stringify(out[field] ?? []);
    }
  }
  return out;
}

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of JSON_FIELDS) {
    try {
      out[field] = JSON.parse(out[field] ?? '[]');
    } catch {
      out[field] = [];
    }
  }
  return out;
}

export async function getAll(householdId) {
  const rows = await db
    .select()
    .from(recipes)
    .where(eq(recipes.householdId, householdId))
    .orderBy(desc(recipes.savedAt));
  return rows.map(parse);
}

export async function create(householdId, data) {
  const [row] = await db
    .insert(recipes)
    .values({ ...serialize(data), householdId })
    .returning();
  return parse(row);
}

// Returns row if inserted, undefined if (household_id, name) already exists.
// Only the save_recipe tool handler should call this.
export async function createOrIgnore(householdId, data) {
  const [row] = await db
    .insert(recipes)
    .values({ ...serialize(data), householdId })
    .onConflictDoNothing({ target: [recipes.householdId, recipes.name] })
    .returning();
  return row ? parse(row) : undefined;
}

// Two-step ownership: find by id first (→ 404), then check householdId (→ 403).
export async function update(householdId, id, data) {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  await db.update(recipes)
    .set({ ...serialize(data), updatedAt: new Date().toISOString() })
    .where(eq(recipes.id, id));

  const [updated] = await db.select().from(recipes).where(eq(recipes.id, id));
  return { status: 'ok', recipe: parse(updated) };
}

export async function remove(householdId, id) {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  // Delete blob if it's a full URL (Vercel Blob) — fire-and-forget, never block the caller
  if (existing.imageUrl?.startsWith('http')) {
    del(existing.imageUrl).catch((e) =>
      console.error('[recipeService] Blob delete failed:', e.message)
    );
  }

  await db.delete(recipes).where(eq(recipes.id, id));
  return { status: 'ok' };
}

export async function toggleFavorite(householdId, id) {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return { status: 'not_found' };
  if (existing.householdId !== householdId) return { status: 'forbidden' };

  await db.update(recipes)
    .set({ isFavorite: !existing.isFavorite, updatedAt: new Date().toISOString() })
    .where(eq(recipes.id, id));

  const [updated] = await db.select().from(recipes).where(eq(recipes.id, id));
  return { status: 'ok', recipe: parse(updated) };
}
