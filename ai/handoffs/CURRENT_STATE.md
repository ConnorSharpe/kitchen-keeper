# Task
TASK-025 — Image Storage for Uploaded Recipes (Vercel Blob at Save Time)

# Current Status
SPEC APPROVED FOR IMPLEMENTATION. Not yet implemented — this is a handoff to the next agent to build it. Full spec at [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md), DRAFT-2, went through one round of architect review (9.3/10 → both required revisions applied, no open questions remain).

TASK-024 (previous task — camera trigger + review step) is DONE; its smoke test results are preserved below for reference.

# Files Required Next (TASK-025 — not yet implemented)
Per [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md) Allowed Files / Dependency Chain:
- `client/src/components/recipes/RecipeUpload.jsx` — retain the resized `Blob` instead of discarding it; pass via `onExtracted(recipe, resized)`
- `client/src/pages/RecipesPage.jsx` — hold image `Blob` in state, base64-encode at save time, include in `POST /api/recipes` payload
- `server/routes/recipes.js` — add `imageBase64` to `createSchema`; `updateSchema` must use `.omit({ imageBase64: true })` before `.partial()` (see spec Constraint 4 — real bug if missed)
- `server/services/recipeService.js` — `create()` becomes the sole owner of upload → insert → rollback; add private `uploadImage(dataUrl, householdId)` helper next to the existing `del` import

# Files Modified (TASK-024 — done, historical)
- `client/src/components/recipes/RecipeUpload.jsx` — camera trigger, canvas resize, EXIF fallback, HEIC guard, AbortController, `onExtracted` prop
- `client/src/components/recipes/RecipeReviewModal.jsx` — NEW: editable pre-save review form
- `client/src/pages/RecipesPage.jsx` — wired `onExtracted` → `reviewRecipe` state → `RecipeReviewModal` → `POST /api/recipes`
- `server/routes/ai.js` — fraction coercion Zod schema, tag whitelist, removed Vercel Blob upload, changed response to `{ recipe: extracted }`, added 40s Promise.race timeout, 415 MIME check, removed `put`/`uuidv4`/`path` imports

# Files Already Reviewed
- `client/src/components/recipes/RecipeModal.jsx` — view-only; already renders `recipe.imageUrl` (client/src/components/recipes/RecipeModal.jsx:41-43) — no changes needed for TASK-025
- `server/services/aiService.js` — extraction logic untouched
- `server/utils/foodNormalization.js` — not needed in v1
- `server/db/schema.js:56` — `recipes.imageUrl` column already exists with a comment anticipating this exact feature; no migration needed
- `server/services/recipeService.js:80-84` — `remove()` already deletes the Blob on recipe delete (`del(existing.imageUrl)`); TASK-025 is the first thing that will actually feed it a real URL
- `git show 0c56b07 -- server/routes/ai.js` — pre-TASK-024 code that did this exact upload inline; reference for the `put()` call shape only, not reusable as-is (uploaded before user review, which is the problem TASK-025's design avoids)

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

## TASK-025 design (spec approved, not yet implemented)
- **Technique: base64-in-JSON, not multipart.** Reuses existing `api.post()` / `validate(createSchema)` pipeline; zero new client API methods or server middleware. Full rationale (incl. Vercel's 4.5MB serverless body limit) in the spec's "Decision" section.
- **Upload timing: at save time, not at parse time.** The resized `Blob` already produced by TASK-024's `resizeImage()` is threaded through review state and only base64-encoded + uploaded when the user clicks Save. Canceling review costs nothing server-side.
- **Ownership: `recipeService.create()` owns the full lifecycle** — decode/validate → `put()` → `db.insert()` → `del()` rollback on insert failure. The route (`recipes.js`) stays a one-line passthrough; `imageBase64` is invisible to it. (This came out of architect review round 1 — the first draft had the route orchestrating storage, which was flagged as a real encapsulation issue.)
- **Size cap: 3MB raw**, enforced client-side (fail fast, skip image but still save recipe) and server-side (413, defense in depth).
- Thumbnail preview in `RecipeReviewModal` was deliberately cut to a follow-up — not needed for persistence, keeps this task single-purpose.

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
1. **[Ready to implement]** TASK-025 — Image storage for uploaded recipes (Vercel Blob at save time). Spec approved, DRAFT-2, [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md). Not yet implemented. See "Files Required Next" above and "Recommended Next Action" below.
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

# Forbidden Exploration (TASK-025)
- `server/routes/ai.js` — parse-recipe-image route is finished, do not touch
- `server/services/aiService.js`
- `client/src/components/recipes/RecipeModal.jsx` — already handles `imageUrl`, view-only
- `server/db/migrations/` — no schema change needed
- `client/src/hooks/useSpeechInput.js`

Note: `server/services/recipeService.js` was forbidden under TASK-024 but is now an **Allowed** file for TASK-025 (that's where most of the new logic lives).

# Recommended Next Action
Implement TASK-025 per [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md) "Changes in Detail" (sections 1–4), in this order:
1. `RecipeUpload.jsx` — pass the resized `Blob` up via `onExtracted`
2. `RecipesPage.jsx` — hold `reviewImage` state, encode to base64 at save, clear on save/cancel
3. `server/services/recipeService.js` — `uploadImage()` helper + rewritten `create()` with rollback
4. `server/routes/recipes.js` — schema field + `updateSchema.omit()` fix

Then work through the spec's Acceptance Criteria as a manual smoke-test pass (mirrors TASK-024's smoke-test approach — see Smoke Test Results above for the format used last time).

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
