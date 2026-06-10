# Task
TASK-014 — Replace Gemini with Groq as Default AI Provider

# Current Status
TASK-014 spec is FULLY APPROVED after 5 rounds of GPT architect review (2026-06-10).
Implementation may begin. Read TASK-014.md in full before writing a single line of code.

One prerequisite before deploy: sign up for Spoonacular free API key at spoonacular.com (no credit card).

TASK-013 smoke tests 3 & 4 remain pending — blocked by Gemini quota exhaustion. Will be completed after TASK-014 deploys.

# Files Modified This Session (spec work only — no implementation yet)

- `ai/handoffs/CURRENT_STATE.md` — this file
- `ai/tasks/TASK-014.md` — full spec, 5 rounds of architect review, fully approved

# Files To Modify (TASK-014 implementation — not yet started)

```
New:
- server/services/recipeSearchService.js
- server/services/ai/groqProvider.js
- server/db/migrations/0008_migrate_gemini_provider.sql

Modify:
- server/services/aiService.js
- server/services/ai/resolveProvider.js
- server/services/ai/anthropicProvider.js     (update _translateTools — coupled with PANTRY_TOOLS change)
- server/services/ai/geminiProvider.js        (add _translateTools; keep as fallback — NOT deleted)
- server/services/householdService.js         (comment update only)
- server/db/schema.js                         (comment update only)
- server/routes/ai.js                         (remove apiKey arg from suggestRecipes; thread resolved provider)
- server/routes/household.js                  (Zod enum: gemini → groq)
- client/src/pages/HouseholdPage.jsx          (dropdown + hardcoded Gemini strings)
- client/src/pages/ChatPage.jsx               (warning banner for response.warning)
- .env.example                                (add GROQ_API_KEY + SPOONACULAR_API_KEY; keep GEMINI_API_KEY)
- server/package.json                         (add groq-sdk; keep @google/generative-ai)

Also remove:
- console.error debug log in wrapAIError (added commit d0a9856 — fold into TASK-014 cleanup)
```

# Dependency Chain

```
Editing:
- server/services/aiService.js
- server/services/recipeSearchService.js        (new)
- server/services/ai/groqProvider.js            (new)
- server/services/ai/resolveProvider.js
- server/services/ai/anthropicProvider.js       (update _translateTools)
- server/services/ai/geminiProvider.js          (add _translateTools; kept as fallback)
- server/services/householdService.js
- server/db/schema.js                           (comment update)
- server/db/migrations/0008_migrate_gemini_provider.sql  (new)
- server/routes/ai.js
- server/routes/household.js
- client/src/pages/HouseholdPage.jsx
- client/src/pages/ChatPage.jsx
- server/package.json

Requires (read-only):
- server/services/ai/providerInterface.js
- server/utils/foodNormalization.js             (import normalizeFood for cache key)

Irrelevant (do not touch):
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- server/middleware/auth.js
- server/services/pushService.js
- client/public/sw.js
- server/db/migrations/0001-0007
- ai/tasks/archive/
```

# Key Architecture Decisions (summary — read TASK-014.md for full detail)

- Groq llama-3.3-70b-versatile: default chat + eatThisNow + expandSuggestion
- Groq llama-3.2-11b-vision-instruct: parseReceipt + parseRecipeImage
- Spoonacular (primary) + TheMealDB (fallback): suggestRecipes — zero LLM tokens
- PANTRY_TOOLS converted from Gemini functionDeclarations → OpenAI tools format
- anthropicProvider._translateTools AND geminiProvider._translateTools both updated in same phase (coupled)
- Gemini retained as quota-exhaustion fallback for eatThisNow/expandSuggestion only (NOT chat)
- withGroqFallback receives resolved provider from route handler — prevents BYOK bypass
- classify429() uses error message content as primary signal; retry-after as heuristic only
- Recipe cache uses normalizeFood() for key normalization; only successful non-empty results cached
- Migration 0008 must run BEFORE deploy (see Phase 7 deployment checklist in spec)
- BYOK: groq | anthropic (gemini removed from UI and Zod enum)

# Critical Coupled Change — Do Not Split

PANTRY_TOOLS format change + anthropicProvider._translateTools update + geminiProvider._translateTools addition must land in the same commit (Phase 3). Splitting these silently breaks Anthropic BYOK tool calling.

# Pre-Implementation Checklist

1. Verify Groq Vision quota isolation: log into console.groq.com → Usage → confirm llama-3.2-11b-vision-instruct has a SEPARATE quota row from llama-3.3-70b-versatile. If shared, treat as blocker.
2. Sign up for Spoonacular API key (spoonacular.com, no credit card required).
3. Add GROQ_API_KEY and SPOONACULAR_API_KEY to Vercel environment variables before deploying.

# Remaining Work

1. Obtain Spoonacular API key
2. Implement TASK-014 (8 phases — see spec)
3. Apply migration 0008 in Neon SQL Editor BEFORE deploying
4. Run behavioral regression matrix (B1–B8) + receipt vision benchmark (≥90% accuracy)
5. After TASK-014 deploys: complete smoke tests 3 & 4

# Known Risks

- Llama 3.3 70b tool calling fidelity vs Gemini — system prompt may need tuning; regression matrix covers this
- Spoonacular 150 points/day (~50 suggestRecipes calls) — TheMealDB fallback covers overflow
- 100K TPD ceiling (~33 chat sessions/day) — recipe API saves ~5K tokens/call; BYOK resolves for heavy households
- PANTRY_TOOLS + both provider _translateTools changes are coupled — must land together

# Verification Results (TASK-013 — preserved)

- `foodNormalization.test.js`: 48/48 PASS
- `purineIndex.test.js`: 10/10 PASS
- `npm run build`: PASS (clean, 352 modules)
- Smoke test 1 (meal logging): ✅ PASS
- Smoke test 2 (dietary profile): ✅ PASS
- Smoke test 3 (recipe cards): ⏳ pending TASK-014 deploy
- Smoke test 4 (save recipe): ⏳ pending TASK-014 deploy

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: read TASK-014.md in full before starting — spec is fully approved across 5 architect review rounds

# PowerShell Merge Block
N/A — working directly on main.
