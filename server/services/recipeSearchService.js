import {
  normalizeFood,
  foodsMatch,
  stripIngredientPrefix,
  normalizeUnit,
} from '../utils/foodNormalization.js';
import * as mealLogService from './mealLogService.js';
import * as dietaryService from './dietaryService.js';
import * as recipeBlocklistService from './recipeBlocklistService.js';
import * as recipeScorer from '../utils/recipeScorer.js';
import * as recipeService from './recipeService.js';
import * as pantryService from './pantryService.js';

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

// TASK-034 Decision D3: `${source}:${sourceId}` key format, shared by dedup, the recency-penalty
// lookup, and the blocklist filter — extracted once instead of re-inlined a third time.
export function deriveRecipeKey(candidate) {
  return candidate.source && candidate.sourceId
    ? `${candidate.source}:${candidate.sourceId}`
    : (candidate.name ?? '').toLowerCase().trim();
}

// Builds a Set of dedup keys from previously shown recipe suggestions in chat history.
// Key format: `${source}:${sourceId}` when available, normalized name as fallback.
// Handles old history rows that pre-date the sourceId field gracefully.
function extractSuggestedRecipeKeys(history) {
  const keys = new Set();
  for (const msg of history) {
    for (const s of msg.metadata?.recipeSuggestions ?? []) {
      if (s.source && s.sourceId) {
        keys.add(`${s.source}:${s.sourceId}`);
      } else if (s.name) {
        keys.add(s.name.toLowerCase().trim());
      }
    }
  }
  return keys;
}

// TASK-034 Decision A3.1: "contains a target ingredient" reuses foodsMatch()/normalizeFood()
// exactly — same TASK-011 invariant as everywhere else in this pipeline (no cross-variety
// matching: a target of "steelhead" will not match a recipe calling for "salmon").
function candidateContainsTarget(candidate, targetIngredients) {
  const ingredientNames = (candidate.ingredients ?? []).map((ing) =>
    stripIngredientPrefix(ing.name)
  );
  return targetIngredients.some((t) =>
    ingredientNames.some((n) => foodsMatch(t, n))
  );
}

// TASK-034 Decision B1: subtracted from effectiveScore for recipes already shown in this
// session's loaded history. Chosen empirically (comparable in magnitude to the saved-source
// ranking bonus below) — not derived from an existing convention. Tune here if suggestions
// feel too sticky or too random.
const RECENT_RECIPE_PENALTY = 0.5;

// TASK-050 D-12: the "is this saved recipe a good enough pantry match" bar, shared by
// suggestForChat's saved-source filter (below) and rankSavedByPantry (end of file) — one
// place for the 0.25/1 threshold instead of the same literals living in two functions.
export function qualifiesAsPantryMatch(recipe, allItems) {
  const { overlapScore, matchedIngredients, unmatchedIngredients } = recipeScorer.score(
    recipe,
    allItems
  );
  const qualifies = overlapScore >= 0.25 && matchedIngredients.length >= 1;
  return { overlapScore, matchedIngredients, unmatchedIngredients, qualifies };
}

/**
 * Chat-tool domain logic for the `suggest_recipes` tool (TASK-036 Part A, D-A2): scoring,
 * tiering, and pantry-status annotation for the AI chat suggestion flow. Moved here from
 * server/routes/ai.js's inline toolHandlers — a pure move, no behavior change.
 *
 * ctx: { householdId, history, allItems, expiringItems, allRecipes }
 * Returns { suggestions (slim, for the model), strategy, recipeSuggestions (full, for the
 * route to persist in chat metadata) }. recipeSuggestions replaces the pre-extraction
 * outer-closure mutation (`recipeSuggestions = annotated` in the old route) — the caller
 * (chat/handlers/suggestRecipes.js) writes it into ctx.result per D-A1.
 */
export async function suggestForChat(args, ctx) {
  const { householdId, history, allItems, expiringItems, allRecipes } = ctx;
  const requestedStrategy = args.strategy ?? 'any';
  const targetIngredients = Array.isArray(args.targetIngredients)
    ? args.targetIngredients.filter(
        (s) => typeof s === 'string' && s.trim().length > 0
      )
    : [];

  // Keys for recipes already shown in this session — soft recency penalty now (Part B),
  // no longer a hard filter.
  const shownKeys = extractSuggestedRecipeKeys(history);

  // Count of PRIOR assistant messages in `history` whose metadata.recipeSuggestions is
  // non-empty — i.e. how many suggestion rounds have already happened in this session.
  // Deliberately NOT a count of all assistant messages: an unrelated question asked in
  // between two recipe requests must not shift rotation.
  const priorSuggestionRounds = history.filter(
    (m) => m.metadata?.recipeSuggestions?.length > 0
  ).length;

  const [dietaryProfile, blockedKeys] = await Promise.all([
    dietaryService.getProfile(householdId),
    recipeBlocklistService.getBlockedKeys(householdId),
  ]);
  const dp = dietaryProfile ?? { conditions: [], allergies: [] };

  // Step 1: Saved recipe candidates — tag with suggestion origin.
  // Overrides the DB `source` field (which tracks save method) with suggestion origin.
  const savedCandidates = allRecipes.map((r) => ({
    ...r,
    source: 'saved',
    sourceId: String(r.id),
  }));

  // Step 2: API candidates — anchored on targetIngredients + rotation offset (Parts A/B).
  // source/sourceId already added by the mapSpoonacular/mapTheMealDB mappers above.
  const apiRaw = await findByPantry(allItems, expiringItems, {
    targetIngredients,
    rotationOffset: priorSuggestionRounds,
  });

  // Step 3+4: Merge into one pool.
  const allCandidates = [...savedCandidates, ...apiRaw];

  // Step 5: Deduplicate across the full pool before scoring (ID-first, name fallback).
  // Hard filter — unchanged from TASK-020.
  const seenDedupeKeys = new Set();
  const deduplicated = allCandidates.filter((c) => {
    const key = deriveRecipeKey(c);
    if (seenDedupeKeys.has(key)) return false;
    seenDedupeKeys.add(key);
    return true;
  });

  // Step 6 (Part D): Remove blocklisted candidates. Hard, permanent — no fallback in this
  // pipeline ever re-admits a blocklisted candidate, even if it leaves the pool empty.
  const notBlocked = deduplicated.filter(
    (c) => !blockedKeys.has(deriveRecipeKey(c))
  );

  // Determine effective strategy (unchanged logic — needs recent meal log).
  let effectiveStrategy = requestedStrategy;
  if (requestedStrategy === 'any') {
    const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const recent72h = await mealLogService.getRecentSince(
      householdId,
      cutoff72h
    );
    const highCount = recent72h.filter((m) => m.purineLevel === 'high').length;
    const medCount = recent72h.filter((m) => m.purineLevel === 'medium').length;
    const isHighPurine = highCount >= 2 || highCount + medCount >= 4;
    if (isHighPurine) effectiveStrategy = 'dietary_safe';
    else if (expiringItems.length > 0) effectiveStrategy = 'expiring_first';
    else effectiveStrategy = 'pantry_overlap';
  }

  const expiringNames = new Set(expiringItems.map((i) => i.name.toLowerCase()));

  // Step 7 (Part B): Score candidates — saved-source ranking bonus, minus a soft penalty
  // for recipes already shown this session. Saved recipes must meet overlap >= 0.25 AND
  // at least 1 matched ingredient to qualify. API candidates always pass through.
  function scoreCandidates(pool) {
    return pool
      .map((c) => {
        const { overlapScore, matchedIngredients, unmatchedIngredients, qualifies } =
          qualifiesAsPantryMatch(c, allItems);
        const { allergyNote, healthNote } = recipeScorer.annotateHealth(c, dp);
        if (c.source === 'saved' && !qualifies) return null;
        const recentPenalty = shownKeys.has(deriveRecipeKey(c))
          ? RECENT_RECIPE_PENALTY
          : 0;
        const effectiveScore =
          overlapScore + (c.source === 'saved' ? 0.2 : 0) - recentPenalty;
        return {
          ...c,
          overlapScore,
          effectiveScore,
          matchedIngredients,
          unmatchedIngredients,
          allergyNote,
          healthNote,
        };
      })
      .filter(Boolean);
  }

  // Step 8 (Part A): Partition into Tier 1 (contains a target ingredient) / Tier 2 — only
  // when targetIngredients is non-empty; a partition (reorders by group), not a scoring step.
  // Zero Tier-1 matches (Decision A4) is not an error: tier1 is simply empty and tier2 fills
  // the result, which is exactly the same as if targetIngredients were empty.
  function partitionByTarget(pool) {
    if (targetIngredients.length === 0) return [pool, []];
    const tier1 = [];
    const tier2 = [];
    for (const c of pool) {
      (candidateContainsTarget(c, targetIngredients) ? tier1 : tier2).push(c);
    }
    return [tier1, tier2];
  }

  // Step 9: Sort by effective strategy (applied within each tier).
  function applyStrategySort(pool) {
    return [...pool].sort((a, b) => {
      if (effectiveStrategy === 'expiring_first') {
        const aExp = (a.matchedIngredients || []).some((n) =>
          expiringNames.has(n.toLowerCase())
        );
        const bExp = (b.matchedIngredients || []).some((n) =>
          expiringNames.has(n.toLowerCase())
        );
        if (aExp && !bExp) return -1;
        if (!aExp && bExp) return 1;
      }
      if (effectiveStrategy === 'dietary_safe') {
        const aScore =
          (a.allergyNote ? -10 : 0) +
          (a.healthNote ? -2 : 0) +
          (a.effectiveScore ?? 0);
        const bScore =
          (b.allergyNote ? -10 : 0) +
          (b.healthNote ? -2 : 0) +
          (b.effectiveScore ?? 0);
        return bScore - aScore;
      }
      return (b.effectiveScore ?? 0) - (a.effectiveScore ?? 0);
    });
  }

  // Steps 8-10: score, partition into tiers, strategy-sort within each tier, take top 5
  // (Tier 1 first in full, then Tier 2 — never interleaved).
  const [tier1, tier2] = partitionByTarget(scoreCandidates(notBlocked));
  const topN = [...applyStrategySort(tier1), ...applyStrategySort(tier2)].slice(
    0,
    5
  );

  // Build pantry lookup map once — O(1) per ingredient vs. find() in a loop.
  const pantryMap = new Map(
    allItems.map((item) => [normalizeFood(item.name), item])
  );

  // Annotate each ingredient with pantry status. Produces API DTOs from scorer output
  // (scorer domain model is never mutated). unmatchedIngredients is dropped from the DTO.
  // NOTE: annotation uses normalized exact lookup only — not foodsMatch() fuzzy fallback.
  // A scorer fuzzy match may not reflect in the highlight color (intentional v1 constraint).
  const annotated = topN.map((recipe) => {
    const annotatedIngredients = (recipe.ingredients ?? []).map((ing) => {
      let pantryStatus = 'missing';
      let needToBuy;
      try {
        const key = normalizeFood(stripIngredientPrefix(ing.name));
        const pantryItem = pantryMap.get(key);
        if (pantryItem) {
          if (ing.quantity == null || pantryItem.quantity == null) {
            pantryStatus = 'have';
          } else if (
            normalizeUnit(ing.unit) !== normalizeUnit(pantryItem.unit)
          ) {
            // Unit mismatch → binary fallback. quantity > 0 guard prevents "0 oz milk" showing green.
            pantryStatus = pantryItem.quantity > 0 ? 'have' : 'missing';
          } else if (pantryItem.quantity < ing.quantity) {
            pantryStatus = 'partial';
            needToBuy = ing.quantity - pantryItem.quantity;
          } else {
            pantryStatus = 'have';
          }
        }
      } catch (err) {
        console.warn(
          '[annotatePantryStatus] ingredient annotation failed:',
          err?.message,
          ing?.name
        );
      }
      const result = { ...ing, pantryStatus };
      if (pantryStatus === 'partial' && needToBuy != null && needToBuy > 0) {
        result.needToBuy = needToBuy;
      }
      return result;
    });

    const { unmatchedIngredients: _removed, ...rest } = recipe;
    return { ...rest, ingredients: annotatedIngredients };
  });

  // Slim objects returned to model only — model cannot reproduce card detail it never saw.
  const slimForModel = topN.map((s) => ({
    name: s.name,
    shortDescription: s.description ?? '',
    source: s.source,
  }));

  return {
    suggestions: slimForModel,
    strategy: effectiveStrategy,
    recipeSuggestions: annotated,
  };
}

// TASK-050 D-5: household's own saved recipes only, ranked by pantry overlap — no external
// API call (an ephemeral Spoonacular/TheMealDB result has no recipeId addRecipesToList could
// use). Reuses qualifiesAsPantryMatch's threshold (D-4/D-12) rather than a new one.
const MAX_SUGGESTIONS = 5;

export async function rankSavedByPantry(householdId) {
  const [allRecipes, allItems] = await Promise.all([
    recipeService.getAll(householdId),
    pantryService.getAll(householdId),
  ]);

  return allRecipes
    .map((r) => {
      const { overlapScore, matchedIngredients, qualifies } = qualifiesAsPantryMatch(
        r,
        allItems
      );
      if (!qualifies) return null;
      return {
        id: r.id,
        name: r.name,
        tags: r.tags,
        overlapScore,
        matchedCount: matchedIngredients.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.overlapScore - a.overlapScore)
    .slice(0, MAX_SUGGESTIONS);
}
