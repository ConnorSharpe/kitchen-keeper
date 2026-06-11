# TASK-015 — Shelf Life Estimation + Non-Food Receipt Filtering

Status: APPROVED — Ready for Implementation
Author: ConnorSharpe + Claude Sonnet 4.6
Date: 2026-06-11
Architect: Approved Round 2 (9.3/10) — 3 minor revisions applied below

---

# Goal

Two closely related problems addressed in one task because they share the same data layer:

1. **Shelf life estimation**: When a food item is added (manually or via receipt) without a printed/scanned expiration date, estimate a sensible `expires_at` value using the USDA FoodKeeper dataset — a free, public-domain, offline JSON file. Zero LLM tokens consumed.

2. **Non-food receipt filtering**: When a receipt photo is parsed, the vision model must classify each line item with a category before anything is written to the pantry. Items like potting soil, cleaning supplies, or hardware are filtered server-side. Classification is folded into the existing `parseReceipt` call — no additional API request.

---

# Background

## Current Behavior

- `parseReceipt` (Groq vision model) extracts items from a receipt image and returns a JSON array. It does not classify or filter non-food items.
- Manual item add form has an optional expiration date field. If left blank, no `expiryDate` is set — the item never expires in the system.
- There is no shelf life lookup of any kind today.

## Why This Matters

- A receipt from Fred Meyer may include potting soil, batteries, or paper towels. Storing those in the pantry poisons downstream logic (meal suggestions, "eat this now", expiry alerts).
- Unset expiration dates degrade the expiry alert and "eat this now" features, since most pantry items have predictable shelf lives even without a printed date.

---

# Data Source: USDA FoodKeeper

**Source**: [USDA FSIS FoodKeeper Data](https://catalog.data.gov/dataset/fsis-foodkeeper-data)

**Format**: Public domain Excel/JSON. Covers 400+ food and beverage items organized by category (Meat, Dairy, Produce, Pantry Staples, etc.) with shelf life in days for three storage contexts:
- `pantryDays` (derived from min/max midpoint)
- `refrigeratorDays` (derived from min/max midpoint)
- `freezerDays` (derived from min/max midpoint)

**Preprocessing**: The Excel/JSON source is processed once, offline, before being committed to the repo. The preprocessing step produces `server/data/foodkeeper.json` with pre-normalized, pre-midpointed entries:

```json
[
  {
    "name": "chicken breast",
    "pantryDays": 0,
    "refrigeratorDays": 2,
    "freezerDays": 270
  }
]
```

All names in the committed file are lowercased and whitespace-normalized. Runtime lookup never re-normalizes the dataset — it normalizes the query string once and searches the pre-processed list.

**Coverage gap**: FoodKeeper covers ~400 items. Exotic, brand-specific, or heavily abbreviated receipt line items may not match. Graceful null is acceptable — if no match is found, `expiryDate` remains unset and the user retains full manual control.

---

# Architecture

## New Files

```
server/data/foodkeeper.json              — USDA FoodKeeper static dataset (committed, pre-processed)
server/services/shelfLifeService.js      — lookup + normalization logic
```

## Modified Files

```
server/services/aiService.js             — parseReceipt JSON schema: classification field
server/services/pantryService.js         — expiry enrichment in create() and bulkCreate()
```

## shelfLifeService.js

Responsibilities:
- Load `foodkeeper.json` once at module init (synchronous require, no async needed)
- Expose `lookup(itemName: string): ShelfLifeResult | null`
- Normalize the query string before matching:
  1. Use `stripIngredientPrefix()` from `server/utils/foodNormalization.js` to strip leading quantity/unit prefixes (e.g., "2x CHKN BRST 1LB" → "CHKN BRST")
  2. Lowercase and trim
  3. Do **NOT** apply `normalizeFood()` from `foodNormalization.js` — that function collapses preparation specificity in the wrong direction ("chicken breast" → "chicken"), which reduces FoodKeeper match quality
- At module init, build an `exactIndex` Map from pre-normalized name → entry. This is an O(1) lookup; no scanning required for exact matches.
- Match strategy (in order):
  1. O(1) exact match via `exactIndex`
  2. O(n) substring: normalized query is contained within a FoodKeeper name
  3. O(n) substring: a FoodKeeper name is contained within the normalized query
- Return `ShelfLifeResult | null`:

```js
{
  pantryDays: number,         // 0 if item is not pantry-stable
  refrigeratorDays: number,   // 0 if not applicable
  freezerDays: number,        // 0 if not applicable
  recommendedDays: number,    // selected value (see storage context logic below)
  storageContext: "pantry" | "refrigerator" | "freezer",
  matchType: "exact" | "substring"  // telemetry only
}
```

- Must never throw. Return null on any error (malformed data, missing file, etc.) and log the error.
- Performance target: p95 < 5ms (offline JSON over 400 items, effectively instant)

### Storage Context Selection

Use the first non-zero value in this fallback order:

```
pantryDays > 0  → storageContext = "pantry",      recommendedDays = pantryDays
refrigeratorDays > 0 → storageContext = "refrigerator", recommendedDays = refrigeratorDays
freezerDays > 0 → storageContext = "freezer",     recommendedDays = freezerDays
all zero        → return null
```

This correctly handles:
- Peanut butter (pantryDays: 90) → pantry ✓
- Chicken breast (pantryDays: 0, refrigeratorDays: 2) → refrigerator ✓
- Bread (pantryDays: 5) → pantry ✓

Do not derive storage context from heuristics or thresholds. The FoodKeeper data already encodes storage intent via which fields are non-zero.

## Expiry Enrichment — Injection Point

Expiry estimation occurs **before persistence**, inside the service layer, not after.

### `pantryService.create(householdId, data)`

Current:
```js
const [row] = await db.insert(pantryItems).values({ ...data, householdId }).returning();
```

Modified flow:
```
1. If data.expiryDate is set → use it unchanged (explicit expiry is never overridden)
2. Else → shelfLifeService.lookup(data.name)
3. If match → data.expiryDate = today + result.recommendedDays (ISO string, UTC midnight)
4. Single INSERT with enriched data
```

Result: one database write per item, always.

### `pantryService.bulkCreate(householdId, items)`

**Behavioral change from current code**: The existing `bulkCreate()` wraps all inserts in a single Drizzle `db.transaction()`. This task changes that to **best-effort / non-atomic** behavior. The `db.transaction()` wrapper must be removed.

Rationale: losing an entire 35-item grocery receipt because one item fails a DB constraint is worse UX than a partial import. Expiry enrichment failures are already non-throwing (they produce null, not an error), so the failure modes that matter are DB-level per-item failures.

New behavior: iterate items independently, catch per-item errors, continue processing remaining items, return the list of successfully inserted rows.

```js
const results = [];
for (const item of items) {
  try {
    const enriched = enrichWithExpiry(item);
    const [row] = await db.insert(pantryItems).values({ ...enriched, householdId }).returning();
    results.push(row);
  } catch (err) {
    logger.error({ err, item }, 'bulkCreate: failed to insert item');
    // continue — do not re-throw
  }
}
return results;
```

`enrichWithExpiry(item)` is a pure synchronous function (no async, no DB) shared by both `create()` and `bulkCreate()`.

## parseReceipt Schema Change (Non-Food Filtering)

Replace `is_food: boolean` (Round 1 draft) with a categorical field:

```json
{
  "name": "Potting Soil 8qt",
  "quantity": 1,
  "unit": null,
  "price": 7.99,
  "classification": "non_food"
}
```

**Enum values**:
- `"produce"` — fresh fruits, vegetables
- `"dairy"` — milk, cheese, yogurt, eggs
- `"meat"` — raw meat, poultry, seafood
- `"packaged"` — canned, boxed, bagged shelf-stable food
- `"beverage"` — drinks
- `"non_food"` — household supplies, hardware, garden, personal care, non-consumables
- `"uncertain"` — item is ambiguous or the model is not confident

**Server-side filtering logic**:

```js
const food    = items.filter(i => i.classification !== "non_food");
const dropped = items.filter(i => i.classification === "non_food");
// log dropped for observability; do not surface to user
// uncertain items ARE included and written to pantry
```

Only `non_food` is discarded. `uncertain` items are passed through — a false positive (real food filtered out) is worse than a false negative (a non-food item included). The user can always delete a misclassified item; they cannot recover a silently deleted one.

**Prompt guidance**: The classification prompt must instruct the model to default to `uncertain` rather than `non_food` when unsure, and to only use `non_food` for items that are clearly and unambiguously not for human consumption.

**Token cost**: ~5–8 tokens per line item added to the existing response. No new API call.

The categorical `classification` field also enables future auto-tagging of pantry items by food group, recipe ranking by category, and pantry organization views — deferring this to the data model now prevents a schema migration later.

---

# Allowed Files

```
server/data/foodkeeper.json              — create (pre-processed static asset)
server/services/shelfLifeService.js      — create
server/services/aiService.js             — modify (parseReceipt prompt + schema only)
server/services/pantryService.js         — modify (enrichWithExpiry helper, create, bulkCreate)
```

# Forbidden Files

```
server/services/ai/groqProvider.js       — do not touch (see TASK-016)
server/services/ai/geminiProvider.js     — do not touch
server/services/recipeSearchService.js   — do not touch
server/routes/ai.js                      — do not touch
server/routes/pantry.js                  — do not touch (route shape unchanged)
server/db/schema.js                      — do not touch (no schema changes needed)
client/*                                 — do not touch
server/db/migrations/*                   — do not touch
```

---

# Out of Scope — TASK-016

The Groq vision model (`llama-3.2-11b-vision-instruct`) may be deprecated. Research indicates Groq is recommending `llama-4-scout-17b-16e-instruct` or `llama-4-maverick` as replacements. This migration is a separate concern and must not block or be mixed with TASK-015.

**TASK-016**: Groq Vision Model Migration
- Verify deprecation status at [console.groq.com/docs/deprecations](https://console.groq.com/docs/deprecations)
- Update model ID in `groqProvider.js`
- Re-run receipt vision benchmark (≥90% accuracy across 10 receipts)

**Pre-implementation gate for TASK-015**: Before implementing the `parseReceipt` schema change, confirm that the current vision model is still active OR that TASK-016 has been completed. Do not implement against a deprecated model without first confirming the replacement.

---

# Constraints

- **Zero new LLM calls** introduced by this task. Shelf life lookup is fully offline.
- **No new npm dependencies** for the lookup logic. No fuzzy string libraries.
- **No database schema changes**. `expiryDate` column already exists.
- The `classification` field must be added to the existing `parseReceipt` prompt/schema only — do not create a separate classification endpoint.
- FoodKeeper data must be committed as a static pre-processed file, not fetched at runtime.
- `lookup()` must never throw. Return null on any error.
- `enrichWithExpiry()` must be a pure synchronous function — no async, no DB access.
- Explicit `expiryDate` values (user-provided or OCR-scanned) must never be overridden by estimates.
- Do not change the manual add UI. The UX for "no expiry set" remains valid.

---

# Technical Debt — Expiry Source Tracking

After this task, a pantry item's `expiryDate` field may have been populated by three different sources:
1. User-entered manually
2. OCR-scanned from a receipt
3. Estimated from FoodKeeper

Users currently cannot distinguish these cases. Example risk: milk printed expiry is June 18 but the system estimated June 22 — user assumes the later date is correct.

This is **not in scope for TASK-015** (would require a schema change and UI work), but is recorded here as explicit technical debt:

> Future task: add `expirySource: "manual" | "scanned" | "estimated"` column to `pantryItems`. Surface estimated dates with a visual indicator in the UI (e.g., "~5 days (estimated)").

---

# Rate Limit Context

Current Groq free tier (as of 2026-06-11):
- `llama-3.3-70b-versatile`: 30 RPM / 12K TPM / 100K TPD
- Vision model: limits not officially published; conservative assumption ~30 RPM based on similar models

The FoodKeeper offline lookup eliminates what would otherwise be a ~500–800 token LLM call per item add. This is the primary token-conservation decision in this task.

---

# Acceptance Criteria

1. `shelfLifeService.lookup("chicken breast")` returns `{ refrigeratorDays: 1–4, storageContext: "refrigerator", recommendedDays: 1–4, ... }`
2. `shelfLifeService.lookup("peanut butter")` returns `{ pantryDays: > 0, storageContext: "pantry", ... }`
3. `shelfLifeService.lookup("potting soil")` returns `null`
4. `shelfLifeService.lookup("zxqfoo nonexistent item")` returns `null` without throwing
5. Malformed or missing `foodkeeper.json` causes `lookup()` to return null and log an error — pantry operations continue unaffected
6. A manually added pantry item with no expiry date receives an estimated `expiryDate` if a FoodKeeper match exists
7. A manually added pantry item with an explicit expiry date is **never** overwritten by the FoodKeeper estimate
8. A receipt containing mixed food + non-food items results in only food and uncertain items being written to the pantry; `non_food` items are discarded
9. Items classified as `"uncertain"` are **not** discarded
10. Receipt import performs one INSERT per item (no post-save UPDATE for expiry)
11. Manual item add performs a single INSERT (no post-save UPDATE for expiry)
12. Receipt import continues processing all items even if `shelfLifeService` throws or returns null for individual items
13. No new packages added to `server/package.json`
14. No new database migration required

---

# Verification Steps

```
1. Unit: shelfLifeService.lookup() — exact match, substring match, null cases, no-throw on bad input
2. Unit: enrichWithExpiry() — explicit expiry unchanged, estimated expiry set, null lookup → no expiry
3. Unit: abbreviation stripping — "2x CHKN BRST 1LB" strips to "CHKN BRST" via stripIngredientPrefix()
4. Integration: POST /api/pantry (manual add, no expiry) → item.expiryDate is set
5. Integration: POST /api/pantry (manual add, explicit expiry) → item.expiryDate unchanged
6. Integration: POST /api/pantry/bulk (receipt items with mixed classification) → non_food absent, uncertain present
7. Performance: shelfLifeService.lookup() p95 < 5ms over 1000 calls
8. Token audit: compare parseReceipt token count before/after schema change (expect < +100 tokens per call)
9. Vision model gate: confirm current Groq vision model is active before implementing parseReceipt changes
```

---

# Dependency Chain

Editing:
- `server/data/foodkeeper.json` (new static asset, pre-processed)
- `server/services/shelfLifeService.js` (new)
- `server/services/pantryService.js` (enrichWithExpiry helper, injected into create + bulkCreate)
- `server/services/aiService.js` (parseReceipt prompt/schema only)

Requires (read-only):
- `server/utils/foodNormalization.js` — use `stripIngredientPrefix()` only; do NOT use `normalizeFood()`
- `server/utils/expiry.js` — UTC date utilities for computing `today + N days`
- `server/services/ai/groqProvider.js` — understand current parseReceipt call shape (read only)
- `server/db/schema.js` — confirm `expiryDate` column type

Irrelevant:
- `server/services/recipeSearchService.js`
- `server/routes/ai.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `client/*`
- `server/db/migrations/*`

---

# Known Risks / Open Questions

1. **Vision model deprecation** — confirmed pre-implementation gate; model migration is TASK-016
2. **FoodKeeper abbreviation match rate** — "CHKN BRST BNL SS" will not match. The normalization pass (stripIngredientPrefix + lowercase) handles quantity/unit stripping but not receipt shorthand expansion. Null fallback is acceptable for v1; a curated abbreviation map can be added in a follow-on task if match rates are unacceptably low post-deploy. Miss logging must be **telemetry-focused, not raw debug logging**: only log a miss when the normalized query length is ≥ 3 characters, contains at least one alphabetic character, and does not look like a PLU code or SKU (pure numeric or short alphanumeric like "PLU 4131"). Threshold for introducing a `foodkeeper_aliases.json`: >15–20% miss rate on common pantry additions observed post-deploy.
3. **Storage context selection** — simple fallback order (pantry → refrigerator → freezer, first non-zero) replaces the Round 1 heuristic. Validated against: chicken breast (fridge ✓), peanut butter (pantry ✓), bread (pantry ✓), fish (fridge ✓).
4. **FoodKeeper data staleness** — USDA dataset last meaningfully updated ~2016. Shelf life guidance hasn't changed materially, but noted.
5. **`uncertain` classification passthrough** — a non-food item occasionally classified as `uncertain` will appear in the pantry. This is acceptable; the user can delete it. Silent deletion of real food is the worse failure mode.
6. **`bulkCreate` transaction and expiry enrichment** — `enrichWithExpiry()` is synchronous and pure, so it is safe to call inside a Drizzle transaction without risk of transaction timeout or re-entrant DB access.

---

# Resolved Questions

**Q1 — FoodKeeper vs curated table**: RESOLVED. Proceed with FoodKeeper + telemetry-focused miss logging. Do not build alias infrastructure preemptively. If post-deploy miss rate exceeds 15–20%, introduce `server/data/foodkeeper_aliases.json` as a follow-on task.

# Optional Enhancement (post-launch)

`shelfLifeService` may accumulate in-process lookup statistics for post-launch analysis:

```js
lookupStats = {
  exactMatch: 0,
  substringMatch: 0,
  noMatch: 0
}
```

Exposed via a module-level `getStats()` call or logged on a periodic interval. Answers: how effective is normalization, how often do substring paths fire, should abbreviation handling be improved. Not required for launch.
