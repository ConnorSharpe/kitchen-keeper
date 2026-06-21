# Task
TASK-015 complete and committed. TASK-016 (model migration) researched — ready for spec + implementation decision.

# Current Status
TASK-015 (Shelf Life Estimation + Non-Food Receipt Filtering) is fully implemented and committed to main.

TASK-016 scope has been clarified through research:
- **Vision model (`llama-3.2-11b-vision-instruct`) is NOT deprecated** — safe to keep as-is.
- **Chat model (`llama-3.3-70b-versatile`) IS deprecated**, shutdown August 16, 2026.
- **Recommended migration**: promote Gemini 2.5 Flash to primary backbone (replaces Groq for chat/eatThisNow/expandSuggestion). GeminiProvider already fully implemented in codebase. No new dependencies.

# Files Modified (TASK-015 — committed)

New:
- `server/data/foodkeeper.json` — pre-processed USDA FoodKeeper static asset (~220 entries)
- `server/services/shelfLifeService.js` — lookup + normalization + telemetry miss logging

Modified:
- `server/services/pantryService.js` — `enrichWithExpiry()` pure helper; injected into `create()` and `bulkCreate()`; `db.transaction()` removed from `bulkCreate()` (best-effort per-item)
- `server/services/aiService.js` — `parseReceipt` prompt + `classification` field; `non_food` filter before return

# Files Required Next (TASK-016)

Modified:
- `server/services/aiService.js` — change default platform provider from Groq to Gemini for chat/eatThisNow/expandSuggestion; remove Groq→Gemini fallback chain (Gemini becomes primary, no fallback needed)
- `server/services/ai/resolveProvider.js` — update platform default resolution
- `server/services/ai/groqProvider.js` — demote to vision-only use; may need cleanup of GROQ_CHAT_MODEL references if no longer used as platform default

Read-only:
- `server/services/ai/geminiProvider.js` — confirm tool calling interface is complete for chat() use
- `server/routes/ai.js` — confirm how provider is resolved for each function

Do NOT touch:
- `server/services/ai/groqProvider.js` (keep GROQ_VISION_MODEL; only remove GROQ_CHAT_MODEL usage if no longer needed)
- `server/data/foodkeeper.json`
- `server/services/shelfLifeService.js`
- `client/*`
- `server/db/migrations/*`

# Files Already Reviewed
- `server/services/aiService.js` — GeminiProvider already handles eatThisNow + expandSuggestion via fallback; already has full chat() path via resolveProvider (BYOK). Promoting Gemini to default just changes resolveProvider output for platform key.
- `server/services/ai/groqProvider.js` — GROQ_VISION_MODEL (`llama-3.2-11b-vision-instruct`) not deprecated; GROQ_CHAT_MODEL (`llama-3.3-70b-versatile`) deprecated Aug 16.
- `server/utils/foodNormalization.js` — `stripIngredientPrefix()` used in shelfLifeService ✓
- `server/utils/expiry.js` — UTC date utilities ✓

# Dependency Chain

Editing (TASK-016):
- `server/services/aiService.js`
- `server/services/ai/resolveProvider.js`

Requires (read-only):
- `server/services/ai/geminiProvider.js`
- `server/services/ai/groqProvider.js`
- `server/routes/ai.js`

Irrelevant (do not touch):
- `server/data/foodkeeper.json`
- `server/services/shelfLifeService.js`
- `server/services/pantryService.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `client/*`
- `server/db/migrations/*`

# Architecture Notes

## TASK-016 Key Decisions (researched, pending spec approval)

### Model deprecation status (checked June 21, 2026)
- `llama-3.2-11b-vision-instruct` — **NOT deprecated** (the deprecated one was `llama-3.2-11b-vision-preview`, a different model ID)
- `llama-3.3-70b-versatile` — **DEPRECATED**, shutdown August 16, 2026. Affects free + developer tier. Enterprise unaffected.

### Recommended replacement (Groq's official)
- `openai/gpt-oss-120b` ($0.15/$0.60 per 1M tokens — paid)
- `qwen/qwen3.6-27b` ($0.60/$3.00 per 1M tokens — preview, not production-safe)

### Recommended replacement (project decision — pending Connor approval)
**Gemini 2.5 Flash as primary platform backbone** for all non-vision functions.

Rationale:
- **Already in codebase** — GeminiProvider implements the full AIProvider interface including tool calling. Currently used as fallback for eatThisNow/expandSuggestion. Already handles chat() for BYOK users.
- **Free tier**: 15 RPM / 1,500 RPD / 1M TPM — more than sufficient for a household app
- **Tool calling** ✓ — confirmed, used for chat() pantry operations
- **JSON mode** ✓ — confirmed, used for eatThisNow/expandSuggestion
- **Vision** ✓ — Gemini 2.5 Flash supports vision; could replace Groq vision in future if needed
- **No new dependencies** — Gemini SDK already installed
- **No new API key required** — GEMINI_API_KEY already in .env and Vercel

### Architecture change summary for TASK-016
- Gemini 2.5 Flash → primary for `chat()`, `eatThisNow()`, `expandSuggestion()` (platform key path)
- Groq `llama-3.2-11b-vision-instruct` → retained for `parseReceipt()` and `parseRecipeImage()` (vision only)
- Remove `withGroqFallback()` or repurpose: Gemini is now primary, no fallback chain needed for eatThisNow/expandSuggestion
- BYOK path unchanged — users can still bring their own Groq/Anthropic/Gemini key
- `geminiCallCount` / `GEMINI_RPD` / `GEMINI_WARN_AT` counters can be removed (no longer a backup pool)

### Alternative considered and rejected
- Cerebras gpt-oss-120b free tier: only 5 RPM (too tight), new provider integration required
- Mistral free tier: new integration required, rate limit details unclear for production
- OpenRouter gpt-oss-120b free: rate limits undisclosed, new integration required
- Paid Groq replacement: introduces ongoing cost for a free-tier household app

## TASK-015 Architecture (implemented)
- FoodKeeper offline JSON lookup — zero tokens, O(1) exact + O(n) substring
- `enrichWithExpiry()` pure sync helper in pantryService — explicit expiryDate never overridden
- `classification` field in parseReceipt — `non_food` discarded server-side, `uncertain` passes through
- `bulkCreate()` — best-effort per-item (transaction removed)

## TASK-014 Architecture (retained for context)
- Groq `llama-3.3-70b-versatile`: chat + eatThisNow + expandSuggestion — **being replaced by TASK-016**
- Groq `llama-3.2-11b-vision-instruct`: parseReceipt + parseRecipeImage — **retained**
- Spoonacular (primary) + TheMealDB (fallback): suggestRecipes — zero LLM tokens
- Gemini `gemini-2.5-flash`: quota-exhaustion fallback for eatThisNow/expandSuggestion — **being promoted to primary**

# Remaining Work

## Immediate (deploy TASK-015)
1. Deploy to Vercel (`vercel --prod`)
2. Run behavioral regression matrix B1–B8
3. Run receipt vision benchmark (≥90% accuracy, now includes classification field)
4. Complete TASK-013 smoke tests 3 & 4
5. Monitor `[shelfLifeService] miss` logs post-deploy for match rate

## TASK-016 (before August 16, 2026)
6. Connor + next dev: approve or adjust Gemini 2.5 Flash as primary backbone decision
7. Draft TASK-016 spec (`ai/tasks/TASK-016.md`)
8. Implement: promote Gemini to primary, remove fallback chain, retain Groq vision
9. Run full behavioral regression matrix with Gemini as primary
10. Test tool calling fidelity: chat() multi-step pantry operations
11. Deploy TASK-016 before August 16, 2026 (hard deadline)

# Known Risks

- **Hard deadline August 16, 2026** — `llama-3.3-70b-versatile` stops working for free/dev tier. TASK-016 must ship before this date.
- Gemini 2.5 Flash free tier is subject to Google policy changes without notice (precedent: Pro removed April 2026)
- Gemini tool calling fidelity vs Groq may differ — regression matrix required
- `geminiCallCount` counter is per-serverless-instance; already noted in codebase comments. With Gemini as primary this counter is removed, simplifying the architecture.
- FoodKeeper match rate unknown until post-deploy telemetry — null fallback acceptable for v1

# Verification Results

- `npm run build`: PASS (352 modules, clean) — pre-commit
- TASK-015 implementation: PASS (code review)
- Integration tests: PENDING (post-deploy)
- Receipt vision benchmark with classification field: PENDING (post-deploy)
- TASK-016 regression matrix: PENDING (post-implementation)

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: deploy TASK-015 → discuss TASK-016 spec with Connor → implement TASK-016 before Aug 16

# PowerShell Merge Block
N/A — working directly on main.
