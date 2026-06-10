# Task
TASK-014 — Replace Gemini with Groq + Spoonacular (spec drafting in progress)

# Current Status
TASK-014 spec drafted, architect-reviewed internally, and gap-analysed (2026-06-10).
Spec is ready to send to GPT architect for external review.

TASK-013 smoke tests 3 & 4 are blocked by Gemini free tier quota exhaustion (20 RPD).
Root cause confirmed via Vercel logs: `429 Too Many Requests` on `gemini-2.5-flash`.
Decision made: do not fix Gemini quota — proceed directly to TASK-014 (Groq migration).
Smoke tests 3 & 4 will be completed after TASK-014 deploys.

Debug log added to `wrapAIError` this session (commit d0a9856) — can be removed after TASK-014.

# Files Modified This Session

- `ai/handoffs/CURRENT_STATE.md` — this file
- `ai/tasks/TASK-014.md` — NEW: full spec drafted + gap-analysed
- `server/services/aiService.js` — added `console.error` in `wrapAIError` to expose root cause (debug only; remove in TASK-014)

# Files Modified (TASK-013 session — preserved for reference)

- `server/services/aiService.js` — removed 2 debug logs; added `prepSteps` to Step 2 format prompt
- `server/routes/ai.js` — declared request-scoped `recipeSuggestions`; captured from `suggest_recipes`; returned in response
- `client/src/pages/ChatPage.jsx` — recipe cards with `savedRecipeNames` state, ingredient bold/normal, allergy/health notes

# Dependency Chain

```
Editing (TASK-014 — not yet implemented):
- server/services/aiService.js
- server/services/recipeSearchService.js        (new)
- server/services/ai/groqProvider.js            (new)
- server/services/ai/resolveProvider.js
- server/services/ai/anthropicProvider.js       (coupled with PANTRY_TOOLS format change)
- server/services/ai/geminiProvider.js          (delete)
- server/services/householdService.js           (comment update only)
- server/db/schema.js                           (comment update only)
- server/db/migrations/0008_migrate_gemini_provider.sql  (new)
- server/routes/ai.js                           (remove apiKey arg from suggestRecipes calls)
- server/routes/household.js                    (Zod enum: gemini → groq)
- client/src/pages/HouseholdPage.jsx            (dropdown + hardcoded strings)
- .env.example                                  (swap GEMINI_API_KEY → GROQ_API_KEY + SPOONACULAR_API_KEY)
- server/package.json                           (add groq-sdk, remove @google/generative-ai)

Deleting:
- server/services/ai/geminiProvider.js

Requires (read-only):
- server/services/ai/providerInterface.js

Irrelevant (unchanged):
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- client/public/sw.js
- server/db/migrations/0001-0007
```

# Architecture Notes

## Why Groq
Gemini 2.5 Flash free tier: 20 RPD, 10 RPM — confirmed exhausted during smoke testing.
Groq llama-3.3-70b-versatile free tier: 1,000 RPD, 30 RPM, 100K TPD.
50× more daily requests; real binding constraint is 100K TPD (~33 chat sessions/day).

## Why Spoonacular + TheMealDB for suggestRecipes
Current `suggestRecipes` burns ~5,000 Groq tokens per call (2 LLM calls via compound-beta).
Spoonacular returns structured recipe JSON directly — zero LLM tokens for recipe discovery.
Saves the full 100K TPD budget for chat sessions.
Spoonacular: 365K recipes, 150 free points/day, no credit card (sign up at spoonacular.com).
TheMealDB: ~300 meals, unlimited free, used as fallback when Spoonacular quota exhausted.

## Critical Coupled Change
`PANTRY_TOOLS` must convert from Gemini `functionDeclarations` format → OpenAI `tools` format.
`anthropicProvider.js` `_translateTools` currently reads `group.functionDeclarations` — will silently
return `[]` (no tools) for Anthropic BYOK users if not updated in the same phase.
Both changes must land together in Phase 3.

## BYOK After Migration
`resolveProvider` default: null → GroqProvider (env GROQ_API_KEY)
BYOK options: 'groq' | 'anthropic' (Gemini removed)
`household.js` Zod enum must change: `z.enum(['gemini','anthropic'])` → `z.enum(['groq','anthropic'])`
DB migration 0008: NULL out any rows where ai_provider = 'gemini' (apply in Neon SQL Editor)

# Decisions Made
- Gemini removed entirely — no partial retention for vision or any other function
- Groq llama-3.3-70b-versatile for chat + eatThisNow + expandSuggestion
- Groq llama-3.2-11b-vision-instruct for parseReceipt + parseRecipeImage
- Spoonacular (primary) + TheMealDB (fallback) for suggestRecipes — zero LLM tokens
- PANTRY_TOOLS converted to OpenAI format; AnthropicProvider updated in same phase
- suggestRecipes signature: remove apiKey param (recipe APIs don't need it)
- eatThisNow / expandSuggestion: retain apiKey param (thread Groq BYOK key)

# Remaining Work
1. **Send TASK-014.md to GPT architect for review** — spec is ready
2. Sign up for Spoonacular free API key (spoonacular.com, no credit card)
3. After architect approval: implement TASK-014
4. After TASK-014 deploys: complete smoke tests 3 & 4
5. Remove debug `console.error` in `wrapAIError` (added commit d0a9856 — folded into TASK-014 cleanup)

# Known Risks
- Llama 3.3 70b tool calling fidelity vs Gemini — system prompt may need tuning after migration
- Spoonacular 150 points/day (~50 suggestRecipes calls) — TheMealDB fallback covers overflow
- TheMealDB ~300 meal coverage gaps — graceful `[]` return already handled in UI
- 100K TPD ceiling — recipe API saves ~5K tokens/suggestRecipes call, extending headroom
- AnthropicProvider _translateTools break if PANTRY_TOOLS change lands without the provider fix

# Verification Results (TASK-013)
- `foodNormalization.test.js`: 48/48 PASS
- `purineIndex.test.js`: 10/10 PASS
- `npm run build`: PASS (clean, 352 modules)
- Smoke test 1 (meal logging): ✅ PASS
- Smoke test 2 (dietary profile): ✅ PASS (503 errors were Gemini quota, not code bugs)
- Smoke test 3 (recipe cards): ⏳ pending TASK-014 deploy
- Smoke test 4 (save recipe): ⏳ pending TASK-014 deploy

# Forbidden Exploration
- server/middleware/auth.js
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- server/services/pushService.js
- client/public/sw.js
- client/src/hooks/usePushNotifications.js
- ai/tasks/archive/

# Context Notes
- branch: main
- worktree: none
- context pressure: low
- next agent: read TASK-014.md in full before starting — spec is architect-reviewed and gap-analysed

# PowerShell Merge Block
N/A — working directly on main. Use commit block below.
