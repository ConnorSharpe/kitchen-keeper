import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { recipes } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

// These three columns are stored as JSON strings in SQLite
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

export function getAll(userId) {
  return db
    .select()
    .from(recipes)
    .where(eq(recipes.userId, userId))
    .orderBy(desc(recipes.savedAt))
    .all()
    .map(parse);
}

export function create(userId, data) {
  const row = db
    .insert(recipes)
    .values({ ...serialize(data), userId })
    .returning()
    .get();
  return parse(row);
}

// Two-step ownership: find by id first (→ 404), then check userId (→ 403).
// Returns { status: 'ok', recipe } | { status: 'not_found' } | { status: 'forbidden' }
export function update(userId, id, data) {
  const existing = db.select().from(recipes).where(eq(recipes.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  db.update(recipes)
    .set({ ...serialize(data), updatedAt: new Date().toISOString() })
    .where(eq(recipes.id, id))
    .run();

  return { status: 'ok', recipe: parse(db.select().from(recipes).where(eq(recipes.id, id)).get()) };
}

export function remove(userId, id) {
  const existing = db.select().from(recipes).where(eq(recipes.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  // Unlink recipe image from /uploads — fire-and-forget, never block the caller
  if (existing.imageUrl) {
    const filePath = path.join('uploads', existing.imageUrl);
    fs.promises.unlink(filePath).catch((e) =>
      console.error('[recipeService] Image unlink failed:', e.message)
    );
  }

  db.delete(recipes).where(eq(recipes.id, id)).run();
  return { status: 'ok' };
}

// Flips isFavorite and bumps updatedAt
export function toggleFavorite(userId, id) {
  const existing = db.select().from(recipes).where(eq(recipes.id, id)).get();
  if (!existing) return { status: 'not_found' };
  if (existing.userId !== userId) return { status: 'forbidden' };

  db.update(recipes)
    .set({ isFavorite: !existing.isFavorite, updatedAt: new Date().toISOString() })
    .where(eq(recipes.id, id))
    .run();

  return { status: 'ok', recipe: parse(db.select().from(recipes).where(eq(recipes.id, id)).get()) };
}
