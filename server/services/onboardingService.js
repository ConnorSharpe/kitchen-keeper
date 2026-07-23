import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userOnboarding } from '../db/schema.js';

// No row = user predates this feature. Treat as already-onboarded rather than
// retroactively showing onboarding to existing users (mirrors the DEFAULT TRUE
// convention in 0003_onboarding_complete.sql, just expressed as row-absence
// instead of a column default, since this is a brand-new table with no legacy
// rows to protect).
export async function getStatus(clerkUserId) {
  const [row] = await db
    .select()
    .from(userOnboarding)
    .where(eq(userOnboarding.clerkUserId, clerkUserId));
  if (!row) return { complete: true, flow: null };
  return { complete: row.complete, flow: row.flow };
}

// Called from householdService.createHousehold (flow='new_household') and
// joinByCode (flow='joined'). Guarded by `WHERE complete = false` — once
// onboarding is complete, the row is frozen. In practice a third call is
// already structurally impossible: createHousehold only runs from
// getOrCreate's step 3 (unreachable once a user owns or belongs to any
// household), and joinByCode's Guard B throws if the caller already has a
// householdMembers row. The WHERE clause is defense-in-depth against that
// invariant ever being relaxed elsewhere, not a workaround for a reachable bug
// (architect review round 1, corrected — see TASK-040 Architect Review History).
export async function upsertFlow(clerkUserId, flow) {
  await db
    .insert(userOnboarding)
    .values({ clerkUserId, flow })
    .onConflictDoUpdate({
      target: userOnboarding.clerkUserId,
      set: { flow },
      where: eq(userOnboarding.complete, false),
    });
}

// Idempotent: a second concurrent PATCH is a no-op (the WHERE clause matches
// zero rows on the second call), so completedAt can't be nudged by a race
// (architect review round 1).
export async function markComplete(clerkUserId) {
  await db
    .update(userOnboarding)
    .set({ complete: true, completedAt: new Date().toISOString() })
    .where(
      and(
        eq(userOnboarding.clerkUserId, clerkUserId),
        eq(userOnboarding.complete, false)
      )
    );
}
