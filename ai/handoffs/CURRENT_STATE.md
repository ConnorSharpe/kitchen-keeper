# Task
TASK-018 — UI Refresh: Chat as Home, Persistent Recipe Cards, Remove Waste Counter

# Current Status
All three issues fully implemented. Build PASS. Migration 0013 must be applied to Neon before deploying.

# Files Modified (TASK-018)

- `client/src/pages/DashboardPage.jsx` — removed WasteSaved import and grid; QuickAdd full-width (Issue 1)
- `client/src/App.jsx` — `/` → ChatPage; `/dashboard` → DashboardPage; `/chat` → Navigate redirect (Issue 3)
- `client/src/components/layout/Sidebar.jsx` — Chat first w/ primary styling; Dashboard second at /dashboard; "Explore" removed (Issue 3)
- `client/src/pages/ChatPage.jsx` — header "Kitchen Keeper"; history maps metadata→recipeSuggestions; mount fetches /api/recipes to seed savedRecipeNames (Issues 2+3)
- `server/db/schema.js` — jsonb import added; metadata column added to chatMessages
- `server/db/migrations/0013_chat_metadata.sql` — NEW: ADD COLUMN metadata JSONB; ADD CONSTRAINT recipes_household_name_unique
- `server/services/chatService.js` — savePair accepts optional metadata arg (4th); writes to assistant row only
- `server/services/recipeService.js` — new createOrIgnore method added; create unchanged
- `server/routes/ai.js` — save_recipe uses createOrIgnore with undefined guard; savePair called with recipeSuggestions metadata

# Deployment Sequence (CRITICAL)

## Step 1: Check for duplicate recipes (MUST be 0 rows before migration)
```sql
SELECT household_id, name, COUNT(*)
FROM recipes
GROUP BY household_id, name
HAVING COUNT(*) > 1;
```

## Step 2: Apply migration 0013 to Neon
```sql
-- From server/db/migrations/0013_chat_metadata.sql
ALTER TABLE chat_messages ADD COLUMN metadata JSONB;
ALTER TABLE recipes ADD CONSTRAINT recipes_household_name_unique UNIQUE (household_id, name);
```

## Step 3: Deploy application code

## Step 4: Verify
1. `/` → Chat page renders (not Dashboard)
2. `/dashboard` → Dashboard renders, no WasteSaved widget
3. `/chat` → redirects to `/`
4. Sidebar: Chat is item 1 (primary styling), Dashboard is item 2
5. Send chat message with recipe suggestions → cards render
6. Refresh page → same recipe cards re-render from history
7. Navigate to /pantry, return → cards still render
8. Old messages (metadata = NULL) → no cards, no JS errors
9. DB: `SELECT metadata FROM chat_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1;` → `{ "version": 1, "recipeSuggestions": [...] }`
10. DB: `SELECT metadata FROM chat_messages WHERE role='user' LIMIT 5;` → all NULL

# Architecture Notes

## Issue 1 — Waste Counter (complete)
- WasteSaved.jsx component file left intact; only DashboardPage import+usage removed
- wasteSaved value in PantryContext untouched

## Issue 2 — Recipe card persistence (complete)
- metadata is nullable JSONB; old rows stay NULL; frontend handles null with `?? []`
- createOrIgnore uses onConflictDoNothing targeting (householdId, name); case-sensitive uniqueness (acceptable for personal-use)
- savePair: user rows always get metadata=null (not passed); assistant rows get metadata only when recipeSuggestions.length > 0
- savedRecipeNames seeded from /api/recipes on mount; fetch failure is non-fatal (createOrIgnore guards DB integrity regardless)
- itemsAdded intentionally not persisted — transient UI badges; renderer handles undefined safely

## Issue 3 — Chat as home (complete)
- /chat retained as Navigate redirect for bookmark compatibility
- Grep confirmed no other nav references to /chat outside App.jsx and Sidebar.jsx
- EatThisNow stays on /dashboard

# Dependency Chain

Editing:
- client/src/pages/DashboardPage.jsx
- client/src/App.jsx
- client/src/components/layout/Sidebar.jsx
- client/src/pages/ChatPage.jsx
- server/db/schema.js
- server/db/migrations/0013_chat_metadata.sql (new)
- server/services/chatService.js
- server/services/recipeService.js
- server/routes/ai.js

Requires (read-only, already reviewed):
- server/db/client.js — Drizzle client pattern confirmed
- server/routes/recipes.js — no changes; create callers unaffected

Irrelevant:
- server/services/ai/*
- server/services/aiService.js
- client/src/components/dashboard/WasteSaved.jsx
- client/public/sw.js
- server/data/foodkeeper.json
- ai/tasks/archive/

# Verification Results
- Build: PASS (vite build, 9.20s, 0 errors)
- Migration 0013: NOT YET APPLIED (pending Neon deploy)

# Known Risks
- Duplicate recipe check must pass (0 rows) before applying migration 0013
- Migration 0013 must be applied before code deploy (chatService.savePair writes metadata column on every assistant message)
- /api/recipes response shape `{ recipes: [...] }` with `name` field — confirmed from existing route

# Remaining Work
- Apply migration 0013 to Neon (duplicate check first)
- Deploy and run verification steps above
- Issue 3 (prod Clerk keys) ops checklist from TASK-017 — still pending
- Receipt vision benchmark (≥85%, 5 receipts) — pending from TASK-016A
- Members card with display names — deferred

# Forbidden Exploration
- `client/public/sw.js`
- `server/db/migrations/0001-0012`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`
- `server/routes/recipes.js`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block

N/A — working directly on main.
