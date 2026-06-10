# TASK-013 — Recipe Suggestion Cards in Chat

**Revision 2 — addresses architect review (2026-06-10)**

## Goal

When the AI calls the `suggest_recipes` tool, render structured recipe cards inline in the chat message thread. Cards display all ingredients (pantry misses in bold), any pre-cooking prep steps, a source link, and a Save button. Currently suggestions are returned as plain text only; the structured data never reaches the client.

---

## Background & Context

### Current flow
1. User asks "what should I cook?"
2. Chat model calls `suggest_recipes` tool
3. `suggest_recipes` handler calls `aiService.suggestRecipes()` — a two-step Gemini pipeline:
   - Step 1: Google Search grounding → raw recipe text
   - Step 2: Format model → structured JSON array
4. `recipeScorer.score()` annotates each candidate with `matchedIngredients` / `unmatchedIngredients`
5. Tool returns `{ ok: true, suggestions: [...], strategy }` to the chat model
6. Chat model writes a plain-text reply summarising the recipes
7. `/api/ai/chat` response: `{ reply, itemsAdded }` — suggestions are **discarded**
8. Client renders the reply as markdown — no recipe cards

### Existing pattern to follow
`itemsAdded` chips already render below assistant messages in `ChatPage.jsx` (lines 170–183). Recipe cards use the same slot.

### Prerequisites — must land before TASK-013
- `maxOutputTokens` raised from 3000 → 8000 on the Step 2 format model (fixes JSON truncation)
- Two debug `console.log` statements added during investigation **must be removed** in this task (see Change 1 below)

---

## Scope

### Allowed Files

- `server/services/aiService.js` — remove debug logs; add `prepSteps` field to Step 2 format prompt
- `server/routes/ai.js` — declare request-scoped `recipeSuggestions`; capture from tool handler; return in response
- `client/src/pages/ChatPage.jsx` — render recipe cards below assistant messages

### Forbidden Files

- `server/utils/recipeScorer.js` — scorer output is already correct; do not touch
- `server/services/householdService.js`
- `server/services/recipeService.js`
- `server/routes/recipes.js`
- `server/db/schema.js`
- `client/src/pages/HouseholdPage.jsx`
- Any migration files

---

## Detailed Changes

### 1. `server/services/aiService.js` — remove debug logs + add `prepSteps`

#### 1a. Remove debug logs

Two temporary diagnostic `console.log` statements must be removed:

```js
// DELETE this line (step 1 log, ~line 377):
console.log('[suggestRecipes] step1 rawText length:', rawText.length, '| preview:', rawText.slice(0, 300));

// DELETE this line (step 2 log, ~line 401):
console.log('[suggestRecipes] step2 formatText length:', formatText.length, '| preview:', formatText.slice(0, 300));
```

Also revert the intermediate variable introduced for step 2 logging back to the inline form, or keep it — either is fine as long as the log line is gone.

#### 1b. Add `prepSteps` to Step 2 format prompt

**Current Step 2 shape:**
```json
{
  "name": "string",
  "description": "string",
  "sourceUrl": "string|null",
  "ingredients": [{ "name": "string", "quantity": "number|null", "unit": "string|null" }],
  "steps": ["string"],
  "tags": ["string"],
  "prepMins": "number|null",
  "cookMins": "number|null",
  "servings": "number|null"
}
```

**New Step 2 shape — add `prepSteps`:**
```json
{
  "name": "string",
  "description": "string",
  "sourceUrl": "string|null",
  "ingredients": [{ "name": "string", "quantity": "number|null", "unit": "string|null" }],
  "prepSteps": ["string"],
  "steps": ["string"],
  "tags": ["string"],
  "prepMins": "number|null",
  "cookMins": "number|null",
  "servings": "number|null"
}
```

**`prepSteps` definition for the format prompt:**
> `prepSteps`: array of any steps that must be completed before active cooking begins — e.g. marinating, brining, bringing meat to room temperature, soaking, chilling dough, or blooming spices. Empty array `[]` if none. Do NOT duplicate these in `steps`.

**Token impact:** Small increase in Step 2 output only. Step 1 (search grounding) is unchanged.

---

### 2. `server/routes/ai.js` — request-scoped capture and return

#### Blocking fix: `recipeSuggestions` MUST be request-scoped

Declare `recipeSuggestions` **inside** the `router.post('/chat', ...)` handler, at the same level as `itemsAdded`. Never at module scope.

```js
router.post('/chat', validate(chatMessageSchema), async (req, res) => {
  // ...existing setup...

  const itemsAdded = [];           // already exists in aiService — see note below
  let recipeSuggestions = [];      // ADD: request-scoped, cannot leak across concurrent requests
```

> **Note on `itemsAdded` vs `recipeSuggestions`:** `itemsAdded` is declared and populated inside `aiService.chat()` and returned as part of its return value — the route just passes it through. `recipeSuggestions` cannot follow the same pattern because it originates from route-level tool handler closures that `aiService.chat()` has no visibility into. They are both request-scoped but wired differently — do not attempt to mirror the `itemsAdded` implementation.

#### Capture inside `suggest_recipes` tool handler

After computing `sorted`, capture before returning:

```js
recipeSuggestions = sorted.slice(0, 5);
return { ok: true, suggestions: recipeSuggestions, strategy: effectiveStrategy };
```

#### Update route response

```js
// Before:
res.json({ reply, itemsAdded });

// After:
res.json({ reply, itemsAdded, recipeSuggestions });
```

`recipeSuggestions` will be `[]` for all turns where `suggest_recipes` was not called.

**Shape of each item in `recipeSuggestions`:**
```ts
{
  name: string
  description: string
  sourceUrl: string | null
  ingredients: { name: string, quantity: number | null, unit: string | null }[]
  prepSteps: string[]              // empty array if none; never undefined
  steps: string[]
  tags: string[]
  prepMins: number | null
  cookMins: number | null
  servings: number | null
  overlapScore: number             // 0–1, from recipeScorer
  matchedIngredients: string[]     // ingredient names present in pantry
  unmatchedIngredients: string[]   // ingredient names NOT in pantry
  allergyNote: string | null       // e.g. "ALLERGY WARNING — contains peanuts"
  healthNote: string | null        // e.g. "contains one high-purine ingredient"
}
```

---

### 3. `client/src/pages/ChatPage.jsx` — recipe cards

#### 3a. Save button state

Add a `savedRecipeNames` state set to track which recipes have been saved in this session:

```js
const [savedRecipeNames, setSavedRecipeNames] = useState(new Set());
```

When Save is clicked:
```js
function handleSaveRecipe(recipeName) {
  setSavedRecipeNames((prev) => new Set([...prev, recipeName]));
  send(`save ${recipeName}`);
}
```

The button is disabled when `savedRecipeNames.has(recipe.name) || loading`.

> **Known limitation:** `savedRecipeNames` is updated optimistically before `send()` resolves. If the save fails (network error, AI failure), the button remains permanently disabled until the user refreshes. This is an accepted MVP trade-off — do not implement rollback logic. Document-facing error handling is already handled by the existing `toast.error` in `send()`'s catch block.

> **Duplicate behaviour (resolved):** `save_recipe` is NOT idempotent — clicking Save twice creates duplicate recipe entries. The `savedRecipeNames` set prevents this within a session. After a page refresh the set resets and the button re-enables; duplicate creation on refresh is a known limitation, deferred to a future task.

#### 3b. API response handling

```js
const { reply, itemsAdded, recipeSuggestions } = await api.post('/api/ai/chat', { message: userText });
setMessages((prev) => [
  ...prev,
  {
    key: nextTempId(),
    role: 'assistant',
    content: reply,
    itemsAdded: itemsAdded ?? [],
    recipeSuggestions: recipeSuggestions ?? [],
  },
]);
```

#### 3c. Card rendering

Render recipe cards below the assistant bubble in the same `ml-9` container as `itemsAdded` chips. Only render when `msg.recipeSuggestions?.length > 0`.

**Card layout:**

```
┌─────────────────────────────────────────────────┐
│ Recipe Name ↗ (link if sourceUrl)  [Save Recipe] │
│ Brief description                                │
│                                                  │
│ ⏱ 15 min prep · 30 min cook · 4 servings        │
│                                                  │
│ BEFORE YOU START (only if prepSteps non-empty)   │
│ • Marinate chicken for at least 1 hour           │
│ • Bring to room temperature 30 min before        │
│                                                  │
│ INGREDIENTS                                      │
│ • 1 item  Chicken Breast       ← in pantry       │
│ • 2 tbsp  Olive Oil            ← in pantry       │
│ • 1 tsp   Garlic Powder (bold) ← not in pantry  │
│ • 1       Lemon        (bold)  ← not in pantry  │
│                                                  │
│ ⚠ ALLERGY WARNING — contains X  (if set)        │
│ ℹ high-purine — moderate given gout  (if set)   │
└─────────────────────────────────────────────────┘
```

#### 3d. Ingredient rendering rules

Build a `Set` from `unmatchedIngredients` for O(1) lookup:

```js
const unmatchedSet = new Set(
  (recipe.unmatchedIngredients ?? []).map((n) => n.toLowerCase())
);
```

For each ingredient:
- `isMissing = unmatchedSet.has(ingredient.name.toLowerCase())`
- `isMissing === true` → render name in **bold**
- `isMissing === false` → render name at normal weight
- `unmatchedIngredients` takes precedence over `matchedIngredients` if the same name appears in both (scorer bug guard)
- Prefix with quantity + unit if present: `"2 tbsp Olive Oil"`

#### 3e. Defensive defaults

```js
const prepSteps = recipe.prepSteps ?? [];           // model may omit the field
const ingredients = recipe.ingredients ?? [];
const unmatchedIngredients = recipe.unmatchedIngredients ?? [];
```

Acceptance criteria must tolerate `prepSteps` being absent from the model response — treat as `[]`.

#### 3f. `sourceUrl` rendering

- If `recipe.sourceUrl` is non-null: render the recipe name as an `<a>` tag opening in a new tab (`target="_blank" rel="noopener noreferrer"`) with a small external link icon (↗ or equivalent)
- If `recipe.sourceUrl` is null: render the recipe name as plain text

#### 3g. Styling

- Cards sit in the `ml-9` left-offset container (same as `itemsAdded` chips)
- Per architect recommendation, use `w-full max-w-md sm:max-w-[75%]` — full width on mobile, bubble-width on desktop
- Card: `bg-white border border-gray-200 rounded-2xl px-4 py-3`
- Save button: `bg-orange-500 text-white` (disabled state: `opacity-50 cursor-not-allowed`)
- Allergy note: amber background or red text with ⚠ icon
- Health note: blue-grey text with ℹ icon
- "BEFORE YOU START" and "INGREDIENTS" section labels: small caps or `text-xs font-semibold text-gray-500 uppercase tracking-wide`

---

## Constraints

- Do not add a new component file — inline the card JSX in `ChatPage.jsx`
- Do not add new API routes
- Do not modify the DB schema
- `recipeSuggestions` MUST be declared inside the request handler — never at module scope
- `recipeSuggestions` is `[]` when `suggest_recipes` was not called — client must not crash if field is absent
- The Save button calls `send()` — `send()` already guards against submission while `loading` is true
- History messages loaded on mount will not have `recipeSuggestions` — `msg.recipeSuggestions ?? []` ensures no crash

---

## Acceptance Criteria

1. Asking "what should I cook?" returns 1–5 recipe cards inline below the assistant reply
2. Each card shows: name, description, time/servings metadata, ingredients, prep steps (if any), Save button
3. Ingredients not in the pantry are bold; pantry matches are normal weight
4. `unmatchedIngredients` takes precedence if an ingredient appears in both arrays
5. Prep steps section ("BEFORE YOU START") only appears when `prepSteps` is non-empty or non-absent
6. Recipe name is a link when `sourceUrl` is non-null; plain text when null
7. Allergy warnings render when `allergyNote` is non-null
8. Health notes render when `healthNote` is non-null
9. Clicking Save disables the button for that recipe and triggers the existing `save_recipe` tool flow
10. Saving the same recipe twice in one session is prevented by the disabled button state
11. Turns that do not call `suggest_recipes` render no recipe cards (no regression)
12. Page refresh loads history without crashing — no recipe cards on history messages
13. Build passes cleanly
14. Debug `console.log` lines removed from `aiService.js`

---

## Verification Steps

1. Add 2–3 pantry items (mix of items that will and won't match recipe ingredients)
2. Ask "what should I cook?" — verify 1–5 cards appear below the assistant reply
3. Confirm unmatched ingredients are bold, matched are normal weight
4. Confirm prep steps section appears for a recipe that includes marinating/resting (e.g. chicken)
5. If a card has a `sourceUrl`, confirm the recipe name is a clickable external link
6. Click Save on one card — confirm recipe appears in recipe book, button disables
7. Attempt to click Save again on the same card — button should remain disabled
8. Send an unrelated message ("how do I store leftovers?") — confirm no cards appear
9. Refresh the page — history loads without crashing, no recipe cards on history messages
10. Check Vercel function logs — confirm no `[suggestRecipes]` debug log lines

---

## Dependency Chain

```
Editing:
- server/services/aiService.js
- server/routes/ai.js
- client/src/pages/ChatPage.jsx

Requires (read-only):
- server/utils/recipeScorer.js    (scorer output shape — matchedIngredients/unmatchedIngredients)

Irrelevant:
- server/db/schema.js
- server/routes/recipes.js
- server/routes/shopping.js
- server/middleware/*
- client/src/pages/HouseholdPage.jsx
- client/public/sw.js
```

---

## Known Risks

1. **`prepSteps` model reliability** — the format model may inconsistently separate prep from cooking steps, or omit the field. Defensive default `?? []` handles the omission case. If content reliability is poor in testing, a client-side keyword fallback can be added post-launch.
2. **Long ingredient lists** — cards with 15+ ingredients will be tall. A collapse/expand toggle is deferred; acceptable for MVP.
3. **Duplicate recipes after refresh** — `savedRecipeNames` resets on page refresh, re-enabling Save. Creating a duplicate is the consequence. Deferred to a future task; `save_recipe` is explicitly NOT idempotent.
4. **`sourceUrl` trustworthiness** — URLs come from Google Search grounding. They are generally reliable but could be stale. No validation required for MVP.
