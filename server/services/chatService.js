import { eq, asc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chatMessages } from '../db/schema.js';

// Returns the N most recent messages for the user, sorted oldest-first (ASC)
// so callers can pass them directly into the AI messages array.
export function getHistory(userId, limit = 50) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit)
    .all();
}

// Inserts both the user message and the assistant reply in a single transaction.
// If either insert fails, neither is committed — no orphan messages in the history.
// Only called after the AI responds successfully, so an AI failure never reaches this.
export function savePair(userId, userMessage, assistantReply) {
  db.transaction((tx) => {
    tx.insert(chatMessages)
      .values({ userId, role: 'user', content: userMessage })
      .run();
    tx.insert(chatMessages)
      .values({ userId, role: 'assistant', content: assistantReply })
      .run();
  });
}

// Deletes the oldest messages so only the most recent keepLast remain.
// Fetches IDs first to avoid a correlated subquery — SQLite handles this pattern
// better than DELETE ... WHERE id NOT IN (SELECT ... ORDER BY ... LIMIT ...).
export function trimHistory(userId, keepLast) {
  const all = db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(asc(chatMessages.createdAt))
    .all();

  if (all.length <= keepLast) return;

  const excess = all.slice(0, all.length - keepLast).map((r) => r.id);
  db.delete(chatMessages).where(inArray(chatMessages.id, excess)).run();
}
