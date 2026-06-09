# TASK-012 — Bring Your Own Key (BYOK): Household-Level AI Provider Plug-in

**Status:** DRAFT-3 — Pending architect review
**Author:** Claude Code / ConnorSharpe

---

## Revision History

| Draft | Changes |
|-------|---------|
| DRAFT-1 | Initial spec |
| DRAFT-2 | Resolved 4 architect blockers. Added 4 issues the architect missed due to no code access: non-chat AI functions scoped out, Anthropic JSON mode constraint specified, `wrapAIError` provider-awareness required, Anthropic model ID pinned. Provider detection changed from prefix inference to explicit `ai_provider` column. `chat()` signature approach corrected. `API_KEY_ENCRYPTION_SECRET` made conditionally required. Decryption failure changed from silent fallback to hard error. Encryption format versioned. |
| DRAFT-3 | Accepted all 3 architect minor issues. (1) Provider resolution moved from `aiService.js` to `routes/ai.js` — `householdService.getAiConfig()` returns `{ provider, decryptedKey }` (decrypts internally); `chat()` accepts `aiConfig` object instead of `householdId`. `householdService` import added to `routes/ai.js`. (2) Undecryptable key error changed from 503 → 422. (3) Rollback SQL added to migration spec. Architect gap identified: `aiConfig` shape and decryption boundary were unspecified in Minor Issue 1 recommendation — clarified here. |

---

## Chain of Thought

### Why this exists

The app currently uses a single `GEMINI_API_KEY` env var shared across all users.
This creates two problems:

1. **Quota exhaustion** — all households share one free-tier quota. A handful of active users can 503 everyone.
2. **Provider lock-in** — if Google changes free tier pricing again (it already has once), the app breaks for all users simultaneously.

The solution is to let households supply their own AI API key. The server uses the household key if present, falls back to the platform key otherwise. No user is ever forced to supply a key — the fallback keeps the app working for casual users.

### Why household-level, not user-level

The app is built around a shared-kitchen model (one pantry, one chat history, one recipe book per household). All members share the same AI conversation context. A per-user key would mean different members of the same household could generate responses from different providers mid-conversation — creating incoherent tool call histories. One key per household is the only model consistent with the existing shared-context architecture.

### Why the Strategy pattern, not a gateway service

An external AI gateway (LiteLLM, Cloudflare AI Gateway) adds infrastructure: another service to host, another failure point, another billing relationship. The app is a household utility targeting free/low-cost operation. The Strategy pattern — a thin provider adapter per SDK — achieves the same routing with zero new infrastructure. The tradeoff is that adding a new provider requires a code change, but for a two-provider initial implementation this is acceptable.

### Why Anthropic Claude as the second provider

- The owner has a Claude API key and wants to use it for testing.
- Claude's tool calling is first-class and well-documented.
- The Anthropic Node SDK (`@anthropic-ai/sdk`) is stable and widely used.
- Claude's multi-turn tool call loop is semantically equivalent to Gemini's — both use a request/response cycle where the model emits tool calls and the server responds with results.

### Why explicit `ai_provider` column instead of prefix inference (DRAFT-2 change)

DRAFT-1 inferred provider from key prefix (`AIza` = Gemini, `sk-ant-` = Anthropic). The architect correctly identified this as brittle — key formats can change, and future providers (OpenAI `sk-...`, DeepSeek) share prefixes. Storing provider explicitly:
- makes routing deterministic regardless of key format changes
- enables a UI dropdown that is unambiguous to the user
- allows future providers to be added without touching the resolver logic

### BYOK scope boundary: `chat()` only (DRAFT-2 addition)

`aiService.js` exports multiple functions that all currently use the hardcoded `genAI`/`MODEL`:
- `chat()` — multi-turn tool-calling conversation
- `parseReceipt()` — Gemini vision, multimodal
- `parseRecipeImage()` — Gemini vision, multimodal
- `eatThisNow()` — JSON mode
- `suggestRecipes()` — JSON mode
- `expandSuggestion()` — JSON mode

**BYOK routing applies to `chat()` only.** All other functions continue using the platform Gemini key unconditionally. Reasons:
1. Vision/multimodal functions (`parseReceipt`, `parseRecipeImage`) use Gemini-specific multimodal APIs. Anthropic's vision API exists but has a different interface — adapting these is a separate task.
2. JSON-mode functions use `responseMimeType: 'application/json'` which is Gemini-specific. Anthropic has no equivalent — JSON enforcement requires prompt engineering, not an API parameter. Adding this to all JSON-mode functions in this task balloons scope.
3. `chat()` is the only function where quota pressure and provider choice directly affect the user's daily interaction. It is the right starting point.

This boundary must be documented in the implementation. The `genAI`/`MODEL` constants at the top of `aiService.js` remain for non-chat functions. Only `chat()` resolves dynamically.

### Security: how the key is stored

API keys must never be stored in plaintext — they are equivalent to passwords. AES-256-GCM is the correct algorithm: authenticated encryption prevents both decryption and tampering without the server secret.

The key is:
- Encrypted before INSERT/UPDATE
- Decrypted only inside the server at request time, never returned to the client
- The client receives only a masked preview (e.g. `sk-ant-...xK9z`) for display purposes

Ciphertext format: `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>` — versioned so the algorithm can be upgraded without a full re-encryption migration.

### Decryption failure behavior (DRAFT-2 change)

DRAFT-1 specified silent fallback on decryption failure. The architect correctly identified this as dangerous: a household that deliberately configured Anthropic would silently revert to platform Gemini if the encryption secret rotates, creating unexpected billing and behavior changes with no visibility.

Correct behavior:
- `ai_api_key IS NULL` → expected fallback to platform key (AC #1)
- `ai_api_key IS NOT NULL` but decryption fails → hard error returned to client, AI requests blocked until household admin removes or replaces the key

### `chat()` signature resolution (DRAFT-3 final)

DRAFT-1 had a contradiction between "signature unchanged" and "new parameter added." DRAFT-2 resolved this by adding `householdId` as an optional last parameter and fetching/decrypting inside `chat()`. The DRAFT-2 architect correctly identified this still violates service layering — `aiService` should be a pure computation service, not a data-fetching service.

**Final resolution (DRAFT-3):** Provider resolution moves entirely to `routes/ai.js`. `householdService.getAiConfig(householdId)` fetches the encrypted key, decrypts it internally, and returns `{ provider, decryptedKey }`. The route passes this `aiConfig` object to `chat()`. `aiService.js` remains pure — it only instantiates the provider adapter, it does not touch the database.

`aiConfig` shape:
```js
// returned by householdService.getAiConfig(householdId)
{
  provider:    'gemini' | 'anthropic' | null,
  decryptedKey: string | null   // null if no BYOK key configured
}
```

Decryption happens inside `householdService.getAiConfig()`. If `API_KEY_ENCRYPTION_SECRET` is absent or decryption fails (tampered ciphertext), `getAiConfig()` throws. The route catches this and returns 422. `keyEncryption.js` is imported by `householdService`, not by `routes/ai.js`.

`routes/ai.js` gains one new import (`householdService`) and one new call before `aiService.chat()`. This is now the only call site change required.

---

## Goal

Add a household-level AI API key and provider selection. The server resolves which provider and key to use per `chat()` request using a Strategy pattern. Anthropic Claude and Google Gemini are the two supported providers. The platform key remains as a fallback. All non-chat AI functions are unaffected.

---

## Scope

### In scope
- DB schema: add `ai_api_key` (encrypted text, nullable) and `ai_provider` (text, nullable) to `households`
- Migration: `0007_household_ai_api_key.sql`
- Encryption utility: `server/utils/keyEncryption.js` (AES-256-GCM, versioned format, encrypt/decrypt/mask)
- Provider abstraction: `server/services/ai/providerInterface.js` (shared contract)
- Gemini adapter: `server/services/ai/geminiProvider.js` (chat only — extracted from `aiService.js`)
- Anthropic adapter: `server/services/ai/anthropicProvider.js` (chat only)
- Provider resolver: `server/services/ai/resolveProvider.js` (explicit provider field → instantiate adapter)
- `aiService.js`: `chat()` accepts `aiConfig` object; resolves provider from it; no DB calls; all other functions unchanged
- Household settings API: PATCH `/api/household/ai-key` (set/remove key + provider)
- Client: provider dropdown + key input field in `HouseholdPage.jsx` settings section
- New env var: `API_KEY_ENCRYPTION_SECRET` (32-byte hex string, required only when a BYOK key is saved or decrypted)

### Out of scope
- BYOK for `parseReceipt`, `parseRecipeImage`, `eatThisNow`, `suggestRecipes`, `expandSuggestion` — all continue using platform Gemini key (future task)
- Per-user keys
- More than two providers (OpenAI, DeepSeek, etc. — future task)
- Usage metering or per-household quota tracking
- Key validity testing on save (deferred)
- `API_KEY_ENCRYPTION_SECRET` rotation strategy (documented risk, not in scope)
- TASK-011 JSONB migration (separate task)

---

## Allowed Files

### New
- `server/db/migrations/0007_household_ai_api_key.sql`
- `server/utils/keyEncryption.js`
- `server/utils/keyEncryption.test.js`
- `server/services/ai/providerInterface.js`
- `server/services/ai/geminiProvider.js`
- `server/services/ai/anthropicProvider.js`
- `server/services/ai/resolveProvider.js`

### Edited
- `server/db/schema.js` — add `aiApiKey`, `aiProvider` columns to `households`
- `server/services/aiService.js` — `chat()` accepts `aiConfig` object; `wrapAIError` made provider-aware; no DB calls
- `server/routes/ai.js` — add `householdService` import; call `getAiConfig()` before `chat()`; pass `aiConfig` to `chat()`
- `server/routes/household.js` — add PATCH `/api/household/ai-key`
- `server/services/householdService.js` — add `setAiApiKey`, `removeAiApiKey`, `getAiApiKey`
- `client/src/pages/HouseholdPage.jsx` — add provider dropdown + key input in settings section
- `.env.example` — document `API_KEY_ENCRYPTION_SECRET`

### Forbidden
- `server/utils/foodNormalization.js`
- `server/data/purineIndex.js`
- `server/services/mealLogService.js`
- `server/services/dietaryService.js`
- `server/routes/dietary.js`
- `server/utils/recipeScorer.js`
- `client/src/hooks/useDietaryProfile.js`
- `client/src/components/settings/DietaryProfileForm.jsx`
- `server/middleware/auth.js`
- `server/routes/auth.js`

---

## Constraints

1. **No plaintext key storage.** `ai_api_key` in the DB is always AES-256-GCM encrypted. The encryption secret lives only in `API_KEY_ENCRYPTION_SECRET` env var.
2. **Key never returned to client.** All endpoints return a masked preview only (first 4 + `...` + last 4 chars). Never the raw key.
3. **Null key → platform fallback. Set key fails to decrypt → hard error.** If `ai_api_key IS NULL`, use platform `GEMINI_API_KEY`. If `ai_api_key` is set but decryption fails, return an explicit error and block AI requests — do not silently fall back to the platform key.
4. **Provider interface is stable.** Both adapters must implement the exact same method signatures so `aiService.js` is provider-agnostic.
5. **`aiService.js` must not import any provider SDK directly.** All SDK imports live inside the adapter files only.
6. **`chat()` accepts `aiConfig` as a new last parameter.** Shape: `{ provider: 'gemini'|'anthropic'|null, decryptedKey: string|null }`. `routes/ai.js` fetches this via `householdService.getAiConfig(req.user.householdId)` before calling `chat()`. `aiService.js` does not import `householdService` or `keyEncryption` — it remains a pure computation service.
7. **Anthropic tool call loop must match Gemini semantics.** The loop runs until no tool calls remain or `MAX_TOOL_ITERATIONS` is hit — identical behavior regardless of provider.
8. **`API_KEY_ENCRYPTION_SECRET` is required only when a household key is saved or decrypted.** Not added to `REQUIRED_ENV` at startup. Validated lazily inside `keyEncryption.js` — throws a clear error if absent when needed.
9. **BYOK applies to `chat()` only.** All other `aiService` functions (`parseReceipt`, `parseRecipeImage`, `eatThisNow`, `suggestRecipes`, `expandSuggestion`) continue using the platform Gemini key unconditionally. The `genAI`/`MODEL` module-level constants remain for these functions.
10. **`wrapAIError` must be provider-aware.** Currently checks `instanceof GoogleGenerativeAIError`. Must also catch `AnthropicError` (from `@anthropic-ai/sdk`). Both map to 503. The adapters should normalize errors to a shared `AIProviderError` type before throwing so `aiService.js` has a single catch target.
11. **Undecryptable BYOK key returns 422, not 503.** 503 implies transient infrastructure failure. A corrupted or tampered stored key is a user configuration error — 422 (Unprocessable Entity) with a user-facing message is correct.
12. **No `npm install` of Anthropic SDK until spec is approved.** Package changes are implementation-phase only.

---

## Architecture

### Provider Interface Contract

```js
// server/services/ai/providerInterface.js
// All adapters must implement this shape exactly.

export class AIProvider {
  // Initializes a chat session. Returns an opaque session object.
  // history: [{ role: 'user'|'assistant', content: string }]
  // tools: Gemini-format functionDeclarations array (adapter translates internally)
  // systemPrompt: string
  startChatSession({ systemPrompt, tools, history }) { throw new Error('Not implemented'); }

  // Sends a message to an active session. Returns raw provider response.
  async sendMessage(session, message) { throw new Error('Not implemented'); }

  // Extracts tool calls from a raw provider response.
  // Returns: [{ callId: string, name: string, args: object }] or []
  extractToolCalls(response) { throw new Error('Not implemented'); }

  // Extracts the assistant text from a raw provider response.
  // Returns: string
  extractText(response) { throw new Error('Not implemented'); }

  // Builds a tool result payload in the provider's required format.
  buildToolResult({ callId, name, result }) { throw new Error('Not implemented'); }

  // Returns true if the response can continue (not blocked/errored at the provider level).
  isResponseValid(response) { throw new Error('Not implemented'); }
}
```

### Provider Resolver

```js
// server/services/ai/resolveProvider.js

import { GeminiProvider } from './geminiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

// Resolves provider from explicit stored value, not key prefix.
// provider: 'gemini' | 'anthropic' | null
// key: decrypted API key string | null
export function resolveProvider(provider, key) {
  if (provider === 'anthropic' && key) {
    return new AnthropicProvider(key);
  }
  // Default: Gemini (household key or platform key)
  return new GeminiProvider(key ?? process.env.GEMINI_API_KEY);
}
```

### Key Encryption Utility

```js
// server/utils/keyEncryption.js
// AES-256-GCM. Secret from API_KEY_ENCRYPTION_SECRET env var (32-byte hex).
// Throws clearly if API_KEY_ENCRYPTION_SECRET is absent when called.

// Versioned format: 'v1:<iv_hex>:<tag_hex>:<ciphertext_hex>'
// Version prefix enables future algorithm migration without full re-encryption.

export function encrypt(plaintext)  // → 'v1:<iv_hex>:<tag_hex>:<ciphertext_hex>'
export function decrypt(ciphertext) // → plaintext string. Throws on tamper or wrong secret.
export function maskKey(plaintext)  // → 'sk-ant-...xK9z' (first4 + '...' + last4)
```

### `aiService.js` change surface

Two targeted changes only. No DB calls, no new imports of householdService or keyEncryption.

**1. `chat()` gains `aiConfig` as a new last parameter:**
```js
// Before:
export async function chat(pantrySummary, recipeSummary, history, userMessage, toolHandlers = {}, dietaryContext = '')

// After:
export async function chat(pantrySummary, recipeSummary, history, userMessage, toolHandlers = {}, dietaryContext = '', aiConfig = null)
```

**2. Provider instantiation at top of `chat()`:**
```js
// Replaces: const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const provider = resolveProvider(aiConfig?.provider ?? null, aiConfig?.decryptedKey ?? null);
```

**3. `wrapAIError` updated to catch both provider error types** (see Constraint #10).

The `genAI`, `jsonModel`, `textModel` module-level helpers remain untouched — they serve `parseReceipt`, `parseRecipeImage`, `eatThisNow`, `suggestRecipes`, `expandSuggestion`.

### `routes/ai.js` change surface

Two targeted changes. `householdService` is not currently imported in `routes/ai.js` — it must be added.

**1. New import:**
```js
import * as householdService from '../services/householdService.js';
```

**2. Before calling `aiService.chat()`:**
```js
const aiConfig = await householdService.getAiConfig(req.user.householdId);
// getAiConfig throws 422 if key is set but undecryptable
```

**3. Pass to chat:**
```js
const { reply, itemsAdded } = await aiService.chat(
  pantrySummary, recipeSummary, history, message, toolHandlers, dietaryContext, aiConfig
);
```

### `householdService.getAiConfig()` contract

```js
// Returns { provider: 'gemini'|'anthropic'|null, decryptedKey: string|null }
// - If no key stored: returns { provider: null, decryptedKey: null } (platform fallback)
// - If key stored and decryption succeeds: returns { provider, decryptedKey }
// - If key stored and decryption fails: throws error with status 422
export async function getAiConfig(householdId)
```

Decryption happens here. `keyEncryption.decrypt()` is imported by `householdService`, not by `routes/ai.js` or `aiService.js`.

### Anthropic JSON mode (DRAFT-2 addition)

Gemini enforces JSON output via `responseMimeType: 'application/json'`. Anthropic has no equivalent API parameter. This is irrelevant to `chat()` — the chat function uses plain-text output, not JSON mode. JSON-mode functions (`eatThisNow`, `suggestRecipes`, etc.) are out of BYOK scope and remain on Gemini. No action required.

### Gemini ↔ Anthropic tool call loop comparison

| Step | Gemini | Anthropic |
|------|--------|-----------|
| Start session | `model.startChat({ history, tools })` | stateless — adapter holds message array |
| Send message | `session.sendMessage(text)` | `client.messages.create({ messages, tools, system })` |
| Detect tool calls | `response.functionCalls()` | `response.content.filter(b => b.type === 'tool_use')` |
| Send tool results | `session.sendMessage([{ functionResponse }])` | append `tool_result` blocks, call `messages.create` again |
| Extract text | `response.text()` | `response.content.filter(b => b.type === 'text')[0]?.text` |
| Stop reason | `response.candidates[0].finishReason` | `response.stop_reason` |

**Critical difference:** Anthropic is stateless — there is no persistent session object. The `AnthropicProvider` adapter maintains the message array internally across tool loop iterations, appending assistant and tool_result turns on each pass.

**Tool declaration translation:** Gemini uses `functionDeclarations[].parameters` (JSON Schema). Anthropic uses `tools[].input_schema` (JSON Schema). Both support `type`, `properties`, `required`, and `enum`. The translation is mechanical and lives inside `anthropicProvider.js`. `aiService.js` passes its existing Gemini-format tool declarations unchanged; the adapter converts them.

### DB Schema additions

```sql
-- 0007_household_ai_api_key.sql
-- Apply in Neon SQL Editor (same process as 0005 and 0006)

-- Forward migration
ALTER TABLE households ADD COLUMN ai_provider TEXT;
ALTER TABLE households ADD COLUMN ai_api_key TEXT;

-- Rollback (run manually if needed — do NOT run automatically)
-- ALTER TABLE households DROP COLUMN ai_api_key;
-- ALTER TABLE households DROP COLUMN ai_provider;
```

Drizzle schema:
```js
aiProvider: text('ai_provider'),  // nullable: 'gemini' | 'anthropic'
aiApiKey:   text('ai_api_key'),   // nullable, AES-256-GCM encrypted, versioned format
```

### API endpoint

```
PATCH /api/household/ai-key
Auth: requireAuth
Body: { provider: 'gemini' | 'anthropic', key: string }
   OR { provider: null, key: null }  (remove key)

Response 200: { provider: 'anthropic' | 'gemini' | null, maskedKey: 'sk-ant-...xK9z' | null }
Response 400: { error: 'provider must be gemini or anthropic' }
Response 400: { error: 'key is required when provider is set' }
```

Validation: `provider` must be one of the two supported values. `key` is required when `provider` is set. No live API call to validate the key — prefix-independent, format-agnostic. A bad key surfaces on the next chat request.

### GET household endpoint (existing)

The existing `GET /api/household` response gains two new read-only fields:
```json
{
  "provider": "anthropic",
  "maskedKey": "sk-ant-...xK9z"
}
```
Never the raw key. `householdService` must decrypt-then-mask at read time, or store the mask separately. Recommend decrypt-then-mask (no extra column).

### Client UI

In `HouseholdPage.jsx`, add an "AI Provider" section in household settings:
- Provider dropdown: `Platform default (Gemini)` / `Gemini (my key)` / `Anthropic Claude`
- Password-type key input (visible when a provider with a key is selected)
- Shows masked key if one is saved
- Save / Remove buttons
- Helper text: "Optional. Your key is encrypted at rest. If not set, the shared platform key is used."

### Anthropic model

Pin to `claude-sonnet-4-6`. Best tool-calling support in the current model family, lower latency and cost than Opus. Set as a constant in `anthropicProvider.js`.

---

## Acceptance Criteria

1. A household with no `ai_api_key` uses the platform `GEMINI_API_KEY` — behavior identical to today.
2. A household with a Gemini key and `ai_provider = 'gemini'` uses that key for `chat()` calls.
3. A household with an Anthropic key and `ai_provider = 'anthropic'` routes `chat()` through the Anthropic adapter; tool calling works correctly through at least one full `consume_pantry_item` flow.
4. The `ai_api_key` column in the DB contains only versioned ciphertext — never a raw key.
5. All household API responses return `provider` and `maskedKey` — never the raw key.
6. PATCH `/api/household/ai-key` with `{ provider: null, key: null }` removes both columns and falls back to platform key.
7. If `ai_api_key` is set and decryption fails, `householdService.getAiConfig()` throws and the route returns 422 with a user-facing message. It does not silently fall back to the platform key.
8. `keyEncryption.test.js` passes: encrypt → decrypt round-trip, versioned format, maskKey output.
9. `parseReceipt`, `parseRecipeImage`, `eatThisNow`, `suggestRecipes`, `expandSuggestion` are unaffected — they continue using the platform Gemini key regardless of household BYOK configuration.
10. Missing `API_KEY_ENCRYPTION_SECRET` at startup does not crash the server. It throws only when a BYOK key is saved or decrypted.
11. A configured but undecryptable BYOK key returns 422 with message: "Your configured AI provider key could not be decrypted. Please update or remove it in Household Settings." Does not silently fall back.
12. `npm run build` passes clean.

---

## Verification Steps

1. `keyEncryption.test.js` — encrypt/decrypt round-trip, versioned format, maskKey format.
2. Household with no key set → chat works via platform key.
3. Set Gemini household key via UI → chat works; confirm in Vercel logs.
4. Set Anthropic household key via UI → send "I ate the chicken" → verify `consume_pantry_item` tool fires and `meal_logs` row written.
5. Remove key via UI → chat falls back to platform key.
6. Manually corrupt `ai_api_key` in Neon SQL Editor → trigger chat → confirm explicit error returned, no silent fallback.
7. Remove `API_KEY_ENCRYPTION_SECRET` from local `.env` → start server → confirm it starts cleanly; attempt to save a BYOK key → confirm clear error thrown.
8. `npm run build` passes clean.

---

## Known Risks / Open Questions

1. **`API_KEY_ENCRYPTION_SECRET` rotation** — if the secret changes, all stored household keys become undecryptable (AC #11 fires for all BYOK households). No rotation strategy is in scope. Ops risk: document in `.env.example` that this value must never change after first use without a coordinated re-encryption migration.
2. **Key validation on save is format-agnostic** — a syntactically plausible but invalid key won't surface until the first chat request. Acceptable for MVP.
3. **`AnthropicProvider` message array growth** — the adapter holds the full message array across tool loop iterations. For a single request this is bounded by `MAX_TOOL_ITERATIONS` (5) and is not a memory risk. Noted for awareness.
4. **`chat()` now does a DB call (householdService.getAiApiKey)** — adds one async DB round-trip per chat request for all households, including those with no BYOK key. This is one indexed primary-key lookup on `households` and is negligible in practice.
5. **Anthropic tool declaration translation** — both providers support JSON Schema `type`, `properties`, `required`, and `enum`. The current Gemini tool declarations use all four. Translation is mechanical. Risk is low.
6. **Vision/non-chat functions remain Gemini-only** — households on Anthropic BYOK still use the platform Gemini key for receipt parsing and recipe image parsing. This is a known limitation, documented in scope boundary. Future task to extend BYOK to these functions.

---

## Dependency Chain

```
New:
- server/db/migrations/0007_household_ai_api_key.sql
- server/utils/keyEncryption.js
- server/utils/keyEncryption.test.js
- server/services/ai/providerInterface.js
- server/services/ai/geminiProvider.js
- server/services/ai/anthropicProvider.js
- server/services/ai/resolveProvider.js

Editing:
- server/db/schema.js (add aiProvider, aiApiKey to households)
- server/services/aiService.js (chat() aiConfig param, provider resolution via resolveProvider, wrapAIError)
- server/routes/ai.js (add householdService import, call getAiConfig(), pass aiConfig to chat())
- server/routes/household.js (add PATCH /api/household/ai-key)
- server/services/householdService.js (add getAiApiKey, setAiApiKey, removeAiApiKey)
- client/src/pages/HouseholdPage.jsx (provider dropdown + key input)
- .env.example (document API_KEY_ENCRYPTION_SECRET)

Requires (read-only):
- server/services/aiService.js (current chat() signature and tool loop structure)
- server/routes/ai.js (confirm householdId is available via req.user)
- server/db/schema.js (current households columns)
- server/services/householdService.js (existing service patterns)

Irrelevant:
- server/routes/dietary.js
- server/utils/foodNormalization.js
- server/data/purineIndex.js
- server/services/mealLogService.js
- server/utils/recipeScorer.js
- client/src/hooks/useDietaryProfile.js
- client/public/sw.js
```

---

## Forbidden Exploration
- server/middleware/auth.js
- server/routes/auth.js
- server/routes/shopping.js
- server/routes/push.js
- server/services/pushService.js
- client/public/sw.js
- ai/tasks/archive/
