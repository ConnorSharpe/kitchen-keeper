import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households } from '../db/schema.js';
import * as mealLogService from './mealLogService.js';

const JSON_FIELDS = ['conditions', 'allergies', 'foodPreferences'];

function serialize(data) {
  const out = { ...data };
  for (const field of JSON_FIELDS) {
    if (out[field] !== undefined) out[field] = JSON.stringify(out[field] ?? []);
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

export async function getProfile(householdId) {
  const [row] = await db
    .select()
    .from(households)
    .where(eq(households.id, householdId));
  return parse(row);
}

export async function updateProfile(householdId, data) {
  await db
    .update(households)
    .set(serialize(data))
    .where(eq(households.id, householdId));
}

export async function buildDietaryContext(householdId) {
  const profile = await getProfile(householdId);
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const [recentDisplay, recent72h] = await Promise.all([
    mealLogService.getRecentLimit(householdId, 7),
    mealLogService.getRecentSince(householdId, cutoff72h),
  ]);

  const conditions = profile?.conditions ?? [];
  const allergies = profile?.allergies ?? [];
  const foodPreferences = profile?.foodPreferences ?? [];

  const hasProfile =
    conditions.length || allergies.length || foodPreferences.length;
  const hasMeals = recentDisplay.length > 0;

  if (!hasProfile && !hasMeals) return '';

  const highCount = recent72h.filter((m) => m.purineLevel === 'high').length;
  const medCount = recent72h.filter((m) => m.purineLevel === 'medium').length;
  let purineLoad;
  if (highCount >= 2 || highCount + medCount >= 4) purineLoad = 'HIGH';
  else if (highCount + medCount >= 2) purineLoad = 'MODERATE';
  else purineLoad = 'LOW';

  const condStr = conditions.length ? conditions.join(', ') : 'none';
  const allergStr = allergies.length ? allergies.join(', ') : 'none';
  const prefStr = foodPreferences.length ? foodPreferences.join(', ') : 'none';

  let ctx = `Dietary profile: ${condStr}. Allergies: ${allergStr}. Preferences: ${prefStr}.`;

  if (hasMeals) {
    const mealStr = recentDisplay
      .map((m) => {
        const lvl =
          m.purineLevel === 'high'
            ? 'high'
            : m.purineLevel === 'medium'
              ? 'med'
              : 'low';
        return `${m.itemName} [${lvl}]`;
      })
      .join(', ');
    ctx += `\nRecent meals (last ${recentDisplay.length}): ${mealStr}.`;
    ctx += `\nPurine load: ${purineLoad}.`;
    if (purineLoad === 'HIGH')
      ctx += ' Recommend limiting high-purine recipes until load normalises.';
  }

  return ctx;
}
