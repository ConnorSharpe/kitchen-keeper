# Task
TASK-025 — Image Storage for Uploaded Recipes (Vercel Blob at Save Time)

# Current Status
IMPLEMENTED, verification blocked on local env. Code changes complete per [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md) DRAFT-2 (all 4 allowed files, exact code from spec's "Changes in Detail"). Syntax-checked (`node --check` on server files, `esbuild` bundle on client files) — no errors. Full manual smoke test (spec's Acceptance Criteria) NOT run — see Known Risks, local dev server can't start.

TASK-024 (previous task — camera trigger + review step) is DONE; its smoke test results are preserved below for reference.

# Files Modified (TASK-025 — implemented, not yet smoke-tested)
- `client/src/components/recipes/RecipeUpload.jsx` — `onExtracted(data.recipe, resized)` now passes the resized Blob up (1-line change)
- `client/src/pages/RecipesPage.jsx` — added `reviewImage` state, `blobToDataUrl()` helper, 3MB client-side size check with toast fallback, `imageBase64` included in save payload, cleared on save/cancel
- `server/routes/recipes.js` — `imageBase64` added to `createSchema` (regex-validated); `updateSchema = createSchema.omit({ imageBase64: true }).partial()` (spec Constraint 4)
- `server/services/recipeService.js` — new `uploadImage(dataUrl, householdId)` helper (regex validate → decode → size cap → `put()`); `create()` rewritten as sole owner of upload → insert → rollback (`del()` on insert failure)

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
1. **[Blocked on env]** TASK-025 — run the manual smoke-test pass against the spec's Acceptance Criteria (10 items, [ai/tasks/TASK-025-spec.md](../tasks/TASK-025-spec.md) "Acceptance Criteria"). Cannot run locally until `DATABASE_URL` is available to the server process — see Known Risks below.
2. **[Backlog, needs spec]** Members card with display names — user confirmed (2026-07-14) this is wanted, not just deferred. Requires pulling in the Clerk backend SDK server-side to resolve `clerkUserId` → display name for rows returned by `householdService.getMembers()` ([TASK-017.md:432](../tasks/TASK-017.md)), then un-hiding the members `<section>` in `HouseholdPage.jsx`. Needs a TASK-XXX spec + architect review before implementation (new dependency, new external API calls).
3. TASK-021 v2: fuzzy annotation (foodsMatch) — HOLD (2026-07-14): intentional v1 limitation, trigger condition is "users report false missing labels" ([TASK-021-spec.md:352](../tasks/TASK-021-spec.md)). User hasn't used the app seriously yet (testing only) and has not observed this. Revisit once there's real usage evidence.
4. TASK-022 v2: user-profile language preference — HOLD (2026-07-14): user only needs English right now, browser-locale detection (`navigator.language`) is sufficient. No API change needed later — hook already accepts a `lang` option ([TASK-022-spec.md:318](../tasks/TASK-022-spec.md)).
5. **[Backlog, unscoped]** iOS PWA has no way to upload an existing photo — `capture="environment"` on `RecipeUpload.jsx:229` forces the camera to open directly and suppresses iOS's Photo Library/Browse chooser. Current behavior (camera-direct) is acceptable for now per user decision (2026-07-14); fix is to add a second, separate "Choose from Library" input/button (no `capture` attribute) alongside the existing camera-direct one, rather than removing `capture` from the existing input. Blocks S7 (HEIC-from-file-picker) smoke test until addressed.
6. **[Backlog, unscoped]** AI extraction accuracy: during S2 iOS testing (2026-07-14), ingredient quantities/values came back wrong and some steps were skipped from the source recipe. Review modal allowed manual correction, so not a blocker for TASK-024, but worth a follow-up task against `server/services/aiService.js` (prompt tuning / model choice) — out of scope here per forbidden-exploration boundary.

## Resolved
- ~~Verify tag whitelist covers all existing production tag values~~ — DONE (2026-07-14): production has 1 recipe total, tags = `[]`. No existing tag data to conflict with the whitelist.
- ~~TASK-017 Issue 3 — Switch to Clerk production keys~~ — WON'T DO (2026-07-14): user decided to stay on Clerk free tier / dev instance keys indefinitely. Not pursuing a custom domain. Revisit only if the user changes their mind.

# Known Risks
- **NEW — local dev server cannot start.** `server/.env.local` has no `DATABASE_URL` (confirmed by grep — only `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ENCRYPTION_KEY`, `OWNER_CLERK_ID` are present). `server/db/client.js:6` calls `neon(process.env.DATABASE_URL)` and throws immediately on boot with no fallback. Tried both `.claude/launch.json`'s `server` config and a manual `DOTENV_CONFIG_PATH=.env.local node index.js` — same failure either way, so this isn't a launch-config issue, the value is just genuinely absent locally. TASK-025's implementation could not be smoke-tested end-to-end (real Blob upload + DB insert + rollback path) as a result. Next agent/user needs to supply `DATABASE_URL` (e.g. `vercel env pull` or copy from the Vercel dashboard) before the Acceptance Criteria checklist can be run.
- `AbortSignal.any` (Chrome 124+ / Safari 17.4+) is feature-detected with fallback to controller.signal only; server 40s timeout covers the gap
- HEIC from share-sheet is rejected with a user message; HEIC from file picker (browser-converted) passes through as JPEG — correct behavior
- `createImageBitmap` EXIF support requires Safari 15+; manual EXIF fallback implemented for older devices

# Verification Results
- TASK-025: `node --check` passed on `server/routes/recipes.js` and `server/services/recipeService.js`
- TASK-025: `esbuild` bundle of `client/src/pages/RecipesPage.jsx` (JSX) completed with no errors
- TASK-025: `err.status` convention confirmed consistent with `server/app.js:67` (`const status = err.status || 500`) and `express-async-errors` confirmed wired in `server/app.js` — so `uploadImage()`'s thrown 400/413 errors propagate correctly without try/catch in the route
- TASK-025: manual smoke test (spec Acceptance Criteria, 10 items) — **NOT RUN**, blocked by missing `DATABASE_URL` (see Known Risks)
- `recipeService.create` and `put`/`uuidv4`/`path` removed from parse-recipe-image route — confirmed no other uses (TASK-024, historical)
- All other `recipeService` calls in ai.js (ai_suggested, agent_saved) untouched (TASK-024, historical)

# Forbidden Exploration (TASK-025)
- `server/routes/ai.js` — parse-recipe-image route is finished, do not touch
- `server/services/aiService.js`
- `client/src/components/recipes/RecipeModal.jsx` — already handles `imageUrl`, view-only
- `server/db/migrations/` — no schema change needed
- `client/src/hooks/useSpeechInput.js`

# Recommended Next Action
1. Supply `DATABASE_URL` to `server/.env.local` (not committed by this session — no secrets were written).
2. Run the dev stack (`npm run dev` from repo root, or the `server`/`client` configs in `.claude/launch.json`).
3. Work through TASK-025's spec Acceptance Criteria as a manual smoke-test pass (mirrors TASK-024's format — see Smoke Test Results above), paying particular attention to: cancel-does-not-upload, oversized-image-toast-fallback, PATCH regression (no `imageBase64` field), malformed `imageBase64` → 400 not 500, and the DB-insert-failure rollback path.
4. Update this file's Smoke Test Results table with outcomes.

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
