# TASK-021 — Pantry-Aware Ingredient Highlighting on Recipe Suggestion Cards

Version: DRAFT-4 (post-architect review, round 3 — APPROVED FOR IMPLEMENTATION)

---

## Goal

Replace the current binary "bolded name = missing" pattern on AI recipe suggestion cards in ChatPage with a full pantry-status display:

- Every ingredient line shows the full amount **bolded**.
- Line is **green** if the pantry has sufficient quantity.
- Line is **red** if the pantry has zero of the ingredient, or has less than the required amount.
- If partial (has some but not enough): line is red, and appends `(need to buy [delta amount])`.

This change applies to the inline suggestion cards rendered in `ChatPage.jsx`. The `RecipeModal.jsx` (saved recipe detail view) is **out of scope** — it renders user-owned saved recipes and has no live pantry comparison mechanism today.

---

## Current Behavior

`server/routes/ai.js` → `suggest_recipes` handler currently returns:

```json
{
  "recipeSuggestions": [
    {
      "ingredients": [
        { "name": "onion", "quantity": 2, "unit": null }
      ],
      "unmatchedIngredients": ["onion"]
    }
  ]
}
```

`ChatPage.jsx` builds `unmatchedSet` from `unmatchedIngredients[]` and bolds `ing.name` when the name is in the set. Quantity/unit are shown in a gray span separately. Fully-matched ingredients have no special treatment.

---

## Proposed Data Shape Change

Replace `unmatchedIngredients: string[]` with per-ingredient pantry status embedded in each ingredient object.

**New ingredient shape:**

```json
{
  "name": "onion",
  "quantity": 2,
  "unit": null,
  "pantryStatus": "have" | "partial" | "missing",
  "needToBuy": 1
}
```

| `pantryStatus` | Meaning |
|---|---|
| `"have"` | Pantry quantity ≥ recipe quantity (or ingredient exists with no required qty) |
| `"partial"` | Pantry has some but less than required; `needToBuy` = numeric delta |
| `"missing"` | Not in pantry at all |

`needToBuy` is only present when `pantryStatus === "partial"`. It is the raw numeric delta (recipe quantity minus pantry quantity) in the recipe's unit.

**Backward compatibility:** `unmatchedIngredients` is removed from the response. Frontend and backend deploy atomically — no backward compatibility window required.

---

## Normalization: Single Source of Truth

The codebase already has a comprehensive normalization module at `server/utils/foodNormalization.js` that exports:

- `normalizeFood(name)` — synonym + plural + preparation-expansion lookup, O(1) via flattened `LOOKUP` map (e.g. `"scallions"` → `"green onion"`, `"cilantro"` → `"coriander"`)
- `stripIngredientPrefix(name)` — strips leading quantity/unit/descriptor text from raw ingredient strings
- `normalizeUnit(unit)` — canonical unit alias map (e.g. `"tbsp"`, `"tbs"`, `"tablespoons"` → `"tablespoon"`; `"cups"`, `"c"` → `"cup"`)

**`normalizeUnit` is already imported in `ai.js` (line 18).** No new imports are needed for unit normalization.

**Rule:** The annotation step MUST import `normalizeFood`, `stripIngredientPrefix`, and `normalizeUnit` directly from `foodNormalization.js`. Do NOT re-export them from `recipeScorer.js` and do NOT inline this logic. One source of truth prevents scoring and highlighting from drifting apart as the normalization tables evolve.

`recipeScorer.js` uses these same functions internally — the annotation step becomes a parallel consumer of the same module.

---

## Unit Comparison

Units are compared after `normalizeUnit()` canonicalization. This resolves the common formatting variants automatically:

```
tbsp / Tbs / TBSP / tablespoons → "tablespoon"
cups / c / Cups                 → "cup"
g / grams                       → "gram"
oz / ounces                     → "ounce"
```

**Comparison rule:**

1. Apply `normalizeUnit()` to both the recipe unit and the pantry item unit.
2. If both normalize to the same string (or both are empty/null): quantities are directly comparable — apply partial logic.
3. If they differ after normalization: fall back to binary — `"have"` if `pantryItem.quantity > 0`, `"missing"` otherwise. This guards against a pantry record with `quantity: 0` (zero-quantity items can exist even though the schema default is 1). Do NOT attempt cross-unit conversion (cups → tablespoons, oz → grams) in v1.

---

## Pantry Quantity Schema Note

The pantry schema (`pantry_items`) defines `quantity: real NOT NULL DEFAULT 1` and `unit: text NOT NULL DEFAULT 'item'`. These fields are never null at the database level. However, the annotation code should still guard defensively against null/undefined quantities from any source.

---

## Quantity Comparison Rules

Full ordered rule set for annotating a single ingredient:

```
pantryItem = pantryMap.get(normalizeFood(stripIngredientPrefix(ing.name)))

if not pantryItem:
  status = 'missing'

else if ing.quantity == null:
  status = 'have'
  // Reason: no required qty specified → presence is sufficient

else if pantryItem.quantity == null:
  status = 'have'
  // Reason: unknown pantry qty = untracked amount, treated as available

else if normalizeUnit(ing.unit) !== normalizeUnit(pantryItem.unit):
  // Unit mismatch — binary fallback. Item must have quantity > 0 to count as "have".
  // Reason: "0 oz milk" with recipe unit "cup" must not show green.
  // Note: cross-unit conversion is out of scope (v1)
  status = pantryItem.quantity > 0 ? 'have' : 'missing'

else if pantryItem.quantity < ing.quantity:
  status = 'partial'
  needToBuy = ing.quantity - pantryItem.quantity

else:
  status = 'have'
```

---

## Backend Changes

**File:** `server/routes/ai.js` — `suggest_recipes` handler

The handler already fetches `allItems` from `pantryService.getAll()` at the top of the chat handler. These items include `name`, `quantity`, and `unit` fields.

### Step 1 — Build pantry lookup map once (before recipe loop)

```js
import { normalizeFood, stripIngredientPrefix, normalizeUnit } from '../utils/foodNormalization.js';

// Build once — O(1) lookup per ingredient
const pantryMap = new Map(
  allItems.map((item) => [normalizeFood(item.name), item])
);
```

This replaces any `find()` calls inside the loop. `allItems` is already in scope — no additional DB query.

### Annotation contract

```
Function: annotatePantryStatus(top5, pantryMap)

Inputs:
  top5       — array of scored recipe objects (scorer domain model, read-only)
  pantryMap  — Map<normalizedName, pantryItem> (built once before this call)

Output:
  annotatedRecipeSuggestions — new array of API DTO objects
    each ingredient carries pantryStatus and, when partial, needToBuy
    unmatchedIngredients is absent from every DTO
```

Defining the contract by inputs/outputs rather than by step number makes it refactor-safe. The implementation may move; the contract does not.

### Step 2 — Annotate ingredients (post-scoring, new)

After the top-5 are selected (post-scoring, post-dedup), call the annotation contract to build DTO objects. The scorer's domain model is immutable within this pipeline — annotation always constructs API DTOs from scorer output rather than modifying scorer-owned objects.

```js
const annotated = top5.map((recipe) => {
  const annotatedIngredients = (recipe.ingredients ?? []).map((ing) => {
    let pantryStatus = 'missing';
    let needToBuy;

    try {
      const key = normalizeFood(stripIngredientPrefix(ing.name));
      const pantryItem = pantryMap.get(key);

      if (pantryItem) {
        if (ing.quantity == null || pantryItem.quantity == null) {
          pantryStatus = 'have';
        } else if (normalizeUnit(ing.unit) !== normalizeUnit(pantryItem.unit)) {
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
      // Annotation failure must not crash the suggestion pipeline.
      // Default pantryStatus = 'missing' is already set above.
      // Project-wide logging uses console.warn — no structured logger exists.
      console.warn('[annotatePantryStatus] ingredient annotation failed:', err?.message, ing?.name);
    }

    // needToBuy is only present when partial and > 0; never sent as null or 0.
    // All existing ingredient properties are passed through unchanged —
    // the annotation layer adds pantryStatus/needToBuy only; it does not reshape ingredient data.
    const result = { ...ing, pantryStatus };
    if (pantryStatus === 'partial' && needToBuy != null && needToBuy > 0) {
      result.needToBuy = needToBuy;
    }
    return result;
  });

  // Return a new DTO — never mutate the scorer-owned recipe object.
  const { unmatchedIngredients: _removed, ...rest } = recipe;
  return { ...rest, ingredients: annotatedIngredients };
});
```

**`needToBuy` contract:** only present on the DTO when `pantryStatus === 'partial'` AND the delta is `> 0`. Never sent as `null`, `undefined`, or `0`. A zero delta (recipe qty === pantry qty) resolves to `'have'`, not `'partial'`, so `needToBuy: 0` is unreachable.

---

## Frontend Changes

**File:** `client/src/pages/ChatPage.jsx`

Remove the `unmatchedSet` construction entirely. Replace the ingredient rendering block with status-driven rendering:

```jsx
{ingredients.map((ing, i) => {
  const status = ing.pantryStatus ?? 'missing'; // explicit fallback
  const have = status === 'have';

  const qty = [
    ing.quantity != null && String(ing.quantity),
    ing.unit,
  ].filter(Boolean).join(' ');

  return (
    <li
      key={i}
      className={`text-xs flex gap-1.5 ${have ? 'text-green-700' : 'text-red-600'}`}
    >
      <span aria-hidden>•</span>
      <span>
        <strong>{qty && `${qty} `}{ing.name}</strong>
        {status === 'partial' && ing.needToBuy != null && (
          <span className="font-normal ml-1">
            (need to buy {formatQty(ing.needToBuy)}{ing.unit ? ` ${ing.unit}` : ''})
          </span>
        )}
      </span>
    </li>
  );
})}
```

`formatQty` is a module-level pure function declared at the top of ChatPage (not inline in JSX):

```js
function formatQty(n) {
  // Round to max 2 decimal places, strip trailing zeros
  return parseFloat(n.toFixed(2)).toString();
}
```

Examples: `1.25` → `"1.25"`, `0.3333` → `"0.33"`, `1.0` → `"1"`, `2` → `"2"`.

**Status switch intent is explicit:** any status value other than `'have'` renders red. The `switch`/default behavior is intentional and documented — future statuses (e.g. `"estimated"`) will default to red until explicitly handled.

**Also remove:** all references to `unmatchedIngredients` and `unmatchedSet` in ChatPage. Leave no dead code.

---

## Allowed Files

- `server/routes/ai.js`
- `client/src/pages/ChatPage.jsx`

## Forbidden Files

- `server/utils/foodNormalization.js` (read-only — consume its exports, do not modify)
- `server/utils/recipeScorer.js` (read-only — do not modify, do not re-export from it)
- `client/src/components/recipes/RecipeCard.jsx`
- `client/src/components/recipes/RecipeModal.jsx`
- `server/db/migrations/`
- `ai/tasks/archive/`

---

## Constraints

- No new dependencies.
- No DB schema changes.
- No cross-unit conversion (v1 scope).
- All normalization logic imported from `foodNormalization.js` — never inlined or duplicated.
- Pantry lookup map built once per request, before the recipe loop.
- Annotation is a post-scoring step — the 11-step pipeline is untouched.
- Scorer output is never mutated — annotation produces new DTOs.
- `pantryStatus` defaults to `"missing"` if annotation logic errors — the suggestion pipeline must not crash.

---

## Acceptance Criteria

1. A recipe card where all ingredients are in pantry with sufficient quantity shows all ingredient lines in green.
2. A recipe card where an ingredient is absent from the pantry shows that line in red with no parenthetical.
3. A recipe card where an ingredient is in pantry but quantity is insufficient shows that line in red with `(need to buy N [unit])`.
4. All ingredient lines (matched and unmatched) show quantity + name bolded.
5. No ingredient line crashes if `pantryStatus` is absent — `?? 'missing'` fallback applies.
6. `unmatchedIngredients` field is absent from the API response; no dead references remain in the frontend.
7. Ingredient names with different casing (`green onion`, `Green Onion`, `GREEN ONION`) compare correctly and produce consistent status.
8. A unit mismatch with positive pantry quantity (`recipe: 2 cups milk`, `pantry: 16 oz milk`) renders green (binary fallback). A unit mismatch with zero pantry quantity (`recipe: 2 cups milk`, `pantry: 0 oz milk`) renders red.
9. A decimal delta renders correctly: `need to buy 0.5 cup` (not `0.50` or `0.500`).
10. A pantry item with no recorded quantity (null) renders green — item presence is sufficient.
11. Exact quantity match (`recipe: 2 eggs`, `pantry: 2 eggs`) renders green — not partial.
12. Surplus quantity (`recipe: 2 eggs`, `pantry: 12 eggs`) renders green.
13. Zero delta is unreachable: `needToBuy: 0` is never present on the DTO and "need to buy 0" is never rendered.
14. An empty ingredients array (`ingredients: []`) renders the ingredients section without error — no items shown, no crash.

---

## Verification Steps

1. Trigger recipe suggestions. Confirm green/red/partial rendering across cards.
2. Check that an ingredient with `pantryStatus: 'have'` but mismatched units still renders green.
3. Add a pantry item with quantity below recipe requirement. Confirm partial (red + parenthetical).
4. Simulate `pantryStatus: undefined` on an ingredient — confirm it renders red without crashing.
5. Confirm `unmatchedIngredients` is not present anywhere in the API response or frontend code after the change.
6. Verify ingredient name normalization: "scallions" in recipe matches "green onion" in pantry (if foodsMatch covers it) — document result.
7. Assert scorer output is unchanged after annotation: log or inspect the top-5 array before and after the annotation step and confirm no mutations (immutability check).

---

## Known Risks / Open Questions

- **Unit mismatch fallback displays `"have"` for nonzero quantities:** A recipe asking for `2 cups milk` when the pantry has `16 oz milk` shows green. This is intentional and correct for v1 — it avoids false "partial" labels. The acceptance criteria (AC 8) explicitly tests both the positive and zero-quantity cases.

## Intentional Limitations

- **`foodsMatch` fuzzy fallback not used in annotation:** The scorer uses both normalized exact lookup and `foodsMatch()` for fuzzy ingredient matching. The annotation step uses only normalized exact lookup. This means a scorer fuzzy match (e.g. token overlap) will not reflect in the pantry status highlight — the UI may show red for an ingredient the scorer considered "matched." This is an intentional v1 constraint, not a bug. A code comment must document this discrepancy at the annotation step. Fuzzy annotation can be added in v2 if users report false "missing" labels.
- **Color accessibility:** `text-green-700` and `text-red-600` on white background both satisfy WCAG AA contrast. The app does not currently implement dark mode. If dark mode is added in future, these classes will need audit.
- **RecipeModal pantry highlighting:** Deferred. A future task should pass `pantryItems` to the modal and replicate the status annotation on the client side.
