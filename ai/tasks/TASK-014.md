# TASK-014 — Replace Gemini with Groq as Default AI Provider

**Status:** APPROVED — Ready for Implementation (Round 4 + non-blocking recommendations applied)  
**Author:** Claude Sonnet 4.6  
**Date:** 2026-06-10  
**Supersedes:** N/A  
**Related:** TASK-012 (BYOK), TASK-013 (recipe suggestion cards)

---

## Goal

Replace Google Gemini as the default AI provider with Groq. Gemini is retained as a quota-exhaustion fallback for non-chat functions (see Decision 9). Groq's free tier offers 50× more daily requests (1,000 RPD vs 20 RPD) and 3× more RPM (30 vs 10), which makes the app viable for real household use without requiring users to supply their own API key. BYOK support (Groq and Anthropic) is retained and extended to include Groq keys.

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

**Decision: A — DECIDED. See Decision 3B below.**

Use `llama-3.2-11b-vision-instruct` for `parseReceipt` and `parseRecipeImage`. Same Groq SDK, same API key, different model string. Free tier limits for this model are counted separately from the chat model limits. Benchmarking against 10 representative receipts is required before marking this task complete (≥90% item extraction accuracy).

---

### Decision 4 — Vision: Groq Llama 3.2 Vision (DECIDED)

Option A is approved. `llama-3.2-11b-vision-instruct` will be used for `parseReceipt` and `parseRecipeImage`. The Gemini SDK is retained in the project (see Decision 9 — Gemini fallback), so vision on Groq is still the right call — it keeps vision off the platform Gemini quota and on the Groq vision model quota, which is separately tracked.

**Rationale:**
- Same Groq SDK and API key; only the model string changes
- Free tier limits for vision models are counted separately from the chat model limits
- If 11B accuracy is insufficient, `llama-3.2-90b-vision-instruct` is available on the same free tier

**Validation requirement (must complete before marking TASK-014 done):**
Run `parseReceipt` against 10 representative receipt images (mix of store types, font sizes, handwritten amounts).

```
Accuracy = correctly extracted line items ÷ total expected line items

A line item is correct if:
  - normalized item name matches expected (case-insensitive, ignoring brand prefixes)
  - quantity matches within ±10%

Success criterion: ≥90% accuracy across all 10 receipts combined.
```

If accuracy falls below threshold, switch to `llama-3.2-90b-vision-instruct` before shipping. Log actual vs. expected for each receipt in the Verification Results.

---

### Decision 5 — DB migration for existing aiProvider rows

**Current state:** The `households.aiProvider` column stores `'gemini' | 'anthropic' | null`. Any household that previously selected Gemini as their BYOK provider will have `aiProvider = 'gemini'` in the DB. After this task, `resolveProvider('gemini', key)` will have no handler.

**Decision:** Write a migration (`0008_migrate_gemini_provider.sql`) that NULLs out any rows where `aiProvider = 'gemini'`:
```sql
UPDATE households SET ai_provider = NULL, ai_api_key = NULL WHERE ai_provider = 'gemini';
```
This is safe because: (1) the app used GEMINI_API_KEY env var as the default, so most rows are already NULL; (2) any stored Gemini BYOK keys become invalid after removal; (3) NULL → resolves to Groq default, which is the correct fallback.

**Apply manually in Neon SQL Editor** (same procedure as migrations 0005–0007).

---

### Decision 6 — BYOK provider options

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

### Decision 7 — `eatThisNow` and `expandSuggestion` BYOK key threading (unchanged)

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

### Decision 8 — JSON mode compatibility

**Current state:** Gemini uses `responseMimeType: 'application/json'` to enforce JSON output at the API level.

**Groq equivalent:** `response_format: { type: "json_object" }` — available on `llama-3.3-70b-versatile`. **Requirement:** the system prompt or user message must contain the word "json" for this mode to activate. All current prompts already include JSON instructions, but each must be verified.

Since `suggestRecipes` now uses Spoonacular/TheMealDB (no LLM), `response_format` applies only to `eatThisNow`, `expandSuggestion`, `parseReceipt`, and `parseRecipeImage`.

---

### Decision 9 — Gemini as quota-exhaustion fallback for non-chat functions

**Context:** Groq's free tier cap is 100K TPD (~33 full chat sessions/day). When that ceiling is hit, the platform returns a 429. Without a fallback, all non-BYOK users lose AI capability until the quota resets at midnight UTC.

**Decision:** Retain `geminiProvider.js` and `@google/generative-ai` as a silent fallback provider. When Groq returns a quota-exhaustion 429, `aiService.js` catches it and retries the request with `GeminiProvider` using `GEMINI_API_KEY`. Gemini's 20 RPD / 10 RPM free tier is sufficient for overflow — it only activates after Groq is exhausted, so the combined effective limit is Groq (primary) + Gemini (overflow).

**Fallback scope — platform default only:**
BYOK users (Groq or Anthropic key stored in household settings) are unaffected — their key is theirs, not the platform's. The fallback only applies when `resolveProvider` returns the platform Groq provider (i.e., `aiConfig.provider === null`).

**Fallback trigger — quota 429 only:**
Not all 429s are quota exhaustion. Groq also returns 429 for RPM (requests-per-minute) bursts, which resolve in seconds. The fallback must distinguish:
- `x-ratelimit-remaining-requests: 0` with a reset time >60 seconds → quota exhaustion → activate Gemini fallback
- Standard RPM 429 → do NOT fall through to Gemini; surface "busy, try again" to client

In practice, inspect the `retry-after` header: if >60 seconds (daily reset), treat as quota exhaustion.

**Provider format compatibility:**
`PANTRY_TOOLS` is being converted to OpenAI format for Groq. `GeminiProvider` currently consumes Gemini `functionDeclarations` format — it must be updated to translate from OpenAI format, exactly like `AnthropicProvider._translateTools` does in the other direction:

```js
// Add to GeminiProvider
_translateTools(openAiTools) {
  return [{
    functionDeclarations: openAiTools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
  }];
}
```

`startChatSession` must call `this._translateTools(tools)` instead of passing `tools` directly.

**Fallback implementation in `aiService.js`:**

The retry wraps the entire request-level call (not a mid-session swap — session state is provider-specific and cannot be transferred). On a quota 429 from Groq, construct a fresh Gemini session with the same inputs and re-run:

```js
// Module-level counter — persists for the lifetime of the process instance.
// Best-effort on Vercel serverless (each instance has its own count),
// but acceptable at 20 RPD — household traffic rarely spans multiple warm instances.
let geminiCallCount = 0;
const GEMINI_RPD = 20;
const GEMINI_WARN_AT = 17;

// provider: already-resolved AIProvider instance (from resolveProvider in the route handler).
// Fallback only activates when provider is a platform GroqProvider and !isByok.
// This prevents accidental use of platform Gemini quota for BYOK Anthropic/Groq users.
async function withGroqFallback(fn, provider, inputs, isByok) {
  try {
    return await fn(provider, inputs);
  } catch (err) {
    if (!isByok && provider instanceof GroqProvider && classify429(err) === 'quota') {
      console.log(`[kitchen-keeper] request_id=${inputs.requestId} provider=groq fallback_provider=gemini function=${inputs.fnName} reason=quota_exhausted`);
      geminiCallCount++;

      // No hard cutoff on geminiCallCount — Gemini's own 429 is the true enforcement.
      // The counter drives advisory warnings only (see GEMINI_WARN_AT).

      const result = await fn(new GeminiProvider(process.env.GEMINI_API_KEY), inputs);

      if (geminiCallCount >= GEMINI_WARN_AT) {
        const remaining = GEMINI_RPD - geminiCallCount;
        result._limitWarning = `You have approximately ${remaining} AI request${remaining === 1 ? '' : 's'} left today. Add your own Groq API key in household settings to remove this limit.`;
      }

      return result;
    }
    throw err;
  }
}
```

`eatThisNow()` and `expandSuggestion()` are refactored to accept a `provider` argument. The route handler calls `resolveProvider(aiConfig.provider, aiConfig.apiKey)` and passes the resolved provider to these functions. This ensures BYOK Anthropic and Groq users always use their own provider — the fallback only fires for platform Groq.

**Client-side warning display:** The route handler in `ai.js` checks for `result._limitWarning` and includes it as a top-level `warning` field in the JSON response. `ChatPage.jsx` renders it as a soft banner beneath the last message — a conditional render on `response.warning`, no new component needed.

**What is NOT falling back to Gemini:**
- `chat()` — excluded despite KK storing conversation history in the DB (which would make a fresh Gemini session context-aware). The exclusion is because Groq failures could occur mid-tool-loop within a single turn, after some tool results have already been accumulated in the in-flight message array but before the final response. A Gemini retry at that point would receive only the original user message and DB history, losing the in-progress tool loop state and potentially double-executing actions. The simpler, safer boundary: chat fails with a clear "daily limit reached" message and BYOK upsell.
- `parseReceipt` and `parseRecipeImage` — use the Groq vision model, which has its own separate quota. If vision quota is exhausted, surface a user-visible error. Vision is a secondary feature; the complexity is not worth it.
- `suggestRecipes` — uses Spoonacular/TheMealDB (no LLM). No fallback needed.

**Why not a full gateway (LiteLLM/Bifrost):**
Both are Python-first proxy services designed for high-throughput production deployments. Kitchen Keeper runs on Vercel serverless with a Node.js/Express backend — adding a separate proxy service introduces infrastructure that must be deployed, maintained, and kept in sync. The direct retry pattern in `aiService.js` achieves the same result with ~30 lines of code and zero additional dependencies.

**Files affected by this decision (additions to original plan):**
- `server/services/ai/geminiProvider.js` — **NOT deleted**; add `_translateTools(openAiTools)` method; update `startChatSession` to call it
- `server/services/aiService.js` — add `withGroqFallback` wrapper and `isQuotaExhausted` helper
- `server/package.json` — `@google/generative-ai` is **NOT removed**
- `GEMINI_API_KEY` — **NOT removed** from Vercel env vars or `.env.example`; keep alongside `GROQ_API_KEY`

---

## Allowed Files

```
server/services/aiService.js
server/services/recipeSearchService.js      ← NEW
server/services/ai/groqProvider.js          ← NEW
server/services/ai/resolveProvider.js
server/services/ai/providerInterface.js     ← verify only, no changes expected
server/services/ai/anthropicProvider.js     ← MUST update _translateTools (see Decision 1)
server/services/ai/geminiProvider.js        ← MODIFY (add _translateTools; kept as fallback — NOT deleted)
server/services/householdService.js         ← comment update only (no logic change)
server/db/schema.js                         ← comment update only (string column confirmed)
server/db/migrations/0008_migrate_gemini_provider.sql  ← NEW
server/routes/ai.js                         ← remove apiKey arg from suggestRecipes calls
server/routes/household.js                  ← update Zod enum (gemini → groq)
client/src/pages/HouseholdPage.jsx          ← update dropdown + hardcoded Gemini strings
client/src/pages/ChatPage.jsx               ← render response.warning banner (limit warning)
.env.example                                ← add GROQ_API_KEY + SPOONACULAR_API_KEY (keep GEMINI_API_KEY)
server/package.json                         ← add groq-sdk (keep @google/generative-ai)
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
4. `GROQ_API_KEY` and `SPOONACULAR_API_KEY` must be added to Vercel environment variables before deploying. `GEMINI_API_KEY` must be **retained** — it is used by the Groq quota-exhaustion fallback (Decision 8).
5. Do not run `node server/db/migrate.js` against production — apply migration 0008 manually in Neon SQL Editor.
6. No changes to the `chat()` function signature or the `toolHandlers` pattern in `ai.js`.
7. `suggestRecipes` signature changes from `(allItems, expiringItems, apiKey)` to `(allItems, expiringItems)` — the `apiKey` parameter is removed. Update all call sites in `ai.js`.
8. Spoonacular HTML in `summary` field must be stripped before storing as `description`. Use a simple regex strip — do not introduce an HTML parsing library.

---

## Implementation Plan

### Phase 1 — Package swap
- `npm install groq-sdk` in `server/`
- Retain `@google/generative-ai` — required for `GeminiProvider` quota-exhaustion fallback (Decision 9). Do NOT uninstall.

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

### Phase 4 — resolveProvider update + GeminiProvider tool format fix
- Add `'groq'` case: `return new GroqProvider(key ?? process.env.GROQ_API_KEY)`
- Change default (null provider): `return new GroqProvider(process.env.GROQ_API_KEY)`
- Remove `'gemini'` BYOK case (users can no longer select Gemini as their BYOK provider)
- **Keep `GeminiProvider` import** — it is used by the fallback, not deleted
- In `geminiProvider.js`: add `_translateTools(openAiTools)` that converts OpenAI tools format → Gemini `functionDeclarations` format; update `startChatSession` to call it instead of passing `tools` directly

**Provider degradation strategy (must implement in this phase):**

```
1. GROQ_API_KEY missing at startup
   → resolveProvider throws a startup-time error with a clear message:
     "GROQ_API_KEY is not set. Add it to Vercel environment variables."
   → Server fails to start (better than silent misconfiguration).

2. Groq returns 429 — RPM burst (retry-after ≤ 60 seconds)
   → wrapAIError maps to user-visible 503:
     "AI service is busy. Please try again in a moment."
   → Do NOT fall back to Gemini — this resolves within seconds.

3. Groq returns 429 — quota exhaustion (message contains "daily"/"quota" OR retry-after > 60s)
   → chat(): surface 503 "You've reached today's AI limit. Try again after midnight UTC, or add your own Groq API key in household settings to remove this limit."
   → eatThisNow() / expandSuggestion(): withGroqFallback retries with GeminiProvider silently
      → At 17 Gemini fallback calls: response includes warning banner "You have 3 AI requests left today…"
      → At 20 Gemini fallback calls: surface 503 "Daily AI limit reached. Add your own Groq API key in household settings to continue."

4. Groq returns 5xx / network timeout
   → wrapAIError maps to AIProviderError:
     "AI service temporarily unavailable. Please try again."
   → HTTP 503 to client. No fallback — transient outage, not quota.

5. BYOK users (Groq or Anthropic key configured)
   → Their configured provider is used exclusively. No fallback to platform Gemini.
   → If their key fails, the same error messages apply.
```

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

**Operational requirements for `recipeSearchService.js`:**

```
Timeouts:
- All fetch calls: 5-second AbortController timeout
- On timeout: log warning, treat as failure, fall through to next source

Retries:
- None. Fail fast and fall through (Spoonacular → TheMealDB → []).

Caching (in-memory, module-level Map):
- Key: sorted comma-joined normalized ingredient names
- Normalize each ingredient with `normalizeFood()` from `server/utils/foodNormalization.js` before building the key — resolves plurals, synonyms, and preparation prefixes so "whole milk"/"milk"/"milks" all produce the same cache key. Import directly; do not re-implement.
  ```js
  import { normalizeFood } from '../utils/foodNormalization.js';
  const cacheKey = ingredients.map(i => normalizeFood(i.name)).sort().join(',');
  ```
- Hit: return cached result immediately, skip all API calls
- Cache ONLY successful non-empty results — TTL: 6 hours
- Do NOT cache: 402 responses, 429 responses, network failures, timeouts, or empty []
  → Caching failures would amplify transient upstream issues across all requests for 30 minutes
  → Instance A hitting a quota failure must not poison Instance B's fresh-start behavior
- Cache is process-scoped (Vercel serverless: per-instance, not cross-request persistent)
  → cache effectiveness is opportunistic only; hit rates vary with instance lifetime and traffic
  → the cache is quota optimization, not a correctness guarantee — do not rely on it being warm

Failure policy:
- Any unhandled error → log to console.error, return []
- Do not throw from findByPantry — callers expect [] on failure
```

Remove `jsonModel()`, `textModel()`, and the module-level `genAI` constant entirely.

Remove `GoogleGenerativeAI` and `GoogleGenerativeAIError` imports. Update `wrapAIError` to remove the `GoogleGenerativeAIError` check — only `AIProviderError` remains.

**Observability — add structured logging in `aiService.js`:**

This migration changes provider, models, and recipe discovery simultaneously. Add `console.log` entries (structured, single line) at the following points so Vercel logs are useful during rollout:

```
chat():           provider_used, model_used, tool_calls_count
eatThisNow():     model_used, response_tokens (from usage.completion_tokens)
expandSuggestion(): model_used, response_tokens
parseReceipt():   model_used, item_count_extracted
parseRecipeImage(): model_used
recipeSearchService: recipe_api_source ("spoonacular"|"themealdb"|"none"), result_count, cache_hit
wrapAIError():    fallback_activated: false (we have no fallback; log for future extension)
```

Format: `[kitchen-keeper] request_id=<id> household_id=<truncated> provider=<groq|anthropic> function=<name> <key=value> ...`

- `request_id`: generate a short random ID per request in the route handler (e.g. `crypto.randomUUID().split('-')[0]`) and thread it into each service call via a parameter or async context
- `household_id`: log first 8 chars only (privacy truncation) — enough to correlate logs without exposing the full ID
- Format stays grep-friendly without a logging library.

**Explicitly prohibited from logs:**
- API keys (any provider)
- Full user IDs or household IDs
- Chat message content (user utterances)
- Tool call arguments (may contain personal food/health data)
- Receipt OCR output (contains item names, prices — user purchase data)
- Any field from `extendedIngredients` or pantry item details

### Phase 6 — Groq → Gemini quota fallback (eatThisNow / expandSuggestion only)

Add two helpers to `aiService.js`:

```js
// Classifies a Groq 429 as quota exhaustion or transient rate limit.
// Classification order (most to least reliable):
//   1. Error message content — explicit and provider-documented
//   2. retry-after header  — heuristic only; Groq may change units or omit it
// retry-after is NOT the primary signal. Provider error message takes precedence.
function classify429(err) {
  if (!(err instanceof AIProviderError) || err.cause?.status !== 429) return null;
  const msg = (err.cause?.error?.message ?? '').toLowerCase();
  if (msg.includes('daily') || msg.includes('quota') || msg.includes('tokens per day')) {
    return 'quota';
  }
  const retryAfter = Number(err.cause?.headers?.['retry-after'] ?? 0);
  if (retryAfter > 60) return 'quota';     // heuristic fallback
  return 'rate_limit';
}

// Module-level Gemini call counter — see Decision 9 for rationale.
// WARNING: Vercel serverless instances do not share memory. Each warm instance starts
// its counter at 0, so "3 requests remaining" warnings are advisory only — the true
// remaining count across all instances may be lower. Hard enforcement happens at the
// provider level (Gemini 429). Do not rely on this counter for correctness.
let geminiCallCount = 0;
const GEMINI_RPD = 20;
const GEMINI_WARN_AT = 17;

// provider: already-resolved AIProvider instance passed in from the route handler.
// Fallback only activates for platform GroqProvider + !isByok.
// ONLY used for eatThisNow and expandSuggestion — NOT chat(). See Decision 9.
async function withGroqFallback(fn, provider, inputs, isByok) {
  try {
    return await fn(provider, inputs);
  } catch (err) {
    if (!isByok && provider instanceof GroqProvider && classify429(err) === 'quota') {
      console.log(`[kitchen-keeper] request_id=${inputs.requestId} provider=groq fallback_provider=gemini function=${inputs.fnName} reason=quota_exhausted`);
      geminiCallCount++;

      // No hard cutoff — Gemini's own 429 is the true enforcement.
      // geminiCallCount drives advisory warnings only.

      const result = await fn(new GeminiProvider(process.env.GEMINI_API_KEY), inputs);

      if (geminiCallCount >= GEMINI_WARN_AT) {
        const remaining = GEMINI_RPD - geminiCallCount;
        result._limitWarning = `You have approximately ${remaining} AI request${remaining === 1 ? '' : 's'} left today. Add your own Groq API key in household settings to remove this limit.`;
      }

      return result;
    }
    throw err;
  }
}
```

`eatThisNow()` and `expandSuggestion()` are refactored to accept a `provider` argument. **The route handler in `ai.js` calls `resolveProvider(aiConfig.provider, aiConfig.apiKey)` once and passes the resolved provider object** into these functions (not an API key string). This ensures BYOK Anthropic/Groq users always use their configured provider — `withGroqFallback` only activates when `provider instanceof GroqProvider && !isByok`. `chat()` is **not** wrapped — see Decision 9 for rationale.

**`chat()` on quota exhaustion:** When Groq returns a quota 429 inside `chat()`, `wrapAIError` catches it and surfaces a 503 with a clear, actionable message:
```
"You've reached today's AI limit. Try again after midnight UTC, or add your own Groq API key in household settings to remove this limit."
```
This is better UX than a transparent provider swap that could behave unexpectedly mid-tool-loop.

**Client-side warning display:** The route handler in `ai.js` checks for `result._limitWarning` on `eatThisNow`/`expandSuggestion` responses and includes it as a top-level `warning` field in the JSON response. `ChatPage.jsx` renders it as a soft banner beneath the last message — a conditional render on `response.warning`, no new component needed.

`parseReceipt` and `parseRecipeImage` are excluded from the fallback (see Decision 9).

### Phase 7 — BYOK and DB
- `server/db/migrations/0008_migrate_gemini_provider.sql`: NULL out Gemini rows
- `server/db/schema.js`: update `aiProvider` comment
- `householdService.js`: accept `'groq'`, reject `'gemini'`
- `HouseholdPage.jsx`: replace `'gemini'`/`'Gemini'` option with `'groq'`/`'Groq'`

**Migration deployment order (required — do not deploy before migrating):**
```
1. Apply migration 0008 in Neon SQL Editor:
   UPDATE households SET ai_provider = NULL, ai_api_key = NULL WHERE ai_provider = 'gemini';
   -- ai_api_key is also cleared: stored Gemini keys are invalid post-migration and
   -- retaining them would leave live credentials with no corresponding provider handler.

2. Verify:
   SELECT count(*) FROM households WHERE ai_provider = 'gemini';
   -- must return 0

3. Deploy application to Vercel.
```
Deploying before migration risks a runtime crash if any `ai_provider = 'gemini'` rows exist and `resolveProvider` receives `'gemini'` with no handler.

### Phase 8 — Environment
- Add `GROQ_API_KEY` to `.env.example`
- Add `SPOONACULAR_API_KEY` to `.env.example`
- Add both to Vercel Production environment variables
- **Retain `GEMINI_API_KEY`** in Vercel and `.env.example` — required for quota-exhaustion fallback

---

## Acceptance Criteria

1. `npm run build` passes with no errors
2. No direct `GoogleGenerativeAI` usage remains outside `geminiProvider.js` (verified by grep):
   ```bash
   grep -r "GoogleGenerativeAI" server/ | grep -v geminiProvider.js
   # must return no matches
   grep -r "google/generative-ai" server/ | grep -v geminiProvider.js
   # must return no matches
   ```
3. Chat responds correctly with tool calling (add item, consume item, log meal)
4. `suggestRecipes` returns real recipes from Spoonacular (or TheMealDB fallback) with no LLM calls
5. `eatThisNow` returns JSON meal suggestions
6. `expandSuggestion` returns a full recipe JSON
7. `parseReceipt` correctly extracts items from a receipt image (≥90% line item accuracy across 10 representative receipts)
8. `parseRecipeImage` correctly parses a recipe image
9. BYOK: household can save a Groq API key; chat uses it instead of env key
10. BYOK: household can save an Anthropic API key; chat uses it correctly
11. All 4 smoke tests pass in production
12. Quota-exhaustion — `eatThisNow`/`expandSuggestion`: when Groq quota is exhausted, these functions fall back to Gemini transparently; "groq quota exhausted" appears in Vercel logs
12b. Quota-exhaustion — `chat()`: surfaces "You've reached your daily AI limit…" 503 — does NOT fall back to Gemini
13. RPM 429 does NOT trigger Gemini fallback — surfaces "busy" 503 instead
14. BYOK Groq household with an exhausted key surfaces a provider error, not a Gemini fallback
15. Behavioral regression matrix passes (see below):

### Behavioral Regression Matrix

These scenarios must be manually tested against Groq after migration. Each tests a known failure mode from switching LLM providers.

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| B1 | Add multiple pantry items in one message | "Add 2 eggs, half a gallon of milk, and a loaf of bread" | Three separate `add_pantry_item` tool calls with correct quantities |
| B2 | Consume partial quantity | "I used half the milk" | `consume_pantry_item` with quantity = 50% of stored amount, not full removal |
| B3 | Ambiguous consume vs. discard | "The chicken is off, I got rid of it" | `remove_pantry_item` (discard) not `log_meal` |
| B4 | Dietary restrictions applied | Profile: vegetarian. Pantry: chicken + vegetables. "What should I eat?" | Suggestions exclude chicken; no LLM tool call needed |
| B5 | Recipe save flow end-to-end | After recipe cards appear: "Save the pasta one" | `save_recipe` tool call fires; recipe appears in recipe book |
| B6 | Tool call followed by natural language | "I ate the eggs. How many calories is that?" | Tool call for meal log + text response with calorie info in same turn |
| B7 | Multi-turn context retention | Turn 1: "Add chicken." Turn 2: "Actually make it 2." | Pantry updated to 2 without re-adding a second item |
| B8 | Graceful tool failure recovery | (Simulate DB error on tool result) | Model acknowledges failure, suggests user try again; does not loop |

Log pass/fail for each scenario in Verification Results before marking task complete.

---

## Verification Steps

```
# 0. Verify Groq Vision quota isolation (do this BEFORE implementation)
# Log into console.groq.com → Usage → confirm llama-3.2-11b-vision-instruct
# appears as a separate row from llama-3.3-70b-versatile in TPD/RPD tables.
# If models share the same quota pool, vision calls eat into the 100K TPD chat budget
# and the assumption in Decision 4 is false — treat as a blocker.

# 1. Grep — no direct Gemini usage outside fallback file
grep -r "GoogleGenerativeAI\|google/generative-ai" server/ | grep -v geminiProvider.js
# must return no matches

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
7. **Both provider tool format changes coupled:** After `PANTRY_TOOLS` is converted to OpenAI format, both `AnthropicProvider._translateTools` and `GeminiProvider._translateTools` must be updated in the same phase. Both must be verified before shipping.
8. **`aiProvider = 'gemini'` in production DB:** Likely zero rows (BYOK was just shipped), but migration 0008 must run before deploy to prevent a runtime crash if any exist.
9. **Gemini fallback quota (20 RPD):** The fallback is a last resort, not a primary traffic handler. If Groq TPD is consistently exhausted, the right fix is encouraging BYOK (paid Groq key) not relying on Gemini's 20 RPD as a production tier.
10. **`retry-after` header availability:** The quota-exhaustion detection reads Groq's `retry-after` header. If Groq changes its error response format, `isQuotaExhausted` may misclassify. Add a fallback classification: if `retry-after` is absent but status is 429 and error message contains "quota" or "daily", treat as exhaustion.

---

## Dependency Chain

```
Editing:
- server/services/aiService.js
- server/services/recipeSearchService.js    (new)
- server/services/ai/groqProvider.js        (new)
- server/services/ai/resolveProvider.js
- server/services/ai/anthropicProvider.js   (update _translateTools)
- server/services/ai/geminiProvider.js      (add _translateTools; kept as fallback)
- server/services/householdService.js
- server/db/schema.js                       (comment update)
- server/db/migrations/0008_migrate_gemini_provider.sql  (new)
- server/routes/ai.js                       (remove apiKey arg from suggestRecipes calls)
- client/src/pages/HouseholdPage.jsx
- client/src/pages/ChatPage.jsx             (warning banner render)
- server/package.json                       (add groq-sdk; keep @google/generative-ai)

Deleting:
- (none — geminiProvider.js is retained as fallback)

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

1. ~~**Vision decision (Decision 3):**~~ **DECIDED — Option A (Groq Llama 3.2 Vision).** See Decision 3B.
2. ~~**TPD mitigation:**~~ **DEFERRED to TASK-015.** Measure real usage under Groq first. Adding prompt compression to this task increases blast radius; the recipe API change already recovers ~5K tokens/suggestRecipes call.
3. **Spoonacular sign-up:** Confirm SPOONACULAR_API_KEY can be obtained and added to Vercel before implementation begins. Free tier requires sign-up at spoonacular.com (no credit card).
4. ~~**`eatThisNow`/`expandSuggestion` BYOK threading (Decision 7):**~~ **DECIDED — retain `apiKey` param; thread household Groq BYOK key.** Mixing chat (BYOK) with helper functions (platform key) would create inconsistent billing behavior for paid Groq households.

5. **Gemini fallback scope (Decision 9):** Architect approved restricting Gemini fallback to `eatThisNow`/`expandSuggestion` only. `chat()` on quota exhaustion surfaces a clear "daily limit reached" message with BYOK upsell. Confirm this is the desired UX, or reopen for Round 5.

### Note on Manual SQL Migrations (re: architect non-blocking rec A)

The architect recommended `npm run migrate` over manual Neon SQL Editor execution. In this project, migrations 0005–0007 were all applied manually in the Neon SQL Editor — this is the established workflow, not configuration drift. The migration runner is not wired to Vercel deploys and has caused conflicts in prior sessions. Migration 0008 will continue the manual pattern. The exact SQL is documented in the migration file, which is committed to the repo.
