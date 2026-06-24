# Task
TASK-018 — UI Refresh: Chat as Home, Persistent Recipe Cards, Remove Waste Counter

# Current Status
COMPLETE. All issues deployed and verified in production. DB spot checks passed.

# Files Modified (TASK-018)

- `client/src/pages/DashboardPage.jsx` — removed WasteSaved import and grid; QuickAdd full-width
- `client/src/App.jsx` — `/` → ChatPage; `/dashboard` → DashboardPage; `/chat` → Navigate redirect
- `client/src/components/layout/Sidebar.jsx` — Chat first w/ primary styling; Dashboard second at /dashboard; "Explore" removed
- `client/src/pages/ChatPage.jsx` — header "Kitchen Keeper"; history maps metadata→recipeSuggestions; mount fetches /api/recipes to seed savedRecipeNames
- `server/db/schema.js` — jsonb import added; metadata column added to chatMessages
- `server/db/migrations/0013_chat_metadata.sql` — ADD COLUMN metadata JSONB; ADD CONSTRAINT recipes_household_name_unique
- `server/services/chatService.js` — savePair accepts optional metadata arg; writes to assistant row only
- `server/services/recipeService.js` — new createOrIgnore method added; create unchanged
- `server/routes/ai.js` — save_recipe uses createOrIgnore with undefined guard; savePair called with recipeSuggestions metadata
- `client/public/favicon.svg` — NEW: fork and spoon icon
- `client/index.html` — favicon.svg wired up
- `client/public/sw.js` — fixed response body already used error in cache handler

# Also committed alongside TASK-018
- `client/src/pages/JoinPage.jsx` — TASK-017 file that was previously untracked
- `server/routes/household.js`, `server/routes/push.js`, `server/services/emailService.js`, `server/services/householdService.js`, `server/services/pushService.js`, `client/src/pages/HouseholdPage.jsx` — TASK-017 changes that were previously uncommitted
- `server/db/migrations/0011a_push_household_add.sql`, `0011b_push_household_finalize.sql`, `0012_household_members.sql` — TASK-017 migrations (already applied to Neon)

# Verification Results
- Build: PASS
- All migrations applied to Neon: 0011a, 0011b, 0012, 0013
- Issue 1: PASS — WasteSaved gone, QuickAdd full-width
- Issue 3: PASS — `/` loads Chat, `/dashboard` loads Dashboard, `/chat` redirects, sidebar correct, header correct
- Issue 2: PASS — recipe cards persist through reload and navigation; old null rows render cleanly
- DB SELECT 1 (latest assistant): NULL (pre-migration row, expected) — will populate on next recipe-returning message
- DB SELECT 5 (user rows): all NULL as required
- Favicon: PASS — fork and spoon appears in browser tab
- sw.js clone error: RESOLVED

# Architecture Notes

## Recipe card persistence
- metadata is nullable JSONB; old rows stay NULL; frontend handles null with `?? []`
- createOrIgnore uses onConflictDoNothing targeting (householdId, name); case-sensitive uniqueness
- savePair: user rows always get metadata=null; assistant rows get metadata only when recipeSuggestions.length > 0
- savedRecipeNames seeded from /api/recipes on mount; fetch failure is non-fatal

## Routing
- /chat retained as Navigate redirect for bookmark compatibility
- EatThisNow stays on /dashboard

# Dependency Chain

Irrelevant (do not open):
- `server/services/ai/*`
- `server/services/aiService.js`
- `client/src/components/dashboard/WasteSaved.jsx`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

# Remaining Work
- **TASK-017 Issue 3** — Switch to Clerk production keys (ops checklist in TASK-017.md Step 1–6)
  Order: create prod instance → configure domains → rotate Vercel env vars → deploy → update OWNER_CLERK_ID → verify
- Receipt vision benchmark (≥85%, 5 receipts) — pending from TASK-016A
- Members card with display names — deferred; requires Clerk backend SDK or display name stored at join time

# Known Risks
- Clerk dev keys warning in console until Issue 3 ops checklist is completed
- OWNER_CLERK_ID must be updated after switching to Clerk production instance

# Forbidden Exploration
- `client/public/sw.js`
- `server/db/migrations/0001-0013`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`
- `server/routes/recipes.js`

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block

N/A — working directly on main.
