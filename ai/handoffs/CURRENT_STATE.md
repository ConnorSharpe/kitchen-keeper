# Task
TASK-014 complete. TASK-015 spec approved — ready for implementation.

# Current Status
TASK-014 (Groq migration) is fully implemented. Awaiting deploy + smoke tests (see Deploy Checklist).

TASK-015 spec has been through 2 rounds of GPT architect review and is **APPROVED** (9.3/10). Implementation may begin after deploy and after the TASK-016 gate check (verify Groq vision model is not deprecated before touching `parseReceipt`).

TASK-016 (Groq Vision Model Migration) is a prerequisite check — created as a spec stub only; see Known Risks.

# Files Modified (TASK-014 implementation)

New:
- `server/services/ai/groqProvider.js`
- `server/services/recipeSearchService.js`
- `server/db/migrations/0008_migrate_gemini_provider.sql`

Modified:
- `server/services/aiService.js`
- `server/services/ai/resolveProvider.js`
- `server/services/ai/anthropicProvider.js`
- `server/services/ai/geminiProvider.js`
- `server/routes/ai.js`
- `server/routes/household.js`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/ChatPage.jsx`
- `.env.example`
- `server/db/schema.js`
- `server/package.json`

# Files Required Next (TASK-015 implementation)

New:
- `server/data/foodkeeper.json` — pre-processed USDA FoodKeeper static asset
- `server/services/shelfLifeService.js` — lookup + normalization + telemetry

Modified:
- `server/services/pantryService.js` — add `enrichWithExpiry()` pure helper; inject into `create()` and `bulkCreate()`; remove `db.transaction()` wrapper from `bulkCreate()` (switch to best-effort)
- `server/services/aiService.js` — `parseReceipt` prompt/schema: add `classification` field

Read-only (do not modify):
- `server/utils/foodNormalization.js` — use `stripIngredientPrefix()` only; do NOT use `normalizeFood()` (wrong direction for FoodKeeper lookup)
- `server/utils/expiry.js` — UTC date utilities
- `server/services/ai/groqProvider.js` — read to understand parseReceipt call shape
- `server/db/schema.js` — confirm `expiryDate` column type

# Files Already Reviewed
- `server/services/pantryService.js` — `create()` is a single INSERT; `bulkCreate()` is currently transactional (must change to best-effort for TASK-015)
- `server/utils/foodNormalization.js` — `stripIngredientPrefix()` is useful; `normalizeFood()` collapses specificity and must NOT be used for FoodKeeper lookup
- `server/utils/expiry.js` — UTC-safe date arithmetic; use for `today + N days` computation
- `server/routes/pantry.js` — route shape unchanged; `POST /api/pantry` → `create()`, `POST /api/pantry/bulk` → `bulkCreate()`

# Dependency Chain

Editing (TASK-015):
- `server/data/foodkeeper.json`
- `server/services/shelfLifeService.js`
- `server/services/pantryService.js`
- `server/services/aiService.js`

Requires (read-only):
- `server/utils/foodNormalization.js`
- `server/utils/expiry.js`
- `server/services/ai/groqProvider.js`
- `server/db/schema.js`

Irrelevant (do not touch):
- `server/services/ai/groqProvider.js` (read only — modifications go in TASK-016)
- `server/services/recipeSearchService.js`
- `server/routes/ai.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `client/*`
- `server/db/migrations/*`

# Architecture Notes

## TASK-015 Key Decisions (architect-approved)

- **Shelf life source**: USDA FoodKeeper local JSON. Zero tokens. Committed as `server/data/foodkeeper.json` (pre-processed: names lowercased, shelf life values midpointed to single integers).
- **Lookup indexing**: Build `exactIndex` Map at module init for O(1) exact match; O(n) substring scan only on miss. Track `matchType: "exact"|"substring"` in return value.
- **Storage context**: First non-zero value in order: pantryDays → refrigeratorDays → freezerDays. No heuristics.
- **Receipt classification**: `classification: "produce"|"dairy"|"meat"|"packaged"|"beverage"|"non_food"|"uncertain"` field added to `parseReceipt` JSON schema. Only `non_food` is discarded. `uncertain` passes through.
- **Expiry enrichment**: Pure synchronous `enrichWithExpiry(item)` function. Runs before INSERT. Explicit `expiryDate` is never overridden.
- **bulkCreate transaction**: Remove `db.transaction()` wrapper → best-effort per-item inserts with per-item try/catch. One failed item does not roll back the rest.
- **Miss logging**: Telemetry only — log misses when query ≥ 3 chars, contains alpha, not a PLU/SKU. Threshold for alias table: >15–20% miss rate post-deploy.
- **`normalizeFood()` must NOT be used** for FoodKeeper lookup preprocessing — it collapses "chicken breast" → "chicken", reducing match quality.

## TASK-016 (stub — Groq Vision Model Migration)
- `llama-3.2-11b-vision-instruct` may be deprecated on Groq
- Pre-implementation gate for TASK-015: check [console.groq.com/docs/deprecations](https://console.groq.com/docs/deprecations)
- If deprecated: update model ID in `groqProvider.js`, re-run receipt vision benchmark (≥90%)
- Full spec TBD in `ai/tasks/TASK-016.md`

## TASK-014 Architecture (retained for context)
- Groq `llama-3.3-70b-versatile`: default chat + eatThisNow + expandSuggestion
- Groq `llama-3.2-11b-vision-instruct`: parseReceipt + parseRecipeImage (check deprecation before TASK-015)
- Spoonacular (primary) + TheMealDB (fallback): suggestRecipes — zero LLM tokens
- Gemini retained as quota-exhaustion fallback for eatThisNow/expandSuggestion only

# Remaining Work

## Immediate (deploy TASK-014)
1. ✅ Migration 0008 applied in Neon SQL Editor (2026-06-10)
2. ✅ GROQ_API_KEY + SPOONACULAR_API_KEY added to Vercel env + local .env (2026-06-10)
3. Deploy to Vercel (`vercel --prod`)
4. Run behavioral regression matrix B1–B8
5. Run receipt vision benchmark (≥90% accuracy across 10 receipts)
6. Complete TASK-013 smoke tests 3 & 4

## After deploy
7. TASK-016 gate check: verify Groq vision model deprecation status
8. Implement TASK-015 (spec at `ai/tasks/TASK-015.md`)

# Known Risks

- Llama 3.3 70b tool calling fidelity — system prompt tuning may be needed
- Spoonacular 150 points/day (~50 suggestRecipes calls) — TheMealDB fallback covers overflow
- 100K TPD ceiling — recipe API saves ~5K tokens/suggestRecipes call
- `llama-3.2-11b-vision-instruct` may be deprecated — TASK-016 gate check required before TASK-015 parseReceipt changes
- FoodKeeper abbreviation match rate unknown until post-deploy telemetry — null fallback acceptable for v1

# Verification Results

- `npm run build`: PASS (352 modules, clean)
- Grep (no Gemini outside geminiProvider.js): PASS
- Behavioral regression matrix B1–B8: PENDING (post-deploy)
- Receipt vision benchmark: PENDING (post-deploy)
- TASK-013 smoke test 1 (meal logging): ✅ PASS
- TASK-013 smoke test 2 (dietary profile): ✅ PASS
- TASK-013 smoke test 3 (recipe cards): ⏳ pending deploy
- TASK-013 smoke test 4 (save recipe): ⏳ pending deploy

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: deploy TASK-014 (checklist below), then TASK-016 gate check, then implement TASK-015

# PowerShell Merge Block
N/A — working directly on main.

# Deploy Checklist (run in this order)

```powershell
# 1. Migration 0008 — DONE (2026-06-10)
# 2. Vercel env vars — DONE (2026-06-10)

# 3. Deploy
vercel --prod

# 4. After deploy: run regression matrix B1–B8 and receipt vision benchmark
# 5. Check Groq deprecations page before starting TASK-015
```
