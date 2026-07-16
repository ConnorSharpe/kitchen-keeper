import { createRequire } from 'module';
import { stripIngredientPrefix } from '../utils/foodNormalization.js';

const require = createRequire(import.meta.url);

let data = [];
let exactIndex = new Map();
let loadError = null;

try {
  data = require('../data/foodkeeper.json');
  for (const entry of data) {
    exactIndex.set(entry.name, entry);
  }
} catch (err) {
  loadError = err;
  console.error(
    '[shelfLifeService] Failed to load foodkeeper.json:',
    err.message
  );
}

function selectStorageContext(entry, storageLocation) {
  if (storageLocation) {
    const days = entry[`${storageLocation}Days`];
    return days > 0
      ? { storageContext: storageLocation, recommendedDays: days }
      : null;
  }
  if (entry.pantryDays > 0)
    return { storageContext: 'pantry', recommendedDays: entry.pantryDays };
  if (entry.refrigeratorDays > 0)
    return {
      storageContext: 'refrigerator',
      recommendedDays: entry.refrigeratorDays,
    };
  if (entry.freezerDays > 0)
    return { storageContext: 'freezer', recommendedDays: entry.freezerDays };
  return null;
}

// storageLocation ('pantry'|'refrigerator'|'freezer'), if given, looks up that specific storage
// context's day-count instead of the pantry > refrigerator > freezer priority fallback.
export function lookup(itemName, storageLocation) {
  try {
    if (loadError || !itemName) return null;

    const stripped = stripIngredientPrefix(itemName);
    const normalized = stripped.toLowerCase().trim();

    if (!normalized) return null;

    // 1. O(1) exact match
    let entry = exactIndex.get(normalized);
    let matchType = 'exact';

    // 2. Normalized query is a substring of a FoodKeeper name
    if (!entry) {
      entry = data.find((e) => e.name.includes(normalized));
      matchType = 'substring';
    }

    // 3. A FoodKeeper name is a substring of the normalized query
    if (!entry) {
      entry = data.find((e) => normalized.includes(e.name));
      matchType = 'substring';
    }

    if (!entry) {
      // Only log if it looks like a real food name, not a PLU/SKU
      const isPluOrSku =
        /^\d+$/.test(normalized) || /^[a-z]{1,4}\s*\d+/.test(normalized);
      if (!isPluOrSku && normalized.length >= 3 && /[a-z]/.test(normalized)) {
        console.log(
          `[shelfLifeService] miss normalized="${normalized}" original="${itemName}"`
        );
      }
      return null;
    }

    const storage = selectStorageContext(entry, storageLocation);
    if (!storage) return null;

    return {
      pantryDays: entry.pantryDays,
      refrigeratorDays: entry.refrigeratorDays,
      freezerDays: entry.freezerDays,
      recommendedDays: storage.recommendedDays,
      storageContext: storage.storageContext,
      matchType,
    };
  } catch (err) {
    console.error('[shelfLifeService] lookup error:', err.message);
    return null;
  }
}
