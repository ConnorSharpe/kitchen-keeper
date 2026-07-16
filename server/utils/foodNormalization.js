// ── Plural forms: exact plural → canonical singular ──────────────────────────
// Note: some entries here have values that are themselves keys in SYNONYM_MAP
// (e.g. 'scallions' → 'scallion', and 'scallion' → 'green onion').
// These chains are resolved by the flattening step below — do NOT inline
// the chain manually here; let the flattening loop handle it.
const PLURAL_FORMS = new Map([
  ['tomatoes', 'tomato'],
  ['potatoes', 'potato'],
  ['avocados', 'avocado'],
  ['anchovies', 'anchovy'],
  ['kidney beans', 'kidney bean'],
  ['chickpeas', 'chickpea'],
  ['lentils', 'lentil'],
  ['mushrooms', 'mushroom'],
  ['onions', 'onion'],
  ['carrots', 'carrot'],
  ['aubergines', 'aubergine'],
  ['courgettes', 'courgette'],
  ['zucchinis', 'zucchini'], // chain: zucchini → courgette (resolved by flattening)
  ['eggplants', 'eggplant'], // chain: eggplant → aubergine (resolved by flattening)
  ['scallions', 'scallion'], // chain: scallion → green onion (resolved by flattening)
  ['prawns', 'prawn'],
  ['shrimps', 'shrimp'],
  ['peas', 'pea'],
  ['eggs', 'egg'],
  ['cloves', 'clove'],
  ['cloves of garlic', 'garlic'],
]);

// ── Regional/cultural synonyms: variant → canonical ──────────────────────────
const SYNONYM_MAP = new Map([
  ['cilantro', 'coriander'],
  ['eggplant', 'aubergine'],
  ['zucchini', 'courgette'],
  ['scallion', 'green onion'],
  ['spring onion', 'green onion'],
  ['green onions', 'green onion'],
  ['spring onions', 'green onion'],
  ['heavy cream', 'cream'],
  ['double cream', 'cream'],
  ['whipping cream', 'cream'],
  ['single cream', 'cream'],
  ['cornstarch', 'cornflour'],
  ['broil', 'grill'],
]);

// ── Preparation expansions: compound form → base ingredient ──────────────────
// These are intentionally one-directional: beef broth IS beef for health purposes.
// 'heart of palm' → 'palm vegetable' prevents the low-purine vegetable from
// matching the high-purine 'heart' keyword in purineIndex.js.
const PREPARATION_EXPANSIONS = new Map([
  ['beef broth', 'beef'],
  ['beef stock', 'beef'],
  ['ground beef', 'beef'],
  ['minced beef', 'beef'],
  ['beef mince', 'beef'],
  ['chicken stock', 'chicken'],
  ['chicken broth', 'chicken'],
  ['chicken breast', 'chicken'],
  ['chicken thigh', 'chicken'],
  ['chicken wings', 'chicken'],
  ['chicken drumstick', 'chicken'],
  ['turkey bacon', 'turkey'],
  ['ground turkey', 'turkey'],
  ['turkey mince', 'turkey'],
  ['pork belly', 'pork'],
  ['pork shoulder', 'pork'],
  ['pork loin', 'pork'],
  ['pork mince', 'pork'],
  ['ground pork', 'pork'],
  ['ground lamb', 'lamb'],
  ['lamb mince', 'lamb'],
  ['lamb chop', 'lamb'],
  ['lamb chops', 'lamb'],
  ['heart of palm', 'palm vegetable'], // low-purine vegetable; must not match 'heart' keyword
]);

// ── Flattened canonical map ────────────────────────────────────────────────────
// Built from the three source tables, then chain-resolved at module initialization.
// After flattening every key maps DIRECTLY to its terminal canonical form —
// no multi-step lookup is needed at runtime.
//
// Why: PLURAL_FORMS intermediate values can themselves be keys in SYNONYM_MAP,
// creating two-step chains that a single Map.get() call cannot follow.
// Example chain: 'scallions' → 'scallion' → 'green onion'
//   Before flattening: LOOKUP.get('scallions') === 'scallion'   ← wrong
//   After flattening:  LOOKUP.get('scallions') === 'green onion' ← correct
//
// The same applies to: 'zucchinis'→'zucchini'→'courgette'
//                  and: 'eggplants'→'eggplant'→'aubergine'
//
// PREPARATION_EXPANSIONS has priority (spread first); duplicates are overwritten
// by later spreads, so the merge order is intentional.
const LOOKUP = new Map([
  ...PREPARATION_EXPANSIONS,
  ...PLURAL_FORMS,
  ...SYNONYM_MAP,
]);

// Resolve all two-step chains so normalizeFood() is a single O(1) lookup.
// Runs until stable — safe for our data depth (max 2 iterations in practice).
{
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, value] of LOOKUP) {
      const resolved = LOOKUP.get(value);
      if (resolved !== undefined && resolved !== value) {
        LOOKUP.set(key, resolved);
        changed = true;
      }
    }
  }
}

export function normalizeFood(name) {
  if (!name) return '';
  const n = name.toLowerCase().trim();
  return LOOKUP.get(n) ?? n;
}

// Strips a trailing regular-plural "s" (e.g. "onions" → "onion"). Guarded against
// words already ending in "ss" (e.g. "glass") to avoid corrupting them into an
// invalid stem ("glas") — this guard prevents corruption of the singular form, it
// does NOT attempt to normalize irregular plurals like "glasses"/"citruses" down to
// their singular (TASK-035 Part B2, deliberately naive — no stemming library).
function stripTrailingPlural(token) {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

// Token-based match: requires ≥2 shared tokens OR exact canonical match.
// Prevents "red bean" matching "bean sprouts" (only 1 shared token).
function tokenize(name) {
  return (name || '')
    .toLowerCase()
    .split(/[\s,()/]+/)
    .filter((t) => t.length > 2)
    .map(stripTrailingPlural);
}

export function foodsMatch(a, b) {
  const na = normalizeFood(a);
  const nb = normalizeFood(b);
  if (na === nb) return true;
  const tokensA = new Set(tokenize(na));
  if (tokensA.size === 0) return false;
  const tokensB = tokenize(nb);
  const sharedCount = tokensB.filter((t) => tokensA.has(t)).length;
  // A single-token query (e.g. a user-named ingredient like "onion") only ever has one
  // token to share — requiring 2 would make it structurally unmatchable against any
  // multi-word candidate (e.g. "caramelized onions"), which was TASK-035 Part B2's
  // observed bug. Multi-word queries keep the original >=2 threshold — this is what
  // preserves the TASK-011 invariant that "red bean" must not match "bean sprouts"
  // (only 1 shared token, and "red bean" has 2 tokens of its own to require).
  const threshold = Math.min(2, tokensA.size);
  return sharedCount >= threshold;
}

// Light normalization for allergy detection ONLY.
// Does NOT run through synonym or preparation expansion — raw text form only.
export function lightNormalizeForAllergy(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[(),.!?;:'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-boundary match. Used for allergy detection only.
export function containsWholeWord(text, word) {
  if (!text || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// ── Allergen category expansion ───────────────────────────────────────────────
// Maps category-level allergen names to their specific ingredient members.
// Explicit curated safety list — NOT synonym expansion.
// Any change here requires a corresponding test update (Invariant 12).
const ALLERGEN_ALIASES = new Map([
  [
    'shellfish',
    [
      'shrimp',
      'prawn',
      'lobster',
      'crab',
      'oyster',
      'scallop',
      'mussel',
      'clam',
      'squid',
      'octopus',
    ],
  ],
  [
    'tree nut',
    [
      'almond',
      'walnut',
      'cashew',
      'pecan',
      'pistachio',
      'hazelnut',
      'macadamia',
      'brazil nut',
      'pine nut',
    ],
  ],
  [
    'tree nuts',
    [
      'almond',
      'walnut',
      'cashew',
      'pecan',
      'pistachio',
      'hazelnut',
      'macadamia',
      'brazil nut',
      'pine nut',
    ],
  ],
  [
    'gluten',
    ['wheat', 'barley', 'rye', 'spelt', 'farro', 'semolina', 'durum', 'bulgur'],
  ],
  [
    'dairy',
    [
      'milk',
      'cream',
      'cheese',
      'butter',
      'yogurt',
      'yoghurt',
      'whey',
      'casein',
      'lactose',
      'ghee',
    ],
  ],
  [
    'fish',
    [
      'salmon',
      'tuna',
      'cod',
      'haddock',
      'tilapia',
      'trout',
      'bass',
      'snapper',
      'halibut',
      'anchovy',
      'sardine',
      'herring',
      'mackerel',
    ],
  ],
  ['soy', ['soy sauce', 'tofu', 'miso', 'edamame', 'tempeh', 'soya']],
]);

export function expandAllergen(allergenLight) {
  const aliases = ALLERGEN_ALIASES.get(allergenLight);
  return aliases ? [allergenLight, ...aliases] : [allergenLight];
}

// ── Unit normalization ────────────────────────────────────────────────────────
const UNIT_ALIASES = new Map([
  ['tbsp', 'tablespoon'],
  ['tbs', 'tablespoon'],
  ['tablespoons', 'tablespoon'],
  ['tsp', 'teaspoon'],
  ['teaspoons', 'teaspoon'],
  ['g', 'gram'],
  ['grams', 'gram'],
  ['kg', 'kilogram'],
  ['kilograms', 'kilogram'],
  ['ml', 'milliliter'],
  ['millilitre', 'milliliter'],
  ['millilitres', 'milliliter'],
  ['milliliters', 'milliliter'],
  ['l', 'liter'],
  ['litre', 'liter'],
  ['litres', 'liter'],
  ['liters', 'liter'],
  ['oz', 'ounce'],
  ['ounces', 'ounce'],
  ['lb', 'pound'],
  ['lbs', 'pound'],
  ['pounds', 'pound'],
  ['c', 'cup'],
  ['cups', 'cup'],
  ['pieces', 'piece'],
  ['pc', 'piece'],
  ['pcs', 'piece'],
  ['items', 'item'],
  ['servings', 'serving'],
  ['cloves', 'clove'],
  ['slices', 'slice'],
  ['bunches', 'bunch'],
  ['heads', 'head'],
  ['cans', 'can'],
  ['jars', 'jar'],
  ['bottles', 'bottle'],
  ['bags', 'bag'],
  ['packets', 'packet'],
]);

export function normalizeUnit(unit) {
  if (!unit) return '';
  const n = unit.toLowerCase().trim();
  return UNIT_ALIASES.get(n) ?? n;
}

// ── Ingredient prefix stripping ───────────────────────────────────────────────
// Handles: "500g chicken breast", "1/2 cup olive oil", "2 cloves of garlic",
//          "1 x onion", "2 cans tomatoes", "3 large eggs", "14 oz diced tomatoes".
// Note: single-letter units (g, l) use \b to prevent partial matches against words
// like "large" (l) or "ground" (g). Without \b, "3 large eggs" would lose the 'l'.
const QUANTITY_PREFIX_RE =
  /^\d+(\s*\/\s*\d+|\.\d+)?\s*(x\s+|×\s+)?(g\b|kg|ml|l\b|oz|lb|lbs|tbsp|tsp|cup|cups|cloves?|heads?|pieces?|servings?|cans?|jars?|bags?|bunches?|slices?|stalks?|sprigs?|packets?)?\s*(of\s+)?(large\s+|small\s+|medium\s+|extra\s+large\s+|diced\s+|chopped\s+|sliced\s+|minced\s+|fresh\s+|dried\s+|frozen\s+|cooked\s+|ground\s+)?/i;

export function stripIngredientPrefix(name) {
  return (name || '').replace(QUANTITY_PREFIX_RE, '').trim();
}
