# Task
TASK-025 — Image Storage for Uploaded Recipes (Vercel Blob at Save Time)

# Current Status
DONE. TASK-025 implemented per spec and fully smoke-tested against real infrastructure (production Neon DB, real Vercel Blob store). All testable acceptance criteria pass. Getting a working local dev environment took most of this session's effort — see "Local Dev Environment Fixes" below, several genuine pre-existing bugs/gaps were found and fixed along the way, unrelated to TASK-025's actual code but required to verify it.

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
1. **[Backlog, needs spec]** Members card with display names — user confirmed (2026-07-14) this is wanted, not just deferred. Requires pulling in the Clerk backend SDK server-side to resolve `clerkUserId` → display name for rows returned by `householdService.getMembers()` ([TASK-017.md:432](../tasks/TASK-017.md)), then un-hiding the members `<section>` in `HouseholdPage.jsx`. Needs a TASK-XXX spec + architect review before implementation (new dependency, new external API calls).
2. TASK-021 v2: fuzzy annotation (foodsMatch) — HOLD (2026-07-14): intentional v1 limitation, trigger condition is "users report false missing labels" ([TASK-021-spec.md:352](../tasks/TASK-021-spec.md)). User hasn't used the app seriously yet (testing only) and has not observed this. Revisit once there's real usage evidence.
3. TASK-022 v2: user-profile language preference — HOLD (2026-07-14): user only needs English right now, browser-locale detection (`navigator.language`) is sufficient. No API change needed later — hook already accepts a `lang` option ([TASK-022-spec.md:318](../tasks/TASK-022-spec.md)).
4. **[Backlog, unscoped]** iOS PWA has no way to upload an existing photo — `capture="environment"` on `RecipeUpload.jsx:229` forces the camera to open directly and suppresses iOS's Photo Library/Browse chooser. Current behavior (camera-direct) is acceptable for now per user decision (2026-07-14); fix is to add a second, separate "Choose from Library" input/button (no `capture` attribute) alongside the existing camera-direct one, rather than removing `capture` from the existing input. Blocks S7 (HEIC-from-file-picker) smoke test until addressed.
5. **[Backlog, unscoped]** AI extraction accuracy: during S2 iOS testing (2026-07-14), ingredient quantities/values came back wrong and some steps were skipped from the source recipe. Review modal allowed manual correction, so not a blocker for TASK-024, but worth a follow-up task against `server/services/aiService.js` (prompt tuning / model choice) — out of scope here per forbidden-exploration boundary.
6. **[Backlog, unscoped]** Migration history reconciliation is a workaround, not a real fix — see "Local Dev Environment Fixes" below. The 12 migration files (0001-0013) still lack `--> statement-breakpoint` markers and still aren't meant to run via the automated `migrate()` path (several contain manual-only warnings). A future task could properly regenerate these via `drizzle-kit` if the team wants automated migrations to actually work end-to-end, rather than the current "hand-apply in Neon SQL Editor + bookkeeping backfill" pattern.

## Resolved
- ~~Verify tag whitelist covers all existing production tag values~~ — DONE (2026-07-14): production has 1 recipe total, tags = `[]`. No existing tag data to conflict with the whitelist.
- ~~TASK-017 Issue 3 — Switch to Clerk production keys~~ — WON'T DO (2026-07-14): user decided to stay on Clerk free tier / dev instance keys indefinitely. Not pursuing a custom domain. Revisit only if the user changes their mind.

# Local Dev Environment Fixes (this session)
Getting `npm run dev` to actually boot locally against production data surfaced several pre-existing, unrelated-to-TASK-025 issues. All fixed with explicit user approval at each step (touches production DB/Blob):

1. **`server/index.js` import-order bug (fixed).** `import './db/migrate.js'` ran before `app.js`'s `import 'dotenv/config'` — in ES modules, import declarations execute before inline statements regardless of source position, so `db/client.js`'s top-level `neon(process.env.DATABASE_URL)` always read `undefined` locally. Fixed by adding `server/loadEnv.js` (a dedicated module that calls `dotenv.config({ path: '.env.local' })`) and importing it first in `index.js`. This also means `server/.env.local` — not root `.env` — is now the authoritative source for local server secrets.
2. **Env var name mismatches (fixed, values added by user).** `OPENAI_API_KEY` (not `GEMINI_API_KEY`, which is unused dead config) and a plain `CLERK_PUBLISHABLE_KEY` (Clerk's SDK convention — separate from the Vite-prefixed `VITE_CLERK_PUBLISHABLE_KEY`, which only reaches the client bundle) were missing from `server/.env.local`. Both now present.
3. **Migration journal out of sync (reconciled).** `server/db/migrations/meta/_journal.json` only tracked `0000_init`, even though files 0001–0013 exist and production already has all of them applied (they were deliberately hand-run in Neon's SQL Editor per explicit comments in several files, e.g. `0001_households.sql:2`, `0008_migrate_gemini_provider.sql:6` — the neon-http driver can't run multi-statement SQL, and some migrations contain data-mutating `DO` blocks not safe to blindly re-run). Fix: added journal entries for all 14 migrations (didn't touch the .sql files themselves), then inserted one bookkeeping row into `drizzle.__drizzle_migrations` in production with a `created_at` high-water-mark covering all of them, so `migrate()` now correctly no-ops every run instead of trying to re-execute already-applied DDL/DML. See Remaining Work #6 for the follow-up this doesn't fully resolve.
4. **No Vercel Blob store existed for this project.** `BLOB_READ_WRITE_TOKEN` wasn't in prod env at all — TASK-025 is the first code that's ever actually called `put()`. User created one via `vercel blob create-store`, but the first attempt defaulted to **Private** access, which TASK-025's approved spec is incompatible with (`RecipeModal.jsx` does a plain `<img src={imageUrl}>`, no signed-URL logic — the spec's design explicitly assumes public URLs). Deleted and recreated as `--access public`. Working now.

# Known Risks
- `AbortSignal.any` (Chrome 124+ / Safari 17.4+) is feature-detected with fallback to controller.signal only; server 40s timeout covers the gap
- HEIC from share-sheet is rejected with a user message; HEIC from file picker (browser-converted) passes through as JPEG — correct behavior
- `createImageBitmap` EXIF support requires Safari 15+; manual EXIF fallback implemented for older devices
- See Remaining Work #6 — migration journal reconciliation is a bookkeeping workaround, not a proper fix

# Verification Results
- TASK-025: `node --check` passed on `server/routes/recipes.js` and `server/services/recipeService.js`; `esbuild` bundle of `client/src/pages/RecipesPage.jsx` (JSX) completed with no errors
- TASK-025: **Full live smoke test run against production Neon DB + real public Vercel Blob store** (via authenticated `fetch()` calls through the browser session, since this tool can't drive native OS file-picker dialogs):
  - ✅ Create with `imageBase64` → real `https://*.public.blob.vercel-storage.com/...` URL returned, confirmed independently loadable (200, `image/jpeg`, correct byte size)
  - ✅ Malformed `imageBase64` (`'not-a-data-url'`) → 400 (`{"error":"Invalid"}`), not 500
  - ✅ Web-suggested recipe with no image → still saves fine, `imageUrl: null` — regression check
  - ✅ `PATCH /api/recipes/:id` with no `imageBase64` field → still works (200) — regression check on `updateSchema.omit()`
  - ✅ Oversized image (3.5MB raw, server-side check) → 413 (`{"error":"Image too large"}`) — defense-in-depth confirmed
  - ✅ Delete → Blob actually removed (confirmed 404 with a cache-busting query param; a same-URL re-check without cache-busting briefly returned a stale CDN-cached 200, not a real bug)
  - ✅ Two concurrent saves with identical image data → distinct Blob URLs (`randomUUID()`-based paths, no collision)
  - Not independently tested: cancel-doesn't-upload (purely client-side — `reviewImage` is cleared and no POST fires; verified by code reading, not live-clicked) and the DB-insert-failure rollback path (would require deliberately breaking a constraint against production — skipped as unnecessary risk given the try/catch code matches the spec exactly)
- `recipeService.create` and `put`/`uuidv4`/`path` removed from parse-recipe-image route — confirmed no other uses (TASK-024, historical)
- All other `recipeService` calls in ai.js (ai_suggested, agent_saved) untouched (TASK-024, historical)

# Forbidden Exploration (TASK-025)
- `server/routes/ai.js` — parse-recipe-image route is finished, do not touch
- `server/services/aiService.js`
- `client/src/components/recipes/RecipeModal.jsx` — already handles `imageUrl`, view-only
- `server/db/migrations/` — no schema change needed
- `client/src/hooks/useSpeechInput.js`

# Recommended Next Action
TASK-025 is done. Local dev now works end-to-end (`npm run dev` from repo root, or the `server`/`client` configs in `.claude/launch.json`) — `server/.env.local` has all required vars, migrations no-op cleanly, and a real public Blob store is connected. Next up is whichever backlog item above the user wants to prioritize — none are blocking.

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
