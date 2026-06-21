# TASK-016A — OpenAI Provider Migration

**Status:** APPROVED — Round 3 revisions applied  
**Author:** ConnorSharpe + Claude Sonnet 4.6  
**Date:** 2026-06-21  
**Hard Deadline:** August 16, 2026 (llama-3.3-70b-versatile shutdown)  
**Supersedes:** TASK-016 (split per architect recommendation)  
**Followed by:** TASK-016B (Clerk auth + per-user BYOK)

---

## Goal

Replace all Groq and Gemini AI calls with `gpt-4o-mini`. Remove the Gemini quota-exhaustion fallback. Existing auth, household model, and BYOK system are untouched.

This task exists solely to clear the August 16 deprecation deadline. It is a provider swap — nothing else changes.

---

## Background

`llama-3.3-70b-versatile` is deprecated on the Groq free/dev tier, shutdown August 16, 2026. It currently drives `chat()`, `eatThisNow()`, and `expandSuggestion()`. Groq's recommended replacements are not production-stable on the free tier.

`gpt-4o-mini` is a commercial-tier OpenAI model with stable multi-year lifecycle, full tool calling support, JSON mode, and native vision. It handles both chat and vision in a single model, allowing removal of the dual-provider Groq architecture and the Gemini fallback.

### Provider state before this task

| Function | Provider | Model | Status |
|---|---|---|---|
| chat() | Groq | llama-3.3-70b-versatile | DEPRECATED Aug 16 |
| eatThisNow() | Groq → Gemini fallback | llama-3.3-70b-versatile | DEPRECATED Aug 16 |
| expandSuggestion() | Groq → Gemini fallback | llama-3.3-70b-versatile | DEPRECATED Aug 16 |
| parseReceipt() | Groq vision | llama-3.2-11b-vision-instruct | Active |
| parseRecipeImage() | Groq vision | llama-3.2-11b-vision-instruct | Active |
| suggestRecipes() | Spoonacular + TheMealDB | (no LLM) | Unchanged |

### Provider state after this task

| Function | Provider | Model |
|---|---|---|
| chat() | OpenAI | gpt-4o-mini |
| eatThisNow() | OpenAI | gpt-4o-mini |
| expandSuggestion() | OpenAI | gpt-4o-mini |
| parseReceipt() | OpenAI | gpt-4o-mini |
| parseRecipeImage() | OpenAI | gpt-4o-mini |
| suggestRecipes() | Spoonacular + TheMealDB | (unchanged) |

---

## Pre-Implementation: Interface Audit (Required)

**Read these files before writing any code:**

```
server/services/ai/providerInterface.js
server/services/ai/groqProvider.js
server/services/ai/anthropicProvider.js
server/services/aiService.js
```

**Known findings from audit (2026-06-21):**

The `AIProvider` interface (`providerInterface.js`) defines exactly six methods:
```
startChatSession({ systemPrompt, tools, history })
sendMessage(session, message)
extractToolCalls(response)
extractText(response)
buildToolResult({ callId, name, result })
isResponseValid(response)
```

`parseImage()` and `jsonCompletion()` are **not in the interface**. They are OpenAI-specific extension methods. `aiService.js` currently calls Groq vision functions directly (not via the provider interface) — the same pattern applies here. Vision and JSON-mode calls in `aiService.js` will use the OpenAI SDK directly, not through the `AIProvider` interface.

**Stale comment in `providerInterface.js`:** The comment "tools passed to startChatSession use Gemini functionDeclarations format" is outdated — `PANTRY_TOOLS` was converted to OpenAI format in TASK-014. Update this comment when implementing `openaiProvider.js`.

**`buildToolResult` signature:** Uses a named-parameter object `{ callId, name, result }`, not positional args. Confirm the Groq and Anthropic implementations match before writing the OpenAI version.

---

## Architecture

### What changes

1. **New:** `server/services/ai/openaiProvider.js` — implements core `AIProvider` interface methods
2. **Modified:** `resolveProvider.js` — default case becomes OpenAI; Groq case removed
3. **Modified:** `aiService.js` — remove `withGroqFallback`, fallback constants; replace Groq vision/JSON calls with OpenAI SDK calls
4. **Modified:** `householdService.js` — remove Groq from allowed `aiProvider` values
5. **Modified:** `server/routes/household.js` — update Zod enum (remove `'groq'`)
6. **Modified:** `client/src/pages/HouseholdPage.jsx` — remove Groq BYOK dropdown option
7. **Modified:** `client/src/pages/ChatPage.jsx` — remove `_limitWarning` quota banner
8. **Deleted:** `server/services/ai/groqProvider.js`
9. **Deleted:** `server/services/ai/geminiProvider.js`
10. **Modified:** `server/package.json` — add `openai`; remove `groq-sdk`, `@google/generative-ai`
11. **Modified:** `.env.example` — add `OPENAI_API_KEY`; remove `GROQ_API_KEY`, `GEMINI_API_KEY`

### What does NOT change

- `server/middleware/auth.js` — untouched
- `req.user.householdId` pattern — untouched
- `AIProvider` interface in `providerInterface.js` — untouched (except stale comment fix)
- `PANTRY_TOOLS` format — already OpenAI format, no changes needed
- `AnthropicProvider` and `_translateTools` — untouched
- Anthropic BYOK path — retained as-is
- All service files (`pantryService`, `shelfLifeService`, `recipeSearchService`, etc.) — untouched
- `suggestRecipes` — untouched

---

## openaiProvider.js

Implements the six core `AIProvider` interface methods. Vision and JSON-mode calls are handled directly in `aiService.js` using the OpenAI SDK — not through the provider interface.

Required capabilities the OpenAI SDK must support (verify at implementation time):
- Tool/function calling
- JSON structured output (`response_format: { type: 'json_object' }`)
- Vision (image input in message content)

```js
import OpenAI from 'openai';
import { AIProvider, AIProviderError } from './providerInterface.js';

export class OpenAIProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  startChatSession({ systemPrompt, tools, history = [] }) {
    return {
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      tools,  // PANTRY_TOOLS already in OpenAI format — pass through directly
    };
  }

  async sendMessage(session, message) {
    // message is a string (user turn) or array (tool results)
    const content = typeof message === 'string' ? message : message;
    session.messages.push({ role: 'user', content });
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: session.messages,
        tools: session.tools?.length ? session.tools : undefined,
      });
      session.messages.push(response.choices[0].message);
      return response;
    } catch (err) {
      throw new AIProviderError(err.message, err);
    }
  }

  extractToolCalls(response) {
    return response.choices[0].message.tool_calls ?? [];
  }

  extractText(response) {
    return response.choices[0].message.content ?? '';
  }

  buildToolResult({ callId, name, result }) {
    return {
      role: 'tool',
      tool_call_id: callId,
      name,
      content: JSON.stringify(result),
    };
  }

  isResponseValid(response) {
    return response.choices[0].finish_reason !== 'content_filter';
  }
}
```

**Vision and JSON-mode (aiService.js directly):**

```js
// parseReceipt / parseRecipeImage — called directly in aiService.js
const openai = new OpenAI({ apiKey: resolvedKey });
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      { type: 'text', text: prompt },
    ],
  }],
  response_format: { type: 'json_object' },
});

// eatThisNow / expandSuggestion — called directly in aiService.js
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  response_format: { type: 'json_object' },
});
```

**Note:** `response_format: { type: 'json_object' }` requires the word "json" in the prompt. Verify all JSON prompts contain it before deploying.

---

## resolveProvider.js changes

```js
// Before (TASK-014 state)
case 'groq':   return new GroqProvider(key ?? process.env.GROQ_API_KEY);
case null:     return new GroqProvider(process.env.GROQ_API_KEY);

// After (TASK-016A)
case null:     return new OpenAIProvider(process.env.OPENAI_API_KEY);
// 'groq' case removed
// 'anthropic' case unchanged
```

Any household row with `aiProvider = 'groq'` falls through to the `null` default after the `'groq'` case is removed. Run the deployment SQL before deploying to NULL those rows cleanly.

---

## aiService.js changes

Remove entirely:
- `withGroqFallback()` and `classify429()` functions
- `geminiCallCount`, `GEMINI_RPD`, `GEMINI_WARN_AT` constants
- `GeminiProvider` and `GroqProvider` imports
- `provider instanceof GroqProvider` checks
- `isByok` parameter threading in `eatThisNow` / `expandSuggestion`
- `_limitWarning` fields and all code referencing them

Replace:
- Groq vision calls → OpenAI SDK vision calls (pattern above)
- Groq JSON calls for `eatThisNow`/`expandSuggestion` → OpenAI SDK JSON-mode calls (pattern above)

`eatThisNow` and `expandSuggestion` revert to the simpler signature they had before TASK-014 added the fallback wrapper.

---

## Deployment SQL

This is data cleanup, not a schema migration. Run in Neon SQL Editor before deploying:

```sql
-- NULL out any Groq BYOK rows (resolves to OpenAI default after 'groq' case is removed)
UPDATE households SET ai_provider = NULL, ai_api_key = NULL WHERE ai_provider = 'groq';

-- Verify
SELECT count(*) FROM households WHERE ai_provider = 'groq';
-- must return 0
```

---

## Rollback Plan

If the deployment fails or gpt-4o-mini produces unacceptable behavior:

```
1. npm install groq-sdk @google/generative-ai (in server/)
2. Restore groqProvider.js and geminiProvider.js from git history
3. Revert resolveProvider.js, aiService.js, package.json to pre-016A commit
4. Re-add GROQ_API_KEY, GEMINI_API_KEY to Vercel env vars
5. Redeploy
```

The rollback is clean because TASK-016A makes no schema changes.

---

## Allowed Files

```
server/services/ai/openaiProvider.js         ← create
server/services/ai/resolveProvider.js        ← modify
server/services/ai/providerInterface.js      ← comment fix only (stale Gemini reference)
server/services/aiService.js                 ← modify
server/services/householdService.js          ← modify (remove 'groq' from allowed providers)
server/routes/household.js                   ← modify (Zod enum: remove 'groq')
server/routes/ai.js                          ← modify (remove isByok threading, _limitWarning)
client/src/pages/HouseholdPage.jsx           ← modify (remove Groq BYOK option)
client/src/pages/ChatPage.jsx                ← modify (remove _limitWarning banner)
server/package.json                          ← modify
.env.example                                 ← modify
```

## Forbidden Files

```
server/middleware/auth.js                    ← do not touch (TASK-016B)
server/services/ai/anthropicProvider.js      ← do not touch
server/db/schema.js                          ← do not touch (TASK-016B)
server/db/migrations/*                       ← do not touch
server/services/pantryService.js             ← do not touch
server/services/shelfLifeService.js          ← do not touch
server/services/recipeSearchService.js       ← do not touch
client/src/main.jsx                          ← do not touch (TASK-016B)
client/src/App.jsx                           ← do not touch (TASK-016B)
```

## Files Deleted

```
server/services/ai/groqProvider.js
server/services/ai/geminiProvider.js
```

---

## Constraints

1. `gpt-4o-mini` is the only model string. Do not introduce `gpt-4o` or any other model.
2. `@google/generative-ai` fully removed — `grep -r "google/generative-ai" server/` must return zero matches.
3. `groq-sdk` fully removed — `grep -r "groq-sdk\|groqProvider\|geminiProvider" server/` must return zero matches.
4. `PANTRY_TOOLS` format does not change.
5. `AnthropicProvider` does not change.
6. `AIProvider` interface does not change (stale comment fix only).
7. Auth system and household model do not change.
8. Set a monthly OpenAI spending cap ($20 recommended) in the OpenAI dashboard before deploying.
9. Complete the interface audit before writing any code.

---

## Acceptance Criteria

1. `npm run build` passes
2. `grep -r "google/generative-ai\|groq-sdk\|groqProvider\|geminiProvider" server/` → zero matches
3. `chat()` with tool calling works end-to-end (add item, consume item, log meal)
4. `eatThisNow()` returns valid JSON meal suggestions
5. `expandSuggestion()` returns full recipe JSON
6. `parseReceipt()` extracts items from a receipt image — ≥85% line item accuracy across 5 receipts (correct if: normalized name matches expected, quantity within ±10%)
7. `parseRecipeImage()` parses a recipe image correctly
8. Anthropic BYOK works for chat — including tool calling (add item, consume item); verified with a real Anthropic API key
9. Behavioral regression matrix B1–B8 from TASK-014 passes against gpt-4o-mini

---

## Verification Steps

```
# Pre-implementation
1. Complete interface audit (providerInterface.js, groqProvider.js, anthropicProvider.js, aiService.js)
2. Confirm OPENAI_API_KEY obtained; added to .env.local
3. Set spending cap in OpenAI dashboard

# Post-implementation
4. npm run build
5. grep -r "google/generative-ai|groq-sdk|groqProvider|geminiProvider" server/ → zero matches
6. Local: POST /api/ai/chat "add 2 eggs" → tool call fires, pantry updated
7. Local: POST /api/ai/eat-this-now → valid suggestions JSON
8. Local: POST /api/ai/parse-receipt (test image) → items array
9. Local: configure Anthropic BYOK key → POST /api/ai/chat "add milk, remove eggs" → two tool calls fire correctly
10. Run deployment SQL in Neon SQL Editor
11. Deploy to Vercel
12. Production smoke: chat, receipt, eat this now, expand suggestion
13. Behavioral regression B1–B8
```

---

## Dependency Chain

```
Editing:
- server/services/ai/openaiProvider.js (new)
- server/services/ai/resolveProvider.js
- server/services/ai/providerInterface.js (comment only)
- server/services/aiService.js
- server/services/householdService.js
- server/routes/household.js
- server/routes/ai.js
- client/src/pages/HouseholdPage.jsx
- client/src/pages/ChatPage.jsx
- server/package.json
- .env.example

Deleting:
- server/services/ai/groqProvider.js
- server/services/ai/geminiProvider.js

Requires (read-only):
- server/services/ai/providerInterface.js (audit first)
- server/services/ai/anthropicProvider.js (audit; confirm no changes needed)

Irrelevant (do not touch):
- server/middleware/auth.js
- server/db/schema.js
- server/services/pantryService.js
- server/services/shelfLifeService.js
- server/services/recipeSearchService.js
- client/src/main.jsx
- client/src/App.jsx
```

---

## Known Risks

1. **Tool calling behavior difference** — gpt-4o-mini handles function calling well but system prompt behavior may differ from Groq Llama. The regression matrix (B1–B8) is the primary validation gate.
2. **Vision quality shift** — gpt-4o-mini vision is generally stronger than llama-3.2-11b-vision-instruct for structured extraction. Receipt parsing should improve, but behavior differences are possible. Revalidate with at least 5 real receipts.
3. **Spending cap is not optional** — without a cap, a misconfigured tool loop could result in unbounded OpenAI charges. Set the cap before implementation.
4. **`response_format: json_object` requires "json" in prompt** — verify all JSON prompts during implementation.
5. **`buildToolResult` signature mismatch** — the interface uses `{ callId, name, result }`. Verify that the existing Groq implementation matches this signature before writing the OpenAI version, to avoid a silent contract divergence.
