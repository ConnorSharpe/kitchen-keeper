# Task
TASK-020 — Recipe Suggestion: Deduplication & Saved-First Priority

# Current Status
COMPLETE. Implementation verified by code review. Ready to push to main.

# Files Modified (TASK-020)

- `server/services/recipeSearchService.js` — added `sourceId` and `source` fields to `mapSpoonacular` and `mapTheMealDB`
- `server/services/aiService.js` — added prose-suppression rule to system prompt after `suggest_recipes` tool rule
- `server/routes/ai.js` — added `extractSuggestedRecipeKeys(history)` module-level helper; rewrote `suggest_recipes` handler as unified 11-step recommendation pipeline

# Architecture Notes

## Recommendation pipeline (suggest_recipes handler)
1. Extract `shownKeys` from chat history metadata (ID-first, name fallback for pre-TASK-020 rows)
2. Collect saved recipe candidates tagged `source: 'saved'`, `sourceId: String(r.id)`
3. Fetch API candidates from `aiService.suggestRecipes` (source/sourceId now on mapper output)
4. Merge into one pool
5. Deduplicate across full pool before scoring (ID-key `source:sourceId`, name fallback)
6. Filter previously-shown recipes via `shownKeys`
7+8. Score via `scoreCandidates()` — saved recipes below `overlapScore >= 0.25` OR `matchedIngredients < 1` are discarded; saved recipes that pass receive a `+0.2` effective score bonus
9. Sort via `applyStrategySort()` — existing strategy logic unchanged
10. Take top 5
11. Fallback: if history filter exhausted all candidates, re-run on pre-filter pool

## Tool result split
- `recipeSuggestions` (full objects) → metadata JSONB + `res.json()` to frontend — unchanged shape, cards render as before
- `slimForModel` (name + shortDescription + source only) → returned to model from tool — model cannot reproduce card detail it never received

## source field semantics
`source` on candidate objects means suggestion origin (`'saved'`, `'spoonacular'`, `'mealdb'`). This overwrites the DB `source` field on saved recipe rows (which tracks save method: `'agent_saved'`, `'upload'`, etc.) — the DB value is irrelevant for suggestions and not read by the frontend.

## Dedup key format
`${source}:${sourceId}` when both present; `name.toLowerCase().trim()` as fallback. Old history rows (pre-TASK-020, no sourceId) use name-based fallback gracefully.

# Dependency Chain

Editing:
- `server/routes/ai.js`
- `server/services/aiService.js`
- `server/services/recipeSearchService.js`

Requires (read-only, unchanged):
- `server/utils/recipeScorer.js`
- `server/services/recipeService.js`
- `server/services/chatService.js`
- `client/src/pages/ChatPage.jsx`

Irrelevant (do not open):
- `server/db/migrations/`
- `server/data/foodkeeper.json`
- `client/src/pages/DashboardPage.jsx`
- `ai/tasks/archive/`

# Decisions Made
- Slim tool result to model (name + shortDescription + source only); full objects to metadata/frontend
- Saved recipes participate in unified ranking with +0.2 bonus — not blindly prepended
- Overlap threshold for saved recipes: `overlapScore >= 0.25` AND `matchedIngredients.length >= 1`
- ID-based dedup (`source:sourceId`) with normalized-name fallback
- Dedup window: all 20 loaded history messages
- Cache in `recipeSearchService` unchanged — dedup happens post-cache
- Fallback returns highest-ranked from pre-history-filter pool, not empty list
- `source` string field (`'saved'`/`'spoonacular'`/`'mealdb'`) instead of `isSaved` boolean

# Remaining Work
- Manual verification on device: ask "what should I eat?" twice and confirm different suggestions on second ask
- Manual verification: confirm prose no longer duplicates recipe card content
- **TASK-017 Issue 3** — Switch to Clerk production keys — BLOCKED (requires custom domain)
- Members card with display names — deferred

# Known Risks
- Spoonacular/TheMealDB API pool is small for a given pantry fingerprint. After a few sessions, the fallback path will activate. This is expected and acceptable.
- Clerk dev keys warning in console until Issue 3 ops checklist is completed

# Forbidden Exploration
- `client/public/sw.js`
- `server/db/migrations/`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block

N/A — working directly on main.
