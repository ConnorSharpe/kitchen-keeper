import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { clerkClient } from '@clerk/express';
import { db } from '../db/client.js';
import {
  households,
  householdMembers,
  pantryItems,
  recipes,
  shoppingLists,
  chatMessages,
  recipeBlocklist,
  mealLogs,
} from '../db/schema.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { maskKey } from '../utils/keyEncryption.js';
import * as platformSettingsService from './platformSettingsService.js';
import * as onboardingService from './onboardingService.js';

const JOIN_CODE_CONSTRAINT = 'households_join_code_unique';
const CLERK_LOOKUP_TIMEOUT_MS = 5000;

function generateJoinCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function updateName(householdId, name) {
  await db
    .update(households)
    .set({ name })
    .where(eq(households.id, householdId));
}

export async function getById(householdId) {
  const [row] = await db
    .select()
    .from(households)
    .where(eq(households.id, householdId));
  return row ?? null;
}

function resolveDisplayName(clerkUser, role) {
  if (!clerkUser) return role === 'owner' ? 'Former owner' : 'Former member';
  const fullName =
    `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim();
  if (fullName) return fullName;
  if (clerkUser.username) return clerkUser.username;
  const primaryEmail = clerkUser.emailAddresses?.find(
    (e) => e.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;
  return primaryEmail ?? 'Household member';
}

// Returns a Map<clerkUserId, ClerkUser>, empty on any failure/timeout — callers
// treat a missing entry the same whether the user was deleted or Clerk is down.
//
// Note: Promise.race only stops *waiting* on the Clerk request past the timeout —
// it does not abort the underlying HTTP call, which keeps running in the background
// and is simply ignored when it eventually resolves. Not a problem here (no side
// effects, nothing to cancel), just worth knowing this isn't true cancellation.
async function lookupClerkUsers(ids, requestId = 'n/a') {
  const start = Date.now();
  try {
    const { data } = await Promise.race([
      clerkClient.users.getUserList({ userId: ids, limit: ids.length }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Clerk user lookup timed out')),
          CLERK_LOOKUP_TIMEOUT_MS
        )
      ),
    ]);
    console.log(
      `[kitchen-keeper] request_id=${requestId} function=lookupClerkUsers ` +
        `elapsedMs=${Date.now() - start} timedOut=false`
    );
    return new Map(data.map((u) => [u.id, u]));
  } catch (err) {
    const timedOut = err.message === 'Clerk user lookup timed out';
    console.warn(
      `[kitchen-keeper] request_id=${requestId} function=lookupClerkUsers ` +
        `elapsedMs=${Date.now() - start} timedOut=${timedOut} ` +
        `fallback_count=${ids.length} error=${err.message}`
    );
    return new Map();
  }
}

export async function getMembers(householdId, { requestId = 'n/a' } = {}) {
  const neonStart = Date.now();
  const household = await getById(householdId);
  if (!household) return [];

  const memberRows = await db
    .select({
      clerkUserId: householdMembers.clerkUserId,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.joinedAt);
  console.log(
    `[kitchen-keeper] request_id=${requestId} function=getMembers ` +
      `neon_query_elapsedMs=${Date.now() - neonStart}`
  );

  // Owner may be null for households whose creator only ever joined via a
  // householdMembers row (see getOrCreate's resolution order) — skip if so.
  const ownerRow = household.clerkUserId
    ? {
        clerkUserId: household.clerkUserId,
        role: 'owner',
        joinedAt: household.createdAt,
      }
    : null;

  const orderedRows = ownerRow ? [ownerRow, ...memberRows] : memberRows;
  if (orderedRows.length === 0) return [];

  const ids = [...new Set(orderedRows.map((r) => r.clerkUserId))];
  const byId = await lookupClerkUsers(ids, requestId);

  return orderedRows.map((r) => ({
    clerkUserId: r.clerkUserId,
    role: r.role,
    joinedAt: r.joinedAt,
    displayName: resolveDisplayName(byId.get(r.clerkUserId), r.role),
  }));
}

export async function getByJoinCode(code) {
  const [row] = await db
    .select()
    .from(households)
    .where(eq(households.joinCode, code.trim().toUpperCase()));
  return row ?? null;
}

// Resolution order:
// 1. householdMembers (non-owner member lookup)
// 2. households.clerkUserId (owner lookup)
// 3. Create new household
export async function getOrCreate(clerkUserId) {
  // Step 1: non-owner member
  const [membership] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.clerkUserId, clerkUserId));
  if (membership) return { id: membership.householdId };

  // Step 2: owner
  const [owned] = await db
    .select()
    .from(households)
    .where(eq(households.clerkUserId, clerkUserId));
  if (owned) return owned;

  // Step 3: create
  return createHousehold(clerkUserId);
}

async function createHousehold(clerkUserId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [row] = await db
        .insert(households)
        .values({
          clerkUserId,
          name: 'My Household',
          joinCode: generateJoinCode(),
        })
        .returning();
      await onboardingService.upsertFlow(clerkUserId, 'new_household');
      return row;
    } catch (err) {
      const isJoinCodeCollision =
        err.code === '23505' && err.constraint === JOIN_CODE_CONSTRAINT;
      if (!isJoinCodeCollision || attempt === 2) throw err;
    }
  }
}

// Every table here has a direct householdId FK and represents real user-created
// content — this list is the complete definition of "does this household have
// data worth protecting." Whenever a new household-owned content table is added
// to the schema, it MUST be added here too, or joinByCode's Guard C will
// silently fail to protect it, letting a join delete real data out from under
// someone (TASK-044, architect review round 1). pushSubscriptions is
// deliberately excluded — it's a device registration, not content.
const CONTENT_TABLES = [
  pantryItems,
  recipes,
  shoppingLists,
  chatMessages,
  recipeBlocklist,
  mealLogs,
];

// LIMIT 1, not COUNT(*) — only presence/absence matters here, and COUNT(*)
// forces Postgres to scan every matching row just to throw the number away
// (TASK-044, architect review round 1).
async function hasAnyRows(table, householdId) {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.householdId, householdId))
    .limit(1);
  return rows.length > 0;
}

// A household is disposable if it contains zero rows across every content table —
// no age check. Revisit before expanding household-sharing features.
export async function isDisposableHousehold(householdId) {
  const results = await Promise.all(
    CONTENT_TABLES.map((table) => hasAnyRows(table, householdId))
  );
  return results.every((hasRows) => !hasRows);
}

// Atomically: delete the user's empty auto-created household and insert a householdMembers row.
// Guards are checked before entering the transaction.
export async function joinByCode(clerkUserId, currentHouseholdId, code) {
  const target = await getByJoinCode(code);
  if (!target) {
    const err = new Error('Invalid join code');
    err.status = 404;
    throw err;
  }

  // Guard A: self-join
  if (target.id === currentHouseholdId) {
    const err = new Error('Already in this household');
    err.status = 409;
    throw err;
  }

  // Guard B: already a member
  const [existing] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(eq(householdMembers.clerkUserId, clerkUserId));
  if (existing) {
    const err = new Error('Already a member of a household');
    err.status = 409;
    throw err;
  }

  // Guard C: current household has data
  const disposable = await isDisposableHousehold(currentHouseholdId);
  if (!disposable) {
    const err = new Error(
      'Your household already has data — cannot join another household'
    );
    err.status = 409;
    throw err;
  }

  await onboardingService.upsertFlow(clerkUserId, 'joined');

  // Sequential (non-transactional): drizzle-orm/neon-http has no interactive transaction
  // support (TASK-035 Part A3). Insert-before-delete, deliberately reordered from the
  // naive delete-then-insert: if the insert fails, the user keeps their old (empty)
  // household as a safe fallback rather than being left with zero household membership.
  // Safe against the unique-constraint concern because households.clerkUserId and
  // householdMembers.clerkUserId are separate unique columns on separate tables, and
  // Guard B above already proved this user has zero existing householdMembers rows.
  await db.insert(householdMembers).values({
    householdId: target.id,
    clerkUserId,
    role: 'member',
  });
  await db.delete(households).where(eq(households.id, currentHouseholdId));

  return { householdId: target.id, householdName: target.name };
}

// Returns { provider: clerkUserId, decryptedKey, publicAiAccessEnabled } for resolveProvider.
// The 'provider' field carries clerkUserId so aiService.js requires no changes.
// Throws with status 422 if key is stored but cannot be decrypted.
export async function getAiConfig(householdId) {
  const row = await getById(householdId);
  const publicAiAccessEnabled =
    await platformSettingsService.isPublicAiAccessEnabled();
  if (!row?.openaiApiKey) {
    return {
      provider: row?.clerkUserId ?? null,
      decryptedKey: null,
      publicAiAccessEnabled,
    };
  }
  try {
    const decryptedKey = decrypt(row.openaiApiKey);
    return { provider: row.clerkUserId, decryptedKey, publicAiAccessEnabled };
  } catch {
    const err = new Error(
      'Your configured AI key could not be decrypted. Please update it in Household Settings.'
    );
    err.status = 422;
    throw err;
  }
}

// Safe preview for the settings GET endpoint — never throws on decrypt failure.
export async function getAiKeyPreview(householdId) {
  const row = await getById(householdId);
  if (!row?.openaiApiKey) return { maskedKey: null };
  try {
    const decryptedKey = decrypt(row.openaiApiKey);
    return { maskedKey: maskKey(decryptedKey) };
  } catch {
    return { maskedKey: null };
  }
}

export async function setAiApiKey(householdId, key) {
  const encryptedKey = encrypt(key);
  await db
    .update(households)
    .set({ openaiApiKey: encryptedKey })
    .where(eq(households.id, householdId));
}

export async function removeAiApiKey(householdId) {
  await db
    .update(households)
    .set({ openaiApiKey: null })
    .where(eq(households.id, householdId));
}

// 3 total attempts (1 initial + 2 retries). Retries only on join-code uniqueness collision.
export async function create(ownerName) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [household] = await db
        .insert(households)
        .values({
          name: `${ownerName}'s Household`,
          joinCode: generateJoinCode(),
        })
        .returning();
      return household;
    } catch (err) {
      const isJoinCodeCollision =
        err.code === '23505' && err.constraint === JOIN_CODE_CONSTRAINT;
      if (!isJoinCodeCollision || attempt === 2) throw err;
    }
  }
}
