# Task
TASK-021 + TASK-022 — COMPLETE

# Current Status
Both tasks implemented and merged to main. TASK-021 replaces binary unmatchedIngredients pattern with per-ingredient pantry status (green/red/partial). TASK-022 adds a mobile-only mic button backed by the Web Speech API.

# Next Implementation Targets

## TASK-021 — Pantry-Aware Ingredient Highlighting (spec: `ai/tasks/TASK-021-spec.md`)
Replace binary `unmatchedIngredients` pattern on AI recipe suggestion cards with per-ingredient
pantry status: green (have), red (missing), red + "(need to buy N unit)" (partial).

**Files to touch:**
- `server/routes/ai.js` — post-scoring annotation step (step 12); build `pantryMap` once, annotate DTO
- `client/src/pages/ChatPage.jsx` — replace `unmatchedSet` rendering with status-driven rendering

**Read-only dependencies:**
- `server/utils/foodNormalization.js` — import `normalizeFood`, `stripIngredientPrefix`, `normalizeUnit`
- `server/utils/recipeScorer.js` — do not modify, do not re-export from

**Key constraints:**
- Scorer output is immutable — annotation builds new DTOs
- `pantryMap` built once (O(1) lookup), not `find()` in a loop
- `needToBuy` only present when `pantryStatus === 'partial'` AND delta > 0; never null/0
- `no-speech`/`aborted` are silent; `try/catch` wraps annotation per ingredient
- Remove `unmatchedIngredients` from response and all frontend references

## TASK-022 — Voice-to-Text Input on Mobile (spec: `ai/tasks/TASK-022-spec.md`)
Add a mic button (mobile only) to the ChatPage input bar. Tapping records speech and appends
the transcript to the textarea for user review before sending.

**Files to touch:**
- `client/src/hooks/useSpeechInput.js` — new file; Web Speech API hook
- `client/src/pages/ChatPage.jsx` — add mic button, wire hook

**Key constraints:**
- No new npm dependencies; no backend changes
- `SpeechRecognition` instance created once in `useEffect`, stored in `useRef`
- Handlers explicitly nulled before `abort()` on cleanup/unmount
- `toggle()` is the single exposed action (not separate start/stop)
- `continuous: false`, `interimResults: false`
- iOS PWA caveat: disabled muted button + toast on tap (not inline text)
- `not-allowed`/`audio-capture` errors → `onError` callback → toast in ChatPage
- `no-speech`/`aborted` → silent reset only
- No `voiceTranscript` state in ChatPage — `onResult` writes directly to `setInput`

# Files Modified

## TASK-021
- `server/routes/ai.js` — expanded foodNormalization import; added pantryMap + annotation step after topN selection; dropped unmatchedIngredients from DTO
- `client/src/pages/ChatPage.jsx` — added formatQty; removed unmatchedSet; replaced ingredient rendering with status-driven green/red/partial

## TASK-022
- `client/src/hooks/useSpeechInput.js` — new file; Web Speech API hook
- `client/src/pages/ChatPage.jsx` — imported hook, wired onResult/onError, added mic button to input bar

# Files Required for TASK-021
- `server/routes/ai.js`
- `client/src/pages/ChatPage.jsx`
- `server/utils/foodNormalization.js` (read-only)
- `server/utils/recipeScorer.js` (read-only)

# Files Required for TASK-022
- `client/src/hooks/useSpeechInput.js` (new)
- `client/src/pages/ChatPage.jsx`

# Dependency Chain

## TASK-021
Editing:
- `server/routes/ai.js`
- `client/src/pages/ChatPage.jsx`

Requires (read-only):
- `server/utils/foodNormalization.js`
- `server/utils/recipeScorer.js`
- `server/services/pantryService.js` (already called in handler — no change needed)

Irrelevant:
- `server/db/migrations/`
- `server/data/foodkeeper.json`
- `client/src/components/recipes/RecipeCard.jsx`
- `client/src/components/recipes/RecipeModal.jsx`
- `ai/tasks/archive/`

## TASK-022
Editing:
- `client/src/hooks/useSpeechInput.js` (new)
- `client/src/pages/ChatPage.jsx`

Irrelevant:
- `server/` (entirely — no backend changes)
- `client/src/components/`
- `ai/tasks/archive/`

# Architecture Notes

## TASK-021 annotation contract
```
annotatePantryStatus(top5, pantryMap) → annotatedRecipeSuggestions
```
Inputs: scored top-5 recipe objects (read-only) + `Map<normalizedName, pantryItem>` built from `allItems`.
Output: new array of API DTOs with `pantryStatus` / `needToBuy` per ingredient; `unmatchedIngredients` absent.

Pantry quantity comparison rules (in order):
1. No pantry item → `missing`
2. `ing.quantity == null` → `have` (presence sufficient)
3. `pantryItem.quantity == null` → `have` (untracked = available)
4. Units mismatch after `normalizeUnit()` → `have` if `pantryItem.quantity > 0`, else `missing`
5. `pantryItem.quantity < ing.quantity` → `partial`, `needToBuy = delta`
6. Otherwise → `have`

## TASK-022 hook contract
```
useSpeechInput({ lang, onResult, onError }) → { supported, iosPwaCaveat, listening, toggle }
```
`supported` = `isTouch && !!SpeechRecognitionAPI && !isIosPwa`
`iosPwaCaveat` = iOS standalone PWA detected (show disabled button + toast)

# Decisions Made
- TASK-021 and TASK-022 can be implemented independently in either order
- TASK-021 uses `foodNormalization.js` directly (not via recipeScorer) as the normalization source of truth
- TASK-022 uses native Web Speech API — no library
- RecipeModal pantry highlighting deferred (no live pantry data available there)
- Unit conversion (oz↔cup etc.) deferred to v2

# Remaining Work
- TASK-017 Issue 3 — Switch to Clerk production keys (BLOCKED: requires custom domain)
- Members card with display names — deferred
- TASK-021 v2: fuzzy annotation (foodsMatch) to align with scorer's fuzzy match
- TASK-022 v2: use user-profile language preference instead of navigator.language
- RecipeModal pantry highlighting — deferred

# Known Risks
- Safari iOS SpeechRecognition reliability varies by device/locale — test on real device
- TASK-021 annotation uses exact name match only; scorer uses fuzzy fallback too — intentional v1 limitation (documented in spec)
- Spoonacular/TheMealDB pool exhaustion after several sessions (TASK-020 fallback handles this)

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
