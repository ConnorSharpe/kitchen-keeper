# Task

TASK-038 — Recipe Photo Picker Fix + Recipe URL Import. **Spec-only session — no application code changed.** Spec is fully drafted and has been through two rounds of architect review; it is marked **APPROVED FOR IMPLEMENTATION** at the top of [ai/tasks/TASK-038-spec.md](../tasks/TASK-038-spec.md) (DRAFT-3). Implementation has not started.

# Current Status

The spec covers two independent, separately-shippable parts:

- **Part A**: fixes the iPhone/Android recipe- and receipt-photo upload controls, which currently force straight to the camera (`capture="environment"` on a single file input) with no way to pick an existing photo from the library. Fix is two explicit buttons on mobile ("Take Photo" / "Choose from Library") behind two separate hidden inputs; desktop is unaffected.
- **Part B**: adds `POST /api/ai/parse-recipe-url` — import a recipe from a pasted URL. Three-tier extraction: schema.org JSON-LD first (free), a best-effort AI enrichment pass when JSON-LD is missing secondary metadata (servings/times/description/tags) but has usable ingredients/steps, then a full AI text-extraction fallback when no JSON-LD Recipe exists at all. Total failure opens the existing `RecipeReviewModal` with just a page-title guess, reusing 100% of existing manual-edit UI rather than building a new one.

Both parts, all code blocks (full file contents / diffs), the new `cheerio` dependency, the SSRF-hardened URL-fetch service, and a new unit-test file are fully specified — this is implementation-ready, not a rough plan. Architect review history (both rounds' adopted/declined items, with reasoning) is captured inline in the spec's own "Architect Review History" table — do not re-litigate those decisions without new information.

# Files Modified (this session)

Only `ai/tasks/TASK-038-spec.md` (created, then revised twice in place through two review rounds). Zero application code touched.

# Files Required Next (implementation)

Per the spec's own "Overall Allowed Files" section:

- New: `server/services/recipeUrlImportService.js`, `server/services/recipeUrlImportService.test.js`, `client/src/components/recipes/RecipeUrlImport.jsx`
- Modified: `client/src/components/recipes/RecipeUpload.jsx`, `client/src/components/pantry/ReceiptUpload.jsx`, `client/src/components/recipes/RecipeReviewModal.jsx`, `client/src/pages/RecipesPage.jsx`, `server/routes/ai.js`, `server/services/aiService.js`, `server/package.json` (add `cheerio` — run `npm install` after)

Forbidden files are listed explicitly in the spec's "Overall Forbidden Files" section (no schema/migration changes, no `resolveProvider`/BYOK changes, no chat-service changes, no rate-limit-middleware changes — the new route inherits `ai.js`'s existing router-wide `aiRateLimit` automatically).

# Files Already Reviewed

This session read (to ground the spec in actual current behavior, not assumptions): `client/src/components/recipes/RecipeUpload.jsx`, `client/src/components/pantry/ReceiptUpload.jsx`, `client/src/pages/RecipesPage.jsx`, `client/src/components/recipes/RecipeReviewModal.jsx`, `server/routes/ai.js`, `server/services/aiService.js` (imports + `parseRecipeImage`), `server/services/recipeSearchService.js` (fetch-with-timeout convention), `server/middleware/upload.js`, `server/middleware/validate.js`, `server/db/schema.js` (`recipes` table — confirmed `source`/`sourceUrl` columns already exist, no migration needed), `server/package.json`, root `package.json`.

# Dependency Chain

Implementing:
- `server/services/recipeUrlImportService.js` (new) — no dependency on any other new-this-task file
- `server/services/aiService.js` (`parseRecipeText`, `enrichRecipeFields`, `RECIPE_ENRICHABLE_FIELDS` export) — depends on nothing new; reuses existing `OpenAI`/`wrapAIError`/`safeParseJSON`/`AIProviderError` already imported there
- `server/routes/ai.js` (new route) — depends on both of the above, plus the existing `parsedRecipeSchema` already defined in that file (from `parse-recipe-image`)
- `client/src/components/recipes/RecipeUrlImport.jsx` (new) — depends on nothing else new
- `client/src/components/recipes/RecipeReviewModal.jsx`, `client/src/pages/RecipesPage.jsx` — wire the above together

Irrelevant (per spec's Overall Forbidden Files, do not touch): any migration file, `server/services/ai/resolveProvider.js`/`providerInterface.js`/`openaiProvider.js`, `server/services/chat/**`, `server/middleware/aiRateLimit*.js`, `server/services/platformSettingsService.js`, `ai/tasks/archive/`.

# Architecture Notes

- New dependency: `cheerio` (HTML/JSON-LD parsing) — not yet installed; add to `server/package.json` and run `npm install` as the first implementation step.
- The new route follows this codebase's existing "utility AI call" convention (direct `process.env.OPENAI_API_KEY`, not `resolveProvider`/BYOK) — matches its closest sibling, `parseRecipeImage`. This is a deliberate, spec'd decision (D-6), not an oversight to fix.
- SSRF guard (`recipeUrlImportService.js`) blocks a comprehensive, explicit list of IANA special-purpose IPv4 ranges plus the standard IPv6 special ranges, re-validated on every redirect hop. Two residual gaps are deliberately accepted and documented in the spec's Known Risks (DNS-rebinding TOCTOU, IPv4-mapped IPv6 addresses) — both judged acceptable given this endpoint's authenticated + rate-limited trust boundary. Do not silently "fix" these without re-reading that reasoning first.
- `recipes.source`/`recipes.source_url` columns already exist (used today by the web-suggestion save path) — this task reuses them via new `source`/`sourceUrl` props on `RecipeReviewModal`, no schema change.

# Decisions Made

All decisions (D-1 through D-22) are recorded directly in the spec, most with an explicit "why" and several documenting what was *declined* and why (e.g., no headless browser, no Redis caching, no `robots.txt` handling, no BYOK integration for this call). Do not re-derive these from scratch — read the spec's "Decisions" subsections (end of Part A, end of Part B) and its "Architect Review History" table first.

# Remaining Work

1. Implement Part A (photo picker fix) — small, self-contained, no server changes, good first slice.
2. Implement Part B (URL import) — `npm install` for `cheerio` first, then the new service file, the two `aiService.js` additions, the new route, then the client-side component + wiring.
3. Run the spec's own Verification Steps (18 steps, covering both parts, SSRF edge cases, the enrichment tier, streaming size cap, tag dedup, and regression checks on the existing photo-upload/receipt-scan flows) — not yet run, since no code has been written.
4. Run `npm test` (root), `npm run lint`, `npm run build` — not yet run this session.

# Known Risks

Carried forward from the spec (see its own "Known Risks" section for full reasoning, not repeated here): DNS-rebinding TOCTOU gap in the SSRF guard; IPv4-mapped IPv6 addresses not unwrapped for the SSRF check; AI enrichment/fallback tiers cost real (small, `gpt-4o-mini`) OpenAI tokens per non-fully-JSON-LD import, backstopped only by the existing app-wide rate limit; JS-only-rendered recipe sites will fail both extraction tiers and land on the manual-fallback path (no headless browser, by design); non-UTF-8 page encodings aren't decoded correctly (cosmetic, not data-loss, since the review modal is always the backstop).

Separately, still open from prior work (not part of this task, just still true): **OpenAI billing has not yet been switched to prepaid credits with auto-recharge off** — the one remaining item from TASK-037's Deployment Prerequisites, blocking `public_ai_access_enabled` from ever being safely flipped to `true` in production. Non-code, outside this repo.

# Verification Results

None — no implementation was done this session. The spec's Verification Steps section defines what "done" looks like for the next implementation session.

# Recommended Next Action

Implement TASK-038 per [ai/tasks/TASK-038-spec.md](../tasks/TASK-038-spec.md) (DRAFT-3, approved). Suggested order: Part A first (small, isolated, immediately testable in a mobile browser), then Part B (`npm install cheerio` → `recipeUrlImportService.js` + its test file → `aiService.js` additions → the new route → client-side component + `RecipesPage.jsx`/`RecipeReviewModal.jsx` wiring), then work through the spec's 18 Verification Steps in order.

# Forbidden Exploration

- `ai/tasks/archive/` — not relevant
- Everything listed under TASK-038-spec.md's own "Overall Forbidden Files" and "Out of Scope" sections — already explicitly scoped out by the spec itself (headless browser rendering, `robots.txt` handling, response caching, BYOK integration for this call, schema/migration changes), not gaps to fill in

# Context Notes

- branch: main
- worktree: none
- This was a spec-writing/review session only — no dev server was run, no code was written or tested. The next session should start by reading the spec in full before writing any code.
