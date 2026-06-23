# Task
TASK-016B — Clerk Auth + Per-User OpenAI BYOK

# Current Status
TASK-016B implementation complete. Client build passes. Packages installed. Pending:
1. Clerk account creation + env var setup (user action)
2. Migration 0010 applied in Neon SQL Editor (user action)
3. npm install verification in server (packages added, build not run — server build is Node, checked by start)
4. Push notifications follow-on: pushSubscriptions.userId is an integer FK to users table; req.user.id is now a Clerk string — push subscribe/unsubscribe will fail at runtime until schema updated (known, non-blocking for auth/BYOK)

# Files Modified (TASK-016B)

- `server/utils/encryption.js` — NEW: AES-256-GCM encrypt/decrypt (ENCRYPTION_KEY env var)
- `server/middleware/clerkAuth.js` — NEW: Clerk session verification + household getOrCreate
- `server/middleware/auth.js` — DEPRECATED: added comment; kept for rollback
- `server/db/schema.js` — added clerkUserId + openaiApiKey columns to households
- `server/db/migrations/0010_clerk_byok.sql` — NEW: SQL migration for Neon
- `server/services/householdService.js` — added getOrCreate; updated getAiConfig/getAiKeyPreview/setAiApiKey/removeAiApiKey for new openaiApiKey column
- `server/services/ai/resolveProvider.js` — OWNER_CLERK_ID enforcement; removed anthropic case; added NoApiKeyError
- `server/services/aiService.js` — removed AnthropicProvider import and instanceof checks (only surgical removal; system prompt unchanged)
- `server/services/ai/anthropicProvider.js` — DELETED
- `server/services/ai/providerInterface.js` — removed stale AnthropicProvider comment
- `server/app.js` — added clerkMiddleware; removed authRouter; updated REQUIRED_ENV; error handler includes err.code
- `server/routes/auth.js` — DELETED (old JWT login/register routes)
- `server/routes/ai.js` — import swap: requireAuth → clerkAuth
- `server/routes/pantry.js` — import swap: requireAuth → clerkAuth
- `server/routes/recipes.js` — import swap: requireAuth → clerkAuth
- `server/routes/shopping.js` — import swap: requireAuth → clerkAuth
- `server/routes/household.js` — import swap + ai-key endpoint updated (OpenAI only, no provider field)
- `server/routes/push.js` — import swap: requireAuth → clerkAuth
- `server/routes/dietary.js` — import swap: requireAuth → clerkAuth
- `client/src/api/index.js` — Bearer token auth via window.Clerk.session.getToken(); err.code propagated
- `client/src/main.jsx` — wrapped with ClerkProvider
- `client/src/App.jsx` — Clerk routes (/sign-in, /sign-up); PrivateRoute uses SignedIn/SignedOut
- `client/src/pages/HouseholdPage.jsx` — OpenAI key input only; Anthropic option removed
- `server/package.json` — added @clerk/express; removed @anthropic-ai/sdk
- `client/package.json` — added @clerk/clerk-react
- `.env.example` — added CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, ENCRYPTION_KEY, OWNER_CLERK_ID; removed JWT_SECRET

# Files Required Next (deployment)

- Apply migration 0010 in Neon SQL Editor
- Set env vars in Vercel: CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, ENCRYPTION_KEY, OWNER_CLERK_ID
- After deploy: run `UPDATE households SET clerk_user_id = '<clerk-id>' WHERE id = <connor-id>` in Neon
- Verify OWNER_CLERK_ID matches Connor's Clerk user ID before deploying

# Files Already Reviewed

- `server/services/ai/openaiProvider.js` — untouched; implements all 6 interface methods
- `server/services/ai/providerInterface.js` — comment cleaned; interface unchanged

# Dependency Chain

Editing:
- All files listed above

Requires (read-only):
- `server/services/ai/openaiProvider.js`

Irrelevant (do not touch):
- `server/services/pantryService.js`
- `server/services/shelfLifeService.js`
- `server/services/recipeSearchService.js`

# Architecture Notes

## Post-TASK-016B provider state
- All LLM: OpenAI gpt-4o-mini only
- BYOK: OpenAI only (Anthropic BYOK removed)
- `resolveProvider(clerkUserId, decryptedKey)`: isOwner check via OWNER_CLERK_ID env var
- `aiConfig.provider` field now carries clerkUserId (pragmatic compat with aiService.js call signature)
- `NoApiKeyError` → HTTP 403 + `{ error: "...", code: "NO_API_KEY" }`
- Client propagates `err.code` from API responses

## Key design decisions
- `getOrCreate` uses `onConflictDoUpdate` on clerkUserId + retry loop for join code collisions — safe under concurrent first-requests
- `encryption.js` uses `ENCRYPTION_KEY` (new); `keyEncryption.js` kept for `maskKey` only
- `req.user.id` = Clerk string ID; `req.user.householdId` = integer — all services unchanged
- Client token: `window.Clerk?.session?.getToken()` — no React hooks needed in api module
- `auth.js` (middleware) kept deprecated for rollback; `routes/auth.js` deleted

## Known issue: push notifications
- `pushSubscriptions.userId` is integer FK to `users` table
- `req.user.id` is now a Clerk string ID
- Push subscribe/unsubscribe will fail with FK constraint error
- Fix in follow-on task: update pushSubscriptions to use householdId or a new clerk_user_id column

## Pre-deployment checklist (user actions required)
1. Create Clerk account at clerk.com; create application
2. Generate ENCRYPTION_KEY: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Note your Clerk user ID (shown after sign-in) → OWNER_CLERK_ID
4. Add all env vars to .env.local and Vercel
5. Apply migration 0010 in Neon SQL Editor
6. Deploy
7. Sign in via Clerk → note your user ID → run UPDATE in Neon to link Connor's household
8. Verify: chat works for Connor; non-owner without key gets NO_API_KEY error

# Decisions Made

- `aiService.js` Anthropic references removed (AnthropicProvider import + instanceof checks) — minimal surgical change, system prompt and all TASK-016A work preserved
- `providerName`/`modelName` hardcoded to 'openai'/'gpt-4o-mini' in aiService.js (was `instanceof` branch)
- Push notifications intentionally left broken (FK type mismatch) — follow-on task
- HouseholdPage members section kept; invite section kept (though users table no longer populated by new signups — cosmetic issue, non-blocking)

# Remaining Work

- Push notifications: update pushSubscriptions schema to use clerk_user_id or householdId
- HouseholdPage members section: will show 0 members for Clerk users (users table not populated) — update in follow-on
- Behavioral regression B1-B8 for Connor's household post-deploy
- Receipt vision benchmark (pending from 016A)

# Known Risks

- **OWNER_CLERK_ID not set before deploy** → Connor's household gets NO_API_KEY errors. Document clearly.
- **Push notification FK failure** — push.js uses `req.user.id` (Clerk string) as integer userId
- **Rollback path**: revert `server/app.js` to import authRouter + requireAuth; add back JWT_SECRET to Vercel env
- **Clerk package version** — installed @clerk/express@1.7.81 and @clerk/clerk-react@5.61.8; verify these are stable at docs.clerk.com

# Verification Results

- Client build: PASS (`npm run build` in client/)
- AnthropicProvider grep: CLEAN
- requireAuth in active routes: CLEAN
- Server install: PASS (@clerk/express installed)

# Recommended Next Action

User pre-deployment checklist (items 1-8 above). After env vars set and migration applied, deploy and run production smoke test.

# Forbidden Exploration

- `client/public/sw.js`
- `server/db/migrations/0001-0009`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Context Notes

- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block

N/A — working directly on main.
