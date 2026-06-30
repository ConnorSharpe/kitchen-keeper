# Task
TASK-024 — Recipe Photo Upload: Add Camera Trigger + User Review Step

# Current Status
IMPLEMENTATION COMPLETE. All changes landed on main. Manual device test (iOS PWA camera trigger + EXIF rotation) still pending.

# Files Modified
- `client/src/components/recipes/RecipeUpload.jsx` — camera trigger, canvas resize, EXIF fallback, HEIC guard, AbortController, `onExtracted` prop
- `client/src/components/recipes/RecipeReviewModal.jsx` — NEW: editable pre-save review form
- `client/src/pages/RecipesPage.jsx` — wired `onExtracted` → `reviewRecipe` state → `RecipeReviewModal` → `POST /api/recipes`
- `server/routes/ai.js` — fraction coercion Zod schema, tag whitelist, removed Vercel Blob upload, changed response to `{ recipe: extracted }`, added 40s Promise.race timeout, 415 MIME check, removed `put`/`uuidv4`/`path` imports

# Files Already Reviewed
- `client/src/components/recipes/RecipeModal.jsx` — view-only; not modified
- `server/services/aiService.js` — extraction logic untouched
- `server/utils/foodNormalization.js` — not needed in v1

# Architecture Notes

## Flow (after TASK-024)
```
camera/file picker
  ↓
HEIC guard (reject share-sheet HEIC)
  ↓
canvas resize (≤1568px, JPEG 85%, EXIF-corrected)
  ↓
POST /api/ai/parse-recipe-image  →  { recipe: extractedJson }
  ↓
RecipeReviewModal (user edits name, ingredients, steps, tags, times)
  ↓
POST /api/recipes (source: 'upload')
  ↓
recipe in list
```

## Key decisions preserved
- Vercel Blob upload removed from parse route; `imageUrl: null` on uploaded recipes (follow-up task)
- `RecipeReviewModal` is a separate component from `RecipeModal` (justified by code inspection)
- Single caller confirmed — response shape change is safe

# Remaining Work
- Manual device test on iOS PWA (camera trigger, EXIF rotation on portrait photo)
- Verify tag whitelist covers all existing production tag values (`SELECT DISTINCT tags FROM recipes`)
- TASK-017 Issue 3 — Switch to Clerk production keys (BLOCKED: requires custom domain)
- Image storage for uploaded recipes (Vercel Blob at save time) — deferred follow-up to TASK-024
- Members card with display names — deferred
- TASK-021 v2: fuzzy annotation (foodsMatch)
- TASK-022 v2: user-profile language preference

# Known Risks
- `AbortSignal.any` (Chrome 124+ / Safari 17.4+) is feature-detected with fallback to controller.signal only; server 40s timeout covers the gap
- HEIC from share-sheet is rejected with a user message; HEIC from file picker (browser-converted) passes through as JPEG — correct behavior
- `createImageBitmap` EXIF support requires Safari 15+; manual EXIF fallback implemented for older devices

# Verification Results
- `recipeService.create` and `put`/`uuidv4`/`path` removed from parse-recipe-image route — confirmed no other uses
- All other `recipeService` calls in ai.js (ai_suggested, agent_saved) untouched

# Forbidden Exploration
- `server/services/aiService.js`
- `server/services/recipeService.js`
- `client/src/components/recipes/RecipeModal.jsx`
- `server/db/migrations/`
- `client/src/hooks/useSpeechInput.js`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
