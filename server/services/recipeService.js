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
