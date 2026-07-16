import { normalizeFood } from '../utils/foodNormalization.js';

const SPOONACULAR_BASE = 'https://api.spoonacular.com';
const THEMEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 5000;

// Process-scoped cache — opportunistic only (Vercel: per-instance, not shared)
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(str) {
  return (str ?? '').replace(/<[^>]*>/g, '').trim();
}

function mapSpoonacular(recipe) {
  const prepMins =
    recipe.preparationMinutes > 0 ? recipe.preparationMinutes : null;
  const cookMins =
    recipe.readyInMinutes > 0
      ? Math.max(0, recipe.readyInMinutes - (prepMins ?? 0))
      : null;

  return {
    sourceId: String(recipe.id),
    source: 'spoonacular',
    name: recipe.title,
    description: stripHtml(recipe.summary).slice(0, 500) || null,
    sourceUrl: recipe.sourceUrl ?? null,
    ingredients: (recipe.extendedIngredients ?? []).map((i) => ({
      name: i.name,
      quantity: i.amount ?? null,
      unit: i.unit || null,
    })),
    prepSteps: [],
    steps: (recipe.analyzedInstructions?.[0]?.steps ?? []).map((s) => s.step),
    tags: recipe.dishTypes ?? [],
    prepMins,
    cookMins,
    servings: recipe.servings ?? null,
  };
}

function mapTheMealDB(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (name && name.trim()) {
      ingredients.push({
        name: name.trim(),
        quantity: null,
        unit: measure?.trim() || null,
      });
    }
  }

  const steps = (meal.strInstructions ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const tags = [meal.strCategory, meal.strArea].filter(Boolean);

  return {
    sourceId: String(meal.idMeal),
    source: 'mealdb',
    name: meal.strMeal,
    description: null,
    sourceUrl: null,
    ingredients,
    prepSteps: [],
    steps,
    tags,
    prepMins: null,
    cookMins: null,
    servings: null,
  };
}

async function spoonacularSearch(ingredients) {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return null;

  const csv = ingredients.map((i) => encodeURIComponent(i)).join(',');
  const searchUrl = `${SPOONACULAR_BASE}/recipes/findByIngredients?ingredients=${csv}&number=5&ranking=2&ignorePantry=true&apiKey=${apiKey}`;

  let searchRes;
  try {
    searchRes = await fetchWithTimeout(searchUrl);
  } catch {
    console.warn(
      '[kitchen-keeper] function=recipeSearchService spoonacular_search timeout/network_error'
    );
    return null;
  }

  if (searchRes.status === 402 || searchRes.status === 429) {
    console.warn(
      '[kitchen-keeper] function=recipeSearchService spoonacular_quota_exceeded status=' +
        searchRes.status
    );
    return null;
  }
  if (!searchRes.ok) {
    console.warn(
      '[kitchen-keeper] function=recipeSearchService spoonacular_search_error status=' +
        searchRes.status
    );
    return null;
  }

  const searchData = await searchRes.json();
  if (!Array.isArray(searchData) || searchData.length === 0) return null;

  const top3 = searchData.slice(0, 3);
  const recipes = [];

  for (const candidate of top3) {
    const detailUrl = `${SPOONACULAR_BASE}/recipes/${candidate.id}/information?includeNutrition=false&apiKey=${apiKey}`;
    let detailRes;
    try {
      detailRes = await fetchWithTimeout(detailUrl);
    } catch {
      continue;
    }
    if (!detailRes.ok) continue;

    const detail = await detailRes.json();
    recipes.push(mapSpoonacular(detail));
  }

  return recipes.length > 0 ? recipes : null;
}

async function themealdbSearch(ingredient) {
  const filterUrl = `${THEMEALDB_BASE}/filter.php?i=${encodeURIComponent(ingredient)}`;

  let filterRes;
  try {
    filterRes = await fetchWithTimeout(filterUrl);
  } catch {
    console.warn(
      '[kitchen-keeper] function=recipeSearchService themealdb_filter timeout/network_error'
    );
    return null;
  }
  if (!filterRes.ok) return null;

  const filterData = await filterRes.json();
  const meals = filterData?.meals;
  if (!Array.isArray(meals) || meals.length === 0) return null;

  const recipes = [];
  for (const stub of meals.slice(0, 3)) {
    const lookupUrl = `${THEMEALDB_BASE}/lookup.php?i=${stub.idMeal}`;
    let lookupRes;
    try {
      lookupRes = await fetchWithTimeout(lookupUrl);
    } catch {
      continue;
    }
    if (!lookupRes.ok) continue;

    const lookupData = await lookupRes.json();
    const meal = lookupData?.meals?.[0];
    if (meal) recipes.push(mapTheMealDB(meal));
  }

  return recipes.length > 0 ? recipes : null;
}

/**
 * Returns up to 5 recipe suggestions based on pantry contents.
 * Never throws — returns [] on total failure.
 * Shape: [{ name, description, sourceUrl, ingredients, prepSteps, steps, tags, prepMins, cookMins, servings }]
 *
 * options.targetIngredients: user-named ingredient strings (TASK-034 Part A). Used as-is (not
 *   resolved against pantry item names). When non-empty, the query uses ONLY these ingredients —
 *   no pantry padding (TASK-035 Part B1: padding was diluting Spoonacular's results away from
 *   the requested ingredient).
 * options.rotationOffset: TASK-034 Part B — rotates which non-expiring pantry items anchor the
 *   query (and thus the 6-hour cache key) across suggestion rounds in a session, for the generic
 *   (no targetIngredients) case only. Expiring items always keep priority regardless of rotation.
 */
export async function findByPantry(allItems, expiringItems, options = {}) {
  const { targetIngredients = [], rotationOffset = 0 } = options;
  try {
    if (!Array.isArray(allItems) || allItems.length === 0) return [];

    const expiringSet = new Set(expiringItems.map((i) => i.id));
    const expiringNames = allItems
      .filter((i) => expiringSet.has(i.id))
      .map((i) => i.name);
    const nonExpiringNames = allItems
      .filter((i) => !expiringSet.has(i.id))
      .map((i) => i.name);

    // Guard: with zero non-expiring items the modulo divisor would be zero — skip rotation
    // entirely rather than attempt/catch. With exactly one, modulo-1 is always 0 (correct no-op).
    const rotatedNonExpiring =
      nonExpiringNames.length > 0
        ? (() => {
            const offset = rotationOffset % nonExpiringNames.length;
            return [
              ...nonExpiringNames.slice(offset),
              ...nonExpiringNames.slice(0, offset),
            ];
          })()
        : nonExpiringNames;

    const pantryOrdered = [...expiringNames, ...rotatedNonExpiring];

    // targetIngredients get absolute priority: when the user named specific ingredient(s),
    // query using ONLY those (deduplicated, capped at 5) — do not pad with pantry items.
    // TASK-035 Part B1: padding a targeted query with unrelated pantry anchors was diluting
    // Spoonacular's results away from the requested ingredient. Rotation is a no-op here by
    // design — it exists to vary pantry anchors for the generic case, and there's nothing to
    // rotate when the user named ingredients explicitly.
    const ingredientSource =
      targetIngredients.length > 0 ? targetIngredients : pantryOrdered;
    const seen = new Set();
    const combined = [];
    for (const name of ingredientSource) {
      const key = name.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      combined.push(name);
    }
    const ingredients = combined.slice(0, 5);

    const cacheKey = ingredients
      .map((n) => normalizeFood(n))
      .sort()
      .join(',');
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(
        `[kitchen-keeper] function=recipeSearchService recipe_api_source=cache result_count=${cached.length} cache_hit=true`
      );
      return cached;
    }

    // Try Spoonacular first
    let results = await spoonacularSearch(ingredients);
    let source = 'spoonacular';

    // Fall back to TheMealDB using the first (most expiring) ingredient
    if (!results) {
      const fallbackIngredient = ingredients[0];
      results = await themealdbSearch(fallbackIngredient);
      source = results ? 'themealdb' : 'none';
    }

    const final = results ?? [];
    console.log(
      `[kitchen-keeper] function=recipeSearchService recipe_api_source=${source} result_count=${final.length} cache_hit=false`
    );

    // Only cache successful non-empty results
    if (final.length > 0) setCached(cacheKey, final);

    return final;
  } catch (err) {
    console.error(
      '[kitchen-keeper] function=recipeSearchService unhandled_error:',
      err.message
    );
    return [];
  }
}
