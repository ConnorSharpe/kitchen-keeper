# Task
TASK-016B — Clerk auth + per-user BYOK (OpenAI)

# Current Status
TASK-016A complete and stable in production. Behavioral regression B1–B7 passed against gpt-4o-mini. B8 (tool failure recovery) skipped — requires simulated DB error, low priority. Receipt vision benchmark and Anthropic BYOK regression are outstanding but not blocking 016B.

TASK-016B is next.

# Files Modified (TASK-016A — this session)

- `server/services/aiService.js` — added `console.error` to `wrapAIError` for diagnostic logging; added three system prompt instructions:
  1. Call tools before responding with text
  2. Consume tool fires immediately without confirmation
  3. Mixed-intent messages: tool call first, then answer the question

# Files Required Next (TASK-016B)

- `server/middleware/auth.js` — replace with Clerk (`clerkAuth.js`)
- `server/db/schema.js` — Migration 0010: add `clerk_user_id` + `openai_api_key` columns to `households`
- `server/services/householdService.js` — `getOrCreate(clerkUserId)` pattern
- `server/services/ai/resolveProvider.js` — `OWNER_CLERK_ID` enforcement
- `server/utils/encryption.js` — new AES-256-GCM utility (create)
- `client/src/main.jsx`, `client/src/App.jsx` — Clerk provider wiring

# Files Already Reviewed

- `server/services/ai/providerInterface.js` — 6-method interface, tools in OpenAI format
- `server/services/ai/openaiProvider.js` — implements all 6 interface methods
- `server/services/ai/anthropicProvider.js` — untouched; `_translateTools` unchanged
- `server/services/aiService.js` — fully on OpenAI; system prompt tuned for gpt-4o-mini behavior
- `server/routes/ai.js` — isByok + _limitWarning removed
- `server/routes/household.js` — Zod enum: anthropic-only
- `client/src/pages/HouseholdPage.jsx` — Groq option removed
- `client/src/pages/ChatPage.jsx` — warning banner removed

# Dependency Chain

Editing (TASK-016B):
- `server/middleware/auth.js` → replace with clerkAuth.js
- `server/db/schema.js` → Migration 0010
- `server/services/householdService.js` → getOrCreate(clerkUserId)
- `server/services/ai/resolveProvider.js` → OWNER_CLERK_ID enforcement
- `server/utils/encryption.js` → new AES-256-GCM utility
- `client/src/main.jsx`, `client/src/App.jsx`

Deleting (TASK-016B):
- `server/services/ai/anthropicProvider.js`
- `server/routes/auth.js`

Irrelevant (do not touch):
- `server/services/pantryService.js`
- `server/services/shelfLifeService.js`
- `server/services/recipeSearchService.js`

# Architecture Notes

## Post-TASK-016A provider state (stable)
- All LLM functions: OpenAI `gpt-4o-mini` (chat + vision + JSON mode)
- BYOK: Anthropic only — retained for now; removed in 016B
- `resolveProvider`: `'anthropic'` → AnthropicProvider(key); `null` → OpenAIProvider(OPENAI_API_KEY)
- `eatThisNow`/`expandSuggestion`: always use platform OpenAI key

## gpt-4o-mini behavior notes (discovered during smoke test)
- Model will answer questions before calling tools unless explicitly instructed otherwise
- Mixed-intent messages ("I ate X, how many calories?") require explicit instruction to tool-call first
- System prompt now contains three instructions to enforce correct tool-call ordering
- These instructions should be preserved through 016B

## TASK-016B summary
- Replace JWT auth (`auth.js`) with Clerk — keep `auth.js` deprecated for one release as rollback
- Add `clerk_user_id` and `openai_api_key` (encrypted) columns to `households` (Migration 0010)
- `OWNER_CLERK_ID` env var identifies Connor's household (uses platform key); all others must BYOK
- AES-256-GCM encryption for stored OpenAI keys (`server/utils/encryption.js`)
- Remove Anthropic BYOK and `anthropicProvider.js` (OpenAI only after 016B)
- `ON CONFLICT DO NOTHING` pattern for household auto-creation

# Decisions Made

- OpenAI `gpt-4o-mini` is the only model string
- `eatThisNow`/`expandSuggestion` always use platform key (no BYOK for these until 016B)
- `buildToolResult` includes `name` field for OpenAI (harmless, not required by API)
- `wrapAIError` logs `err.cause` before wrapping — keep this in place for future debugging
- B8 (tool failure recovery) skipped during smoke test — not blocking

# Remaining Work

## Outstanding from TASK-016A (non-blocking)
- Receipt vision benchmark (≥85%, 5 receipts)
- Anthropic BYOK regression (tool calling with real key)

## TASK-016B
- See `ai/tasks/TASK-016B.md`

# Known Risks

- **Hard deadline August 16, 2026** — must deploy 016B before this date (54 days remain as of 2026-06-22)
- **Anthropic `_translateTools`** — not regression-tested this session; still highest-risk retained component until 016B removes it
- **gpt-4o-mini tool ordering** — mitigated by system prompt instructions; monitor in production

# Verification Results

- TASK-016A build: PASS
- TASK-016A grep check: PASS
- TASK-016A deployment: PASS
- Behavioral regression B1: PASS
- Behavioral regression B2: PASS
- Behavioral regression B3: PASS
- Behavioral regression B4: PASS
- Behavioral regression B5: PASS
- Behavioral regression B6: PASS (required 3 system prompt iterations)
- Behavioral regression B7: PASS
- Behavioral regression B8: SKIPPED
- Receipt vision benchmark: PENDING
- Anthropic BYOK regression: PENDING

# Recommended Next Action

Begin TASK-016B. Read `ai/tasks/TASK-016B.md` for full spec. Start with Migration 0010 and `encryption.js` before touching auth.

# Forbidden Exploration

- `client/public/sw.js`
- `server/db/migrations/0001-0008`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: implement TASK-016B (Clerk auth + per-user OpenAI BYOK)

# PowerShell Merge Block

N/A — working directly on main.
