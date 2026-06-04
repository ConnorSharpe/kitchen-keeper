import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, users } from '../db/schema.js';

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
