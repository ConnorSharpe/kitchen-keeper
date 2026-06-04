# TASK-008 — Fix suggestRecipes for No-Expiry Pantry Items

Version: DRAFT-2
Status: APPROVED — Implementation-ready

---

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial spec |
| DRAFT-2 | APPROVED | AC #2 rewritten as system-behavior check; `item.id` guarantee documented; defensive array guard added; prompt wording strengthened; large-pantry cap decision made explicit |

---

## Goal

`POST /api/ai/suggest-recipes` silently returns an empty array whenever the user has
no pantry items with an expiry date set within the next 7 days. This makes the feature
useless for pantries filled with non-perishables, frozen goods, or staples added via the
TASK-007 onboarding flow (which sets no expiry dates).

Fix: pass the full pantry to `suggestRecipes()` so the AI always has ingredients to work
with, while still prioritising items that are expiring soon.

---

## Root Cause

**`server/routes/ai.js` (lines 101-109)**

```js
router.post('/suggest-recipes', async (req, res) => {
  const allItems = await pantryService.getAll(req.user.householdId);
  const expiringItems = allItems.filter((item) => {
    const days = getExpiryDays(item.expiryDate);
    return days !== null && days >= 0 && days <= 7;
  });
  const suggestions = await aiService.suggestRecipes(expiringItems); // ← only expiring
  res.json({ suggestions });
});
```

**`server/services/aiService.js` (line 234)**

```js
export async function suggestRecipes(expiringItems) {
  if (expiringItems.length === 0) return []; // ← silent empty return
  ...
}
```

Both the early-return guard and the single-argument signature must change together.

---

## Allowed Files

- `server/routes/ai.js`
- `server/services/aiService.js`

---

## Forbidden Files

- `server/db/schema.js`
- `server/db/migrations/*`
- `server/routes/pantry.js`
- `server/routes/auth.js`
- `server/middleware/*`
- `server/services/pantryService.js`
- `client/*`

---

## Constraints

1. No new DB queries — `allItems` is already fetched in the route.
2. The two-step Google Search grounding architecture in `suggestRecipes` is preserved unchanged.
3. `responseMimeType` / `jsonModel` / `textModel` helpers are not modified.
4. Expiring items must still be flagged as priority in the AI prompt — the current
   prioritisation intent is preserved, not removed.
5. No new files. No schema migration.
6. `eatThisNow` and all other `aiService` exports are untouched.

---

## Implementation Plan

### Change 1 — `server/routes/ai.js`

Pass both `allItems` and `expiringItems` to `suggestRecipes`:

```js
// before
const suggestions = await aiService.suggestRecipes(expiringItems);

// after
const suggestions = await aiService.suggestRecipes(allItems, expiringItems);
```

No other changes to this file.

### Change 2 — `server/services/aiService.js`

**Signature** — add `allItems` as first parameter:

```js
// before
export async function suggestRecipes(expiringItems) {

// after
export async function suggestRecipes(allItems, expiringItems) {
```

**Early-return guard** — guard on `allItems` instead of `expiringItems`, with defensive array check:

```js
// before
if (expiringItems.length === 0) return [];

// after
if (!Array.isArray(allItems) || allItems.length === 0) return [];
```

`getAll()` in `pantryService.js` always returns an array (Drizzle `db.select()` contract),
so `!Array.isArray` will never fire in practice. The check is a service-boundary guard
against future callers passing unexpected values — consistent with how defensive boundaries
are handled elsewhere in the codebase.

**Step 1 prompt data** — replace the flat `itemsData` array with a richer shape that
includes an `expiresSoon` flag, mirroring the approach already used by `formatPantrySection`:

```js
// before
const itemsData = expiringItems.map((i) => ({ name: i.name, category: i.category }));

// after
const expiringSet = new Set(expiringItems.map((i) => i.id));
const itemsData = allItems.map((i) => ({
  name: i.name,
  category: i.category,
  expiresSoon: expiringSet.has(i.id),
}));
```

**`item.id` guarantee** — `id` is safe to use as the deduplication key here.
`pantryItems.id` is defined as `serial('id').primaryKey()` in `server/db/schema.js` —
a non-null auto-incrementing integer enforced at the DB level. `pantryService.getAll()`
is a bare `db.select().from(pantryItems)` (no column projection), so every returned row
includes `id`. It is impossible for a row from this query to arrive without an `id`.

**Step 1 prompt text** — strengthen expiry-priority signal from a field-name reference to
a behavioral instruction the model can act on:

```js
// before
`Search for 3 healthy recipes that use the ingredients listed above. ...`

// after
`Search for 3 healthy recipes using ingredients from the pantry listed above. ` +
`Items marked expiresSoon=true must be treated as highest-priority ingredients ` +
`and should appear in the recipes whenever practical. ...`
```

No changes to Step 2 (the JSON formatting call).

---

## Dependency Chain

Editing:
- `server/routes/ai.js`
- `server/services/aiService.js`

Requires (read-only reference):
- `server/utils/expiry.js` — `getExpiryDays` already imported; no change needed

Irrelevant:
- `server/db/*`
- `server/routes/pantry.js`
- `server/routes/auth.js`
- `server/middleware/*`
- `client/*`

---

## Acceptance Criteria

1. A household with pantry items that have **no expiry date** receives a non-empty
   response from `POST /api/ai/suggest-recipes` (the AI call is made and returns results).
2. When expiring items exist, the JSON payload sent to Gemini Step 1 contains those items
   with `expiresSoon: true` and the remaining items with `expiresSoon: false`. The prompt
   text instructs the model to treat `expiresSoon=true` items as highest priority.
   *(This is verifiable by inspecting the constructed `itemsData` array and prompt string
   — it does not depend on model output.)*
3. An **empty pantry** (zero items) returns `[]` immediately without making any AI call.
4. `eatThisNow`, `expandSuggestion`, `chat`, `parseReceipt`, and `parseRecipeImage`
   are unaffected — their behaviour and signatures are unchanged.
5. `npm run build` passes with zero errors.

---

## Verification Steps

1. `npm run build` — confirm no type or import errors.
2. Code inspection — verify `itemsData` construction:
   - all items from `allItems` are present in `itemsData`
   - items in `expiringItems` have `expiresSoon: true`
   - items not in `expiringItems` have `expiresSoon: false`
   - prompt string contains the `expiresSoon=true` priority instruction
3. Manual smoke test (Vercel preview or local `npm run dev`):
   a. Add 3 pantry items with **no expiry date** → call `POST /api/ai/suggest-recipes` → assert non-empty `suggestions` array.
   b. Empty pantry → assert `[]` returned with 200, no AI call made.
4. Confirm `eatThisNow` still works (uses a separate code path — no regression expected).

---

## Known Risks / Open Questions

1. **`expiresSoon` flag vs. inline text** — using a boolean flag on each item keeps the
   JSON compact. An alternative (`"expires in X days"` string per item) might produce
   more focused model responses but would increase prompt size and couple the prompt to
   the `getExpiryDays` utility. The boolean approach mirrors the structured-data pattern
   already used elsewhere in the codebase and is the chosen implementation.

2. **Large-pantry item cap — DEFERRED** — No item cap will be implemented in TASK-008.
   At current scale (typical household: 20–60 items) the full pantry adds negligible
   tokens to the Step 1 prompt. Prompt-size optimisation for 100+ item pantries is
   explicitly deferred to a future task. If a cap is added later, the required ordering
   is: all expiring items first, then remaining items sorted by category.

---

## Files Modified

- `server/routes/ai.js` — 1-line change (add `allItems` argument to `suggestRecipes` call)
- `server/services/aiService.js` — ~10 lines changed (signature, guard, itemsData shape, prompt text)

---

## PowerShell Merge Block

N/A — working directly on main.
