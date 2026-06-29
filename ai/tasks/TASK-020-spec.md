# TASK-020 Spec — Recipe Suggestion: Deduplication & Saved-First Priority

**Status:** APPROVED WITH REVISIONS (architect score: 8.5/10)
**Last updated:** Post architect review + code verification pass

---

## Problem Statement

When the user asks "what should I eat?", two bugs occur:

1. **Duplicate display**: The agent suggests recipes both as plain prose text AND as UI recipe cards (rendered from `metadata.recipeSuggestions`). The user sees the full recipe details twice in the same response.

2. **Same recipes every time**: The agent suggests the same 2-3 recipes on every request. There is no mechanism to track what has already been shown, so the same pantry fingerprint always produces the same results. Saved recipes are never surfaced as suggestions even when they match the pantry.

---

## System Context

### How suggest_recipes currently works

1. User sends "what should I eat?" → model calls `suggest_recipes` tool
2. Route handler in `server/routes/ai.js` calls `aiService.suggestRecipes(allItems, expiringItems)`
3. `aiService.suggestRecipes` delegates to `recipeSearchService.findByPantry`
4. `findByPantry` queries Spoonacular (primary) or TheMealDB (fallback) with up to 5 pantry ingredient names
5. Results are cached in-process for 6 hours keyed by normalized ingredient names (**per-Vercel-instance only — not shared across instances**)
6. Candidates are scored by `recipeScorer.score()` (pantry overlap ratio using fuzzy matching) and `recipeScorer.annotateHealth()` (allergy/dietary flags)
7. Top 5 sorted results are returned to the model as the full tool result (including ingredients, steps, servings, etc.)
8. Model writes a prose summary of those recipes in its text reply
9. Route saves `recipeSuggestions` as JSONB metadata on the assistant chat message row
10. Frontend (`ChatPage.jsx`) renders recipe cards from that metadata alongside the model's text reply

### Relevant files

- `server/routes/ai.js` — `suggest_recipes` tool handler (lines ~393–438)
- `server/services/aiService.js` — system prompt, `chat()` function
- `server/services/recipeSearchService.js` — Spoonacular/TheMealDB fetch + 6h in-process cache; `mapSpoonacular` and `mapTheMealDB` mapper functions
- `server/utils/recipeScorer.js` — `score()` and `annotateHealth()`; uses fuzzy `foodsMatch()` internally
- `server/services/recipeService.js` — `getAll()` returns saved recipes with parsed `ingredients[]`
- `server/services/chatService.js` — `getHistory()` returns full rows including `metadata` JSONB column
- `client/src/pages/ChatPage.jsx` — renders recipe cards from `message.metadata.recipeSuggestions`

### Data shapes

**Chat history row** (from `chatService.getHistory`):
```js
{ id, householdId, role, content, metadata: { recipeSuggestions: [{ name, ... }] } | null, createdAt }
```

**Saved recipe row** (from `recipeService.getAll`, already parsed):
```js
{ id, householdId, name, description, ingredients: [{ name, quantity, unit }], steps, tags, ... }
```
The `id` here is a stable integer DB primary key — reliable for deduplication.

**API candidate (current shape from `recipeSearchService`)**:
```js
{ name, description, sourceUrl, ingredients, prepSteps, steps, tags, prepMins, cookMins, servings }
```
**No source ID is preserved.** `mapSpoonacular` uses `recipe.id` internally for detail lookup but does not include it in output. `mapTheMealDB` uses `stub.idMeal` internally but also drops it. Source IDs must be added to the mapper output to enable ID-based deduplication.

**`recipeScorer.score(recipe, pantryItems)`** accepts any object with `ingredients[].name`. Uses fuzzy `foodsMatch()` for matching — scores slightly above zero can be noise (e.g. "salt" matching an unrelated recipe). Returns `{ overlapScore, matchedIngredients, unmatchedIngredients }`.

---

## Goals

1. **Eliminate duplicate display**: Recipe details must not appear in both prose text and recipe cards.
2. **Saved recipes first**: When the user asks for suggestions, surface saved recipes that overlap with the current pantry before fetching from external APIs.
3. **No repeated suggestions**: Recipes already shown in recent chat history should not be suggested again until the suggestion pool is exhausted.

---

## Architectural Decisions (post review)

### Decision 1 — Prose suppression: tool result split, not prompt-only

**Architect finding:** Relying on a prompt instruction alone is too weak. The model receives full recipe objects and you're asking it to ignore most of the data. A prompt rule is the last line of defense, not the primary mechanism.

**Resolution:** The tool result returned to the model and the data saved in `metadata.recipeSuggestions` should be different objects.

- **Tool result (to model):** slim — `{ name, shortDescription, source }` only
- **Metadata (to DB/UI):** full — all fields needed for card rendering

The route already has both in scope (the handler builds `recipeSuggestions` before returning to the model). We split: build a slim array for the tool response, keep the full array for metadata. The prompt instruction remains as a secondary safeguard.

---

### Decision 2 — Unified recommendation pipeline, not ad hoc merging

**Architect finding:** Ad hoc `saved + api + dedup` in the handler will become spaghetti as future features add more candidate sources.

**Resolution:** Implement a single pipeline in the `suggest_recipes` handler (not a separate module yet — premature). Pipeline order:

```
1. Collect saved candidates (allRecipes, already in scope)
2. Collect API candidates (recipeSearchService.findByPantry)
3. Add `source` field to each candidate
4. Merge into one pool
5. Deduplicate (ID-first, normalized-name fallback) — before scoring
6. Filter recently suggested (extractSuggestedRecipeKeys(history))
7. Score each candidate (recipeScorer.score + annotateHealth)
8. Apply saved-source ranking bonus
9. Apply strategy sort (expiring_first / dietary_safe / pantry_overlap)
10. Take top 5
11. Fallback: if empty after filtering, return highest-ranked from full unfiltered pool
```

Dedup happens **before** scoring to avoid wasting compute on duplicates.

---

### Decision 3 — Saved recipes participate in unified ranking (no prepend)

**Architect finding:** Prepending saved recipes ignores score. A saved recipe at 2% overlap would outrank an API recipe at 95% overlap.

**Resolution:** Saved recipes enter the same candidate pool as API results. They receive a ranking bonus (e.g. `+0.2` added to `overlapScore`) to give them preference at roughly equal overlap, but they do not unconditionally win. Saved recipes are also subject to the same dedup and recently-shown filters — they should not dominate every recommendation session forever.

---

### Decision 4 — Overlap threshold: `overlapScore >= 0.25` AND `matchedIngredients.length >= 1`

**Architect finding:** `overlap > 0` is too loose. Suggested `>= 0.35` or "at least 2 matching ingredients."

**Code-specific nuance:** `recipeScorer.score()` uses fuzzy `foodsMatch()` which can produce very low scores from noise matches. A combined threshold is more principled than either metric alone:
- `overlapScore >= 0.25` (at least 25% of ingredients match)
- `matchedIngredients.length >= 1` (at least one real match — prevents scoring artifacts)

"At least 2 matching ingredients" as an absolute count is not recommended here because recipes with only 2–3 ingredients where 1 matches (e.g. 50% overlap) are genuinely good suggestions. The ratio handles this correctly.

This threshold applies when scoring saved recipes for inclusion. API candidates are always included in the pool regardless of score, then ranked by score.

---

### Decision 5 — ID-based deduplication with normalized-name fallback

**Architect finding:** Name-based dedup is fragile ("Chicken Alfredo" vs "Chicken Alfredo Pasta").

**Code-specific finding:** Source IDs are currently stripped in both `mapSpoonacular` and `mapTheMealDB`. Neither function includes `recipe.id` (Spoonacular) or `meal.idMeal` (TheMealDB) in its output.

**Resolution:** Add `sourceId` and `source` fields to both mapper functions in `recipeSearchService.js`:
```js
// mapSpoonacular:
sourceId: String(recipe.id),
source: 'spoonacular',

// mapTheMealDB:
sourceId: String(meal.idMeal),
source: 'mealdb',
```

Saved recipes use their integer DB `id` as the stable key.

Dedup key priority:
1. `source + sourceId` (for API candidates after mapper change)
2. Normalized name (`name.toLowerCase().trim()`) as fallback

---

### Decision 6 — `extractSuggestedRecipeKeys(history)` as a named helper

**Architect finding:** Scattering metadata parsing inside the route couples recommendation logic to chat storage internals.

**Resolution:** Extract a named helper function (inline in the route file, not a separate module yet):

```js
function extractSuggestedRecipeKeys(history) {
  // Returns a Set of dedup keys from previously shown suggestions
  const keys = new Set();
  for (const msg of history) {
    for (const s of msg.metadata?.recipeSuggestions ?? []) {
      if (s.source && s.sourceId) keys.add(`${s.source}:${s.sourceId}`);
      else if (s.name) keys.add(s.name.toLowerCase().trim());
    }
  }
  return keys;
}
```

This function reads history but owns the dedup key format. Future changes to how suggestions are stored do not leak into pipeline logic.

---

### Decision 7 — Cache stays as-is; dedup occurs after cache retrieval

**Architect finding:** Do not bypass the cache. Pipeline deduplication happens after the cached list is returned.

**Code-specific note:** The cache is process-scoped (`new Map()`), per-Vercel-instance, not shared. On multi-instance deployments users may see different cached results anyway. This is noted but does not change the recommendation — bypassing the cache is worse.

**Resolution:**
```
cached API results → merge → dedup → rank → return top N
```
If filtering leaves an empty list: fall back to the highest-ranked candidates from the full (pre-filter) pool, not random unfiltered results.

---

### Decision 8 — Dedup window: all loaded history (20 messages)

**Architect finding:** Use all loaded history, not an arbitrary shorter window. The history is already bounded to 20 messages; adding another window creates confusing edge cases.

**Resolution:** `extractSuggestedRecipeKeys(history)` reads all 20 loaded messages. No secondary window.

---

### Decision 9 — `source` field instead of `isSaved: boolean`

**Architect finding:** A `source` string scales better than a boolean. Future providers don't require more flags.

**Resolution:** Every candidate in the pipeline carries `source: 'saved' | 'spoonacular' | 'mealdb'`. This is the field saved in `metadata.recipeSuggestions` and used by the frontend (currently not rendered differently, but available for future UI treatment).

---

## Files Changed

| File | Change |
|------|--------|
| `server/routes/ai.js` | Rewrite `suggest_recipes` handler: unified pipeline, `extractSuggestedRecipeKeys` helper, slim tool result |
| `server/services/aiService.js` | System prompt: add secondary prose-suppression rule |
| `server/services/recipeSearchService.js` | Add `sourceId` and `source` fields to `mapSpoonacular` and `mapTheMealDB` |

No schema changes. No frontend changes. No new DB migrations.

---

## Acceptance Criteria

1. When the user asks "what should I eat?", the agent's text reply contains one brief sentence, not a full recipe breakdown with ingredients and steps.
2. Recipe cards still render in the UI with full data as before.
3. No recipe appears more than once in a single suggestion list (dedup across merged saved + API pool).
4. If the user has saved recipes with `overlapScore >= 0.25` and at least 1 matching ingredient, those appear in suggestions (ranked, not blindly prepended).
5. On a second "what should I eat?" in the same session, different recipes are suggested.
6. If no new recipes can be found after filtering, the fallback returns the highest-ranked candidates from the pre-filter pool — not an empty list.
7. Every returned recipe carries a `source` field (`'saved'`, `'spoonacular'`, or `'mealdb'`).
8. Ranking is deterministic for the same input — no random ordering.
9. No new DB migrations required.
10. No additional LLM API calls introduced.

---

## Open Questions (resolved)

| Question | Resolution |
|----------|------------|
| Prompt-only vs structural suppression | Split tool result (slim to model, full to metadata) |
| Saved-first vs ranking bonus | Ranking bonus (+0.2), not prepend |
| Overlap threshold | `overlapScore >= 0.25` AND `matchedIngredients.length >= 1` |
| ID vs name dedup | ID-first (`source:sourceId`); requires mapper changes in `recipeSearchService.js` |
| Dedup window | All 20 loaded history messages |
| Cache interaction | Keep cache; dedup after cache retrieval |
| Saved recipe dedup exemption | No exemption; bonus score handles preference without dominance |
| UI `isSaved` flag | Use `source` string field instead |
| Fallback behavior | Return highest-ranked from pre-filter pool |
| Pipeline location | Inline in route handler; extract `extractSuggestedRecipeKeys` helper |
