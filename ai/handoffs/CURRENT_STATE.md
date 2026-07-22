# Task

TASK-038 — Recipe Photo Picker Fix + Recipe URL Import. **Implemented this session**, per [ai/tasks/TASK-038-spec.md](../tasks/TASK-038-spec.md) (DRAFT-3, approved). Both Part A and Part B are code-complete and automated verification passes.

# Current Status

Both parts implemented exactly per spec, verbatim code blocks used:

- **Part A**: `RecipeUpload.jsx` and `ReceiptUpload.jsx` now show two explicit buttons ("📷 Take Photo" / "🖼️ Choose from Library") behind two separate hidden file inputs on mobile; desktop dropzone unchanged.
- **Part B**: `POST /api/ai/parse-recipe-url` added — three-tier extraction (JSON-LD → best-effort AI enrichment → full AI text-extraction fallback), SSRF-hardened fetch service, wired into `RecipeReviewModal`/`RecipesPage` with a new "🔗 Import from URL" button and `url_import` source/filter option.

One deviation from the spec's literal code block: fixed a lint error (`no-useless-escape` on `\/` inside a character class in `parseIngredientLine`'s regex) — functionally identical, `eslint .` now passes clean.

# Files Modified (this session)

- `client/src/components/recipes/RecipeUpload.jsx` — two-button mobile picker
- `client/src/components/pantry/ReceiptUpload.jsx` — two-button mobile picker
- `client/src/components/recipes/RecipeReviewModal.jsx` — `source`/`sourceUrl` props, dynamic header subtitle
- `client/src/pages/RecipesPage.jsx` — new state/handlers/button/modal for URL import, filter dropdown option
- `server/routes/ai.js` — new `POST /api/ai/parse-recipe-url` route + import
- `server/services/aiService.js` — new `parseRecipeText`, `enrichRecipeFields`, exported `RECIPE_ENRICHABLE_FIELDS`
- `server/package.json` — added `cheerio` (`^1.2.0`, via `npm install --save`)

# Files Created (this session)

- `server/services/recipeUrlImportService.js` — SSRF guard, fetch-with-redirect-revalidation, JSON-LD extraction, page-text extraction
- `server/services/recipeUrlImportService.test.js` — 11 tests, all passing
- `client/src/components/recipes/RecipeUrlImport.jsx` — URL-paste modal

# Files Required Next

None for implementation — code is complete. Remaining work is verification only (see below).

# Files Already Reviewed

This session re-confirmed (before editing) that `RecipeUpload.jsx`, `ReceiptUpload.jsx`, `RecipeReviewModal.jsx`, `RecipesPage.jsx`, and `server/routes/ai.js` matched the spec's "Current Behavior" section exactly — no drift since the spec-writing session.

# Dependency Chain

No longer relevant — all planned files are now implemented. Any follow-up work should treat this as a normal codebase, not a scoped dependency chain.

# Architecture Notes

Carried forward from the spec, now reflected in code:
- New dependency `cheerio` installed and used only in `recipeUrlImportService.js`.
- The new route follows the existing "utility AI call" convention (direct `process.env.OPENAI_API_KEY`), not `resolveProvider`/BYOK — matches `parseRecipeImage`.
- `recipes.source`/`recipes.source_url` columns (pre-existing) are now also written by the URL-import and manual-fallback paths via `RecipeReviewModal`'s new props.

# Decisions Made

All D-1 through D-22 from the spec were implemented as specified — no new decisions this session. One micro-fix not in the spec: regex escape cleanup for lint (see Current Status).

# Remaining Work

1. **Manual verification** — the spec's 18 Verification Steps were not run this session. Automated ones (steps 9, 18) are confirmed passing (see below). The rest require either a real mobile device (steps 1, camera vs. picker behavior isn't reliable in devtools emulation) or a logged-in session against real recipe URLs (steps 3–7, 10–17) — this session could not log in (Clerk-gated, no credentials available/appropriate to enter).
2. Recommend the user runs through Verification Steps 1–8, 10–17 by hand against the running dev servers (left running at `http://localhost:5183` client / `:3001` server).

# Known Risks

Unchanged from the spec — DNS-rebinding TOCTOU gap, IPv4-mapped-IPv6 not unwrapped, AI-fallback token cost, JSON-LD quality variance, JS-only-rendered sites, non-UTF-8 encodings. All accepted/documented in the spec, nothing new introduced this session.

Separately, still open from prior work: **OpenAI billing has not yet been switched to prepaid credits with auto-recharge off** (carried from TASK-037, unrelated to this task).

# Verification Results

- `npm test` (root: shared tests + server `node --test`) — **82/82 pass**, including all 11 new `recipeUrlImportService.test.js` tests (covers spec Verification Step 9 in full).
- `npm run lint` (`eslint .`) — **pass** (after the one regex fix noted above).
- `npm run build` (`vite build`) — **pass**, no new warnings beyond the pre-existing chunk-size notice.
- Dev servers (`server` :3001, `client` :5183) started cleanly, zero console/server errors on initial load. UI could not be exercised past Clerk's sign-in screen without credentials.
- Spec Verification Steps 1–8, 10–17 — **not run** (require real device or logged-in manual testing per above).

# Recommended Next Action

Log into the running dev server (`http://localhost:5183`) and manually work through TASK-038-spec.md's Verification Steps 1–8 and 10–17 — particularly step 14 (confirm `source`/`sourceUrl` save correctly for all three paths: JSON-LD import, manual-fallback import, and existing image-upload with no regression) and step 16 (rate-limit inheritance). Step 1 (camera vs. library picker) needs a real iPhone/Android device, not devtools emulation.

# Forbidden Exploration

- `ai/tasks/archive/` — not relevant
- Everything under TASK-038-spec.md's "Overall Forbidden Files"/"Out of Scope" — unchanged, still not touched this session (confirmed no schema/migration files, no `resolveProvider`/BYOK, no chat-service, no rate-limit-middleware files were edited)

# Context Notes

- branch: main
- worktree: none
- Dev servers left running (server :3001, client :5183) for the user's manual verification pass — stop with the preview tooling or `Ctrl+C` when done.
- No commit made this session — implementation is uncommitted on `main`. User should review the diff and commit when satisfied with manual verification.
