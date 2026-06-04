# TASK-011 — Intelligent Agent: Full Pantry CRUD, Consumption Logging, Dietary Awareness & Recipe Suggestion Tools

**Status:** DRAFT-7 — updated after sixth GPT architect review (2026-06-04)
**Author:** Claude Code / ConnorSharpe

## Revision History

| Draft | Changes |
|-------|---------|
| DRAFT-1 | Initial spec — all features in one block, rationale mixed into requirements |
| DRAFT-2 | Split into 011A/B/C, ADRs extracted, invariants added, JSONB vs TEXT resolved, purine default corrected, hybrid window added |
| DRAFT-3 | `skipDeduction` moved to server-side determinism; dual source-of-truth invariant added; `getRecentWindow` capped and deterministic; `foodNormalization.js` consolidated; JSON parse boundary invariant; correction-after-consumption behavior specified; `amountConsumed` ratio threshold clarified; TASK-012 stub raised for JSONB migration |
| DRAFT-4 | **Normalization rewrite:** removed all algorithmic plural stripping (was corrupting "cheese"→"chee", "tomatoes"→"tomat"); alias lookup now runs first on original string; bidirectional alias expansion at init. **`getPurineLevel`:** explicit `null` category handling. **Allergy detection:** normalized allergen + word-boundary matching (fixes "nut"→"coconut" false positive). **`getRecentWindow`:** replaced two-query union with single-query + post-filter (fixes 72h overflow when >10 meals). **`consume_pantry_item`:** ratio-based skip replaced with category-only rule (eliminates NaN-when-fullyConsumed bug and unit-mismatch trap); `unit` field re-added with unit-equality guard. **recipeScorer:** pantry pre-normalized into `Map` for O(1) lookup. **Unit test requirement** added as Invariant 11. |
| DRAFT-5 | **scorer O(n²)→O(n+m):** `pantryKeysList` extracted outside ingredient loop. **`getRecentWindow` simplified:** always returns last 10 sorted DESC; 72h logic moved to `buildDietaryContext` where interpretation belongs. **Allergy detection:** dropped `foodsMatch` from allergy path — `containsWholeWord` only (single clear semantic). **`containsWholeWord`:** switched to `\b` word boundaries (handles punctuation like `"almond (sliced)"`). **`foodsMatch`:** replaced substring with token-based overlap (fixes `"pea"`→`"peach"` and `"ham"`→`"chamomile"` false positives). **Unit normalization:** `normalizeUnit()` added to `foodNormalization.js`; unit equality guard now normalizes both sides before comparison. **`skipDeduction` description:** clarified as advisory-only. **`ALIAS_ENTRIES` restructured:** split into `PLURAL_FORMS`, `SYNONYM_MAP`, `PREPARATION_EXPANSIONS` for maintainability. **`logged_at TEXT`:** documented as safe — `toISOString()` is the established codebase convention for all date writes; not a risk. |
| DRAFT-6 | **Quantity prefix stripping:** added `stripIngredientPrefix()` in `recipeScorer.score()` — strips leading numbers/fractions/units from AI-generated ingredient names before normalization. NOT placed in `normalizeFood()` to preserve its purity. **Allergy light normalization:** added `lightNormalizeForAllergy()` (lowercase + punctuation only, no synonym/prep expansion) to `foodNormalization.js`; `annotateHealth()` now uses this instead of `normalizeFood()`. **Invariant 12** added: `normalizeFood()` and `foodsMatch()` are banned from allergy detection code paths. **`foodsMatch()` 2-token threshold:** single shared token no longer sufficient; requires ≥2 token overlap OR exact canonical match — prevents "red bean"/"bean sprouts" collision. **`getPurineLevel` keyword ordering:** `medium` checked before `high` (simpler and correct fix — "kidney bean" matches medium before "kidney" matches high; plain "kidney" doesn't contain "kidney bean" so correctly falls through to high). **Consume fuzzy match tightened:** substring fallback now requires consumed-name to be a meaningful portion of the pantry name (≥4 chars, not just any overlap). |
| DRAFT-7 | **Dietary window correctness fix (hard blocker):** split `getRecentWindow` into `getRecentLimit(householdId, n)` (last N sorted DESC, for display) and `getRecentSince(householdId, isoTimestamp)` (unbounded time-range query, for 72h purine load). `buildDietaryContext` now calls both independently — purine classification uses `getRecentSince` with full temporal visibility, not a pre-truncated LIMIT 10 set. DB index on `(household_id, logged_at)` added to migration. **`stripIngredientPrefix` moved to `foodNormalization.js`** (second hard blocker): function is fundamentally text normalization; moving it keeps all normalization testable in one file. `recipeScorer.js` imports it. Test spec corrected — `stripIngredientPrefix` now correctly belongs in `foodNormalization.test.js`. |

---

# Architecture Decision Records

## ADR-001: Dietary profile on household, not user
The app operates on a shared-kitchen model. One pantry, one recipe book, one chat history. Dietary constraints represent the union of all members' needs. If one member has a peanut allergy, peanuts are unsafe for all household meals. Individual per-user profiles would require meal suggestions scoped per-user, conflicting with the shared-pantry model. The JSON array structure (`conditions: ["gout"]`) allows multiple members' constraints to coexist without schema changes if per-user profiles become necessary later.

## ADR-002: Separate `meal_logs` table, not derived from `pantryItems.consumedAt`
`consumedAt` only records full consumption with no category or health data at write time. Partial consumption events never appear. Chat history (`chatMessages`, trimmed to 50 messages, unstructured) is explicitly not a substitute. A dedicated `meal_logs` table is append-only, cheap to query for the rolling window, and records classification at the time of eating.

## ADR-003: Static purine index, not USDA API
Purine content is not a USDA FoodData Central nutrient field. The high-purine food list is short and stable. A curated keyword lookup is zero-latency, has no rate limit, and is more reliable than API availability. USDA integration is a valid future enhancement for macro tracking but must not be a hard dependency.

## ADR-004: JSON columns — TEXT, not JSONB (intentional debt)
Every JSON field in the existing schema (`recipes.ingredients`, `recipes.steps`, `recipes.tags`) is stored as `text` and handled via `serialize()`/`parse()` helpers in the service layer — the pattern is established in `recipeService.js` and must be followed exactly for all new JSON-text fields. Introducing `jsonb` columns for new fields only would create two incompatible patterns. New `households` columns use `text` for consistency. A separate TASK-012 is raised to migrate all JSON-text columns to JSONB as a single coherent change. **This is documented debt, not stable architecture.**

## ADR-005: Substring overlap scoring with normalization, not embeddings
Deterministic, cheap, debuggable. The normalization layer (shared utility, see below) closes the majority of practical gaps. Embeddings are a valid future upgrade if scoring accuracy proves insufficient.

## ADR-006: Staged delivery (011A → 011B → 011C)
Four distinct systems (pantry mutation, dietary intelligence, recipe recommendation, agent orchestration) bundled into one atomic change creates unacceptable blast radius. Dependencies are strictly one-directional: 011A produces data 011B reads; 011B produces context 011C uses.

## ADR-007: Server owns mutation policy, model is advisory only
The model may suggest `skipDeduction: true` for trace condiment use, but the server applies its own deterministic rule first. This follows the principle: **inventory correctness > conversational nuance.** Non-deterministic financial operations (quantity state changes) must not be delegated to the model. The model's judgment is used for reasoning and framing, not for deciding whether a write occurs.

## ADR-008: `foodNormalization.js` as single source of truth
Both purine classification and ingredient overlap scoring require name normalization (plural handling, aliases, synonym mapping). Because both `purineIndex.js` and `recipeScorer.js` are new files, consolidating normalization into a shared utility from day one prevents divergence. Without this, the two systems will produce inconsistent results within two iterations of alias expansion.

## ADR-009: Meal log is append-only; corrections affect pantry only
`meal_logs` is an audit trail. If a user says "actually I didn't eat that," the pantry quantity is restored via `update_pantry_item`, but the meal log entry is not reversed. This is intentional: the log records what the agent processed, not a verified ground truth of consumption. The model must be prompted to tell the user that the pantry has been restored but the meal history entry remains. This preserves log integrity and keeps dietary window calculations stable.

---

# System Invariants

Enforced at the service/handler layer. Not suggestions.

1. **Pantry quantity ≥ 0 always.** `consume_pantry_item` handler must clamp: `remaining = Math.max(0, remaining)`. If clamped to 0, treat as `fullyConsumed = true`.
2. **`meal_logs` is append-only.** No update or delete endpoints exist. No service methods for mutation.
3. **Tool calls must reference valid IDs.** `update_pantry_item` and `remove_pantry_item` handlers verify `id` belongs to `householdId` before any write. Non-existent or cross-household IDs return `{ ok: false, error: 'Item not found' }` — never a silent no-op.
4. **Ambiguous name match never mutates DB.** If `consume_pantry_item` fuzzy match returns 2+ candidates, return `{ ok: false, error: 'Ambiguous: [list]. Ask user to clarify.' }` before any write.
5. **No negative `amountConsumed`.** Validated as `z.number().positive()` at the Zod boundary in the tool handler.
6. **Dietary profile fields must be valid JSON arrays.** `PATCH /api/dietary` validates `conditions`, `allergies`, `foodPreferences` as `z.array(z.string())` before write.
7. **Allergy notes are critical warnings.** System prompt instructs the model: allergy `allergyNote` values must be surfaced explicitly — never suppressed or softened.
8. **`item_name` in `meal_logs` is informational only when `pantry_item_id IS NOT NULL`.** If a FK is present, `item_name` must not be used for joins, analytics queries, or deduplication. It exists solely for human readability when the referenced item has been deleted. Future analytics code must join on `pantry_item_id` when available.
9. **Server owns skip-deduction policy.** The server applies its deterministic condiment rule before honoring any model-supplied `skipDeduction` flag. Model cannot override a server-enforced deduction.
10. **JSON-text fields are parsed once at the service boundary.** No `JSON.parse()` in route handlers. All new services with JSON-text columns must implement `serialize()`/`parse()` helpers following the `recipeService.js` pattern.
11. **`foodNormalization.js` must have unit tests.** It is a semantic single point of failure: bugs here affect health warnings, recipe matching, and dietary classification simultaneously. A test file (`server/utils/foodNormalization.test.js`) is required before 011C ships, covering: known synonyms, known plurals, words that previously broke stripping (`"cheese"`, `"hummus"`, `"glass"`), `foodsMatch` symmetric cases, and `containsWholeWord` boundary cases (see `foodNormalization.js` spec for full fixture list).
12. **`normalizeFood()` and `foodsMatch()` are banned from allergy detection code paths.** Allergy detection must use `lightNormalizeForAllergy()` and `containsWholeWord()` only. Synonym and preparation expansion in the allergy path risk false negatives in safety-critical matching — if a future alias change renames an ingredient, an existing allergy entry could silently stop triggering. Raw text form is the only safe anchor for allergy matching.

---

# Staged Deliverables

## TASK-011A — Pantry Mutation + Consumption System
Foundational. Must ship first. Introduces `meal_logs`, the three mutation tools, and `foodNormalization.js`.

## TASK-011B — Dietary Profile System
Depends on 011A. Introduces household dietary columns, `dietaryService`, and dietary UI.

## TASK-011C — Recipe Intelligence Layer
Depends on 011B. Introduces `suggest_recipes`, `save_recipe`, and `recipeScorer`.

---

# TASK-011A Spec — Pantry Mutation + Consumption System

## Goal
Add `update_pantry_item`, `remove_pantry_item`, and `consume_pantry_item` tools to the chat agent. Introduce the `meal_logs` table, `mealLogService`, `purineIndex`, and `foodNormalization` shared utility. Update `pantrySummary` to include `id` and `category`.

## Allowed Files (011A)

### New
- `server/db/migrations/0005_meal_logs.sql`
- `server/utils/foodNormalization.js` ← shared normalization utility
- `server/data/purineIndex.js`
- `server/services/mealLogService.js`

### Edit
- `server/db/schema.js` — add `mealLogs` table
- `server/services/aiService.js` — add 3 tool declarations; update system prompt with tool decision rules and correction behavior
- `server/routes/ai.js` — add 3 tool handlers; update `pantrySummary` shape

## Forbidden Files (011A)
- `server/services/pantryService.js` — `update`, `remove`, `markUsed` already exist; no changes needed
- All files not listed above

## DB Changes (011A)

### `0005_meal_logs.sql`
```sql
CREATE TABLE meal_logs (
  id             SERIAL PRIMARY KEY,
  household_id   INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  pantry_item_id INTEGER REFERENCES pantry_items(id) ON DELETE SET NULL,
  item_name      TEXT    NOT NULL,
  category       TEXT    NOT NULL DEFAULT 'Other',
  purine_level   TEXT    NOT NULL DEFAULT 'medium',
  was_expiring   BOOLEAN,
  logged_at      TEXT    NOT NULL,
  source         TEXT    NOT NULL DEFAULT 'agent'
);

-- Index required for getRecentSince() time-range queries — without this,
-- getRecentSince does a full table scan filtered in Postgres.
CREATE INDEX idx_meal_logs_household_logged_at
  ON meal_logs (household_id, logged_at DESC);
```

**Design notes:**
- `pantry_item_id` is nullable. Set when the item exists at time of consumption. `ON DELETE SET NULL` preserves the log entry when the item is later deleted.
- Per Invariant 8: when `pantry_item_id IS NOT NULL`, `item_name` is informational only — not for joins or analytics.
- `purine_level` defaults to `'medium'`, not `'low'`. Unknown Meat/Seafood items are more likely medium than low. Over-warning is preferable for a health constraint.
- `was_expiring` propagated from expiry status at time of consumption — preserves the waste-saved analytics signal for the existing `GET /api/pantry/waste-saved` endpoint.

## `pantrySummary` Shape Change (011A)

```js
// BEFORE
const pantrySummary = allItems.map((i) => ({
  name:   i.name,
  qty:    `${i.quantity} ${i.unit}`,
  status: getExpiryStatus(i.expiryDate),
  frozen: i.isFrozen,
}));

// AFTER
const pantrySummary = allItems.map((i) => ({
  id:       i.id,
  name:     i.name,
  category: i.category,
  qty:      `${i.quantity} ${i.unit}`,
  status:   getExpiryStatus(i.expiryDate),
  frozen:   i.isFrozen,
}));
```

## `server/utils/foodNormalization.js` (011A — shared utility)

Single source of truth for all food name normalization. Imported by `purineIndex.js`, `recipeScorer.js` (011C), and the `consume_pantry_item` handler. Covered by unit tests (Invariant 11).

**Design decisions:**
- No algorithmic plural stripping — corrupts too many food words (`"cheese"→"chee"`, `"hummus"→"humu"`). All plural→singular forms are declared explicitly.
- Alias tables split into three distinct concerns to prevent maintenance collisions: plurals, synonyms (regional/cultural variants), and preparation expansions (compound forms like "chicken broth").
- `foodsMatch` uses token-based overlap instead of substring — prevents `"pea"` matching `"peach"` and `"ham"` matching `"chamomile"`.
- `containsWholeWord` uses `\b` word boundaries — handles punctuation in realistic ingredient strings (`"almond (sliced)"`, `"peanut, roasted"`).

```js
// ── Plural forms: exact plural → canonical singular ──────────────────────────
// To add a new food plural: add ONE entry here. Do not add algorithmic stripping.
const PLURAL_FORMS = new Map([
  ['tomatoes',      'tomato'],
  ['potatoes',      'potato'],
  ['avocados',      'avocado'],
  ['anchovies',     'anchovy'],
  ['kidney beans',  'kidney bean'],
  ['chickpeas',     'chickpea'],
  ['lentils',       'lentil'],
  ['mushrooms',     'mushroom'],
  ['onions',        'onion'],
  ['carrots',       'carrot'],
  ['aubergines',    'aubergine'],
  ['courgettes',    'courgette'],
  ['zucchinis',     'zucchini'],
  ['eggplants',     'eggplant'],
  ['scallions',     'scallion'],
  ['prawns',        'prawn'],
  ['shrimps',       'shrimp'],
  ['eggs',          'egg'],
  ['cloves',        'clove'],
  ['cloves of garlic', 'garlic'],
]);

// ── Regional/cultural synonyms: variant → canonical ──────────────────────────
// Canonical form is the more common English name.
const SYNONYM_MAP = new Map([
  ['cilantro',      'coriander'],
  ['eggplant',      'aubergine'],
  ['zucchini',      'courgette'],
  ['scallion',      'green onion'],
  ['spring onion',  'green onion'],
  ['green onions',  'green onion'],
  ['spring onions', 'green onion'],
  ['heavy cream',   'cream'],
  ['double cream',  'cream'],
  ['whipping cream','cream'],
  ['single cream',  'cream'],
  ['cornstarch',    'cornflour'],
  ['broil',         'grill'],
]);

// ── Preparation expansions: compound form → base ingredient ──────────────────
// "chicken broth" resolves to "chicken" for purine and overlap scoring purposes.
// These are intentionally one-directional: beef broth IS beef for health purposes.
const PREPARATION_EXPANSIONS = new Map([
  ['beef broth',        'beef'],
  ['beef stock',        'beef'],
  ['ground beef',       'beef'],
  ['minced beef',       'beef'],
  ['beef mince',        'beef'],
  ['chicken stock',     'chicken'],
  ['chicken broth',     'chicken'],
  ['chicken breast',    'chicken'],
  ['chicken thigh',     'chicken'],
  ['chicken wings',     'chicken'],
  ['chicken drumstick', 'chicken'],
  ['turkey bacon',      'turkey'],
  ['ground turkey',     'turkey'],
  ['turkey mince',      'turkey'],
  ['pork belly',        'pork'],
  ['pork shoulder',     'pork'],
  ['pork loin',         'pork'],
  ['pork mince',        'pork'],
  ['ground pork',       'pork'],
  ['ground lamb',       'lamb'],
  ['lamb mince',        'lamb'],
  ['lamb chop',         'lamb'],
  ['lamb chops',        'lamb'],
]);

// Build combined lookup: longest-match wins (preparation expansions checked first).
// Lookup order: PREPARATION_EXPANSIONS → PLURAL_FORMS → SYNONYM_MAP
const LOOKUP = new Map([
  ...PREPARATION_EXPANSIONS,
  ...PLURAL_FORMS,
  ...SYNONYM_MAP,
]);

export function normalizeFood(name) {
  if (!name) return '';
  const n = name.toLowerCase().trim();
  return LOOKUP.get(n) ?? n;
}

// Token-based match: splits names into word tokens and checks for meaningful overlap.
// Requires ≥2 shared tokens OR exact canonical match — single token overlap is not sufficient.
// This prevents "red bean" matching "bean sprouts" (only 1 shared token: "bean").
// It also correctly handles single-word foods: "beef" normalizes to "beef" via LOOKUP,
// so exact canonical match catches it before token comparison.
function tokenize(name) {
  return (name || '').toLowerCase().split(/[\s,()/]+/).filter((t) => t.length > 2);
}

// Returns true if a and b refer to the same food after normalization and token comparison.
export function foodsMatch(a, b) {
  const na = normalizeFood(a);
  const nb = normalizeFood(b);
  // Exact canonical match is always sufficient
  if (na === nb) return true;
  // Require ≥2 shared tokens to prevent single-word false positives
  const tokensA = new Set(tokenize(na));
  const tokensB = tokenize(nb);
  const sharedCount = tokensB.filter((t) => tokensA.has(t)).length;
  return sharedCount >= 2;
}

// Light normalization for allergy detection ONLY.
// Intentionally does NOT run through synonym or preparation expansion.
// Reason: synonym expansion could cause false negatives in safety-critical allergy matching
// (e.g. if "peanut butter" expands to "peanut", allergy for "peanut butter" might not match
// an ingredient listed as "peanut butter" in a future alias change).
// Rule: allergy detection always operates on raw text form (lowercase + punctuation only).
export function lightNormalizeForAllergy(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[(),.!?;:'"]/g, ' ')  // strip punctuation to spaces
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}

// Word-boundary match: checks if word appears as a whole word in text.
// Uses \b boundaries — correctly handles punctuation ("almond (sliced)", "peanut, roasted").
// Used for allergy detection only. Do not use for general ingredient matching.
export function containsWholeWord(text, word) {
  if (!text || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// ── Unit normalization ────────────────────────────────────────────────────────
// Maps common abbreviations and variants to a canonical unit string.
// Used by the consume_pantry_item handler to normalize units before equality check.
const UNIT_ALIASES = new Map([
  ['tbsp',         'tablespoon'], ['tbs',           'tablespoon'], ['tablespoons', 'tablespoon'],
  ['tsp',          'teaspoon'],  ['teaspoons',      'teaspoon'],
  ['g',            'gram'],      ['grams',          'gram'],
  ['kg',           'kilogram'],  ['kilograms',      'kilogram'],
  ['ml',           'milliliter'],['millilitre',     'milliliter'], ['millilitres', 'milliliter'], ['milliliters', 'milliliter'],
  ['l',            'liter'],     ['litre',          'liter'],      ['litres',      'liter'],       ['liters',     'liter'],
  ['oz',           'ounce'],     ['ounces',         'ounce'],
  ['lb',           'pound'],     ['lbs',            'pound'],      ['pounds',      'pound'],
  ['c',            'cup'],       ['cups',           'cup'],
  ['pieces',       'piece'],     ['pc',             'piece'],      ['pcs',         'piece'],
  ['items',        'item'],
  ['servings',     'serving'],
  ['cloves',       'clove'],
  ['slices',       'slice'],
  ['bunches',      'bunch'],
  ['heads',        'head'],
  ['cans',         'can'],
  ['jars',         'jar'],
  ['bottles',      'bottle'],
  ['bags',         'bag'],
  ['packets',      'packet'],
]);

export function normalizeUnit(unit) {
  if (!unit) return '';
  const n = unit.toLowerCase().trim();
  return UNIT_ALIASES.get(n) ?? n;
}

// ── Ingredient prefix stripping ───────────────────────────────────────────────
// Strips leading quantity/unit prefixes from AI-generated recipe ingredient name strings.
// Gemini structured prompts separate name from quantity, but the two-step suggestRecipes()
// search-grounding path can produce mixed strings like "2 cloves of garlic".
// Placed here (not in recipeScorer.js) so it is testable alongside other normalizations
// and importable by any future caller that processes AI ingredient strings.
const QUANTITY_PREFIX_RE = /^\d+(\s*\/\s*\d+|\.\d+)?\s*(g|kg|ml|l|oz|lb|lbs|tbsp|tsp|cup|cups|cloves?|heads?|pieces?|servings?)?\s*(of\s+)?/i;

export function stripIngredientPrefix(name) {
  return (name || '').replace(QUANTITY_PREFIX_RE, '').trim();
}
```

**Unit test requirement (Invariant 11):** `server/utils/foodNormalization.test.js` must cover:
- Known plurals: `"tomatoes"` → `"tomato"`, `"anchovies"` → `"anchovy"`
- Known synonyms: `"scallions"` → `"green onion"`, `"cilantro"` → `"coriander"`
- Preparation expansions: `"chicken broth"` → `"chicken"`, `"ground beef"` → `"beef"`
- Non-breaking cases: `"cheese"` → `"cheese"`, `"hummus"` → `"hummus"`, `"glass"` → `"glass"`
- `foodsMatch` true (≥2 token overlap): `"kidney bean soup"` / `"kidney bean stew"` (shares "kidney", "bean")
- `foodsMatch` false (single token): `"red bean"` / `"bean sprouts"` (only "bean" shared → no match)
- `foodsMatch` false (single token): `"pea"` / `"peach"`, `"ham"` / `"chamomile"`
- `containsWholeWord` true: `"almond (sliced)"` contains `"almond"`
- `containsWholeWord` false: `"coconut"` does NOT contain `"nut"` as whole word
- `lightNormalizeForAllergy`: strips punctuation, lowercases, does NOT expand synonyms (`"scallions"` → `"scallions"`, NOT `"green onion"`)
- `normalizeUnit`: `"tbsp"` → `"tablespoon"`, `"ml"` → `"milliliter"`, unknown → passthrough
- `stripIngredientPrefix` (exported from `foodNormalization.js`): `"2 cloves of garlic"` → `"garlic"`, `"500g chicken breast"` → `"chicken breast"`, `"1/2 cup olive oil"` → `"olive oil"`, `"olive oil"` → `"olive oil"` (unchanged)

## `server/data/purineIndex.js` (011A)

Imports `normalizeFood` from `foodNormalization.js`. Does not contain its own normalization logic.

```js
import { normalizeFood } from '../utils/foodNormalization.js';

const PURINE_KEYWORDS = {
  high: [
    'organ meat', 'liver', 'kidney', 'heart', 'sweetbread',
    'anchovy', 'sardine', 'herring', 'mackerel', 'sprat',
    'mussel', 'scallop', 'game meat', 'venison', 'goose',
    'yeast extract', 'marmite', "brewer's yeast",
  ],
  medium: [
    'beef', 'pork', 'lamb', 'veal', 'chicken', 'turkey', 'duck',
    'crab', 'lobster', 'oyster', 'prawn', 'shrimp',
    'spinach', 'asparagus', 'cauliflower',
    'lentil', 'kidney bean', 'chickpea', 'pea',
    'oatmeal', 'wheat germ',
  ],
};

// category may be null when called from recipeScorer (recipe ingredients have no category).
// null/undefined category skips the category fallback — keyword match is the only signal.
//
// KEYWORD CHECK ORDER: medium checked BEFORE high.
// Reason: "kidney bean" contains the word "kidney" (high), but is a legume (medium).
// Checking medium first lets "kidney bean" match the medium keyword "kidney bean" before
// "kidney" (high) fires. Plain "kidney" (organ meat) does not contain "kidney bean", so it
// correctly falls through medium and matches high.
// Checking longer/more-specific keywords first within each level for same reason.
const PURINE_CHECK_ORDER = ['medium', 'high'] as const;

export function getPurineLevel(itemName, category) {
  const name = normalizeFood(itemName);
  for (const level of PURINE_CHECK_ORDER) {
    // Sort keywords by length descending — longer/more-specific keywords matched first
    const sorted = [...PURINE_KEYWORDS[level]].sort((a, b) => b.length - a.length);
    if (sorted.some((k) => name.includes(k))) return level;
  }
  // Category fallback: only applied when category is a known string, never on null/undefined.
  if (category === 'Meat' || category === 'Seafood') return 'medium';
  return 'low';
}
```

## Tool Declarations (011A)

### `update_pantry_item`
```js
{
  name: 'update_pantry_item',
  description:
    'Update one or more fields on an existing pantry item. ' +
    'Use the item id from the pantry summary. ' +
    'Only include fields the user actually wants to change. ' +
    'Also use this to restore quantity if the user says they did not actually eat something.',
  parameters: {
    type: 'object',
    properties: {
      id:         { type: 'integer', description: 'Item id from the pantry summary.' },
      name:       { type: 'string' },
      quantity:   { type: 'number', minimum: 0 },
      unit:       { type: 'string' },
      category:   { type: 'string', enum: ['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other'] },
      expiryDate: { type: 'string', description: 'ISO 8601 date string.' },
      notes:      { type: 'string' },
    },
    required: ['id'],
  },
}
```

**Handler:** Validates `id` is integer. Calls `pantryService.update(householdId, id, fields)`. Returns `{ ok: true, item }` or `{ ok: false, error }`.

### `remove_pantry_item`
```js
{
  name: 'remove_pantry_item',
  description:
    'Permanently delete an item from the pantry. ' +
    'Use when the user throws something out or explicitly discards it. ' +
    'Do NOT use when the user ate or used the item — use consume_pantry_item instead.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Item id from the pantry summary.' },
    },
    required: ['id'],
  },
}
```

**Handler:** Calls `pantryService.remove(householdId, id)`.

### `consume_pantry_item`

```js
{
  name: 'consume_pantry_item',
  description:
    'Record that the user ate or used a pantry item, fully or partially. ' +
    'Updates pantry quantity and logs the meal for dietary tracking. ' +
    'Pass the exact item name from the pantry summary. ' +
    'For finished items set fullyConsumed true. ' +
    'For Condiments (olive oil, soy sauce, vinegar, etc.) the server skips quantity deduction ' +
    'automatically unless fullyConsumed is true — you do not need to set skipDeduction.',
  parameters: {
    type: 'object',
    properties: {
      itemName:       { type: 'string', description: 'Exact name from pantry summary.' },
      amountConsumed: { type: 'number', description: 'Amount consumed. Omit if fullyConsumed is true.' },
      unit:           { type: 'string', description: 'Unit of amountConsumed (e.g. "tbsp", "ml", "item"). Should match or be equivalent to the pantry entry unit.' },
      fullyConsumed:  { type: 'boolean', description: 'True if the item is completely gone.' },
      skipDeduction:  { type: 'boolean', description: 'Advisory only — server applies its own rule based on item category. Set true if the user says they used a trace/negligible amount of a non-Condiment item. Has no effect on Condiments (always skipped unless fullyConsumed).' },
    },
    required: ['itemName'],
  },
}
```

**Handler logic:**

```
1. Zod-validate: amountConsumed must be > 0 if provided.

2. Fuzzy match itemName against allItems (scoped to householdId), in priority order:
   a. Exact match (case-insensitive) — preferred; model should pass exact pantry names
   b. itemName is a substring of pantryItem.name AND itemName.length >= 4 (prevents "oil" matching "olive oil spray" AND "fish oil")
   c. pantryItem.name is a substring of itemName AND pantryItem.name.length >= 4
   Matches from (b) or (c) that produce 2+ candidates are treated as ambiguous regardless of which candidate matches.

3. 0 matches → { ok: false, error: 'Item not found. Ask user which item they mean.' }
   2+ matches → { ok: false, error: 'Ambiguous: [list]. Ask user to clarify.' }

4. Unit guard (when amountConsumed and unit are both provided):
   const normalizedInputUnit = normalizeUnit(unit);
   const normalizedPantryUnit = normalizeUnit(item.unit);
   if (normalizedInputUnit && normalizedPantryUnit && normalizedInputUnit !== normalizedPantryUnit) {
     return { ok: false, error: `Unit mismatch: pantry shows "${item.unit}", you passed "${unit}". Please clarify the amount in ${item.unit}.` }
   }
   // Both sides normalized before comparison — "tbsp" matches "tablespoon", "ml" matches "milliliter".

5. SERVER-SIDE skip-deduction rule — category-only, no ratio math:
   // Condiments are skipped by default unless the user says they finished it.
   // Ratio-based logic removed: it produced NaN when amountConsumed was absent (fullyConsumed case)
   // and was unit-ambiguous when pantry and consumed units differed.
   const serverSkip = (item.category === 'Condiments' && fullyConsumed !== true);
   const effectiveSkip = serverSkip || (skipDeduction === true && !serverSkip);

6. Compute remaining:
   - fullyConsumed=true → remaining = 0
   - else → remaining = item.quantity - (amountConsumed ?? 0)
   - clamp: remaining = Math.max(0, remaining)

7. If !effectiveSkip:
   - remaining === 0 → pantryService.markUsed(householdId, item.id)
   - remaining > 0  → pantryService.update(householdId, item.id, { quantity: remaining })

8. Resolve wasExpiring:
   const status = getExpiryStatus(item.expiryDate);
   const wasExpiring = ['warning', 'critical', 'expired'].includes(status);

9. mealLogService.create({
     householdId,
     pantryItemId: item.id,
     itemName:     item.name,
     category:     item.category,
     purineLevel:  getPurineLevel(item.name, item.category),
     wasExpiring,
     source: 'agent',
   })

10. Return { ok: true, item: { id: item.id, name: item.name, remaining, skipApplied: effectiveSkip } }
```

**Concurrency note:** Two rapid `consume_pantry_item` calls for the same item can race on steps 2 and 7. For MVP, the risk is low (single-user household sessions). A future hardening task should wrap steps 2→7 in a DB transaction with a `SELECT FOR UPDATE` on the pantry item. This is not in scope for 011A.

## `mealLogService.js` (011A)

Follows the `serialize()`/`parse()` service boundary convention (Invariant 10). No JSON-text fields on `meal_logs`, but all future JSON additions must follow the pattern.

**Methods:**
- `create({ householdId, pantryItemId, itemName, category, purineLevel, wasExpiring, source })` — appends entry, sets `logged_at` to `new Date().toISOString()`
- `getRecentLimit(householdId, n = 7)` — returns last N entries sorted DESC; used by `buildDietaryContext` for the display portion of the dietary context string
- `getRecentSince(householdId, isoTimestamp)` — returns ALL entries since timestamp, sorted DESC, **no LIMIT**; used by `buildDietaryContext` for purine load classification

**Why two methods:** A single `LIMIT 10` fetch makes 72h binge-detection statistically invalid — if a user logs 20 meals in 72 hours, the 10-entry cap hides the older meals in that window, causing purine load to be silently under-counted. `getRecentSince` gives `buildDietaryContext` full temporal visibility for health classification. `getRecentLimit` is only used for the human-readable "recent meals" display line in the prompt, where an exact count bound is appropriate.

**`getRecentSince` safety:** No `LIMIT` is safe here because 72 hours of meal logs is naturally bounded (6 meals/day × 3 days = 18 entries maximum under normal usage). The `(household_id, logged_at DESC)` index in the migration makes this query efficient.

```js
export async function getRecentLimit(householdId, n = 7) {
  return db
    .select()
    .from(mealLogs)
    .where(eq(mealLogs.householdId, householdId))
    .orderBy(desc(mealLogs.loggedAt))
    .limit(n);
}

export async function getRecentSince(householdId, isoTimestamp) {
  return db
    .select()
    .from(mealLogs)
    .where(and(
      eq(mealLogs.householdId, householdId),
      sql`${mealLogs.loggedAt} >= ${isoTimestamp}`,
    ))
    .orderBy(desc(mealLogs.loggedAt));
  // No .limit() — caller requires full temporal visibility for health classification.
}
```

`logged_at` is TEXT storing ISO 8601 UTC strings (`new Date().toISOString()`). The established codebase convention for all date fields — lexicographic sort on ISO UTC is chronological sort. Not a risk.

## Tool Decision Rules — System Prompt Additions (011A)

```
Tool selection rules:
- User ate, used, cooked with, or consumed something → consume_pantry_item
- User threw out, discarded, binned, or wasted something → remove_pantry_item
- User wants to correct a value (wrong date, wrong quantity) → update_pantry_item
- User contradicts a recent consume action ("actually I didn't eat that") →
    call update_pantry_item to restore the previous quantity.
    Inform the user: the pantry has been restored, but the meal history entry cannot be reversed.
- Uncertain whether consumed or discarded → ask before calling either.
- Name is ambiguous (multiple pantry items match) → ask for clarification before calling.
- Trace condiment amounts: the server handles skip-deduction automatically — do not overthink it.
The pantry summary includes item IDs. Always use the id field for update_pantry_item and remove_pantry_item.
```

## Acceptance Criteria (011A)

- [ ] `0005_meal_logs.sql` runs clean against Neon; `idx_meal_logs_household_logged_at` index created
- [ ] `getRecentLimit(householdId, 7)` returns last 7 entries sorted DESC
- [ ] `getRecentSince(householdId, cutoff72h)` returns ALL entries in the 72h window with no cap — verified by inserting 15 entries within 72h and confirming all 15 are returned
- [ ] `pantrySummary` includes `id` and `category` in every chat turn
- [ ] "Change the milk expiry to Friday" → `update_pantry_item` called; pantry reflects new date
- [ ] "I threw out the expired cheese" → `remove_pantry_item` called; item removed
- [ ] "I ate half the avocado" → avocado quantity halved; `meal_logs` row with `purine_level: low`; `was_expiring` correct
- [ ] "I finished the chicken" → `consumedAt` set; `meal_logs` row created
- [ ] "I used a splash of olive oil" (Condiments, `fullyConsumed` not set) → server auto-skips deduction by category rule; meal logged; quantity unchanged
- [ ] "I finished the olive oil" (Condiments, `fullyConsumed: true`) → `markUsed` called; meal logged
- [ ] "I used 2 tbsp of soy sauce" where pantry unit is `'tablespoon'` → `normalizeUnit` resolves both to `'tablespoon'`; no mismatch error; deduction proceeds
- [ ] "I used 2 tbsp of soy sauce" where pantry unit is `'ml'` → normalized units differ (`'tablespoon'` ≠ `'milliliter'`); mismatch error returned; no DB write; agent asks user to clarify in ml
- [ ] "I ate the chicken" with two chicken items → agent asks for clarification; no DB write
- [ ] "Actually I didn't eat that" → `update_pantry_item` called to restore; agent tells user meal history entry remains
- [ ] Quantity never goes below 0 in DB
- [ ] `item_name` in `meal_logs` correct; `pantry_item_id` set to item's id

---

# TASK-011B Spec — Dietary Profile System

*Depends on: TASK-011A (`meal_logs` table, `getRecentLimit`, and `getRecentSince` must exist)*

## Goal
Persist household dietary profile (conditions, allergies, preferences). Expose via API. Build the rolling window context string injected into chat.

## Allowed Files (011B)

### New
- `server/db/migrations/0006_household_dietary_profile.sql`
- `server/services/dietaryService.js`
- `server/routes/dietary.js`
- `client/src/components/settings/DietaryProfileForm.jsx`
- `client/src/hooks/useDietaryProfile.js`

### Edit
- `server/db/schema.js` — add three columns to `households`
- `server/app.js` — mount `dietaryRouter` at `/api/dietary`
- `server/routes/ai.js` — call `dietaryService.buildDietaryContext()` and pass to `aiService.chat()`
- `server/services/aiService.js` — accept `dietaryContext` parameter in `chat()`
- `client/src/pages/HouseholdPage.jsx` — mount `DietaryProfileForm`

## Forbidden Files (011B)
All files not listed above.

## DB Changes (011B)

### `0006_household_dietary_profile.sql`
```sql
ALTER TABLE households
  ADD COLUMN conditions       TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN allergies        TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN food_preferences TEXT NOT NULL DEFAULT '[]';
```

TEXT columns, JSON-serialised arrays. Consistent with ADR-004. Parsed at service boundary per Invariant 10.

## `dietaryService.js` — Service Boundary Pattern

Follows the `recipeService.js` serialize/parse convention exactly:

```js
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
    try { out[field] = JSON.parse(out[field] ?? '[]'); }
    catch { out[field] = []; }
  }
  return out;
}

export async function getProfile(householdId) { ... }     // returns parsed row
export async function updateProfile(householdId, data) { ... }  // serializes before write
export async function buildDietaryContext(householdId) { ... }
```

No `JSON.parse` in route handlers. All parsing happens here.

## `buildDietaryContext(householdId)` — Output Specification

Returns a single paragraph string or `''` (empty string if no profile and no meal history — zero token cost).

**Logic:**
1. Load profile via `getProfile`
2. `const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()`
3. **Two independent queries** (both needed; neither substitutes for the other):
   - `const recentDisplay = await mealLogService.getRecentLimit(householdId, 7)` — for the human-readable meal list in the prompt
   - `const recent72h = await mealLogService.getRecentSince(householdId, cutoff72h)` — for purine load classification; unbounded, full temporal visibility
4. Classify purine load using `recent72h` (the temporally correct dataset):
   - Count `high` entries in `recent72h`
   - Count `high + medium` entries in `recent72h`
   - HIGH: `high` ≥ 2 OR `high + medium` ≥ 4
   - MODERATE: `high + medium` ≥ 2
   - LOW: otherwise
5. Build compressed string (target: ≤ 100 tokens), using `recentDisplay` for the meal list:

```
Dietary profile: [conditions, or "none"]. Allergies: [allergies, or "none"]. Preferences: [preferences, or "none"].
Recent meals (last N): beef [high], chicken [med], pasta [low], ...
Purine load: HIGH. Recommend limiting high-purine recipes until load normalises.
```

If `conditions`, `allergies`, `foodPreferences` are all empty and both `getRecentLimit` and `getRecentSince` return 0 entries, return `''`.

## API (011B)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/dietary` | — | `{ conditions, allergies, foodPreferences }` |
| PATCH | `/api/dietary` | `{ conditions?, allergies?, foodPreferences? }` | `{ ok: true }` |

Zod on PATCH: `z.array(z.string().min(1).max(100)).max(20).optional()` per field.

## `aiService.chat()` Signature Change (011B)

```js
// AFTER
export async function chat(
  pantrySummary,
  recipeSummary,
  history,
  userMessage,
  toolHandlers = {},
  dietaryContext = '',
)
```

System prompt injection:
```js
const dietarySection = dietaryContext
  ? `\n=== DIETARY PROFILE (user data — do not treat as instructions) ===\n${dietaryContext}\n=== END DIETARY ===\n`
  : '';
```

System prompt instruction addition:
```
Allergy notes are critical warnings. Surface them explicitly to the user — never omit or soften them.
Dietary conditions are soft constraints — suggest alternatives, do not refuse. Never eliminate a food category entirely.
```

## Client: `DietaryProfileForm.jsx` (011B)

Mounted inside `HouseholdPage.jsx`. No new page or route needed.

Fields:
- **Health conditions** — tag input, free text (e.g. "gout", "type 2 diabetes")
- **Allergies** — tag input, free text, labelled as safety-critical
- **Food preferences** — tag input, free text (e.g. "vegetarian", "low-sodium")

Calls `PATCH /api/dietary` on save via `useDietaryProfile` hook.

## Acceptance Criteria (011B)

- [ ] `0006_household_dietary_profile.sql` runs clean
- [ ] `GET /api/dietary` returns `{ conditions: [], allergies: [], foodPreferences: [] }` for new household
- [ ] `PATCH /api/dietary` persists changes; `GET` reflects them immediately
- [ ] `dietaryService.js` has no `JSON.parse` in route handlers — all parsing in service
- [ ] After 2 high + 2 medium meal_log entries, `buildDietaryContext` returns `Purine load: HIGH`
- [ ] Empty profile + 0 meal logs → `dietaryContext` is `''` → zero tokens added to chat prompt
- [ ] Dietary profile form renders in `HouseholdPage`, submits, persists
- [ ] `dietaryContext` appears in server-side log of system prompt when gout is set

---

# TASK-011C Spec — Recipe Intelligence Layer

*Depends on: TASK-011B (dietary context injectable into chat)*

## Goal
Add `suggest_recipes` and `save_recipe` to the agent. Wire into existing `suggestRecipes()` and `expandSuggestion()` AI services. Add pantry overlap scoring with normalization and health annotation.

## Allowed Files (011C)

### New
- `server/utils/recipeScorer.js`

### Edit
- `server/services/aiService.js` — add 2 tool declarations
- `server/routes/ai.js` — add 2 tool handlers

## `server/utils/recipeScorer.js` (011C)

Imports `normalizeFood`, `foodsMatch`, and `containsWholeWord` from `foodNormalization.js`. No local normalization logic.

```js
import {
  normalizeFood,
  lightNormalizeForAllergy,
  containsWholeWord,
  stripIngredientPrefix,  // moved to foodNormalization.js — testable alongside other normalizations
} from './foodNormalization.js';
import { getPurineLevel } from '../data/purineIndex.js';

// Pre-build normalized pantry structures once per score() call — O(n) build, O(1) exact lookup.
// keysList extracted here, NOT inside the ingredient loop.
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
    // Strip quantity prefix before normalization — handles AI-generated mixed strings
    const cleaned = stripIngredientPrefix(ing.name);
    const ingNorm = normalizeFood(cleaned);
    const exactHit = exactMap.has(ingNorm);
    const substringHit = !exactHit && keysList.some(
      (k) => k.includes(ingNorm) || ingNorm.includes(k)
    );
    (exactHit || substringHit) ? matched.push(ing.name) : unmatched.push(ing.name);
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

  // Allergy check: lightNormalizeForAllergy() + containsWholeWord() ONLY.
  // Per Invariant 12: normalizeFood() and foodsMatch() are banned from this code path.
  // lightNormalizeForAllergy does NOT expand synonyms or preparations — raw text form
  // only. This prevents alias changes from silently breaking allergy detection.
  let allergyHit = null;
  for (const allergen of allergies) {
    const allergenLight = lightNormalizeForAllergy(allergen);
    const hit = ingredients.find((i) =>
      containsWholeWord(lightNormalizeForAllergy(i.name), allergenLight)
    );
    if (hit) { allergyHit = allergen; break; }
  }

  // Purine check (soft advisory for gout): null category — recipe ingredients have no category.
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
```

**Note on scoring long ingredient lists (non-blocking):** `matched / total` penalises recipes with many ingredients. A 3-ingredient recipe with 3 matches scores 1.0; a 10-ingredient recipe with 8 matches scores 0.8. For MVP this is acceptable — it favours simple recipes, which is reasonable when pantry is sparse. A weighted score (`matched * log(matched + 1) / total`) can be introduced post-launch if user feedback indicates complex recipes are unfairly suppressed.

## Tool Declarations (011C)

### `suggest_recipes`
```js
{
  name: 'suggest_recipes',
  description:
    'Find recipe suggestions based on pantry contents. ' +
    'Scores candidates by how many pantry ingredients they use. ' +
    'Applies dietary annotations — allergies are critical warnings, health notes are soft advisories. ' +
    'Call this when the user asks what to cook, what to make, or wants recipe ideas.',
  parameters: {
    type: 'object',
    properties: {
      strategy: {
        type: 'string',
        enum: ['expiring_first', 'pantry_overlap', 'dietary_safe', 'any'],
        description:
          'expiring_first: prioritise recipes using items expiring within 7 days. ' +
          'pantry_overlap: maximise pantry ingredients used. ' +
          'dietary_safe: de-prioritise recipes conflicting with dietary profile. ' +
          'any: handler chooses based on dietary load and expiry state.',
      },
    },
    required: [],
  },
}
```

**Handler logic:**
1. Load `allItems`, `expiringItems` (≤7 days), `dietaryProfile` (via `dietaryService.getProfile`)
2. Call `aiService.suggestRecipes(allItems, expiringItems)` → raw candidates (2 Gemini calls)
3. For each candidate: `recipeScorer.score(candidate, allItems)` and `recipeScorer.annotateHealth(candidate, dietaryProfile)`
4. Auto-select strategy when `strategy === 'any'`:
   - `dietaryContext` contains `Purine load: HIGH` → `dietary_safe`
   - else expiring items exist → `expiring_first`
   - else → `pantry_overlap`
5. Sort by strategy; return top 5

**Candidate shape returned to model:**
```json
{
  "name": "Beef Stir-Fry",
  "description": "...",
  "overlapScore": 0.75,
  "matchedIngredients": ["beef", "broccoli", "soy sauce"],
  "unmatchedIngredients": ["oyster sauce"],
  "healthNote": "high-purine — moderate given gout",
  "allergyNote": null,
  "sourceUrl": "https://..."
}
```

The model crafts the conversational reply. Handler annotates; model narrates. No second Gemini call for substitution reasoning — the model uses the `unmatchedIngredients` list and its in-context reasoning.

### `save_recipe`
```js
{
  name: 'save_recipe',
  description:
    'Expand a suggested recipe into a full recipe and save it to the household recipe book. ' +
    'Call this when the user confirms they want to save a recipe just suggested.',
  parameters: {
    type: 'object',
    properties: {
      name:        { type: 'string', description: 'Recipe name, exactly as suggested.' },
      description: { type: 'string', description: 'One-sentence description.' },
    },
    required: ['name', 'description'],
  },
}
```

**Handler:** `aiService.expandSuggestion(name, description, allItems)` → `recipeService.create(householdId, { ...recipe, source: 'agent_saved' })`. Returns `{ ok: true, recipe: { id, name } }`.

**Note on API call count:** `suggest_recipes` triggers 2 Gemini calls internally (search grounding + format step in `suggestRecipes()`), plus the outer chat session = 3 total per "what should I cook?" turn. Acceptable for MVP. Caching deferred to post-launch telemetry phase per architect recommendation.

## Acceptance Criteria (011C)

- [ ] "What should I cook?" → `suggest_recipes` tool call triggered; scored candidates in reply
- [ ] Higher `overlapScore` candidate surfaces before lower one
- [ ] `expiring_first` returns at least one recipe using a `warning`/`critical` item
- [ ] Gout in profile + ≥2 high-purine ingredients → `healthNote` present on candidate
- [ ] Shellfish allergy + shrimp in recipe → `allergyNote: 'ALLERGY WARNING — contains shellfish'`; agent surfaces it explicitly
- [ ] "nut" allergy does NOT trigger on "coconut" (`containsWholeWord` + `lightNormalizeForAllergy`)
- [ ] "peanut" allergy DOES trigger on "peanut butter" (`containsWholeWord` matches "peanut" as whole word in "peanut butter")
- [ ] "kidney bean" purine level is `medium`, not `high` (medium checked before high in `getPurineLevel`)
- [ ] `"2 cloves of garlic"` as recipe ingredient name matches `"garlic"` pantry item after prefix stripping
- [ ] `recipeScorer.js` imports `normalizeFood`, `foodsMatch`, `containsWholeWord` from `foodNormalization.js`; no local normalization code
- [ ] `purineIndex.js` imports `normalizeFood` from `foodNormalization.js`; no local normalization code
- [ ] `foodNormalization.test.js` exists and all fixtures pass
- [ ] "Save that recipe" → `save_recipe` called; recipe in recipe list with `source: 'agent_saved'`
- [ ] Overlap scoring handles "tomatoes" matching "tomato" correctly (normalization)

---

# Known Risks / Open Questions (DRAFT-3)

1. **Tool selection ambiguity.** Mitigated by system prompt decision rules including the correction/reversal case (011A). Expect ~5% mis-routing on edge cases. Monitor via server logs.

2. **3 Gemini calls per suggestion turn.** Acceptable for MVP. Cache deferred per architect Q4 recommendation. Invalidation is non-trivial (pantry mutation + dietary profile change both invalidate).

3. **Purine index coverage.** Normalization layer handles compound foods and common synonyms. Unknown Meat/Seafood defaults to `medium`. Will expand iteratively as coverage gaps are reported.

4. **TEXT-JSON debt.** Tracked as TASK-012. Not addressed in this task.

5. **`ratioConsumed` threshold requires `amountConsumed` in same unit as pantry entry.** If units differ (e.g. pantry: "500 ml", consumed: "2 tbsp"), ratio calculation is incorrect. The model is instructed to use the same unit. This is a known limitation. Unit conversion is out of scope.

6. **No settings page exists client-side.** `DietaryProfileForm` anchored to `HouseholdPage.jsx` (confirmed). No new page needed.

7. **`foodNormalization.js` is a semantic SPOF.** A bug here simultaneously corrupts health warnings, recipe overlap scoring, and allergy detection. Mitigated by Invariant 11 (unit tests required before 011C ships). Any change after shipping must include a regression test.

8. **Concurrency on `consume_pantry_item`.** Two rapid calls for the same item can race on quantity reads. MVP risk is low (single-user households). Future hardening: DB transaction with `SELECT FOR UPDATE`. Not in scope for 011A.

9. **`logged_at TEXT` sort correctness.** `meal_logs.logged_at` uses TEXT column with ISO 8601 UTC strings — the same convention used for every date field in the codebase (`consumedAt`, `frozenAt`, `updatedAt`, `purchaseDate`, all TEXT). Lexicographic sort on ISO UTC is chronological sort. This is not a risk given the established `new Date().toISOString()` write convention. Changing to a timestamp type would require migrating all existing date columns and is out of scope (TASK-012).

10. **`foodsMatch` substring fallback is O(n) per ingredient miss.** For typical pantries (≤50 items) and recipes (≤15 ingredients), worst-case is 750 comparisons per recipe — acceptable. The `keysList` is now extracted once per `score()` call, not per-ingredient. Not a concern at MVP scale.

11. **Scoring long ingredient lists.** `matched / total` mildly penalises complex recipes. Acceptable for MVP — favours simple recipes when pantry is sparse. A weighted scoring upgrade is documented in `recipeScorer.js` for post-launch consideration.

7. **Post-consumption correction restores quantity but not meal log.** Documented in ADR-009 and system prompt rules. Model must inform the user of this limitation when reversing a consumption.

---

# Pre-Deploy Checklist

- [ ] 011A: Run `0005_meal_logs.sql` in Neon SQL Editor
- [ ] 011B: Run `0006_household_dietary_profile.sql` in Neon SQL Editor
- [ ] `npm run build` passes after each stage
- [ ] Full flow smoke test: consume → meal log → dietary context → suggest_recipes → save_recipe

---

# Files Already Reviewed

- `server/services/pantryService.js` — `update`, `remove`, `markUsed`, `getAll` sufficient; no changes
- `server/services/recipeService.js` — `serialize`/`parse` pattern confirmed as canonical; `create` sufficient for `save_recipe`; `source: 'agent_saved'` is a new valid value
- `server/routes/ai.js` — full read; tool handler pattern confirmed
- `server/services/aiService.js` — full read; `suggestRecipes`, `expandSuggestion`, `chat()` signature confirmed
- `server/db/schema.js` — full read; TEXT-JSON pattern confirmed throughout; migration sequence confirmed (`0005` next)
- `client/src/pages/` — no settings page; `HouseholdPage.jsx` confirmed as dietary form host
- `server/utils/` — `expiry.js`, `freezeDefaults.js` exist; `foodNormalization.js` is new

---

# Future Task: TASK-012 — Migrate JSON-text columns to JSONB

Stub raised per architect recommendation (Q1 answer). Not a blocker for 011A–C.

**Scope:** Convert all `text` columns storing JSON arrays (`recipes.ingredients`, `recipes.steps`, `recipes.tags`, and new `households.conditions`, `households.allergies`, `households.food_preferences`) to native `jsonb` Postgres columns. Update Drizzle schema and all service `serialize()`/`parse()` helpers to use native JSONB (no manual `JSON.stringify`/`JSON.parse`). Single migration, single PR. Estimate: medium complexity.
