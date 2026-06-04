import { eq, asc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chatMessages } from '../db/schema.js';

// Returns the N most recent messages sorted oldest-first so callers can pass
// them directly into the AI messages array without re-sorting.
export async function getHistory(householdId, limit = 50) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.householdId, householdId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit);
}

// Inserts user message and assistant reply atomically — no orphan messages on AI failure.
export async function savePair(householdId, userMessage, assistantReply) {
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({ householdId, role: 'user',      content: userMessage });
    await tx.insert(chatMessages).values({ householdId, role: 'assistant', content: assistantReply });
  });
}

// Deletes oldest messages so only the most recent keepLast remain.
// Fetches IDs first to avoid a subquery — cleaner across all SQL dialects.
export async function trimHistory(householdId, keepLast) {
  const all = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.householdId, householdId))
    .orderBy(asc(chatMessages.createdAt));

  if (all.length <= keepLast) return;

  const excess = all.slice(0, all.length - keepLast).map((r) => r.id);
  await db.delete(chatMessages).where(inArray(chatMessages.id, excess));
}
