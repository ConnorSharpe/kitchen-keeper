# TASK-018 — UI Refresh: Chat as Home, Persistent Recipe Cards, Remove Waste Counter

**Status:** APPROVED v3 — architect approval received (Round 2); revised per architect + Claude code review  
**Author:** ConnorSharpe + Claude Sonnet 4.6  
**Date:** 2026-06-23  
**Depends on:** TASK-017 deployed  
**Priority order:** Issue 1 (trivial) → Issue 3 (nav/routing) → Issue 2 (schema + persistence)

---

## Architect Review Summary (Round 1)

**Approved:** Issue 1, Issue 3.  
**Conditionally approved:** Issue 2 — required revision before implementation.

**Hard blocker raised:** Message contract between runtime-created messages and history-loaded messages was not explicitly verified. Architect could not confirm all fields consumed by recipe card rendering were preserved on history load.

**Claude's assessment of Round 1:**

*Hard blocker — partially valid, severity lower than stated.*
Grepped `ChatPage.jsx` lines 196–322 for all fields accessed by the recipe card renderer. Every field (`recipe.name`, `recipe.ingredients`, `recipe.prepSteps`, `recipe.unmatchedIngredients`, `recipe.sourceUrl`, `recipe.description`, `recipe.prepMins`, `recipe.cookMins`, `recipe.servings`, `recipe.allergyNote`, `recipe.healthNote`) comes from within the recipe object itself, stored verbatim in `metadata.recipeSuggestions`. The `isSaved` and `loading` states come from component state, not the message object. Card rendering is safe.

The real gap is `msg.itemsAdded` — present on runtime messages but not mapped in the history load. The renderer uses `msg.itemsAdded?.length > 0` which safely handles `undefined`, so there is no crash. "+item added to pantry" badges won't reappear on reload; this is acceptable (they are transient confirmations, not persistent UI). The spec will explicitly document this.

*Architect missed: `save_recipe` is not idempotent.* `recipeService.create` is a plain `INSERT` with no `onConflictDoNothing` or `onConflictDoUpdate`. Since `savedRecipeNames` is initialized as an empty Set on every mount, history-loaded cards always show "Save Recipe" regardless of prior saves. Clicking the button calls `send("save <name>")` → the AI calls `save_recipe` → `recipeService.create` inserts a **duplicate recipe row**. This is a data integrity issue introduced by persisting cards. Fix: add `onConflictDoNothing` to `recipeService.create` (name + householdId uniqueness) AND initialize `savedRecipeNames` from the household's existing saved recipes on ChatPage mount.

*Medium Risk #1 — `/chat` grep confirmed resolved.* Grep of `client/src/**/*.{jsx,js}` for `/chat` returns only `App.jsx:44` and `Sidebar.jsx:64` (nav references, both in scope) plus `ChatPage.jsx:29,58` (API paths `/api/ai/chat/...`, not navigation routes). No post-login redirects, CTAs, onboarding flows, or other nav references exist. Spec constraint verified accurate.

*Medium Risk #2 — metadata versioning.* Accepted. `version: 1` added to stored metadata object at near-zero cost.

*Minor findings — all incorporated:* rollback migration added; explicit constraint that user rows always store `metadata = null`; DB verification SQL added; dashboard bookmark callout elevated.

**Changes in v2:**
- Issue 2: explicit message contract table added
- Issue 2: `itemsAdded` handling documented (intentionally not persisted; renderer handles undefined safely)
- Issue 2: `isSaved` / duplicate save risk added as known risk; two-part fix specified (`onConflictDoNothing` on `recipeService.create` + initialize `savedRecipeNames` from saved recipes on mount)
- Issue 2: `version: 1` added to metadata object shape
- Issue 2: rollback SQL added to migration spec
- Issue 2: explicit constraint — user rows always `metadata = null`
- Issue 2: DB verification SQL step added
- Issue 3: `/chat` grep result noted as confirmed-resolved check
- `server/services/recipeService.js` added to Allowed Files (Issue 2 duplicate fix)
- `server/db/schema.js` recipes table uniqueness constraint noted

---

## Architect Review Summary (Round 2)

**Approved:** All issues.  
**Required revisions:** Two, both minor.

**New Issue #1 (architect):** `recipeService.create` return contract change is potentially breaking — other callers may not handle `undefined`. Required: grep all call sites before changing the return contract.

**Claude's assessment of Round 2 Issue #1:**
Grepped `server/` for `recipeService.create`. Found **4 call sites**:
- `server/routes/ai.js:60` → `res.status(201).json({ recipe: saved })` — passes return value directly to response
- `server/routes/ai.js:165` → `res.status(201).json({ recipe: saved })` — same pattern
- `server/routes/ai.js:454` → `save_recipe` tool handler — already patched in v2 spec
- `server/routes/recipes.js:47` → `res.status(201).json({ recipe })` — same pattern

The architect is correct. Changing `create` to return `undefined` on conflict would cause 3 additional callers to respond with `{ recipe: undefined }` — not a crash, but a broken API contract for legitimate operations. The right fix is **not** to update all 3 callers. Instead, add a new `createOrIgnore(householdId, data)` method alongside the existing `create`. The `save_recipe` tool handler uses `createOrIgnore`; all other callers continue using `create` unchanged.

**New Issue #2 (architect):** Unique constraint is case-sensitive — `"Chicken Soup"` and `"chicken soup"` would be treated as distinct. For a personal-use app, case-sensitive uniqueness is acceptable. Documented explicitly.

**New Issue #3 (architect):** Acceptance criterion overstates saved-state behavior — the `/api/recipes` fetch has a silent `.catch(() => {})` fallback, so correct "Saved" state is not guaranteed. Criterion wording adjusted.

**Constraint #3 wording (architect):** The optional parameter is `metadata` (4th argument), not `recipeSuggestions` (3rd argument). Fixed.

**Changes in v3:**
- Issue 2: `onConflictDoNothing` moved from `create` to a new `createOrIgnore` method — `create` contract preserved
- Issue 2: `save_recipe` handler updated to call `createOrIgnore` instead of `create`
- Issue 2: `server/routes/recipes.js` explicitly listed as a forbidden file (no changes needed there)
- Issue 2: case-sensitive uniqueness documented
- Issue 2: acceptance criterion for saved state qualified with fetch-failure fallback
- Constraint #3 wording corrected (`metadata` is optional 4th argument)

---

## Goal

Three independent UI improvements:

1. **Remove "Items Saved from Waste" counter** from the Dashboard — a vanity metric with no actionable drill-down.
2. **Persist recipe cards through chat history** — currently recipe cards are rendered from a runtime-only array that is never saved to the DB, so they revert to plain text on page reload or navigation.
3. **Promote chat to the default home screen** — the AI chat is the most valuable feature but is buried at the bottom of the nav under the label "Explore" with secondary styling.

---

## Allowed Files

### Server
- `server/db/schema.js` — add `metadata` column to `chatMessages`; add uniqueness constraint to `recipes` (Issue 2)
- `server/db/migrations/0013_chat_metadata.sql` — new migration (Issue 2)
- `server/routes/ai.js` — pass `recipeSuggestions` to `chatService.savePair` (Issue 2)
- `server/services/chatService.js` — update `savePair` signature (Issue 2)
- `server/services/recipeService.js` — add new `createOrIgnore` method alongside existing `create`; `create` is not modified (Issue 2)

### Client
- `client/src/pages/DashboardPage.jsx` — remove `WasteSaved` import and section (Issue 1)
- `client/src/App.jsx` — make Chat the index route, move Dashboard to `/dashboard`, keep `/chat` as redirect (Issue 3)
- `client/src/components/layout/Sidebar.jsx` — reorder nav, promote Chat to primary styling, rename "Explore" → "Chat", update Dashboard link (Issue 3)
- `client/src/pages/ChatPage.jsx` — update page title; hydrate `recipeSuggestions` from history metadata; initialize `savedRecipeNames` from saved recipes on mount (Issue 2 + Issue 3)

---

## Forbidden Files

- `server/middleware/clerkAuth.js`
- `server/services/aiService.js`
- `server/services/ai/*`
- `server/services/householdService.js`
- `server/services/pushService.js`
- `client/src/components/dashboard/WasteSaved.jsx` — leave the file; only remove usage from DashboardPage
- `server/routes/recipes.js` — no changes needed; `create` callers here are unaffected
- `client/public/sw.js`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

---

## Constraints

1. `WasteSaved.jsx` component file is NOT deleted — only its import and usage in `DashboardPage.jsx` are removed. The `wasteSaved` value in `PantryContext` is also left untouched.
2. The `metadata` column is nullable JSONB. Old `chat_messages` rows have `NULL` metadata — the frontend must treat `null` identically to `{ recipeSuggestions: [] }`.
3. `chatService.savePair` must remain backward-compatible: `metadata` is an optional fourth argument defaulting to `null`; callers that omit it must not break.
4. **User message rows always store `metadata = null`.** Metadata is only written on the assistant insert in `savePair`. No other code path should write metadata to a user-role row.
5. The `/chat` route is retained as a `<Navigate to="/" replace />` redirect to preserve any existing bookmarks.
6. Issue 3 routing: only `App.jsx` and `Sidebar.jsx` are touched as navigation files. Confirmed via grep: no other client file references `/chat` as a navigation target. API paths (`/api/ai/chat/...`) are unaffected.
7. No changes to the AI prompt, tool definitions, or `aiService.js`.
8. Migration 0013 must be applied to Neon before code is deployed.

---

## Issue 1 — Remove "Items Saved from Waste" Counter (TRIVIAL)

### Root Cause

`WasteSaved` displays a single integer with no drill-down and no next action. It occupies half the bottom row of Dashboard inside a `grid grid-cols-1 md:grid-cols-2` layout alongside `QuickAdd`.

### Changes — `client/src/pages/DashboardPage.jsx`

1. Remove `import WasteSaved from '../components/dashboard/WasteSaved.jsx'`
2. Replace the 2-column grid with a full-width `QuickAdd` section:

**Before:**
```jsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <section aria-labelledby="quickadd-heading">
    <h2 id="quickadd-heading" className="sr-only">Quick Add</h2>
    <QuickAdd />
  </section>

  <section aria-labelledby="waste-heading">
    <h2 id="waste-heading" className="sr-only">Waste Saved</h2>
    <WasteSaved />
  </section>
</div>
```

**After:**
```jsx
<section aria-labelledby="quickadd-heading">
  <h2 id="quickadd-heading" className="sr-only">Quick Add</h2>
  <QuickAdd />
</section>
```

No other files change for this issue.

---

## Issue 2 — Persist Recipe Cards Through Chat History (MEDIUM)

### Root Cause

`recipeSuggestions` is populated inside `POST /api/ai/chat` during tool handler execution, collected into a runtime array, and returned via `res.json({ reply, itemsAdded, recipeSuggestions })`. It is never written to the database.

`chatService.savePair` saves only `content` (the text reply). When `ChatPage` mounts and loads history via `GET /api/ai/chat/history`, each row returns `{ id, role, content, householdId, createdAt }` with no recipe data. The `recipeSuggestions` field on the message object defaults to `[]`, so cards never render after reload or navigation.

### Message contract

**Runtime-created message shape** (set in `send()` at response time):
```js
{
  key: nextTempId(),      // temp string id
  role: 'assistant',
  content: reply,
  itemsAdded: itemsAdded ?? [],
  recipeSuggestions: recipeSuggestions ?? [],
}
```

**History-loaded message shape** (after this spec's changes):
```js
{
  id,                     // integer DB id
  householdId,
  role: 'assistant',
  content,
  metadata,               // { version: 1, recipeSuggestions: [...] } | null
  createdAt,
  key: String(m.id),      // mapped from id
  recipeSuggestions: m.metadata?.recipeSuggestions ?? [],  // mapped from metadata
}
```

**Fields consumed by recipe card renderer and their source:**

| Field | Source | Present at runtime | Present in history |
|---|---|---|---|
| `recipe.name` | recipe object in `recipeSuggestions` | ✓ | ✓ (stored in metadata) |
| `recipe.ingredients` | recipe object | ✓ | ✓ |
| `recipe.prepSteps` | recipe object | ✓ | ✓ |
| `recipe.unmatchedIngredients` | recipe object | ✓ | ✓ |
| `recipe.sourceUrl` | recipe object | ✓ | ✓ |
| `recipe.description` | recipe object | ✓ | ✓ |
| `recipe.prepMins / cookMins / servings` | recipe object | ✓ | ✓ |
| `recipe.allergyNote / healthNote` | recipe object | ✓ | ✓ |
| `isSaved` | `savedRecipeNames` Set (component state) | ✓ | ✓ (see below) |
| `loading` | component state | ✓ | ✓ |
| `msg.itemsAdded` | runtime only | ✓ | intentionally absent — see note |

**`itemsAdded` note:** History-loaded messages do not map `itemsAdded`. The "+item added to pantry" badges are transient confirmations that do not need to survive navigation. The renderer uses `msg.itemsAdded?.length > 0`, which safely returns `false` for undefined — no crash, no visual regression beyond the expected absence of these badges on reload.

### `isSaved` state and duplicate save risk

**Problem:** `savedRecipeNames` is initialized as `new Set()` on every mount. History-loaded cards always show "Save Recipe" regardless of prior saves. Clicking the button calls `send("save <name>")` → the AI calls `save_recipe` → `recipeService.create` does a plain `INSERT` with no conflict handling → **duplicate recipe row created in the DB.**

Grep of `server/` for `recipeService.create` found **4 call sites**:
- `server/routes/ai.js:60` → `res.status(201).json({ recipe: saved })` — passes return directly to response
- `server/routes/ai.js:165` → `res.status(201).json({ recipe: saved })` — same pattern
- `server/routes/ai.js:454` → `save_recipe` tool handler — the only call site needing conflict safety
- `server/routes/recipes.js:47` → `res.status(201).json({ recipe })` — same pattern

Changing `create` to return `undefined` on conflict would silently break the other 3 callers. The shared `create` contract must not change.

**Two-part fix:**

**Part A — add `createOrIgnore` to `recipeService`.** New method alongside existing `create`. `create` is unchanged. Only the `save_recipe` tool handler calls `createOrIgnore`. Recipe name uniqueness is **case-sensitive** (Postgres default) — `"Chicken Soup"` and `"chicken soup"` are treated as distinct rows. This is acceptable for a personal-use application and is explicitly documented as a known limitation.

This requires a unique index on `recipes(household_id, name)`. Added to migration 0013.

**Part B — initialize `savedRecipeNames` from saved recipes on ChatPage mount:** On mount, alongside the history load, fetch saved recipe names from the existing `GET /api/recipes` endpoint and seed the Set. When the fetch succeeds, history-loaded cards for already-saved recipes show "Saved" (disabled). When the fetch fails, the Set remains empty and cards show "Save Recipe" — the `createOrIgnore` guard in Part A still prevents DB duplicates regardless.

```js
// In ChatPage mount effect — run in parallel with history load
api.get('/api/recipes')
  .then(({ recipes }) => {
    setSavedRecipeNames(new Set(recipes.map((r) => r.name)));
  })
  .catch(() => {}); // non-fatal; falls back to empty Set
```

Part A protects data integrity regardless of Part B. Part B provides correct UI state when the fetch succeeds. Both are required.

### Schema changes — `server/db/schema.js`

**1. Add `metadata` column to `chatMessages`:**

```js
import { pgTable, serial, integer, text, jsonb } from 'drizzle-orm/pg-core';

export const chatMessages = pgTable('chat_messages', {
  id:          serial('id').primaryKey(),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  role:        text('role').notNull(),
  content:     text('content').notNull(),
  metadata:    jsonb('metadata'),  // null for user rows and old assistant rows
  createdAt:   text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

`jsonb` must be added to the `drizzle-orm/pg-core` import alongside existing named imports.

**2. Add unique constraint to `recipes` table** (enables `onConflictDoNothing` in `recipeService.createOrIgnore`):

Add `.unique()` to the name+householdId combination, or use a `pgTable` third-argument index definition. Exact Drizzle syntax to be confirmed against current `recipes` table definition in `schema.js`.

### Migration — `server/db/migrations/0013_chat_metadata.sql`

```sql
-- Add metadata column to chat_messages
ALTER TABLE chat_messages
  ADD COLUMN metadata JSONB;

-- Add unique constraint to recipes (enables safe re-save of history-loaded cards)
ALTER TABLE recipes
  ADD CONSTRAINT recipes_household_name_unique UNIQUE (household_id, name);

-- Down migration (if needed):
-- ALTER TABLE recipes DROP CONSTRAINT recipes_household_name_unique;
-- ALTER TABLE chat_messages DROP COLUMN metadata;
```

Note: `ADD CONSTRAINT ... UNIQUE` on an existing table with duplicate rows will fail. Run this first to check:
```sql
SELECT household_id, name, COUNT(*)
FROM recipes
GROUP BY household_id, name
HAVING COUNT(*) > 1;
```
If duplicates exist, deduplicate before applying. For a personal-use project this is unlikely but must be verified.

### Service changes — `server/services/chatService.js`

**`savePair`** — accept optional `metadata` argument and persist it with the assistant row only:

```js
export async function savePair(householdId, userMessage, assistantReply, metadata = null) {
  await db.insert(chatMessages).values({ householdId, role: 'user',      content: userMessage });
  await db.insert(chatMessages).values({ householdId, role: 'assistant', content: assistantReply, metadata });
}
```

User row always receives `metadata = null` implicitly (column default is NULL and no value is passed). `getHistory` requires no changes — `db.select()` already returns all columns.

### Service changes — `server/services/recipeService.js`

Add a new `createOrIgnore` method alongside the existing `create`. `create` is NOT modified — its return contract is unchanged:

```js
// Existing create() — unchanged, returns row or throws on constraint violation
export async function create(householdId, data) { ... }

// New method — returns row if inserted, undefined if (household_id, name) already exists
export async function createOrIgnore(householdId, data) {
  const [row] = await db
    .insert(recipes)
    .values({ ...serialize(data), householdId })
    .onConflictDoNothing({ target: [recipes.householdId, recipes.name] })
    .returning();
  return row; // undefined on conflict — only the save_recipe handler calls this
}
```

Only `save_recipe` in `ai.js` calls `createOrIgnore`. All other call sites (`ai.js:60`, `ai.js:165`, `recipes.js:47`) continue using `create` and are not modified.

### Route changes — `server/routes/ai.js`

**1. Pass `recipeSuggestions` into `savePair`:**

```js
// Before:
await chatService.savePair(householdId, message, reply);

// After:
await chatService.savePair(
  householdId,
  message,
  reply,
  recipeSuggestions.length > 0 ? { version: 1, recipeSuggestions } : null
);
```

**2. Update `save_recipe` handler to call `createOrIgnore` and handle `undefined` return:**

```js
save_recipe: async (args) => {
  // ... existing validation and expansion ...
  const saved = await recipeService.createOrIgnore(householdId, { ...full, source: 'agent_saved' });
  const name = saved?.name ?? parsed.name;  // fallback when conflict was ignored
  return { ok: true, recipe: { id: saved?.id, name } };
},
```

### Client changes — `client/src/pages/ChatPage.jsx`

**1. Initialize `savedRecipeNames` from saved recipes on mount** (run in parallel with history load):

```js
useEffect(() => {
  // Load chat history
  api.get('/api/ai/chat/history')
    .then(({ messages: history }) => {
      setMessages(history.map((m) => ({
        ...m,
        key: String(m.id),
        recipeSuggestions: m.metadata?.recipeSuggestions ?? [],
      })));
      setHistoryLoaded(true);
    })
    .catch(() => { setHistoryLoaded(true); });

  // Seed savedRecipeNames so history-loaded cards show correct "Saved" state
  api.get('/api/recipes')
    .then(({ recipes }) => {
      setSavedRecipeNames(new Set(recipes.map((r) => r.name)));
    })
    .catch(() => {}); // non-fatal
}, []);
```

**2. Map metadata on history load** — already shown above in the updated `setMessages` call.

No changes to card rendering JSX.

---

## Issue 3 — Chat as Default Home Screen (MEDIUM)

### Current state

- `/` → `DashboardPage`
- `/chat` → `ChatPage` (labeled "Explore", styled as secondary nav)
- Sidebar: Chat below a `<hr>`, `text-xs text-gray-400` (visually demoted)

### Target state

- `/` → `ChatPage`
- `/dashboard` → `DashboardPage`
- `/chat` → `<Navigate to="/" replace />` (backward-compatible redirect)

### Changes — `client/src/App.jsx`

```jsx
import { Navigate } from 'react-router-dom';

// Inside the private route block:
<Route index element={<ChatPage />} />
<Route path="/dashboard" element={<DashboardPage />} />
<Route path="/chat" element={<Navigate to="/" replace />} />
<Route path="/pantry" element={<PantryPage />} />
<Route path="/recipes" element={<RecipesPage />} />
<Route path="/shopping" element={<ShoppingPage />} />
<Route path="/household" element={<HouseholdPage />} />
```

The `/join` public route is unchanged.

### Changes — `client/src/components/layout/Sidebar.jsx`

Chat moves to position 1 with full primary `navClass` styling (identical to Pantry/Recipes/Shopping). Dashboard moves to position 2 with link updated to `/dashboard`. "Explore" label → "Chat". The secondary-styled `/chat` block is replaced. The `<hr>` divider stays above Household only.

```jsx
<nav className="flex-1 p-3 space-y-1 overflow-y-auto">
  <NavLink to="/" end className={navClass} onClick={() => setMobileOpen(false)}>
    <span aria-hidden>💬</span>
    Chat
  </NavLink>

  <NavLink to="/dashboard" className={navClass} onClick={() => setMobileOpen(false)}>
    <span aria-hidden>🏠</span>
    Dashboard
  </NavLink>

  <NavLink to="/pantry" className={navClass} onClick={() => setMobileOpen(false)}>
    <span aria-hidden>🥦</span>
    Pantry
    {expiringCount > 0 && (
      <span
        className="ml-auto text-xs bg-amber-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-tight"
        aria-label={`${expiringCount} items expiring soon`}
      >
        {expiringCount}
      </span>
    )}
  </NavLink>

  <NavLink to="/recipes" className={navClass} onClick={() => setMobileOpen(false)}>
    <span aria-hidden>📖</span>
    Recipes
  </NavLink>

  <NavLink to="/shopping" className={navClass} onClick={() => setMobileOpen(false)}>
    <span aria-hidden>🛒</span>
    Shopping
  </NavLink>

  <div className="my-2 border-t border-gray-100" />

  <NavLink
    to="/household"
    onClick={() => setMobileOpen(false)}
    className={({ isActive }) =>
      `flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
        isActive
          ? 'bg-gray-100 text-gray-700'
          : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
      }`
    }
  >
    <span aria-hidden>🏡</span>
    Household
  </NavLink>
</nav>
```

### Changes — `client/src/pages/ChatPage.jsx`

Update page header title:

```jsx
<h1 className="text-lg font-semibold text-gray-800">Kitchen Keeper</h1>
```

Subtitle unchanged.

**Release note:** Users who previously bookmarked `/` will land on Chat instead of Dashboard. This is intentional. Dashboard remains accessible at `/dashboard` and from the nav.

---

## Dependency Chain

### Editing
- `server/db/schema.js`
- `server/db/migrations/0013_chat_metadata.sql` (new)
- `server/routes/ai.js`
- `server/services/chatService.js`
- `server/services/recipeService.js`
- `client/src/pages/DashboardPage.jsx`
- `client/src/App.jsx`
- `client/src/components/layout/Sidebar.jsx`
- `client/src/pages/ChatPage.jsx`

### Requires (read-only, already reviewed)
- `server/db/client.js` — Drizzle client import pattern confirmed
- `server/db/schema.js` — `chatMessages` shape confirmed; `recipes` table uniqueness constraint to be verified before applying migration
- `client/src/pages/ChatPage.jsx` — message shape and renderer fields fully audited

### Irrelevant
- `server/services/ai/*`
- `server/services/aiService.js`
- `client/src/components/dashboard/WasteSaved.jsx`
- `client/public/sw.js`
- `server/data/foodkeeper.json`
- `ai/tasks/archive/`

---

## Acceptance Criteria

### Issue 1 — Remove Waste Counter
- [ ] `WasteSaved` component does not appear on Dashboard
- [ ] `QuickAdd` is full-width on all breakpoints
- [ ] `WasteSaved.jsx` file still exists (not deleted)
- [ ] No console errors related to `wasteSaved` from PantryContext

### Issue 2 — Persist Recipe Cards
- [ ] Migration 0013 applied; `chat_messages.metadata` column exists in Neon
- [ ] Migration 0013 applied; `recipes_household_name_unique` constraint exists in Neon
- [ ] After sending a message that returns recipe suggestions, refreshing the page re-renders the same recipe cards
- [ ] Navigating away from Chat and back re-renders recipe cards from history
- [ ] Old messages (metadata = NULL) render no cards and no errors
- [ ] When `/api/recipes` fetch succeeds on mount, history-loaded cards for already-saved recipes show "Saved" (disabled); unsaved cards show "Save Recipe"
- [ ] Clicking "Save Recipe" on a history-loaded card for an already-saved recipe does not create a duplicate in the DB
- [ ] `chatService.savePair` called without metadata argument does not throw
- [ ] DB spot check: `SELECT metadata FROM chat_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1;` returns `{ "version": 1, "recipeSuggestions": [...] }`
- [ ] User message rows: `SELECT metadata FROM chat_messages WHERE role='user' LIMIT 5;` returns all NULL

### Issue 3 — Chat as Default Home
- [ ] Navigating to `/` renders the Chat page
- [ ] Navigating to `/dashboard` renders the Dashboard page
- [ ] Navigating to `/chat` redirects to `/` without a 404
- [ ] "Chat" is the first nav item, rendered in full primary styling (same weight/color as Pantry)
- [ ] "Dashboard" is the second nav item, link goes to `/dashboard`
- [ ] "Explore" label is gone from the nav
- [ ] Chat page header reads "Kitchen Keeper"
- [ ] Pantry expiring-items badge still appears correctly
- [ ] Household nav item is still below the divider in secondary styling
- [ ] Sign out and sign back in → lands on Chat (`/`)

---

## Verification Steps

```
Issue 1:
1. Load /dashboard → WasteSaved widget not present
2. QuickAdd fills full width on md+ screens

Issue 2 — pre-deploy:
1. Check for duplicate recipes: SELECT household_id, name, COUNT(*) FROM recipes GROUP BY household_id, name HAVING COUNT(*) > 1;
   → Must return 0 rows before applying migration 0013
2. Apply migration 0013
3. Confirm: \d chat_messages → metadata column present (nullable jsonb)
4. Confirm: \d recipes → recipes_household_name_unique constraint present

Issue 2 — post-deploy:
5. Send chat message asking for recipe suggestions → cards render
6. Refresh page → same cards still render
7. Navigate to /pantry, return to / → cards still render
8. Old messages (pre-migration) → no cards, no JS errors in console
9. DB spot check: SELECT metadata FROM chat_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1;
   → { "version": 1, "recipeSuggestions": [...] }
10. User rows check: SELECT metadata FROM chat_messages WHERE role='user' LIMIT 5;
    → all NULL
11. History-loaded card for a previously saved recipe → button shows "Saved" (disabled) on mount
12. Click "Save Recipe" on any history-loaded card → check recipes table: no duplicate rows

Issue 3:
1. Load / → Chat page renders (not Dashboard)
2. Load /dashboard → Dashboard renders
3. Load /chat → redirects to /
4. Sidebar: Chat is item 1, active/highlighted when on /
5. Sidebar: Dashboard is item 2, navigates to /dashboard
6. Sign out and sign back in → lands on /
```

---

## Known Risks / Open Questions

- **Issue 2 — `jsonb` Drizzle import:** Confirm `jsonb` is exported from `drizzle-orm/pg-core`. It is standard in drizzle-orm ≥ 0.28 — verify version in `package.json` before implementing.
- **Issue 2 — duplicate recipes pre-migration:** Run the duplicate check SQL before applying migration 0013. Duplicates in `recipes` table will cause `ADD CONSTRAINT ... UNIQUE` to fail.
- **Issue 2 — `recipeService.create` returns `undefined` on conflict:** The `save_recipe` tool handler must guard against `saved` being `undefined`. Returning `{ ok: true }` with the known name is sufficient.
- **Issue 2 — `/api/recipes` response shape:** Verify the recipes endpoint returns `{ recipes: [...] }` with a `name` field on each item before implementing the `savedRecipeNames` seed call in ChatPage.
- **Issue 3 — EatThisNow on Dashboard:** The expiring-items AI suggestion panel stays on `/dashboard`. Users who relied on it as their first screen will need to navigate there. Acceptable for now; could be surfaced on the Chat empty state in a future task.

---

## Context Notes

- branch: main (no worktree needed)
- worktree: none
- context pressure: low

## PowerShell Merge Block

N/A — working directly on main.
