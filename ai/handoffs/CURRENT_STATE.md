# Task
TASK-024 — Recipe Photo Upload: Add Camera Trigger + User Review Step

# Current Status
SPEC COMPLETE. DRAFT-3 approved by architect (2 review rounds). Ready for implementation.

# Files Modified
- `ai/tasks/TASK-024-spec.md` — NEW: implementation-ready spec (DRAFT-3)
- `ai/handoffs/CURRENT_STATE.md` — this file

# Files Already Reviewed
- `client/src/components/recipes/RecipeUpload.jsx` — existing upload UI; calls `/api/ai/parse-recipe-image`; saves immediately (no review step); no camera trigger; no resize
- `client/src/components/recipes/RecipeModal.jsx` — confirmed view-only (175 lines static JSX, requires recipe.id); cannot be reused as edit form
- `server/routes/ai.js:138–189` — existing `POST /api/ai/parse-recipe-image`; has multer, Zod (`parsedRecipeSchema`), Vercel Blob upload, immediate save
- `server/services/aiService.js:336` — `parseRecipeImage()` uses `gpt-4o-mini` + base64; do not modify
- `server/utils/foodNormalization.js` — `normalizeFood`, `normalizeUnit`, `stripIngredientPrefix` available for reuse

# Architecture Notes

## What already exists (do not rewrite)
- Route: `POST /api/ai/parse-recipe-image` (ai.js:157) — keep path, auth, multer
- Zod schema: `parsedRecipeSchema` (ai.js:140) — extend only (fraction coercion + tag whitelist)
- AI extraction: `aiService.parseRecipeImage()` — untouched

## What changes
1. `RecipeUpload.jsx` — add `capture="environment"`, client-side canvas resize (≤1568px JPEG 85%), new review flow, AbortController, disable-during-upload guard
2. `RecipeReviewModal.jsx` — NEW: pre-save editable form (name, description, ingredients+rows, steps+rows, servings, prepMins, cookMins, tags)
3. `server/routes/ai.js` — patch `parsedRecipeSchema` (fraction coercion transform, tag whitelist), remove Vercel Blob upload, change response from `{ recipe: saved }` to `{ recipe: extracted }`, add server-side 40s timeout, expand HTTP error codes

## Key decisions made
- **RecipeReviewModal is a new component** (not mode="review" on RecipeModal) — justified by code inspection
- **Vercel Blob upload removed** from parse route in v1; uploaded recipes have `imageUrl: null`; image storage is a follow-up task
- **Single caller confirmed** — only RecipeUpload.jsx calls parse-recipe-image; response shape change is safe
- **Fraction coercion** — unrecognized formats (e.g. "2 to 3", "about 2") → `null` consistently, never throw
- **Timeouts** — client 45s AbortSignal, server `Promise.race` 40s timeout → 504

## Flow (after this task)
```
camera/file picker
  ↓
canvas resize (≤1568px, JPEG 85%, EXIF-corrected)
  ↓
POST /api/ai/parse-recipe-image  →  { recipe: extractedJson }
  ↓
RecipeReviewModal (user edits)
  ↓
POST /api/recipes (source: 'upload')
  ↓
recipe in list
```

# Remaining Work
- Implement TASK-024 per spec at `ai/tasks/TASK-024-spec.md`
- Before implementing tags whitelist: run `SELECT DISTINCT tags FROM recipes` to verify whitelist covers existing production values
- After implementation: manual device test on iOS PWA (camera trigger + EXIF rotation)
- TASK-017 Issue 3 — Switch to Clerk production keys (BLOCKED: requires custom domain)
- Members card with display names — deferred
- TASK-021 v2: fuzzy annotation (foodsMatch)
- TASK-022 v2: user-profile language preference
- RecipeModal pantry highlighting — deferred
- Image storage for uploaded recipes (Vercel Blob at save time) — deferred follow-up to TASK-024

# Known Risks
- `createImageBitmap` EXIF support requires Safari 15+ / iOS 15+; manual EXIF fallback required for older devices
- HEIC from clipboard/share-sheet may bypass browser JPEG conversion — detect and reject with user message
- `parse-recipe-image` response shape change is a breaking change to RecipeUpload.jsx — both must be updated atomically in same commit

# Forbidden Exploration
- `server/services/aiService.js` — do not modify extraction logic
- `server/services/recipeService.js` — CRUD unchanged
- `client/src/components/recipes/RecipeModal.jsx` — view-only, no changes
- `server/db/migrations/`
- `client/src/hooks/useSpeechInput.js`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
