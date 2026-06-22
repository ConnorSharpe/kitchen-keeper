# Task
TASK-016A — OpenAI provider migration — IMPLEMENTED, pending deployment

# Current Status
TASK-016A code is complete and committed. Build passes. Grep checks pass.

Pending before declaring done:
- `OPENAI_API_KEY` added to Vercel env vars (user action)
- OpenAI monthly spending cap set (user action, recommended $20)
- Run Deployment SQL in Neon SQL Editor (user action)
- Deploy to Vercel
- Behavioral regression matrix B1–B8
- Receipt vision benchmark (≥85% accuracy, 5 receipts)
- Verify Anthropic BYOK tool calling still works

# Files Modified (TASK-016A)

Created:
- `server/services/ai/openaiProvider.js`

Modified:
- `server/services/ai/resolveProvider.js`
- `server/services/ai/providerInterface.js` (stale comment fix)
- `server/services/aiService.js`
- `server/routes/household.js`
- `server/routes/ai.js`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/ChatPage.jsx`
- `server/package.json`
- `.env.example`

Deleted:
- `server/services/ai/groqProvider.js`
- `server/services/ai/geminiProvider.js`

# Files Required Next (TASK-016B)

- `server/middleware/auth.js` — replaced by Clerk in 016B
- `server/db/schema.js` — Migration 0010 adds clerk_user_id + openai_api_key columns
- `client/src/main.jsx`, `client/src/App.jsx` — Clerk provider wiring

# Files Already Reviewed

- `server/services/ai/providerInterface.js` — 6-method interface, tools are OpenAI format
- `server/services/ai/groqProvider.js` — deleted
- `server/services/ai/geminiProvider.js` — deleted
- `server/services/ai/anthropicProvider.js` — untouched; _translateTools unchanged
- `server/services/aiService.js` — fully rewritten for OpenAI
- `server/routes/ai.js` — isByok + _limitWarning removed
- `server/routes/household.js` — Zod enum updated to anthropic-only
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

## Post-TASK-016A provider state
- All LLM functions: OpenAI `gpt-4o-mini` (chat + vision + JSON mode)
- BYOK: Anthropic only — `anthropicProvider.js` retained, `_translateTools` unchanged
- Gemini fallback: fully removed
- `resolveProvider`: `'anthropic'` → AnthropicProvider(key); `null` → OpenAIProvider(OPENAI_API_KEY)
- `eatThisNow`/`expandSuggestion`: no longer take provider/isByok — always use platform OpenAI key
- `parseReceipt`/`parseRecipeImage`: OpenAI vision via `response_format: json_object` not needed (raw JSON array/object returned by prompt)

## TASK-016B summary (implement after 016A is stable in production)
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
- `wrapAIError` simplified: all `AIProviderError` → generic 503 (no classify429 branch)

# Remaining Work

## Deployment (user actions)
1. `OPENAI_API_KEY` → add to `.env.local` and Vercel env vars
2. Set spending cap ($20/month) at platform.openai.com
3. Run Deployment SQL in Neon SQL Editor:
   ```sql
   UPDATE households SET ai_provider = NULL, ai_api_key = NULL WHERE ai_provider = 'groq';
   SELECT count(*) FROM households WHERE ai_provider = 'groq'; -- must return 0
   ```
4. Deploy to Vercel
5. Behavioral regression B1–B8
6. Receipt vision benchmark (≥85%, 5 receipts)
7. Anthropic BYOK regression (tool calling with real key)

## TASK-016B (implement after 016A stable)
8–23. See TASK-016B.md

# Known Risks

- **Hard deadline August 16, 2026** — must deploy 016A before this date (55 days remain as of 2026-06-22)
- **OpenAI spending cap** — must be set before deploying. A tool loop bug could cause unbounded charges.
- **gpt-4o-mini tool calling** — may differ from Groq Llama. Regression matrix B1–B8 is the primary gate.
- **Anthropic `_translateTools`** — highest-risk retained component. Must be regression-tested.
- **Vision quality** — gpt-4o-mini vision generally stronger than llama-3.2-11b-vision-instruct; receipt parsing should improve but revalidate with 5 receipts.

# Verification Results

- TASK-016A build: PASS (`npm run build`)
- TASK-016A grep check: PASS (zero matches for groq-sdk, google/generative-ai, groqProvider, geminiProvider)
- TASK-016A deployment: PENDING
- TASK-016B: PENDING

# Recommended Next Action

1. Add `OPENAI_API_KEY` to `.env.local` and set spending cap
2. Run Deployment SQL in Neon
3. Deploy to Vercel
4. Run behavioral regression B1–B8

# Forbidden Exploration

- `client/public/sw.js`
- `server/db/migrations/0001-0008`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: deploy TASK-016A and run regression matrix

# PowerShell Merge Block

N/A — working directly on main.
