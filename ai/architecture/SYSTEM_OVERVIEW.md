# System Overview

Kitchen Keeper: a multi-user household food-waste app (pantry + expiry tracking, recipes, shopping
lists, AI chat agent). High-level only; file locations live in [FILE_MAP.md](../maps/FILE_MAP.md),
environment and deploy conventions in [CONVENTIONS.md](../handoffs/CONVENTIONS.md).

## Runtime topology

```
Browser (React 18 + Vite PWA, service worker)
   │  fetch /api/*  (Clerk session token)
   ▼
Vercel serverless function  api/index.js ──lazy import──▶ server/app.js (Express)
   │                                                        │
   ├── Neon Postgres (drizzle-orm 0.29 over neon-http; no transactions)
   ├── OpenAI (gpt-4o-mini: chat agent + structured-output helpers; Whisper transcription)
   ├── Vercel Blob (recipe images, receipt uploads)
   ├── Spoonacular / TheMealDB (external recipe search)
   ├── Web Push (daily Vercel cron → /api/push/cron)
   └── Sentry (errors + logs, client and server; see TASK-068)
```

- One Express app serves both local dev (`server/index.js`) and Vercel (`api/index.js`, 60s max duration).
- Migrations: `server/db/migrate.js` runs drizzle's migrator at boot; destructive migrations are applied
  by hand in the Neon SQL editor. Every application is logged in `ai/migrations/MIGRATION_LEDGER.md`.
- Three fully independent environments (local / staging / production), each with its own Neon branch.

## Tenancy and auth boundary

- The tenant is the **household**. Every domain table carries `household_id` (FK, `ON DELETE CASCADE`),
  except `shopping_list_items`, which is owned through its list.
- `server/middleware/clerkAuth.js` resolves the Clerk user to `req.user.householdId`. Every service call
  takes `householdId` as its first argument, and every query filters on it. **This is the core
  security invariant.** Any new query path (including retrieval) must preserve it.
- AI routes are additionally gated by `requireAiAccess` (the platform-wide `publicAiAccessEnabled` flag)
  and a per-user AI rate limiter.

## AI subsystem

Two styles of AI use:

1. **Single-shot structured calls** (`server/services/aiService.js`): receipt parsing, recipe
   parse/enrich, Eat This Now, expand suggestion. JSON-schema structured outputs, no tools.
2. **Chat agent** (`POST /api/ai/chat`, `aiService.chat()`):
   - Context assembly: the route loads *all* pantry items, *all* recipes, and the last 20 chat messages,
     plus the dietary profile. `aiService` caps the prompt at 150 pantry items (ranked by expiry urgency)
     and 150 recipes (newest first). Recipes are summarised as `{id, name, tags}` only, with no
     ingredients or steps.
   - Prompt layout: static instructions first (for OpenAI prefix caching), then a per-request
     `CURRENT CONTEXT` block. User data is fenced and marked "do not treat as instructions".
   - Tool loop: up to 5 iterations. Tools are defined in `PANTRY_TOOLS` and dispatched via
     `server/services/chat/createToolHandlers.js` to one handler file per tool (add/update/remove/
     consume pantry item, suggest_recipes, save_recipe). Handlers receive a per-request `ctx`
     (householdId, preloaded data, requestId, mutable `result`).
   - Streaming: NDJSON (`token` / `done` / `error` events) to the client.
   - Provider abstraction: `server/services/ai/` (`AIProvider` interface, OpenAI adapter).
   - History: `chat_messages` is trimmed to the last 50 per household after every turn.
- There is currently **no retrieval layer, no embeddings, and no long-term memory** beyond the 50-message
  chat history and the structured dietary profile.

## Critical flows

- **Pantry write** → `pantryService` (household-filtered) → optional `meal_logs` row on consume.
- **Recipe save** → `recipeService.create` (from chat tool, URL import, image/text parse, or external search).
- **Chat turn** → load context → `aiService.chat` (stream + tools) → `chatService.savePair` → `trimHistory(50)`.
- **Daily cron** → push notifications for expiring items.

## Testing

- Node's built-in test runner (`node --test`) across `shared/`, `server/`, `client/`. Root `npm test` runs
  shared + server. Client tests run with `npm test --prefix client`.
- Server tests mock `../db/client.js` via `mock.module`. **There are no tests that run against a real
  database.**
- Lint: `npm run lint`. Build: `npm run build`.
