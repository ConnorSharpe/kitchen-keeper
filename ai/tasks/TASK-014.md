# TASK-014 — Replace Gemini with Groq as Default AI Provider

**Status:** Draft — Pending Architect Review  
**Author:** Claude Sonnet 4.6  
**Date:** 2026-06-10  
**Supersedes:** N/A  
**Related:** TASK-012 (BYOK), TASK-013 (recipe suggestion cards)

---

## Goal

Replace the Google Gemini SDK entirely with Groq as the default AI provider for Kitchen Keeper. Groq's free tier offers 50× more daily requests (1,000 RPD vs 20 RPD) and 3× more RPM (30 vs 10), which makes the app viable for real household use without requiring users to supply their own API key. BYOK support (Groq and Anthropic) is retained and extended to include Groq keys.

---

## Rate Limit Justification

| Metric | Gemini 2.5 Flash (current) | Groq llama-3.3-70b-versatile |
|--------|---------------------------|------------------------------|
| RPM | 10 | 30 |
| **RPD** | **20** | **1,000** |
| TPM | 250,000 | 12,000 |
| TPD | — | 100,000 |

**Critical caveat on TPD:** At ~3,000 tokens per chat turn (system prompt ≈ 1,000 tokens + context + tool calls), the 100K TPD cap is the real binding constraint — approximately 33 full chat sessions per day before the token ceiling is hit. This is still vastly better than 20 RPD, but the architect should weigh whether prompt compression is warranted to stretch the token budget further.

**Token savings from recipe API:** `suggestRecipes` previously consumed ~5,000 Groq tokens per invocation (two LLM calls). Replacing it with Spoonacular + TheMealDB API calls consumes **zero Groq tokens** for recipe discovery, meaningfully extending the 100K TPD budget for chat sessions.

---

## Chain of Thought: Architecture Decisions

### Decision 1 — PANTRY_TOOLS format migration

**Current state:** `PANTRY_TOOLS` in `aiService.js` is defined in Gemini's `functionDeclarations` format:
```js
[{ functionDeclarations: [{ name, description, parameters }] }]
```

**Options:**
- A. `GroqProvider` translates Gemini format → OpenAI format internally
- B. Redefine `PANTRY_TOOLS` in OpenAI format; `GeminiProvider` is deleted

**Decision: B.** Since Gemini is being removed entirely, keeping the Gemini format serves no purpose and would leave dead translation code. Redefine `PANTRY_TOOLS` in OpenAI `tools` format:
```js
[{ type: "function", function: { name, description, parameters } }]
```

**CONFIRMED BREAKING CHANGE — `anthropicProvider.js` must be updated.** The `_translateTools` function currently reads Gemini format:
```js
// Current (reads Gemini functionDeclarations)
function _translateTools(geminiTools) {
  return geminiTools.flatMap((group) =>
    (group.functionDeclarations || []).map((fn) => ({ ... }))
  );
}
```
After `PANTRY_TOOLS` is converted to OpenAI format, `group.functionDeclarations` will be `undefined` and `_translateTools` will return `[]` — silently sending no tools to Anthropic, breaking tool calling for all BYOK Anthropic users. This must be fixed in the same phase:
```js
// Updated (reads OpenAI tools format)
function _translateTools(openAiTools) {
  return openAiTools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}
```

---

### Decision 2 — Recipe discovery for suggestRecipes

**Current state:** Step 1 uses Gemini Google Search grounding to discover recipes from the web — two LLM calls, ~5,000 tokens per invocation. This is expensive against the 100K TPD budget and fragile (web content is unstructured).

**Options:**
- A. Groq `compound-beta` — built-in Tavily-powered web search; preview model; still consumes ~5,000 tokens/call
- B. **Spoonacular API (primary) + TheMealDB (fallback)** — structured recipe database; returns clean JSON directly; zero LLM tokens for discovery
- C. Tavily API + Groq formatting — extra API key; still token-expensive

**Decision: B.** Purpose-built recipe APIs return structured data that maps directly to the Kitchen Keeper recipe schema, eliminating the need for an LLM at the discovery step entirely. This is architecturally superior: more reliable, faster, and consumes zero Groq tokens.

**Spoonacular** (primary): 365,000+ recipes, multi-ingredient ranked search, 150 free points/day, no credit card required when signing up at spoonacular.com directly. Each `suggestRecipes` invocation costs approximately 2–3 points (1 search call + up to 3 detail lookups).

**TheMealDB** (fallback): ~300 meals, completely unlimited and free, single-ingredient filter only. Used when Spoonacular quota is exhausted or returns zero results.

**New suggestRecipes flow (zero LLM tokens):**
1. Extract ingredient names from expiring pantry items
2. Call Spoonacular `GET /recipes/findByIngredients?ingredients=...&number=5&ranking=2` → ranked recipe list
3. For each top result, call `GET /recipes/{id}/information` → full recipe detail
4. Map Spoonacular response directly to KK recipe schema (no LLM needed)
5. On Spoonacular quota exhaustion (429) or zero results: fall back to TheMealDB `/filter.php?i={ingredient}` + `/lookup.php?i={id}`
6. Return `[]` if both sources fail (same graceful degradation as before)

**Schema mapping — Spoonacular → KK:**
```
title                           → name
summary (strip HTML)            → description
sourceUrl                       → sourceUrl
extendedIngredients[].original  → ingredients (parsed)
analyzedInstructions[0].steps   → steps
preparationMinutes              → prepMins
readyInMinutes - prepMins       → cookMins
servings                        → servings
dishTypes                       → tags
```

**Schema mapping — TheMealDB → KK:**
```
strMeal                         → name
strInstructions (split lines)   → steps
strIngredient1..20 + strMeasure1..20 → ingredients
strCategory + strArea           → tags
prepMins / cookMins / servings  → null (not provided)
```

**New file:** `server/services/recipeSearchService.js` — encapsulates all Spoonacular and TheMealDB HTTP calls, schema mapping, and fallback logic. Keeps `aiService.js` clean; `suggestRecipes` delegates entirely to this service.

**`apiKey` parameter removal:** The `suggestRecipes(allItems, expiringItems, apiKey)` signature currently threads the household Groq BYOK key for the LLM call. Since recipe discovery no longer uses an LLM, the `apiKey` parameter is removed. The route handler in `ai.js` must stop passing it.

---

### Decision 3 — Vision functions (parseReceipt, parseRecipeImage)

**Current state:** Both functions use `model.generateContent([{ inlineData: { data, mimeType } }, promptText])` — Gemini multimodal. Groq's primary chat models (`llama-3.3-70b-versatile`) are text-only.

**Options:**
- A. Use Groq `llama-3.2-11b-vision-instruct` or `llama-3.2-90b-vision-instruct` for vision calls
- B. Keep Gemini SDK exclusively for vision functions (partial migration)
- C. Remove vision features pending a clean multimodal solution

**Architect decision required.** 

Arguments for A: completes the full Gemini removal; Llama 3.2 Vision is available on Groq free tier; API is OpenAI-compatible so the `GroqProvider` can instantiate a vision model variant.

Arguments for B: pragmatic; vision is a secondary feature; avoids testing two Groq model families in one task; Gemini's vision quality on receipts is well-validated.

Arguments for C: simplest; vision features are rarely used; can be TASK-015.

**Recommendation: A** — use `llama-3.2-11b-vision-instruct` for `parseReceipt` and `parseRecipeImage`. Same Groq SDK, same API key, different model string. Free tier limits for this model are separate from the chat model limits.

---

### Decision 4 — DB migration for existing aiProvider rows

**Current state:** The `households.aiProvider` column stores `'gemini' | 'anthropic' | null`. Any household that previously selected Gemini as their BYOK provider will have `aiProvider = 'gemini'` in the DB. After this task, `resolveProvider('gemini', key)` will have no handler.

**Decision:** Write a migration (`0008_migrate_gemini_provider.sql`) that NULLs out any rows where `aiProvider = 'gemini'`:
```sql
UPDATE households SET ai_provider = NULL, ai_api_key = NULL WHERE ai_provider = 'gemini';
```
This is safe because: (1) the app used GEMINI_API_KEY env var as the default, so most rows are already NULL; (2) any stored Gemini BYOK keys become invalid after removal; (3) NULL → resolves to Groq default, which is the correct fallback.

**Apply manually in Neon SQL Editor** (same procedure as migrations 0005–0007).

---

### Decision 5 — BYOK provider options

**Current state:** UI offers three options: "Platform default (Gemini)", "Gemini (my key)", "Anthropic Claude". The Zod schema in `household.js` enforces `z.enum(['gemini', 'anthropic'])`. `schema.js` uses a plain string column (not an enum — confirmed). `householdService.js` has no provider validation (validation is route-layer only).

**Changes required:**

`server/routes/household.js` — update Zod enum:
```js
// Before
provider: z.enum(['gemini', 'anthropic']).nullable(),
// After
provider: z.enum(['groq', 'anthropic']).nullable(),
```

`client/src/pages/HouseholdPage.jsx` — three string changes:
1. `<option value="platform">Platform default (Gemini)</option>` → `Platform default (Groq)`
2. Remove `<option value="gemini">Gemini (my key)</option>` entirely
3. Hardcoded informational text referencing "Gemini" (line ~190) → update to "Groq"

`server/db/schema.js` — update comment only:
```js
// Before: aiProvider: text('ai_provider'),   // nullable: 'gemini' | 'anthropic'
// After:  aiProvider: text('ai_provider'),   // nullable: 'groq' | 'anthropic'
```

No migration needed for the column type — it is already a plain text column.

---

### Decision 7 — `eatThisNow` and `expandSuggestion` BYOK key threading

**Current state:** Both functions accept `apiKey` and instantiate `new GoogleGenerativeAI(apiKey)` when a key is present. This correctly uses a household's BYOK key for these calls.

**After migration:** Both functions will use the Groq SDK instead. The `apiKey` parameter is **retained** — when a household has a Groq BYOK key, it should be passed to the Groq client for these calls, not the env default. The pattern changes from:
```js
const client = apiKey ? new GoogleGenerativeAI(apiKey) : genAI;
```
to:
```js
const groq = new Groq({ apiKey: apiKey ?? process.env.GROQ_API_KEY });
```
All four call sites in `ai.js` (lines 37, 54, 86 — note: `parseReceipt` doesn't take apiKey, 150) must be audited. `parseReceipt` and `parseRecipeImage` currently do NOT accept `apiKey` — this is acceptable since vision is a secondary feature and free-tier Groq vision limits are per-model.

---

### Decision 6 — JSON mode compatibility

**Current state:** Gemini uses `responseMimeType: 'application/json'` to enforce JSON output at the API level.

**Groq equivalent:** `response_format: { type: "json_object" }` — available on `llama-3.3-70b-versatile`. **Requirement:** the system prompt or user message must contain the word "json" for this mode to activate. All current prompts already include JSON instructions, but each must be verified.

Since `suggestRecipes` now uses Spoonacular/TheMealDB (no LLM), `response_format` applies only to `eatThisNow`, `expandSuggestion`, `parseReceipt`, and `parseRecipeImage`.

---

## Allowed Files

```
server/services/aiService.js
server/services/recipeSearchService.js      ← NEW
server/services/ai/groqProvider.js          ← NEW
server/services/ai/resolveProvider.js
server/services/ai/providerInterface.js     ← verify only, no changes expected
server/services/ai/anthropicProvider.js     ← MUST update _translateTools (see Decision 1)
server/services/ai/geminiProvider.js        ← DELETE
server/services/householdService.js         ← comment update only (no logic change)
server/db/schema.js                         ← comment update only (string column confirmed)
server/db/migrations/0008_migrate_gemini_provider.sql  ← NEW
server/routes/ai.js                         ← remove apiKey arg from suggestRecipes calls
server/routes/household.js                  ← update Zod enum (gemini → groq)
client/src/pages/HouseholdPage.jsx          ← update dropdown + hardcoded Gemini strings
.env.example                                ← swap GEMINI_API_KEY for GROQ_API_KEY + SPOONACULAR_API_KEY
server/package.json                         ← add groq-sdk, remove @google/generative-ai
```

---

## Forbidden Files

```
server/routes/recipes.js
server/routes/shopping.js
server/routes/push.js
server/middleware/auth.js
server/middleware/validate.js
client/public/sw.js
ai/tasks/archive/
```

---

## Constraints

1. The `AIProvider` base class interface in `providerInterface.js` must not change — `GroqProvider` implements it as-is.
2. `PANTRY_TOOLS` must be redefined in OpenAI `tools` format **and** `anthropicProvider.js` `_translateTools` must be updated in the same phase. These are a coupled change — doing one without the other silently breaks Anthropic tool calling.
3. `response_format: { type: "json_object" }` requires the word "json" in the prompt. Audit all JSON prompts before sending.
4. `GROQ_API_KEY` and `SPOONACULAR_API_KEY` must be added to Vercel environment variables before deploying. `GEMINI_API_KEY` can be removed after deploy is confirmed healthy.
5. Do not run `node server/db/migrate.js` against production — apply migration 0008 manually in Neon SQL Editor.
6. No changes to the `chat()` function signature or the `toolHandlers` pattern in `ai.js`.
7. `suggestRecipes` signature changes from `(allItems, expiringItems, apiKey)` to `(allItems, expiringItems)` — the `apiKey` parameter is removed. Update all call sites in `ai.js`.
8. Spoonacular HTML in `summary` field must be stripped before storing as `description`. Use a simple regex strip — do not introduce an HTML parsing library.

---

## Implementation Plan

### Phase 1 — Package swap
- `npm install groq-sdk` in `server/`
- `npm uninstall @google/generative-ai` in `server/`

### Phase 2 — GroqProvider adapter
Create `server/services/ai/groqProvider.js`:
- Constructor: `new Groq({ apiKey })`
- `startChatSession`: translate `PANTRY_TOOLS` (OpenAI format) directly; build Groq-compatible history
- `sendMessage`: call `groq.chat.completions.create()`; handle streaming off (non-streaming)
- `extractToolCalls`: parse `response.choices[0].message.tool_calls`
- `extractText`: return `response.choices[0].message.content ?? ''`
- `buildToolResult`: return OpenAI tool result message object `{ role: 'tool', tool_call_id, content }`
- `isResponseValid`: return `true` (no provider-level block concept)

Multi-turn tool loop requires accumulating messages array (not a session object like Gemini). The session object returned by `startChatSession` must carry the mutable messages array and be updated by `sendMessage`.

### Phase 3 — Redefine PANTRY_TOOLS and fix AnthropicProvider
In `aiService.js`, convert all entries in `PANTRY_TOOLS` from Gemini `functionDeclarations` format to OpenAI `tools` format.

**In the same phase**, update `anthropicProvider.js` `_translateTools` to read OpenAI format (see Decision 1). These two changes are coupled — doing one without the other will break Anthropic BYOK tool calling.

### Phase 4 — resolveProvider update
- Add `'groq'` case: `return new GroqProvider(key ?? process.env.GROQ_API_KEY)`
- Change default (null provider): `return new GroqProvider(process.env.GROQ_API_KEY)`
- Remove `GeminiProvider` import and `'gemini'` case
- Delete `geminiProvider.js`

### Phase 5 — Rewrite non-chat AI functions
Replace `genAI` singleton and all direct `GoogleGenerativeAI` calls:

| Function | Old | New |
|----------|-----|-----|
| `eatThisNow` | `genAI` + JSON mime type | Groq `llama-3.3-70b-versatile` + `response_format: json_object` |
| `expandSuggestion` | `genAI` + JSON mime type | Groq `llama-3.3-70b-versatile` + `response_format: json_object` |
| `suggestRecipes` | `genAI` + Google Search (2 LLM calls) | `recipeSearchService.findByPantry(allItems, expiringItems)` — zero LLM calls |
| `parseReceipt` | `genAI` + `inlineData` (vision) | Groq `llama-3.2-11b-vision-instruct` + base64 image in message content |
| `parseRecipeImage` | `genAI` + `inlineData` (vision) | Groq `llama-3.2-11b-vision-instruct` + base64 image in message content |

**New: `server/services/recipeSearchService.js`**

Exports a single function `findByPantry(allItems, expiringItems)`:
1. Build ingredient list: expiring items first, then remaining pantry items, max 5 ingredients (Spoonacular performs best with focused queries)
2. Call Spoonacular `findByIngredients` — `ranking=2` maximises ingredient coverage, `ignorePantry=true`
3. Take top 3 results; fetch full details via `GET /recipes/{id}/information`
4. Map to KK schema; strip HTML from `summary`
5. On Spoonacular 402/429 or zero results: call TheMealDB fallback for the first expiring ingredient
6. Return mapped results array; return `[]` on total failure

Uses native `fetch` (Node 18+ built-in) — no additional HTTP library required.

Remove `jsonModel()`, `textModel()`, and the module-level `genAI` constant entirely.

Remove `GoogleGenerativeAI` and `GoogleGenerativeAIError` imports. Update `wrapAIError` to remove the `GoogleGenerativeAIError` check — only `AIProviderError` remains.

### Phase 6 — BYOK and DB
- `server/db/migrations/0008_migrate_gemini_provider.sql`: NULL out Gemini rows
- `server/db/schema.js`: update `aiProvider` if enum type
- `householdService.js`: accept `'groq'`, reject `'gemini'`
- `HouseholdPage.jsx`: replace `'gemini'`/`'Gemini'` option with `'groq'`/`'Groq'`

### Phase 7 — Environment
- Add `GROQ_API_KEY` to `.env.example`
- Add `SPOONACULAR_API_KEY` to `.env.example`
- Add both to Vercel Production environment variables
- Remove `GEMINI_API_KEY` from Vercel after healthy deploy confirmed

---

## Acceptance Criteria

1. `npm run build` passes with no errors or warnings about missing Gemini imports
2. No `@google/generative-ai` or `GoogleGenerativeAI` references remain in `server/` (verified by grep)
3. Chat responds correctly with tool calling (add item, consume item, log meal)
4. `suggestRecipes` returns real recipes from Spoonacular (or TheMealDB fallback) with no LLM calls
5. `eatThisNow` returns JSON meal suggestions
6. `expandSuggestion` returns a full recipe JSON
7. `parseReceipt` correctly extracts items from a receipt image
8. `parseRecipeImage` correctly parses a recipe image
9. BYOK: household can save a Groq API key; chat uses it instead of env key
10. BYOK: household can save an Anthropic API key; chat uses it correctly
11. All 4 smoke tests pass in production

---

## Verification Steps

```
# 1. Grep — no Gemini imports remain
grep -r "google/generative-ai\|GoogleGenerativeAI\|GeminiProvider\|geminiProvider" server/

# 2. Build
cd client && npm run build

# 3. Server smoke (local)
cd server && node --experimental-vm-modules node_modules/.bin/jest

# 4. Production smoke tests
# Test 1: add item → chat "I ate the chicken" → verify meal_logs row
# Test 2: set dietary profile → chat → verify dietaryContext in system prompt
# Test 3: "what should I cook?" → verify recipe cards appear
# Test 4: "save that recipe" → verify recipe appears in recipe book
```

---

## Known Risks / Open Questions

1. **Llama tool calling fidelity:** Llama 3.3 70b handles function calling well but system prompt tuning may be needed. The existing Kitchen Keeper system prompt was written for Gemini — test for behavioral differences, especially around multi-item add and ambiguous consume/discard disambiguation.
2. **Vision model quality:** Llama 3.2 11B Vision may parse receipts with lower accuracy than Gemini Vision. If quality is insufficient, `llama-3.2-90b-vision-instruct` is the next tier up (same free tier, different RPM limits).
3. **100K TPD ceiling:** Recipe discovery no longer consumes tokens, easing pressure significantly. Remaining ceiling: ~33 full chat sessions/day. BYOK (Groq paid key) resolves for heavy households. Consider logging a warning when `x-ratelimit-remaining-tokens` response header approaches zero.
4. **Spoonacular 150 points/day:** At ~3 points per `suggestRecipes` call, the free tier supports ~50 recipe suggestion requests per day — well within expected household usage. If exceeded, TheMealDB fallback activates automatically.
5. **TheMealDB coverage gaps:** ~300 meals means uncommon ingredients may return zero results. Both Spoonacular and TheMealDB returning empty is a valid outcome; the chat UI already handles `[]` gracefully (no cards rendered).
6. **Spoonacular `summary` HTML:** The `summary` field contains HTML markup. Must be stripped before storing. A simple `replace(/<[^>]*>/g, '')` regex is sufficient — do not import an HTML parser.
7. **AnthropicProvider tool format:** After `PANTRY_TOOLS` is converted to OpenAI format, verify `AnthropicProvider.startChatSession` still correctly translates tool definitions. If it currently assumes Gemini format, it must be updated in this task.
8. **`aiProvider = 'gemini'` in production DB:** Likely zero rows (BYOK was just shipped), but migration 0008 must run before deploy to prevent a runtime crash if any exist.

---

## Dependency Chain

```
Editing:
- server/services/aiService.js
- server/services/recipeSearchService.js    (new)
- server/services/ai/groqProvider.js        (new)
- server/services/ai/resolveProvider.js
- server/services/ai/anthropicProvider.js   (verify only)
- server/services/householdService.js
- server/db/schema.js                       (if enum)
- server/db/migrations/0008_migrate_gemini_provider.sql  (new)
- server/routes/ai.js                       (remove apiKey arg from suggestRecipes calls)
- client/src/pages/HouseholdPage.jsx
- server/package.json

Deleting:
- server/services/ai/geminiProvider.js

Requires (read-only):
- server/services/ai/providerInterface.js

Irrelevant:
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- client/public/sw.js
- server/db/migrations/0001-0007
```

---

## Files Already Reviewed

- `server/services/aiService.js` — full read (2026-06-10)
- `server/services/ai/geminiProvider.js` — full read (2026-06-10)
- `server/services/ai/resolveProvider.js` — full read (2026-06-10)
- `server/services/ai/providerInterface.js` — full read (2026-06-10)
- `server/routes/ai.js` — partial read, aiConfig threading confirmed

---

## Open Architect Questions

1. **Vision decision (Decision 3):** Approve Option A (Groq Llama 3.2 Vision), B (keep Gemini for vision only), or C (remove vision pending TASK-015)?
2. **TPD mitigation:** Should system prompt compression be in scope for this task, or deferred?
3. **Spoonacular sign-up:** Confirm SPOONACULAR_API_KEY can be obtained and added to Vercel before implementation begins. Free tier requires sign-up at spoonacular.com (no credit card).
4. **`eatThisNow`/`expandSuggestion` BYOK threading (Decision 7):** Confirm that passing the Groq BYOK key to these functions is the desired behavior, or should all non-chat functions always use the env key regardless of BYOK setting?
