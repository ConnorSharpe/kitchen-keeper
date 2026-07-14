# Task
TASK-024 — Recipe Photo Upload: Add Camera Trigger + User Review Step

# Current Status
IMPLEMENTATION COMPLETE. Smoke tests S1–S12 run against production (kitchenkeeper.vercel.app). 9/12 pass; S2/S6/S7 pending iOS device. One bug found and fixed during testing (see below).

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

# Smoke Test Results (2026-07-08)
| Test | Status |
|------|--------|
| S1 File Picker | ✅ Pass |
| S2 iOS PWA Camera | ✅ Pass (2026-07-14) |
| S3 Review Modal Editing | ✅ Pass |
| S4 Save | ✅ Pass (bug fixed) |
| S5 Cancel | ✅ Pass |
| S6 HEIC Share Sheet | ⚪ N/A — iOS PWAs can't be Web Share Target |
| S7 HEIC File Picker | ⚪ Blocked — see backlog item below |
| S8 Slow Network | ✅ Pass |
| S9 Abort | ✅ Pass |
| S10 Image Resize | ✅ Pass |
| S11 Invalid File | ✅ Pass |
| S12 Regression | ✅ Pass |

**Bug fixed during testing:** `RecipesPage.jsx` line 157 — `api.post('/recipes', recipe)` → `api.post('/api/recipes', recipe)`. Missing `/api` prefix caused 405 on save.

# Remaining Work
1. **[Backlog, needs spec]** Image storage for uploaded recipes (Vercel Blob at save time) — deferred follow-up to TASK-024. Uploaded recipes currently save with `imageUrl: null`. Needs a TASK-XXX spec drafted and run through architect review before implementation (per [[feedback_spec_workflow]]). Prioritized to front of backlog (2026-07-14) per user request.
2. **[Backlog, needs spec]** Members card with display names — user confirmed (2026-07-14) this is wanted, not just deferred. Requires pulling in the Clerk backend SDK server-side to resolve `clerkUserId` → display name for rows returned by `householdService.getMembers()` ([TASK-017.md:432](../tasks/TASK-017.md)), then un-hiding the members `<section>` in `HouseholdPage.jsx`. Needs a TASK-XXX spec + architect review before implementation (new dependency, new external API calls).
3. TASK-021 v2: fuzzy annotation (foodsMatch) — HOLD (2026-07-14): intentional v1 limitation, trigger condition is "users report false missing labels" ([TASK-021-spec.md:352](../tasks/TASK-021-spec.md)). User hasn't used the app seriously yet (testing only) and has not observed this. Revisit once there's real usage evidence.
4. TASK-022 v2: user-profile language preference — HOLD (2026-07-14): user only needs English right now, browser-locale detection (`navigator.language`) is sufficient. No API change needed later — hook already accepts a `lang` option ([TASK-022-spec.md:318](../tasks/TASK-022-spec.md)).
5. **[Backlog, unscoped]** iOS PWA has no way to upload an existing photo — `capture="environment"` on `RecipeUpload.jsx:229` forces the camera to open directly and suppresses iOS's Photo Library/Browse chooser. Current behavior (camera-direct) is acceptable for now per user decision (2026-07-14); fix is to add a second, separate "Choose from Library" input/button (no `capture` attribute) alongside the existing camera-direct one, rather than removing `capture` from the existing input. Blocks S7 (HEIC-from-file-picker) smoke test until addressed.
6. **[Backlog, unscoped]** AI extraction accuracy: during S2 iOS testing (2026-07-14), ingredient quantities/values came back wrong and some steps were skipped from the source recipe. Review modal allowed manual correction, so not a blocker for TASK-024, but worth a follow-up task against `server/services/aiService.js` (prompt tuning / model choice) — out of scope here per forbidden-exploration boundary.

## Resolved
- ~~Verify tag whitelist covers all existing production tag values~~ — DONE (2026-07-14): production has 1 recipe total, tags = `[]`. No existing tag data to conflict with the whitelist.
- ~~TASK-017 Issue 3 — Switch to Clerk production keys~~ — WON'T DO (2026-07-14): user decided to stay on Clerk free tier / dev instance keys indefinitely. Not pursuing a custom domain. Revisit only if the user changes their mind.

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
