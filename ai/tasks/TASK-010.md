# TASK-010 — Substitution Suggestions in Recipe Expansion

Version: DRAFT-2
Status: APPROVED — Implementation-ready.

---

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial spec |
| DRAFT-2 | APPROVED | Semantic matching clarified; `typeof` guard added; UI wording updated to "pantry sub:"; substitute realism instruction added to prompt; persistence AC added; schema enforcement confirmed absent; line count corrected |

---

## DRAFT-1 → DRAFT-2 Changes

### Adopted (real issues)

**Must Fix #1 (Pantry-presence matching semantics):** Adopted Option A.
The prompt wording "by name" has been removed. The match is explicitly documented
as semantic and AI-driven — the model makes a best-effort judgment (e.g. `"Butter"`
matches `"Unsalted Butter"`). AC #2 now says "semantically equivalent to a pantry
item" not "name matches." No deterministic server-side normalization algorithm is
added (out of scope; would touch `pantryService` which is forbidden).

**Must Fix #2 (Malformed substitute validation):** Adopted.
The UI guard changes from `ing.substitute && (...)` to
`typeof ing.substitute === 'string' && ing.substitute.trim() !== '' && (...)`.
This correctly handles omitted fields, `null`, empty string, and malformed
object/array values the model might emit. AC updated to explicitly require that
malformed values produce no annotation and no rendering error.

**Must Fix #3 (Ambiguous UI wording):** Adopted.
`→ sub:` replaced with `→ pantry sub:` to communicate that the suggestion comes
from the user's own pantry, not a generic internet suggestion.

**Important #1 (Substitute realism instruction):** Adopted.
Prompt now adds: "Choose a substitute that could realistically replace the original
ingredient in the recipe steps if the original is unavailable." This doesn't
rewrite steps but signals to the model that the suggestion must be functionally
valid in the recipe context.

**Important #2 (Persistence verification):** Adopted.
AC and Verification Steps now explicitly verify the `substitute` field survives
the save → reload → reopen round-trip.

### Resolved with explanation (false alarms)

**Observation (schema enforcement / line count):**
`expandSuggestion()` uses `jsonModel()`, which sets `responseMimeType: 'application/json'`
in `generationConfig`. This is prompt-only JSON enforcement via MIME type — there is
no `responseSchema` key in `generationConfig` anywhere in the function.
The JSON schema is communicated entirely through the prompt string.
No separate schema declaration needs updating.

Line count corrected: prompt change is ~6 lines in `aiService.js`; RecipeModal
`<li>` change is ~5 lines. Total: ~11 lines changed across 2 files.

---

## Goal

When a user expands a recipe suggestion via `POST /api/ai/expand-suggestion`,
the generated recipe does not indicate which required ingredients are missing
from their pantry, nor does it suggest what they could use instead.

Fix: extend `expandSuggestion()` to include a `substitute: string | null` field
on each ingredient. When an ingredient is semantically absent from the pantry, the
model suggests the best available pantry item that could stand in. When the
ingredient is already in the pantry (semantically), or has no reasonable substitute,
it is `null`.

No schema migration is required — `ingredients` is already stored as a free-form
JSON text blob (`text('ingredients').notNull()`). The new field is transparently
stored and retrieved by the existing serialize/parse layer in `recipeService.js`.

---

## Allowed Files

**Editing:**
- `server/services/aiService.js` — extend prompt + JSON schema in `expandSuggestion()`
- `client/src/components/recipes/RecipeModal.jsx` — render `ing.substitute` inline

---

## Forbidden Files

- `server/routes/ai.js` — no route changes; expand-suggestion spreads recipe data unchanged
- `server/services/recipeService.js` — JSON blob passthrough; no modification needed
- `server/services/pantryService.js` — no server-side name normalization
- `server/db/schema.js` — no migration; ingredients blob is open JSON
- `server/db/migrations/*` — no migration
- All other routes, services, and client pages

---

## Constraints

1. **Single-call approach only.** The model already receives the full `allItems`
   pantry list in the prompt. Do not add a second AI call. Extend the existing
   `expandSuggestion()` prompt in place.

2. **Matching is semantic, not exact.** The model determines pantry presence by
   semantic judgment (e.g. `"Butter"` matches `"Unsalted Butter"`). No server-side
   normalization algorithm is applied. Best-effort is the documented and accepted
   behavior.

3. **No token budget change.** `maxOutputTokens: 1500` is sufficient.
   `jsonModel()` uses `responseMimeType: 'application/json'` (MIME-type enforcement).
   There is NO `responseSchema` in `generationConfig` — no separate schema object
   to update. JSON schema lives entirely in the prompt string.
   Estimated additional output: ~10 ingredients × ~25 chars ≈ ~60 tokens headroom.

4. **`substitute` is a display-only field.** It is never used in DB queries,
   filtering, or sorting.

5. **UI guard must use `typeof` check.** Do not use `ing.substitute && (...)`.
   Use `typeof ing.substitute === 'string' && ing.substitute.trim() !== ''` to
   guard against malformed model output (object, array, empty string, omitted field).

6. **Backward compatible.** Old saved recipes have no `substitute` field.
   The `typeof` guard silently skips them — no annotation, no error.

7. **No new components.** The annotation is inline within the existing `<li>` row.

8. **Other AI functions are untouched.** `eatThisNow`, `suggestRecipes`, `chat`,
   `parseReceipt`, `parseRecipeImage`, and their routes are unchanged.

---

## Implementation Plan

### Change 1 — `server/services/aiService.js`

**Extend `expandSuggestion()` prompt and JSON schema.**

Current prompt (lines 179–186):

```js
result = await model.generateContent(
  `${pantrySection}\n\n` +
  `Write a full recipe for: "${name}"\n` +
  `Description: "${description}"\n` +
  `Use pantry items where possible.\n\n` +
  `Respond with this exact JSON:\n` +
  `{"name":"string","description":"string","ingredients":[{"name":"string","quantity":number|null,"unit":"string|null"}],"steps":["string"],"servings":number,"prepMins":number,"cookMins":number,"tags":["string"]}`,
);
```

Replacement:

```js
result = await model.generateContent(
  `${pantrySection}\n\n` +
  `Write a full recipe for: "${name}"\n` +
  `Description: "${description}"\n` +
  `Use pantry items where possible.\n\n` +
  `For each ingredient: if it is semantically present in the pantry (e.g. "Butter" ` +
  `matches "Unsalted Butter"), set "substitute" to null. If it is NOT in the pantry, ` +
  `set "substitute" to the name of the single best pantry item that could realistically ` +
  `replace it in the recipe steps — or null if no reasonable pantry substitute exists.\n\n` +
  `Respond with this exact JSON:\n` +
  `{"name":"string","description":"string","ingredients":[{"name":"string","quantity":number|null,"unit":"string|null","substitute":"string|null"}],"steps":["string"],"servings":number,"prepMins":number,"cookMins":number,"tags":["string"]}`,
);
```

No other changes to `expandSuggestion()`.

---

### Change 2 — `client/src/components/recipes/RecipeModal.jsx`

**Render `ing.substitute` inline on each ingredient row.**

Current ingredient render (lines 114–125):

```jsx
{recipe.ingredients.map((ing, i) => (
  <li key={i} className="text-sm text-gray-700 flex gap-2">
    <span className="text-gray-400 select-none">•</span>
    <span>
      {ing.quantity != null && `${ing.quantity} `}
      {ing.unit && `${ing.unit} `}
      {ing.name}
    </span>
  </li>
))}
```

Replacement:

```jsx
{recipe.ingredients.map((ing, i) => (
  <li key={i} className="text-sm text-gray-700 flex gap-2">
    <span className="text-gray-400 select-none">•</span>
    <span>
      {ing.quantity != null && `${ing.quantity} `}
      {ing.unit && `${ing.unit} `}
      {ing.name}
      {typeof ing.substitute === 'string' && ing.substitute.trim() !== '' && (
        <span className="text-amber-600 text-xs ml-1.5 font-medium">
          → pantry sub: {ing.substitute}
        </span>
      )}
    </span>
  </li>
))}
```

The `typeof` guard prevents rendering when the model emits a malformed value
(object, array) or omits the field entirely. Old recipes are unaffected.

---

## Dependency Chain

Editing:
- `server/services/aiService.js`
- `client/src/components/recipes/RecipeModal.jsx`

Requires (read-only reference, no changes):
- `server/routes/ai.js` — route spreads `{ ...recipe, source: 'ai_suggested' }` unchanged
- `server/services/recipeService.js` — serialize/parse layer handles ingredients blob transparently

Irrelevant:
- `server/db/*`
- `server/routes/pantry.js`
- `server/routes/auth.js`
- `server/middleware/*`
- `client/src/pages/RecipesPage.jsx`
- `client/src/components/recipes/RecipeCard.jsx`
- `client/src/components/recipes/RecipeUpload.jsx`

---

## Acceptance Criteria

1. **Substitute rendered for semantically missing ingredient:** Expand a recipe when
   the pantry contains `Olive Oil` but not `Butter`. The `Butter` ingredient row in
   RecipeModal shows `→ pantry sub: Olive Oil` (or another pantry alternative) in
   amber text inline.

2. **Null when ingredient is semantically in pantry:** An ingredient semantically
   equivalent to a pantry item (e.g. recipe calls for `"Butter"`, pantry has
   `"Unsalted Butter"`) has `substitute: null` — no amber annotation appears.

3. **Null when no substitute exists:** An ingredient with no reasonable pantry
   substitute has `substitute: null` — no amber annotation appears.

4. **Malformed model output is silently ignored:** If the model emits
   `substitute: {}` or `substitute: []` or `substitute: ""`, no annotation
   is rendered and no JS error is thrown.

5. **Persistence round-trip:** Expand a recipe → save → reload page → reopen
   the same recipe in RecipeModal. Substitute annotations still appear correctly
   (field survives the JSON blob serialize/parse round-trip in `recipeService`).

6. **Old recipes unaffected:** Existing saved recipes (no `substitute` field on
   ingredients) display exactly as before — no annotation, no UI regression.

7. **`eatThisNow`, `suggestRecipes`, `chat`, `parseReceipt`, `parseRecipeImage`
   are unaffected** — their signatures and behavior are unchanged.

8. **`npm run build` passes with zero errors.**

---

## Verification Steps

1. `npm run build` — confirm no type or import errors.

2. Via DevTools or local dev:
   a. Add 2–3 pantry items (e.g. `Olive Oil`, `Garlic`, `Onion`).
   b. Call `POST /api/ai/eat-this-now` → pick a suggestion → call
      `POST /api/ai/expand-suggestion` with its `name` + `description`.
   c. Open the saved recipe in RecipeModal.
   d. Assert: ingredients not in the pantry show `→ pantry sub: …` in amber.
   e. Assert: ingredients in the pantry show no amber annotation.
   f. Close the modal. Reload the page. Reopen the same recipe.
   g. Assert: substitute annotations still appear — confirming persistence.

3. Open an older saved recipe (pre-TASK-010) in RecipeModal → no amber
   annotations, no JS errors.

4. Confirm `eatThisNow` still works (separate code path — no regression expected).

---

## Known Risks / Open Questions

1. **Semantic matching quality:** The model determines pantry presence
   semantically. This is best-effort — an ingredient like `"2% Milk"` may or may
   not match a pantry item named `"Whole Milk"` depending on context. This is
   accepted behavior; the substitute field is advisory, not authoritative.

2. **Open question — substitute display placement (carry-forward from DRAFT-1):**
   Inline `→ pantry sub: name` on the same line. Alternative: indented sub-line
   below the ingredient. Inline is simpler and avoids layout change.
   Architect to confirm or redirect.

3. **`maxOutputTokens: 1500` adequacy:** Estimated additional output per recipe:
   ~10 ingredients × ~25 chars ≈ ~60 tokens. Sufficient headroom.

4. **Forward compatibility — TASK-009:** No interaction. Push notification logic
   operates on pantry expiry state, not recipe ingredients.

---

## Files Modified

- `server/services/aiService.js` — ~6 lines changed (prompt string extended with substitute instructions; ingredient JSON schema extended with `substitute` field)
- `client/src/components/recipes/RecipeModal.jsx` — ~5 lines changed (conditional inline annotation with `typeof` guard)

---

## PowerShell Merge Block

N/A — working directly on main.
