import { db } from '../db/client.js';
import { suggestions } from '../db/schema.js';

// No read function — deliberately. This table has no in-app read path; the owner queries it
// directly. No transaction wrapper either — a single INSERT has nothing else to keep atomic with it.
export async function submitSuggestion({ householdId, clerkUserId, message }) {
  await db.insert(suggestions).values({ householdId, clerkUserId, message });
}
