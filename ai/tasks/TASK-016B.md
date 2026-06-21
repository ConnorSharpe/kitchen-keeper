# TASK-016B — Clerk Auth + Per-User OpenAI BYOK

**Status:** APPROVED — Round 3 revisions applied  
**Author:** ConnorSharpe + Claude Sonnet 4.6  
**Date:** 2026-06-21  
**Depends on:** TASK-016A complete and deployed  
**Supersedes:** TASK-016 (split per architect recommendation)

---

## Goal

Three tightly coupled changes:

1. **Replace JWT auth with Clerk** — existing `server/middleware/auth.js` (JWT cookie-based) is replaced by Clerk session verification. `req.user.householdId` continues to flow into all routes and services unchanged — only the source of that value changes.

2. **Add per-user OpenAI BYOK** — each household can store their own OpenAI API key. This is stored encrypted at rest (AES-256-GCM) in the `households` table. The platform `OPENAI_API_KEY` env var is used for Connor's household only; other users must supply their own key.

3. **BYOK enforcement** — AI endpoints return a clear `NO_API_KEY` error if the requesting household has no `openaiApiKey` and the request is not from Connor's household. This ensures Connor does not pay for other users' AI usage.

---

## Background

### Current auth system (post-TASK-016A state)

The app has a working JWT cookie-based auth system in `server/middleware/auth.js`. On login, a JWT is issued containing `{ sub: userId, email, name, householdId }`. All routes use `requireAuth` middleware which verifies the token and populates `req.user.householdId`. All services receive `householdId` as a parameter — they have no auth dependency.

This means:
- **The service layer does not change in this task.** `pantryService`, `shelfLifeService`, etc. already take `householdId` as a parameter.
- **The route layer changes minimally.** `req.user.householdId` continues to work — only `requireAuth` middleware changes.
- **The client auth flow changes.** Cookie-based JWT is replaced by Clerk's session token (Bearer header).

### Why Clerk over keeping JWT

The current JWT system has no user registration flow suitable for the public — there is no sign-up UI, no email verification, no password reset, and no OAuth. Clerk provides all of this out of the box with pre-built React components, eliminating the need to build and maintain auth infrastructure.

Clerk free tier: 10,000 MAU — sufficient indefinitely for a portfolio project.

### Why per-user BYOK is in this task

BYOK enforcement requires knowing which household belongs to Connor vs. a public user. That distinction only exists once auth is in place. BYOK without auth means the platform key is always used — which is the problem to solve.

---

## Architecture

### Decision 1 — Clerk replaces JWT middleware only

`server/middleware/auth.js` is replaced with `server/middleware/clerkAuth.js`. The new middleware:
- Verifies the Clerk session token from the `Authorization: Bearer <token>` header (not a cookie)
- Looks up or creates the household associated with `clerkUserId`
- Populates `req.user = { id: clerkUserId, householdId }` in the same shape as before

All other route code continues reading `req.user.householdId` without changes. The import in each route file changes from `requireAuth` to `clerkAuth` — nothing else.

**Existing login/register routes** (`server/routes/auth.js` if it exists) are deleted. Clerk handles authentication entirely on the client side via its pre-built components. The server only verifies tokens it receives.

---

### Decision 2 — Household creation strategy

**Lazy creation on first authenticated request** is the simplest approach for this project. On every authenticated request, `clerkAuth.js` calls `householdService.getOrCreate(clerkUserId)`. If the household exists, it returns it. If not, it inserts one.

The UNIQUE constraint on `clerk_user_id` is the concurrency safety mechanism. Use `INSERT ... ON CONFLICT DO NOTHING` followed by a SELECT, which is atomic and avoids error handling entirely:

```js
async function getOrCreate(clerkUserId) {
  // Insert if not exists (idempotent — safe under concurrent requests)
  await db.insert(households)
    .values({ clerkUserId })
    .onConflictDoNothing();
  return db.query.households.findFirst({
    where: eq(households.clerkUserId, clerkUserId),
  });
}
```

This is safe for the concurrent first-request scenario — all parallel requests converge on the same SELECT result. No error handling required.

---

### Decision 3 — AES-256-GCM encryption for openaiApiKey

Raw API keys are not stored in the database. Before INSERT/UPDATE, the key is encrypted. After SELECT, it is decrypted. The encryption key is `ENCRYPTION_KEY` — a 32-byte hex string stored as a Vercel/`.env.local` environment variable.

```js
// server/utils/encryption.js
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encrypt(text) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(stored) {
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(encryptedHex, 'hex')) + decipher.final('utf8');
}
```

`householdService.js` calls `encrypt()` before storing and `decrypt()` after fetching. The decrypted key is placed in `aiConfig.decryptedKey` — the same field that `resolveProvider` already reads. No changes required in `resolveProvider.js` or `aiService.js` for the encryption layer.

`ENCRYPTION_KEY` must never appear in logs. Add to the explicit log prohibition list.

---

### Decision 4 — BYOK enforcement

The business rule: Connor's household uses the platform key; all other households must supply their own key.

The implementation uses an `OWNER_CLERK_ID` environment variable rather than a database flag. This is immutable, auditable, and cannot be corrupted by a DB edit:

```env
OWNER_CLERK_ID=user_xxxxxxxxxxxxxxxx   # Connor's Clerk user ID
```

`resolveProvider` after this task:

```js
function resolveProvider(aiConfig) {
  // OpenAI default path
  const isOwner = aiConfig.clerkUserId === process.env.OWNER_CLERK_ID;
  const key = isOwner
    ? process.env.OPENAI_API_KEY      // Connor's household — use platform key
    : aiConfig.decryptedKey;          // all others — must have BYOK key
  if (!key) throw new NoApiKeyError();
  return new OpenAIProvider(key);
}
```

`NoApiKeyError` is a new error class that `wrapAIError` maps to HTTP 403 with body `{ error: "Please add your OpenAI API key in Settings to use AI features.", code: "NO_API_KEY" }`.

**Why `OWNER_CLERK_ID` over `is_owner` column:**
- A DB flag can be accidentally duplicated (two rows become owner, both use platform billing)
- An env var is set once and never drifts
- No migration required to change ownership — just update the env var

The client renders a dismissible banner when it receives `code: "NO_API_KEY"`, linking to household settings.

**Decrypted key handling rules** (must be enforced in `householdService.js` and `clerkAuth.js`):
- Decrypted key is placed in `aiConfig.decryptedKey` for use within the request only
- Must not be persisted anywhere after the request completes
- Must not be cached at module level or attached to `req`
- Must not appear in any log output
- Add `decryptedKey` to the explicit log prohibition list alongside API keys

---

### Decision 5 — Remove Anthropic BYOK

The architect and Connor's use case both suggest that Anthropic BYOK adds maintenance burden without proportional value for a general public audience. With OpenAI as the only backend, the BYOK story simplifies to: "get an OpenAI key, paste it in settings."

`AnthropicProvider` is deleted in this task. `_translateTools` is no longer needed. The `'anthropic'` case in `resolveProvider` is removed. The Anthropic BYOK option is removed from the household settings UI.

If this decision is revisited, the `AIProvider` interface makes re-adding Anthropic straightforward.

---

## New and Modified Files

```
server/middleware/clerkAuth.js               ← NEW
server/middleware/auth.js                    ← DEPRECATE (keep for one release; do not delete)
server/utils/encryption.js                  ← NEW
server/services/householdService.js          ← add getOrCreate(clerkUserId); encrypt/decrypt key
server/services/ai/resolveProvider.js        ← add isOwner logic; remove 'anthropic' case
server/services/ai/anthropicProvider.js      ← DELETE
client/src/main.jsx                          ← wrap with <ClerkProvider>
client/src/App.jsx                           ← add /sign-in, /sign-up routes; protect app routes
client/src/pages/HouseholdPage.jsx           ← add openaiApiKey input; remove Anthropic option
client/src/api/client.js (or equivalent)     ← swap cookie auth for Bearer token header
server/db/schema.js                          ← add clerkUserId, openaiApiKey, isOwner columns
server/db/migrations/0010_clerk_byok.sql     ← NEW
server/app.js                                ← swap requireAuth import for clerkAuth in route mounts
server/package.json                          ← add @clerk/backend; remove jsonwebtoken (if unused)
client/package.json                          ← add @clerk/clerk-react
.env.example                                 ← add CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY,
                                                ENCRYPTION_KEY, OWNER_CLERK_ID; remove JWT_SECRET
```

**All protected route files** — update the `requireAuth` import to `clerkAuth`. No other changes to route logic:
- `server/routes/ai.js`
- `server/routes/pantry.js`
- `server/routes/recipes.js`
- `server/routes/shopping.js`
- `server/routes/household.js`
- `server/routes/dietary.js`
- `server/routes/push.js`

**Exempt from auth middleware (no changes needed):**
- `GET /api/health` — defined directly in `server/app.js`, no `requireAuth`, stays public
- `server/routes/auth.js` — deleted entirely; Clerk handles auth client-side

No other public routes exist. Every `/api/*` route except `/api/health` requires auth.

---

## Migration 0010

```sql
-- Add Clerk identity and encrypted BYOK key columns
ALTER TABLE households ADD COLUMN clerk_user_id TEXT UNIQUE;
ALTER TABLE households ADD COLUMN openai_api_key TEXT;   -- stores AES-256-GCM ciphertext (iv:authTag:encrypted)

-- After Clerk setup: link Connor's existing household
-- UPDATE households SET clerk_user_id = '<connor-clerk-user-id>'
-- WHERE id = '<existing-household-id>';

-- Set OWNER_CLERK_ID in Vercel env vars to Connor's Clerk user ID (no DB flag needed)

-- Verify
SELECT id, clerk_user_id FROM households;
SELECT openai_api_key FROM households WHERE openai_api_key IS NOT NULL;
-- openai_api_key values should look like: hex:hex:hex (not plaintext)
```

Apply manually in Neon SQL Editor. **Deploy after migration, not before.**

---

## Pre-Implementation Checklist

Before writing any code:

1. Create a Clerk account at clerk.com
2. Create a Clerk application; obtain `CLERK_SECRET_KEY` and publishable key
3. Confirm current Clerk-supported packages for a **Vite + React frontend + Express backend** stack (package names may have changed — do not hardcode from this spec; verify at docs.clerk.com at implementation time)
4. Generate `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. After Clerk sign-up, note your Clerk user ID — this becomes `OWNER_CLERK_ID`
6. Add `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `ENCRYPTION_KEY`, `OWNER_CLERK_ID` to `.env.local` and Vercel

---

## Allowed Files

```
server/middleware/clerkAuth.js               ← create
server/utils/encryption.js                   ← create
server/services/householdService.js          ← modify
server/services/ai/resolveProvider.js        ← modify
server/db/schema.js                          ← modify
server/db/migrations/0010_clerk_byok.sql     ← create
server/app.js                                ← modify
server/routes/ai.js                          ← import swap only
server/routes/pantry.js                      ← import swap only
server/routes/recipes.js                     ← import swap only
server/routes/shopping.js                    ← import swap only
server/routes/household.js                   ← import swap + remove Anthropic option
server/package.json                          ← modify
client/package.json                          ← modify
client/src/main.jsx                          ← modify
client/src/App.jsx                           ← modify
client/src/pages/HouseholdPage.jsx           ← modify
client/src/api/client.js                     ← modify
.env.example                                 ← modify
```

## Forbidden Files

```
server/services/aiService.js                 ← do not touch (TASK-016A complete)
server/services/ai/openaiProvider.js         ← do not touch
server/services/pantryService.js             ← do not touch
server/services/shelfLifeService.js          ← do not touch
server/services/recipeSearchService.js       ← do not touch
server/data/foodkeeper.json                  ← do not touch
server/db/migrations/0001-0009              ← do not touch
```

## Files Deprecated (keep for one release, delete in follow-on)

```
server/middleware/auth.js                    ← add /* DEPRECATED — replaced by clerkAuth.js */ comment;
                                                do not delete until Clerk deployment is confirmed stable
```

## Files Deleted

```
server/services/ai/anthropicProvider.js
```

---

## Constraints

1. `req.user.householdId` shape must be preserved — all route handlers rely on it.
2. `ENCRYPTION_KEY`, `CLERK_SECRET_KEY`, and `openai_api_key` ciphertext must never appear in logs.
3. Do not store the decrypted OpenAI key anywhere outside the request lifecycle (no module-level caching).
4. Clerk package names must be verified at docs.clerk.com at implementation time — do not hardcode the names from this spec.
5. `is_owner` flag is set manually in Neon — there is no automatic ownership assignment. Document this clearly in the migration file.
6. Do not run `node server/db/migrate.js` against production — apply migration 0010 manually.

---

## Acceptance Criteria

1. `npm run build` passes
2. Unauthenticated requests to `/api/*` return `401`
3. New user signs up via Clerk → household auto-created → confirmed in Neon
4. Race condition safe: opening the app with 3 parallel requests does not create duplicate households or 500 errors
5. Connor's household (`is_owner = TRUE`) uses platform `OPENAI_API_KEY` — AI features work without BYOK key set
6. Non-owner household with no `openaiApiKey` → AI endpoints return `{ code: "NO_API_KEY" }` → client renders "add key" banner
7. Non-owner household with valid `openaiApiKey` → AI features work; unit test confirms `resolveProvider` instantiates `OpenAIProvider` with the household key, not the platform key
8. `openaiApiKey` stored as ciphertext in DB (verify in Neon: value should be `iv:authTag:ciphertext` format, not plaintext)
9. Behavioral regression matrix B1–B8 passes for Connor's household
10. `AnthropicProvider` is fully removed — `grep -r "anthropicProvider\|AnthropicProvider" server/` returns zero matches

---

## Verification Steps

```
# Pre-implementation
1. Clerk account created; keys obtained
2. ENCRYPTION_KEY generated and added to .env.local and Vercel
3. Verify current Clerk package names at docs.clerk.com

# Post-implementation
4. npm run build
5. Local: unauthenticated GET /api/pantry → 401
6. Local: sign in via Clerk → GET /api/pantry → 200
7. Local: second parallel request on new user login → no duplicate household, no 500
8. Local: Connor household (is_owner = TRUE via manual DB update) → AI works
9. Local: test household with no openaiApiKey → POST /api/ai/eat-this-now → { code: "NO_API_KEY" }
10. Local: test household with openaiApiKey set → AI works; check OpenAI dashboard for key usage
11. Check Neon: SELECT openai_api_key FROM households → value should look like hex:hex:hex
12. Migration 0010 applied in Neon SQL Editor
13. Deploy to Vercel
14. Connor's household manually linked in Neon SQL Editor
15. Production smoke: chat, receipt, eat this now, expand suggestion
16. grep -r "anthropicProvider|AnthropicProvider" server/ → zero matches
```

---

## Dependency Chain

```
Editing:
- server/middleware/clerkAuth.js (new)
- server/utils/encryption.js (new)
- server/services/householdService.js
- server/services/ai/resolveProvider.js
- server/db/schema.js
- server/db/migrations/0010_clerk_byok.sql (new)
- server/app.js
- server/routes/ai.js (import swap)
- server/routes/pantry.js (import swap)
- server/routes/recipes.js (import swap)
- server/routes/shopping.js (import swap)
- server/routes/household.js
- client/src/main.jsx
- client/src/App.jsx
- client/src/pages/HouseholdPage.jsx
- client/src/api/client.js
- server/package.json, client/package.json
- .env.example

Deleting:
- server/middleware/auth.js
- server/services/ai/anthropicProvider.js

Requires (read-only, verify no changes needed):
- server/services/ai/openaiProvider.js
- server/services/aiService.js

Irrelevant (do not touch):
- server/services/pantryService.js
- server/services/shelfLifeService.js
- server/services/recipeSearchService.js
- server/data/foodkeeper.json
```

---

## Rollback Plan

If Clerk deployment fails (broken callback URL, Vercel config error, key mismatch):

```
1. In server/app.js: swap clerkAuth import back to requireAuth (auth.js is still present)
2. Re-add JWT_SECRET to Vercel env vars
3. Redeploy — app returns to JWT cookie auth immediately
4. Investigate Clerk configuration before re-attempting
```

`auth.js` is retained specifically for this rollback path. Delete it only after Clerk has been confirmed stable in production for at least one release cycle.

---

## Known Risks / Open Questions

1. **Clerk package names** — Clerk has changed package structures multiple times. The packages listed (`.env` keys, SDK names) must be verified at docs.clerk.com before implementation. The integration pattern for Vite + React + Express may differ from Next.js examples.

2. **Existing users after migration** — All current `households` rows have `clerk_user_id = NULL`. Any existing session cookies will be invalid after `auth.js` is deleted. For a private project (Connor only), this is acceptable — re-login via Clerk. For a public launch, existing users would need a migration path. This spec assumes private-to-public transition with Connor as the only existing user.

3. **`is_owner` is manually set** — There is no code path that sets `is_owner = TRUE` automatically. If the manual SQL UPDATE is not run before deploying, Connor's own household will return `NO_API_KEY` errors. Document this clearly in the migration file. Consider whether a fallback (e.g., env var `OWNER_CLERK_ID`) would be safer than a manual flag.

4. **Anthropic BYOK removal is a breaking change for any BYOK Anthropic users** — If anyone currently has an Anthropic key configured, their BYOK will stop working. For a portfolio project at this stage, this is acceptable. If reversing this decision, restore `anthropicProvider.js` and the `'anthropic'` case in `resolveProvider`.

5. **Clerk token delivery on client** — Clerk sessions can be delivered as cookies or Bearer tokens. The spec uses Bearer tokens. Ensure the Clerk React SDK is configured to expose the session token via `useAuth().getToken()` for inclusion in API request headers.
