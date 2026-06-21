# Task
TASK-016A approved and ready for implementation.

# Current Status
TASK-015 and all prior tasks complete and committed to main.

TASK-016 (original combined spec) has been split into two tasks per architect review:
- **TASK-016A** — OpenAI provider migration. APPROVED. Ready to implement. Hard deadline August 16, 2026.
- **TASK-016B** — Clerk auth + per-user BYOK. APPROVED. Implement after 016A is deployed and stable.

# Files Modified (this session — spec work only, no code changes)

New:
- `ai/tasks/TASK-016A.md` — OpenAI provider migration spec (approved, Round 3)
- `ai/tasks/TASK-016B.md` — Clerk auth + BYOK spec (approved, Round 3)

Modified:
- `ai/tasks/TASK-016.md` — superseded; redirects to 016A and 016B
- `ai/handoffs/CURRENT_STATE.md` — this file

# Files Required Next (TASK-016A)

**Must read before writing any code:**
- `server/services/ai/providerInterface.js` — interface audit (known: 6 methods, no parseImage/jsonCompletion)
- `server/services/ai/groqProvider.js` — understand current vision/chat call shapes before deleting
- `server/services/ai/anthropicProvider.js` — confirm _translateTools still works after Groq removal
- `server/services/aiService.js` — locate all Groq/Gemini call sites; find withGroqFallback, geminiCallCount

**Create:**
- `server/services/ai/openaiProvider.js`

**Modify:**
- `server/services/ai/resolveProvider.js`
- `server/services/ai/providerInterface.js` (stale comment fix only)
- `server/services/aiService.js`
- `server/services/householdService.js`
- `server/routes/household.js`
- `server/routes/ai.js`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/ChatPage.jsx`
- `server/package.json`
- `.env.example`

**Delete:**
- `server/services/ai/groqProvider.js`
- `server/services/ai/geminiProvider.js`

**Do NOT touch:**
- `server/middleware/auth.js`
- `server/db/schema.js`
- `server/services/pantryService.js`
- `server/services/shelfLifeService.js`
- `server/services/recipeSearchService.js`
- `client/src/main.jsx`
- `client/src/App.jsx`

# Files Already Reviewed (this session)

- `server/middleware/auth.js` — JWT cookie auth; populates `req.user.householdId`; all routes use this pattern
- `server/routes/ai.js` — uses `req.user.householdId`; `resolveProvider` called per-request
- `server/routes/pantry.js` — uses `req.user.householdId`; service layer takes householdId as param
- `server/app.js` — route mounts confirmed; `/api/health` is the only public route; `authRouter` at `/api/auth`
- `server/services/ai/providerInterface.js` — 6 methods: `startChatSession({ systemPrompt, tools, history })`, `sendMessage`, `extractToolCalls`, `extractText`, `buildToolResult({ callId, name, result })`, `isResponseValid`. No parseImage or jsonCompletion. Stale comment references Gemini format.

# Dependency Chain

Editing (TASK-016A):
- `server/services/ai/openaiProvider.js` (new)
- `server/services/ai/resolveProvider.js`
- `server/services/ai/providerInterface.js` (comment only)
- `server/services/aiService.js`
- `server/services/householdService.js`
- `server/routes/household.js`
- `server/routes/ai.js`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/ChatPage.jsx`
- `server/package.json`, `.env.example`

Deleting (TASK-016A):
- `server/services/ai/groqProvider.js`
- `server/services/ai/geminiProvider.js`

Requires (read-only):
- `server/services/ai/providerInterface.js`
- `server/services/ai/anthropicProvider.js`

Irrelevant (TASK-016A — do not touch):
- `server/middleware/auth.js`
- `server/db/schema.js`
- `server/services/pantryService.js`
- `server/services/shelfLifeService.js`
- `server/services/recipeSearchService.js`
- `client/src/main.jsx`, `client/src/App.jsx`

# Architecture Notes

## Current AI provider state (pre-TASK-016A)
- Chat/eatThisNow/expandSuggestion: Groq `llama-3.3-70b-versatile` (primary) → Gemini `gemini-2.5-flash` (quota fallback)
- Vision (parseReceipt, parseRecipeImage): Groq `llama-3.2-11b-vision-instruct`
- Recipe suggestion: Spoonacular (primary) + TheMealDB (fallback) — zero LLM tokens
- BYOK: Groq or Anthropic key per household, stored in `households.aiApiKey`

## Target AI provider state (post-TASK-016A)
- All LLM functions: OpenAI `gpt-4o-mini` (chat + vision + JSON mode)
- Recipe suggestion: unchanged (Spoonacular + TheMealDB)
- BYOK: Anthropic only (Groq option removed); Anthropic `_translateTools` unchanged
- Gemini fallback: removed entirely (`withGroqFallback`, `geminiCallCount`, `_limitWarning` all deleted)

## Key implementation notes for TASK-016A
- `PANTRY_TOOLS` is already in OpenAI format — no translation needed for OpenAIProvider
- `parseImage` and `jsonCompletion` are NOT in the AIProvider interface — call OpenAI SDK directly from `aiService.js` for vision and JSON-mode functions
- `buildToolResult` takes object `{ callId, name, result }` — match this signature exactly
- `startChatSession` takes object `{ systemPrompt, tools, history }` — match this signature exactly
- `response_format: { type: 'json_object' }` requires "json" in the prompt — verify all JSON prompts
- Run Deployment SQL in Neon before deploying (NULL out `aiProvider = 'groq'` rows)
- Set OpenAI monthly spending cap before deploying

## TASK-016B summary (implement after 016A is stable)
- Replace JWT auth (`auth.js`) with Clerk — keep `auth.js` deprecated for one release as rollback
- Add `clerk_user_id` and `openai_api_key` (encrypted) columns to `households` (Migration 0010)
- `OWNER_CLERK_ID` env var identifies Connor's household (uses platform key); all others must BYOK
- AES-256-GCM encryption for stored OpenAI keys (`server/utils/encryption.js`)
- Remove Anthropic BYOK and `anthropicProvider.js` (OpenAI only after 016B)
- `ON CONFLICT DO NOTHING` pattern for household auto-creation
- Only public route: `GET /api/health` (defined in `app.js`, no auth middleware)

## Existing auth architecture (important for TASK-016B context)
- `server/middleware/auth.js` — JWT cookie (`req.cookies.token`), verified with `JWT_SECRET`
- All routes apply `requireAuth` at router level (`router.use(requireAuth)`)
- `req.user = { id, email, name, householdId }` — populated from JWT payload
- All services take `householdId` as a parameter — service layer has zero auth dependency
- `server/routes/auth.js` — handles login/register; will be deleted in TASK-016B (Clerk replaces it)

# Decisions Made

- Split TASK-016 into 016A (OpenAI migration) and 016B (Clerk + BYOK) per architect recommendation
- OpenAI `gpt-4o-mini` chosen as backbone — commercial tier, stable lifecycle, handles chat + vision
- Anthropic BYOK retained in 016A, removed in 016B (OpenAI only in final state)
- `OWNER_CLERK_ID` env var over `is_owner` DB column for billing enforcement
- AES-256-GCM for OpenAI key encryption at rest
- `auth.js` kept deprecated for one release post-016B as rollback path
- HTTP 403 (not 402) for `NO_API_KEY` error

# Remaining Work

## TASK-016A (implement now — before August 16, 2026)
1. Obtain `OPENAI_API_KEY` from platform.openai.com; set spending cap ($20/month)
2. Complete interface audit (read providerInterface.js, groqProvider.js, anthropicProvider.js, aiService.js)
3. `npm install openai` in `server/`
4. Create `openaiProvider.js` implementing 6 AIProvider interface methods
5. Update `resolveProvider.js` — remove Groq case, add OpenAI default
6. Update `aiService.js` — remove fallback system; wire vision/JSON calls directly via OpenAI SDK
7. Update household route Zod enum and BYOK dropdown UI
8. Remove `_limitWarning` banner from `ChatPage.jsx`
9. Delete `groqProvider.js`, `geminiProvider.js`; uninstall `groq-sdk`, `@google/generative-ai`
10. Run Deployment SQL in Neon SQL Editor
11. Deploy to Vercel
12. Run behavioral regression matrix B1–B8
13. Run receipt vision benchmark (≥85% accuracy, 5 receipts)
14. Verify Anthropic BYOK tool calling still works

## TASK-016B (implement after 016A is stable)
15. Create Clerk account; obtain keys
16. Generate `ENCRYPTION_KEY`; add `OWNER_CLERK_ID` to env
17. Implement `clerkAuth.js` middleware + `encryption.js` utility
18. Add `householdService.getOrCreate(clerkUserId)` with `ON CONFLICT DO NOTHING`
19. Update `resolveProvider.js` — `OWNER_CLERK_ID` enforcement
20. Run Migration 0010
21. Wire Clerk to React client
22. Deprecate `auth.js` (keep for rollback); delete `anthropicProvider.js`
23. Deploy; link Connor's household in Neon; verify BYOK enforcement

# Known Risks

- **Hard deadline August 16, 2026** — `llama-3.3-70b-versatile` stops on free/dev tier. TASK-016A must ship before this date. 56 days remain as of 2026-06-21.
- **OpenAI spending cap** — must be set before deploying TASK-016A. Without it, a tool loop bug could result in unbounded charges.
- **gpt-4o-mini tool calling behavior** — may differ from Groq Llama. Regression matrix B1–B8 is the primary gate.
- **Anthropic `_translateTools`** — highest-risk retained component post-016A. Must be regression-tested with real tool calls.
- **Clerk package names** — verify at docs.clerk.com at 016B implementation time; packages have changed before.
- **`auth.js` deletion** — do not delete until Clerk is confirmed stable in production for one release.

# Verification Results

- TASK-015: PASS (committed to main)
- TASK-016A: PENDING (not yet implemented)
- TASK-016B: PENDING (not yet implemented)

# Recommended Next Action

Implement TASK-016A. Read `ai/tasks/TASK-016A.md` in full, then complete the interface audit before writing any code.

# Forbidden Exploration

- `client/public/sw.js`
- `server/db/migrations/0001-0008`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes

- branch: main
- worktree: none
- context pressure: low
- next agent: implement TASK-016A (OpenAI provider migration)

# PowerShell Merge Block

N/A — working directly on main.
