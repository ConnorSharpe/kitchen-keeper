import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import { createCachedLoader } from './cachedLoader.js';

const SETTINGS_ROW_ID = 1;
const PLATFORM_SETTINGS_CACHE_TTL_MS = 5000;

// Used both if the settings row is somehow missing (shouldn't happen —
// migration 0017 seeds it) and if the DB lookup itself fails.
const DEFAULTS = {
  publicAiAccessEnabled: false,
  aiRateLimitMax: 20,
  updatedAt: null,
  updatedByClerkId: null,
};

function rowToSettings(row) {
  return {
    publicAiAccessEnabled: row.publicAiAccessEnabled,
    aiRateLimitMax: row.aiRateLimitMax,
    updatedAt: row.updatedAt,
    updatedByClerkId: row.updatedByClerkId,
  };
}

async function loadFromDb() {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, SETTINGS_ROW_ID));
  return row ? rowToSettings(row) : DEFAULTS;
}

const cache = createCachedLoader(loadFromDb, PLATFORM_SETTINGS_CACHE_TTL_MS);

// Fails closed: any DB error (Neon outage, network blip) is treated as
// "platform access disabled, default rate limit" rather than 500ing every AI
// request or accidentally fail-opening to grant everyone platform-key access.
export async function getPlatformSettings() {
  try {
    return await cache.get();
  } catch (err) {
    console.error(
      '[platformSettingsService] lookup failed, failing closed:',
      err.message
    );
    return DEFAULTS;
  }
}

export async function isPublicAiAccessEnabled() {
  const { publicAiAccessEnabled } = await getPlatformSettings();
  return publicAiAccessEnabled;
}

// Uses UPDATE ... RETURNING (Drizzle's .returning(), already used elsewhere
// in this codebase — see householdService.createHousehold) so the response
// reflects exactly the row just written, in the same atomic statement. This
// avoids a race where invalidating the cache and then re-reading it as two
// separate steps could return stale/default data if the second read failed
// (architect review round 2). Verify .returning() works on .update() with
// the installed drizzle-orm@0.29.5 + neon-http combination before relying on
// it — proven for .insert() in this codebase already, not yet for .update().
export async function setPlatformSettings(patch, updatedByClerkId) {
  const [row] = await db
    .update(platformSettings)
    .set({ ...patch, updatedAt: new Date().toISOString(), updatedByClerkId })
    .where(eq(platformSettings.id, SETTINGS_ROW_ID))
    .returning();
  cache.invalidate();
  return rowToSettings(row);
}
