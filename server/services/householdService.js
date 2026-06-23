import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, users } from '../db/schema.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { maskKey } from '../utils/keyEncryption.js';

const JOIN_CODE_CONSTRAINT = 'households_join_code_unique';

function generateJoinCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function getById(householdId) {
  const [row] = await db.select().from(households).where(eq(households.id, householdId));
  return row ?? null;
}

export async function getMembers(householdId) {
  return db
    .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.householdId, householdId));
}

export async function getByJoinCode(code) {
  const [row] = await db
    .select()
    .from(households)
    .where(eq(households.joinCode, code.trim().toUpperCase()));
  return row ?? null;
}

// Lazy household creation on first authenticated Clerk request.
// INSERT ... ON CONFLICT DO UPDATE is idempotent and returns the row — safe under concurrent requests.
// Retries up to 3 times on join-code uniqueness collisions only.
export async function getOrCreate(clerkUserId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [row] = await db
        .insert(households)
        .values({ clerkUserId, name: 'My Household', joinCode: generateJoinCode() })
        .onConflictDoUpdate({
          target: households.clerkUserId,
          set: { clerkUserId }, // no-op update; returns existing row via RETURNING
        })
        .returning();
      return row;
    } catch (err) {
      const isJoinCodeCollision =
        err.code === '23505' && err.constraint === JOIN_CODE_CONSTRAINT;
      if (!isJoinCodeCollision || attempt === 2) throw err;
    }
  }
}

// Returns { provider: clerkUserId, decryptedKey } for resolveProvider.
// The 'provider' field carries clerkUserId so aiService.js requires no changes.
// Throws with status 422 if key is stored but cannot be decrypted.
export async function getAiConfig(householdId) {
  const row = await getById(householdId);
  if (!row?.openaiApiKey) {
    return { provider: row?.clerkUserId ?? null, decryptedKey: null };
  }
  try {
    const decryptedKey = decrypt(row.openaiApiKey);
    return { provider: row.clerkUserId, decryptedKey };
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
  await db.update(households)
    .set({ openaiApiKey: encryptedKey })
    .where(eq(households.id, householdId));
}

export async function removeAiApiKey(householdId) {
  await db.update(households)
    .set({ openaiApiKey: null })
    .where(eq(households.id, householdId));
}

// 3 total attempts (1 initial + 2 retries). Retries only on join-code uniqueness collision.
export async function create(ownerName) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [household] = await db
        .insert(households)
        .values({ name: `${ownerName}'s Household`, joinCode: generateJoinCode() })
        .returning();
      return household;
    } catch (err) {
      const isJoinCodeCollision =
        err.code === '23505' && err.constraint === JOIN_CODE_CONSTRAINT;
      if (!isJoinCodeCollision || attempt === 2) throw err;
    }
  }
}
