# Task
TASK-026 — Household Members Card with Display Names

# Current Status
SPEC APPROVED FOR IMPLEMENTATION. Not yet implemented — this is a handoff to the next agent to build it. Full spec at [ai/tasks/TASK-026-spec.md](../tasks/TASK-026-spec.md), DRAFT-3, went through two rounds of architect review (8.8/10 → 9.7/10, approved, no further design revision requested).

TASK-025 (previous task — Vercel Blob image storage for uploaded recipes) is DONE and fully smoke-tested; its details are preserved below for reference.

# Files Required Next (TASK-026 — not yet implemented)
Per [ai/tasks/TASK-026-spec.md](../tasks/TASK-026-spec.md) Allowed Files / Dependency Chain:
- `server/services/householdService.js` — rewrite `getMembers()` to merge the owner (`households.clerkUserId`) with `householdMembers` rows, resolve display names via one batched `clerkClient.users.getUserList()` call (deduplicated IDs, explicit `limit`, 5s `Promise.race` timeout), and degrade to fallback names ("Former owner"/"Former member") on any Clerk failure rather than throwing
- `client/src/pages/HouseholdPage.jsx` — add a new "Household members" `<section>` card: its own fetch/loading/error state (independent of the page's other sections), list rendering with role + `joinedAt`, "(You)" via `useAuth().user.id` comparison
- `server/routes/household.js` — **no change expected**; the existing `/members` route is already a thin passthrough, confirm during implementation it needs no edits

# Files Modified (TASK-025 — done, historical)
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
- `server/routes/household.js` — `GET /api/household/members` already exists, already auth'd via `clerkAuth`, already returns real `getMembers()` rows; simply unused by any client code today. No route changes needed for TASK-026.
- `server/middleware/clerkAuth.js` — only uses `getAuth(req)` (session-token verification) today; confirmed no conflict with the new `clerkClient.users.getUserList()` usage TASK-026 introduces.
- `client/src/context/AuthContext.jsx` — `useAuth().user.id` confirmed as the current-user Clerk ID for the client-side "(You)" comparison; its `fullName ?? firstName ?? username` fallback chain is the frontend precedent TASK-026's server-side `resolveDisplayName()` mirrors (backend `User` has no `fullName` getter, must be computed manually).
- `server/db/schema.js` — `households.clerkUserId` (owner, nullable), `householdMembers` (non-owner members, `clerkUserId` unique), `users` table confirmed dead/legacy (pre-Clerk, has `passwordHash`, not a name source). `joinedAt`/`createdAt` confirmed already ISO strings (`text().$defaultFn(() => new Date().toISOString())`) — no date normalization needed.
- `node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts` — confirmed `getUserList(params?: UserListParams): Promise<PaginatedResourceResponse<User[]>>` supports batched `userId: string[]` lookup in one call.
- `node_modules/@clerk/shared/dist/types/pagination.d.ts` — confirmed `ClerkPaginationRequest` has optional `limit`/`offset` with a platform-side default page size, which is why the spec passes `limit: ids.length` explicitly.
- `ai/tasks/TASK-017.md:432-449` — original deferral note: `getMembers()` was scoped to non-owner members only, and the UI card was explicitly deferred "until display names are available." TASK-026 is that follow-up.
- `client/src/components/recipes/RecipeModal.jsx` — view-only; already renders `recipe.imageUrl` (client/src/components/recipes/RecipeModal.jsx:41-43) — no changes needed for TASK-025 (historical)
- `server/services/aiService.js` — extraction logic untouched (historical)
- `server/utils/foodNormalization.js` — not needed in v1 (historical)

# Architecture Notes

## Flow (after TASK-024/TASK-025)
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
POST /api/recipes (source: 'upload', imageBase64 uploaded to Vercel Blob at save time)
  ↓
recipe in list, imageUrl populated
```

## Key decisions preserved (TASK-024/025, historical)
- Vercel Blob upload happens at save time, not parse time — canceling review costs nothing server-side
- `recipeService.create()` owns the full upload → insert → rollback lifecycle; route stays a one-line passthrough
- Single caller confirmed — response shape changes were safe

## TASK-026 design (spec approved, not yet implemented)
- **Clerk is an enrichment dependency, not a source of truth.** The member list (`clerkUserId`, `role`, `joinedAt`) originates entirely from Postgres; Clerk is only consulted to attach a human-readable `displayName`. If Clerk is unreachable, the endpoint still returns 200 with all rows present, using fallback names ("Former owner"/"Former member") — it never fails the whole request over a missing name. This was the central architectural fix from review round 1 (DRAFT-1 let a Clerk failure fail the entire endpoint).
- **One batched Clerk call per request, not N.** `clerkClient.users.getUserList({ userId: [...], limit: ids.length })` — deduplicated IDs, explicit `limit` (Clerk paginates by default), 5s `Promise.race` timeout mirroring the existing timeout idiom already used in `server/routes/ai.js:196-200`.
- **Ownership: `householdService.getMembers()` owns the full merge + resolve lifecycle** — DB query (owner + members) → dedupe → batched Clerk lookup (degrading gracefully on failure) → per-row `displayName` resolution. The route (`household.js`) stays a two-line passthrough, matching the thin-route/fat-service precedent set by TASK-025's `recipeService.create()`.
- **No caching.** Household sizes are tiny (2-5 people) and this endpoint only fires when the Household settings page loads — not a hot or polled path. Revisit only if that changes.
- Response shape is now a documented contract: `{ clerkUserId, role, joinedAt, displayName }` per row — `displayName` guaranteed non-empty going forward.
- Two rounds of architect review explicitly declined further abstraction (a shared `resolveDisplayName` utility, a dedicated `IdentityService` layer, a request-scoped identity cache, automated tests) as premature for a single-caller, single-call-site feature at this app's scale — reasoning recorded in the spec's Known Risks section.

# Smoke Test Results (2026-07-08, TASK-024/025 — historical)
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

TASK-026 has not been smoke-tested yet — it's not implemented. See spec's Acceptance Criteria for the manual verification scenarios to run once built (owner-only, null owner, deleted Clerk account, Clerk timeout/outage, duplicate IDs, genuine endpoint failure).

# Remaining Work
1. **[Ready to implement]** TASK-026 — Household members card with display names. Spec approved, DRAFT-3, [ai/tasks/TASK-026-spec.md](../tasks/TASK-026-spec.md). Not yet implemented. See "Files Required Next" above and "Recommended Next Action" below.
2. TASK-021 v2: fuzzy annotation (foodsMatch) — HOLD (2026-07-14): intentional v1 limitation, trigger condition is "users report false missing labels" ([TASK-021-spec.md:352](../tasks/TASK-021-spec.md)). User hasn't used the app seriously yet (testing only) and has not observed this. Revisit once there's real usage evidence.
3. TASK-022 v2: user-profile language preference — HOLD (2026-07-14): user only needs English right now, browser-locale detection (`navigator.language`) is sufficient. No API change needed later — hook already accepts a `lang` option ([TASK-022-spec.md:318](../tasks/TASK-022-spec.md)).
4. **[Backlog, unscoped]** iOS PWA has no way to upload an existing photo — `capture="environment"` on `RecipeUpload.jsx:229` forces the camera to open directly and suppresses iOS's Photo Library/Browse chooser. Current behavior (camera-direct) is acceptable for now per user decision (2026-07-14); fix is to add a second, separate "Choose from Library" input/button (no `capture` attribute) alongside the existing camera-direct one, rather than removing `capture` from the existing input. Blocks S7 (HEIC-from-file-picker) smoke test until addressed.
5. **[Backlog, unscoped]** AI extraction accuracy: during S2 iOS testing (2026-07-14), ingredient quantities/values came back wrong and some steps were skipped from the source recipe. Review modal allowed manual correction, so not a blocker for TASK-024, but worth a follow-up task against `server/services/aiService.js` (prompt tuning / model choice) — out of scope here per forbidden-exploration boundary.
6. **[Backlog, unscoped]** Migration history reconciliation is a workaround, not a real fix — see "Local Dev Environment Fixes" below. The 12 migration files (0001-0013) still lack `--> statement-breakpoint` markers and still aren't meant to run via the automated `migrate()` path (several contain manual-only warnings). A future task could properly regenerate these via `drizzle-kit` if the team wants automated migrations to actually work end-to-end, rather than the current "hand-apply in Neon SQL Editor + bookkeeping backfill" pattern.
7. **[Backlog, noted during TASK-026 spec review, not scoped]** No Clerk webhook sync — if a user deletes their Clerk account, their `householdMembers`/`households` row is never cleaned up (renders as "Former member"/"Former owner" per TASK-026's design instead of being removed). Would need a `user.deleted` webhook to actively fix; deferred as real new surface area, revisit only if the user cares about it later.

## Resolved
- ~~Verify tag whitelist covers all existing production tag values~~ — DONE (2026-07-14): production has 1 recipe total, tags = `[]`. No existing tag data to conflict with the whitelist.
- ~~TASK-017 Issue 3 — Switch to Clerk production keys~~ — WON'T DO (2026-07-14): user decided to stay on Clerk free tier / dev instance keys indefinitely. Not pursuing a custom domain. Revisit only if the user changes their mind.

# Local Dev Environment Fixes (TASK-025 session, historical — still in effect)
Getting `npm run dev` to actually boot locally against production data surfaced several pre-existing, unrelated issues, all fixed with explicit user approval at each step (touches production DB/Blob):

1. **`server/index.js` import-order bug (fixed).** `import './db/migrate.js'` ran before `app.js`'s `import 'dotenv/config'` — in ES modules, import declarations execute before inline statements regardless of source position, so `db/client.js`'s top-level `neon(process.env.DATABASE_URL)` always read `undefined` locally. Fixed by adding `server/loadEnv.js` (a dedicated module that calls `dotenv.config({ path: '.env.local' })`) and importing it first in `index.js`. This also means `server/.env.local` — not root `.env` — is now the authoritative source for local server secrets.
2. **Env var name mismatches (fixed, values added by user).** `OPENAI_API_KEY` (not `GEMINI_API_KEY`, which is unused dead config) and a plain `CLERK_PUBLISHABLE_KEY` (Clerk's SDK convention — separate from the Vite-prefixed `VITE_CLERK_PUBLISHABLE_KEY`, which only reaches the client bundle) were missing from `server/.env.local`. Both now present.
3. **Migration journal out of sync (reconciled).** `server/db/migrations/meta/_journal.json` only tracked `0000_init`, even though files 0001–0013 exist and production already has all of them applied (they were deliberately hand-run in Neon's SQL Editor per explicit comments in several files, e.g. `0001_households.sql:2`, `0008_migrate_gemini_provider.sql:6` — the neon-http driver can't run multi-statement SQL, and some migrations contain data-mutating `DO` blocks not safe to blindly re-run). Fix: added journal entries for all 14 migrations (didn't touch the .sql files themselves), then inserted one bookkeeping row into `drizzle.__drizzle_migrations` in production with a `created_at` high-water-mark covering all of them, so `migrate()` now correctly no-ops every run instead of trying to re-execute already-applied DDL/DML. See Remaining Work #6 for the follow-up this doesn't fully resolve.
4. **No Vercel Blob store existed for this project.** `BLOB_READ_WRITE_TOKEN` wasn't in prod env at all — TASK-025 is the first code that's ever actually called `put()`. User created one via `vercel blob create-store`, but the first attempt defaulted to **Private** access, which TASK-025's approved spec is incompatible with (`RecipeModal.jsx` does a plain `<img src={imageUrl}>`, no signed-URL logic — the spec's design explicitly assumes public URLs). Deleted and recreated as `--access public`. Working now.

# Known Risks
- `AbortSignal.any` (Chrome 124+ / Safari 17.4+) is feature-detected with fallback to controller.signal only; server 40s timeout covers the gap (TASK-024, historical)
- HEIC from share-sheet is rejected with a user message; HEIC from file picker (browser-converted) passes through as JPEG — correct behavior (TASK-024, historical)
- `createImageBitmap` EXIF support requires Safari 15+; manual EXIF fallback implemented for older devices (TASK-024, historical)
- See Remaining Work #6 — migration journal reconciliation is a bookkeeping workaround, not a proper fix
- TASK-026 (not yet implemented): deleted-Clerk-account and Clerk-outage cases will render identically ("Former member"/"Former owner") — accepted tradeoff, see spec Known Risks #5. Also no DB/Clerk consistency guarantee (Remaining Work #7 above) and a 5s Clerk lookup timeout that's a starting guess, not a tuned value (spec Known Risks #4).

# Verification Results
- TASK-025 (historical): `node --check` passed on `server/routes/recipes.js` and `server/services/recipeService.js`; `esbuild` bundle of `client/src/pages/RecipesPage.jsx` (JSX) completed with no errors
- TASK-025 (historical): **Full live smoke test run against production Neon DB + real public Vercel Blob store** — all acceptance criteria confirmed (create with image → real loadable Blob URL, malformed input → 400 not 500, no-image save still works, PATCH without imageBase64 still works, oversized image → 413, delete removes Blob, concurrent saves → distinct URLs). Full detail in git history (this file was condensed when TASK-026 became active).
- TASK-026: **not yet implemented, not yet verified.** See spec's Acceptance Criteria for the manual scenarios to run once built.

# Forbidden Exploration (TASK-026)
- `server/middleware/clerkAuth.js` — auth flow is unrelated; `getAuth()` and the new `clerkClient.users.getUserList()` usage are confirmed non-conflicting, don't touch the auth flow itself
- `server/db/schema.js` / `server/db/migrations/` — no schema change needed; both `clerkUserId` columns already exist
- `client/src/context/AuthContext.jsx` — read `useAuth().user.id` only, don't modify
- `server/routes/household.js` other routes (`/`, `/ai-key`, `/invite`, `/join`) — unrelated to this task
- `server/routes/ai.js`, `server/services/aiService.js`, `client/src/components/recipes/*` — unrelated, TASK-024/025 territory

# Recommended Next Action
Implement TASK-026 per [ai/tasks/TASK-026-spec.md](../tasks/TASK-026-spec.md) "Changes in Detail" (sections 1–3), in this order:
1. `server/services/householdService.js` — add `resolveDisplayName()` and `lookupClerkUsers()` helpers, rewrite `getMembers()` to merge owner + members, dedupe IDs, batch-resolve via Clerk with timeout/fallback, return the documented `{ clerkUserId, role, joinedAt, displayName }` shape
2. Confirm `server/routes/household.js`'s existing `/members` route needs no edits (should be a no-op check)
3. `client/src/pages/HouseholdPage.jsx` — add the members `<section>` card: independent fetch/loading/error state, list rendering, "(You)" comparison via `useAuth()`

Then work through the spec's Acceptance Criteria as a manual smoke-test pass against local dev, specifically forcing the two scenarios that won't come up naturally: a Clerk lookup timeout/failure (temporarily lower `CLERK_LOOKUP_TIMEOUT_MS` or point `CLERK_SECRET_KEY` at an invalid value) and a duplicate `clerkUserId` between owner and a member row (manual DB insert in local dev only).

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main.
