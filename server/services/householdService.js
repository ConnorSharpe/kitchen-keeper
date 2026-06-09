import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, users } from '../db/schema.js';
import { encrypt, decrypt, maskKey } from '../utils/keyEncryption.js';

// Drizzle convention: {tableName}_{columnName}_unique → households_join_code_unique
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

// Normalization (trim + toUpperCase) is performed here — callers pass raw input.
export async function getByJoinCode(code) {
  const [row] = await db
    .select()
    .from(households)
    .where(eq(households.joinCode, code.trim().toUpperCase()));
  return row ?? null;
}

// Returns { provider, decryptedKey } for chat routing.
// Throws with status 422 if key is stored but cannot be decrypted.
export async function getAiConfig(householdId) {
  const row = await getById(householdId);
  if (!row?.aiApiKey) {
    return { provider: null, decryptedKey: null };
  }
  try {
    const decryptedKey = decrypt(row.aiApiKey);
    return { provider: row.aiProvider, decryptedKey };
  } catch {
    const err = new Error(
      'Your configured AI provider key could not be decrypted. Please update or remove it in Household Settings.'
    );
    err.status = 422;
    throw err;
  }
}

// Safe preview for the settings GET endpoint — never throws on decrypt failure.
export async function getAiKeyPreview(householdId) {
  const row = await getById(householdId);
  if (!row?.aiApiKey) return { provider: null, maskedKey: null };
  try {
    const decryptedKey = decrypt(row.aiApiKey);
    return { provider: row.aiProvider, maskedKey: maskKey(decryptedKey) };
  } catch {
    return { provider: row.aiProvider, maskedKey: null };
  }
}

export async function setAiApiKey(householdId, provider, key) {
  const encryptedKey = encrypt(key);
  await db.update(households)
    .set({ aiApiKey: encryptedKey, aiProvider: provider })
    .where(eq(households.id, householdId));
}

export async function removeAiApiKey(householdId) {
  await db.update(households)
    .set({ aiApiKey: null, aiProvider: null })
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
