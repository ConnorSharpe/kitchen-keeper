# Task
TASK-012 — BYOK spec approved, ready for implementation (2026-06-09)

# Current Status
TASK-011 complete and deployed. TASK-012 (BYOK) spec approved after 3 architect review rounds — implementation ready.

Production infrastructure fixes applied this session:
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` were missing from Vercel env vars — regenerated and added
- Gemini model changed from `gemini-2.0-flash` (no free tier) to `gemini-2.5-flash` (1,500 req/day free tier)
- Debug log added then removed from `aiService.js` during diagnosis

TASK-011 smoke tests not yet completed — deferred; owner will use their own Claude API key via TASK-012 BYOK for testing.

# Files Modified (this session)

### New
- `server/db/migrations/0005_meal_logs.sql`
- `server/db/migrations/0006_household_dietary_profile.sql`
- `server/utils/foodNormalization.js`
- `server/utils/foodNormalization.test.js`
- `server/data/purineIndex.js`
- `server/data/purineIndex.test.js`
- `server/services/mealLogService.js`
- `server/services/dietaryService.js`
- `server/routes/dietary.js`
- `server/utils/recipeScorer.js`
- `client/src/hooks/useDietaryProfile.js`
- `client/src/components/settings/DietaryProfileForm.jsx`

### Edited
- `server/db/schema.js` — added `mealLogs` table + 3 columns to `households`
- `server/app.js` — mounted `dietaryRouter` at `/api/dietary`
- `server/services/aiService.js` — added 5 tool declarations; updated `chat()` signature + system prompt
- `server/routes/ai.js` — added 5 tool handlers; updated `pantrySummary`; injected `dietaryContext`
- `client/src/pages/HouseholdPage.jsx` — mounted `DietaryProfileForm`

# Files Already Reviewed (do not re-read without cause)
All files from prior session remain valid. See previous CURRENT_STATE for list.

# Dependency Chain

```
Editing (complete):
- server/db/schema.js
- server/db/migrations/0005_meal_logs.sql
- server/db/migrations/0006_household_dietary_profile.sql
- server/utils/foodNormalization.js
- server/data/purineIndex.js
- server/services/mealLogService.js
- server/services/dietaryService.js
- server/routes/dietary.js
- server/utils/recipeScorer.js
- server/services/aiService.js
- server/routes/ai.js
- client/src/components/settings/DietaryProfileForm.jsx
- client/src/hooks/useDietaryProfile.js
- client/src/pages/HouseholdPage.jsx
- server/app.js

Requires (read-only, unchanged):
- server/services/pantryService.js
- server/services/recipeService.js
- server/middleware/auth.js
- server/middleware/validate.js

Irrelevant (unchanged):
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- client/public/sw.js
```

# Architecture Notes

## Spec Deviation: purineIndex sort strategy
The spec specified "medium checked BEFORE high" with per-level length sorting. This was correct for the `"kidney bean"` → `"medium"` case but caused `"beef heart"` and `"chicken heart"` (HIGH) to incorrectly return `"medium"` because `\bbeef\b` / `\bchicken\b` fired first.

**Fix applied:** Merged all keywords into a single list sorted globally by length descending. This means compound forms (e.g. `"beef heart"` 9 chars) always take precedence over their shorter base words (e.g. `"beef"` 4 chars), regardless of level. All test cases pass. This is a strict improvement — the spec's reasoning holds but the implementation mechanism is different.

## QUANTITY_PREFIX_RE regex fix
The spec's regex had `l` as a unit alias (for liters) without a word boundary. This caused `"3 large eggs"` to consume the leading `l` from `large`, producing `"arge eggs"`. Fixed by changing `g|...|l|...` to `g\b|...|l\b|...` for single-letter units.

# Decisions Made
- All prior ADRs preserved as-is (ADR-001 through ADR-009)
- Purine check order changed from per-level to global-sort (compatible with all acceptance criteria)
- `real` type used in Drizzle schema for `quantity_before`/`quantity_after` (consistent with pantry schema; spec said NUMERIC in SQL which the migration correctly uses)
- `expiringItems` computed once in POST /api/ai/chat route and shared across all handlers via closure

# Remaining Work
1. ~~Run `0005_meal_logs.sql` in Neon SQL Editor~~ ✅ DONE (2026-06-04)
2. ~~Run `0006_household_dietary_profile.sql` in Neon SQL Editor~~ ✅ DONE (2026-06-04)
3. ~~Fix `VAPID_SUBJECT` in Vercel~~ ✅ DONE (2026-06-05)
4. ~~Fix `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in Vercel~~ ✅ DONE (2026-06-09)
5. ~~Switch Gemini model to free-tier `gemini-2.5-flash`~~ ✅ DONE (2026-06-09)
6. **TASK-012 — implement BYOK** (spec at `ai/tasks/TASK-012.md`, approved DRAFT-3)
   - ~~Pre-implementation: generate `API_KEY_ENCRYPTION_SECRET` and add to `.env` + Vercel~~ ✅ DONE (2026-06-09) — rotated after `.env.example` security fix
   - Pre-deploy: run `0007_household_ai_api_key.sql` in Neon SQL Editor
7. TASK-011 smoke tests — deferred until TASK-012 is live (owner will use Claude API key)

# Known Risks
- All prior known risks remain (see TASK-011.md)
- Concurrency on `consume_pantry_item` — SELECT FOR UPDATE deferred to post-launch
- `dietaryService.getProfile` also called inside `suggest_recipes` handler (second DB call); acceptable for MVP
- `__drizzle_migrations` table does not exist in Neon — all migrations applied manually; never run `node server/db/migrate.js` against production or it will re-apply 0001–0006 and fail on already-dropped columns
- `JWT_SECRET` and `API_KEY_ENCRYPTION_SECRET` were briefly exposed in git history via `.env.example` — both have been rotated (2026-06-09). No BYOK keys were ever stored with the old encryption secret.

# Verification Results
- `foodNormalization.test.js`: 48/48 PASS
- `purineIndex.test.js`: 10/10 PASS (within foodNormalization suite run)
- `npm run build`: PASS (clean, 352 modules)

# Smoke Test Status (2026-06-09)
## Infrastructure issues resolved
- Login 500 — `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` missing from Vercel; regenerated and added ✅
- Chat 503 — `gemini-2.0-flash` has no free tier (limit: 0); switched to `gemini-2.5-flash` ✅

## Smoke tests (deferred — pending TASK-012)
- [ ] add item → chat "I ate the chicken" → verify meal_logs row
- [ ] set dietary profile → chat → verify dietaryContext in system prompt
- [ ] "what should I cook?" → verify suggest_recipes returns scored candidates
- [ ] "save that recipe" → verify recipe appears in recipe book

# Forbidden Exploration
- server/middleware/auth.js
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/household.js
- server/routes/push.js
- server/services/pushService.js
- client/public/sw.js
- client/src/hooks/usePushNotifications.js
- ai/tasks/archive/

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — working directly on main. Commit all implementation files.
