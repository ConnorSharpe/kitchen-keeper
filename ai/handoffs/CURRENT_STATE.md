# Task
TASK-014 — Replace Gemini with Groq as Default AI Provider

# Current Status
TASK-014 implementation COMPLETE. All 8 phases implemented. `npm run build` passes (352 modules). Grep check passes — no direct Gemini SDK usage outside `geminiProvider.js`. Awaiting:
1. `GROQ_API_KEY` + `SPOONACULAR_API_KEY` added to Vercel environment variables
2. Migration 0008 applied in Neon SQL Editor (see PowerShell Merge Block)
3. Deploy
4. Behavioral regression matrix (B1–B8) + receipt vision benchmark (≥90%)
5. After deploy: complete TASK-013 smoke tests 3 & 4

# Files Modified (TASK-014 implementation)

New:
- `server/services/ai/groqProvider.js`
- `server/services/recipeSearchService.js`
- `server/db/migrations/0008_migrate_gemini_provider.sql`

Modified:
- `server/services/aiService.js` — full rewrite (Groq, recipe API, fallback logic, observability)
- `server/services/ai/resolveProvider.js` — groq default, 'gemini' BYOK removed
- `server/services/ai/anthropicProvider.js` — _translateTools reads OpenAI format
- `server/services/ai/geminiProvider.js` — _translateTools added; kept as fallback
- `server/routes/ai.js` — provider resolution, requestId, suggestRecipes apiKey removed
- `server/routes/household.js` — Zod enum: gemini → groq
- `client/src/pages/HouseholdPage.jsx` — dropdown + platform label updated
- `client/src/pages/ChatPage.jsx` — warning banner added
- `.env.example` — GROQ_API_KEY + SPOONACULAR_API_KEY added
- `server/db/schema.js` — comment updated
- `server/package.json` — groq-sdk added

# Dependency Chain

Editing: (all files above)

Requires (read-only):
- `server/services/ai/providerInterface.js`
- `server/utils/foodNormalization.js`

Irrelevant (do not touch):
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `server/routes/push.js`
- `server/middleware/auth.js`
- `client/public/sw.js`
- `server/db/migrations/0001-0007`

# Architecture Notes

- Groq `llama-3.3-70b-versatile`: default chat + eatThisNow + expandSuggestion
- Groq `llama-3.2-11b-vision-instruct`: parseReceipt + parseRecipeImage
- Spoonacular (primary) + TheMealDB (fallback): suggestRecipes — zero LLM tokens
- PANTRY_TOOLS now in OpenAI tools format — AnthropicProvider and GeminiProvider both translate
- Gemini retained as quota-exhaustion fallback for eatThisNow/expandSuggestion only
- `withGroqFallback` + `classify429` in aiService.js handle fallback routing
- `geminiCallCount` module-level counter (advisory only — Vercel instances don't share)
- Warning banner in ChatPage renders `response.warning` from chat endpoint

# Decisions Made

- All 9 spec decisions implemented as approved
- `withGroqFallback` is internal to `aiService.js` (not exported); route handlers pass `provider, isByok, requestId`
- `_eatThisNow` / `_expandSuggestion` private functions handle both Groq and Gemini code paths
- `recipeSearchService.findByPantry` never throws — returns [] on any failure

# Remaining Work

1. ✅ Migration 0008 applied in Neon SQL Editor (2026-06-10)
2. ✅ GROQ_API_KEY + SPOONACULAR_API_KEY added to Vercel environment variables and local .env (2026-06-10)
3. Deploy to Vercel
4. Run behavioral regression matrix B1–B8
5. Run receipt vision benchmark (≥90% accuracy across 10 receipts)
6. Complete TASK-013 smoke tests 3 & 4

# Known Risks

- Llama 3.3 70b tool calling fidelity — system prompt tuning may be needed
- Spoonacular 150 points/day (~50 suggestRecipes calls) — TheMealDB fallback covers overflow
- 100K TPD ceiling — recipe API saves ~5K tokens/suggestRecipes call
- PANTRY_TOOLS + both provider _translateTools changes are coupled — landed together ✓
- Gemini fallback counter is per-instance on Vercel serverless (advisory only)

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
- next agent: deploy checklist below, then regression matrix

# PowerShell Merge Block
N/A — working directly on main.

# Deploy Checklist (run in this order)

```powershell
# 1. Migration 0008 — DONE (2026-06-10)
# 2. Vercel env vars (GROQ_API_KEY, SPOONACULAR_API_KEY) — DONE (2026-06-10)

# 3. Deploy:
#    GROQ_API_KEY=<your key from console.groq.com>
#    SPOONACULAR_API_KEY=<your key from spoonacular.com>
#    Keep GEMINI_API_KEY (used by quota fallback)

# 3. Deploy
vercel --prod
```
