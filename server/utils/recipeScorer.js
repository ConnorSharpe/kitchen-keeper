import {
  normalizeFood,
  foodsMatch,
  lightNormalizeForAllergy,
  containsWholeWord,
  expandAllergen,
  stripIngredientPrefix,
} from './foodNormalization.js';
import { getPurineLevel } from '../data/purineIndex.js';

function buildPantryStructures(pantryItems) {
  const exactMap = new Map();
  const keysList = [];
  for (const item of pantryItems) {
    const norm = normalizeFood(item.name);
    exactMap.set(norm, item);
    keysList.push(norm);
  }
  return { exactMap, keysList };
}

export function score(recipe, pantryItems) {
  const ingredients = recipe.ingredients ?? [];
  if (!ingredients.length) return { overlapScore: 0, matchedIngredients: [], unmatchedIngredients: [] };

  const { exactMap, keysList } = buildPantryStructures(pantryItems);
  const matched = [];
  const unmatched = [];

  for (const ing of ingredients) {
    const cleaned = stripIngredientPrefix(ing.name);
    const ingNorm = normalizeFood(cleaned);
    const exactHit = exactMap.has(ingNorm);
    // foodsMatch() for fuzzy fallback — token-based overlap, not raw substring.
    // Raw substring was removed: it reintroduced "pea"→"peach" and "ham"→"chamomile" false positives.
    const fuzzyHit = !exactHit && keysList.some((k) => foodsMatch(k, ingNorm));
    (exactHit || fuzzyHit) ? matched.push(ing.name) : unmatched.push(ing.name);
  }

  return {
    overlapScore: matched.length / ingredients.length,
    matchedIngredients: matched,
    unmatchedIngredients: unmatched,
  };
}

export function annotateHealth(recipe, dietaryProfile) {
  const { conditions = [], allergies = [] } = dietaryProfile;
  const ingredients = recipe.ingredients ?? [];

  // Allergy: lightNormalizeForAllergy() + expandAllergen() + containsWholeWord() ONLY.
  // Per Invariant 12: normalizeFood() and foodsMatch() are banned from this code path.
  let allergyHit = null;
  for (const allergen of allergies) {
    const allergenLight = lightNormalizeForAllergy(allergen);
    const allergenTerms = expandAllergen(allergenLight);
    const hit = ingredients.find((i) => {
      const ingLight = lightNormalizeForAllergy(i.name);
      return allergenTerms.some((term) => containsWholeWord(ingLight, term));
    });
    if (hit) { allergyHit = allergen; break; }
  }

  // Purine (soft advisory for gout): null category — recipe ingredients have no category.
  let healthNote = null;
  if (conditions.some((c) => c.toLowerCase().includes('gout'))) {
    const highCount = ingredients.filter(
      (i) => getPurineLevel(stripIngredientPrefix(i.name), null) === 'high'
    ).length;
    if (highCount >= 2) healthNote = 'high-purine — moderate given gout';
    else if (highCount === 1) healthNote = 'contains one high-purine ingredient — moderate given gout';
  }

  return {
    allergyNote: allergyHit ? `ALLERGY WARNING — contains ${allergyHit}` : null,
    healthNote,
  };
}
