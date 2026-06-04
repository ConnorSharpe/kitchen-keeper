# Task
TASK-011 SPEC COMPLETE (DRAFT-7) — awaiting implementation

# Current Status
TASK-011 spec (DRAFT-7) written and approved through 7 rounds of GPT architect review.
Ready to hand to a dev agent for implementation.
No code has been written yet — this session was spec-only.

Previous completed tasks: TASK-006 through TASK-010 all complete. See archive.

# Files Modified (this session)
- `ai/tasks/TASK-011.md` — created; iterated DRAFT-1 through DRAFT-7

# Files Required Next (for implementation agent)
- `server/db/schema.js`
- `server/db/migrations/` (next migration is 0005)
- `server/services/pantryService.js` (read-only reference)
- `server/services/recipeService.js` (read-only reference)
- `server/services/aiService.js`
- `server/services/chatService.js` (read-only reference)
- `server/routes/ai.js`
- `server/app.js`
- `client/src/pages/HouseholdPage.jsx`

# Files Already Reviewed (do not re-read without cause)
- `server/services/pantryService.js` — `update`, `remove`, `markUsed`, `getAll`, `bulkCreate` all exist and are sufficient; no changes needed
- `server/services/recipeService.js` — `serialize`/`parse` pattern is canonical; `create` sufficient for `save_recipe`
- `server/routes/ai.js` — full read; tool handler pattern confirmed; pantrySummary shape confirmed
- `server/services/aiService.js` — full read; `chat()` signature, `PANTRY_TOOLS`, `suggestRecipes`, `expandSuggestion` all confirmed
- `server/db/schema.js` — full read; TEXT-JSON pattern confirmed; next migration is 0005
- `client/src/pages/` — no settings page exists; `HouseholdPage.jsx` confirmed as dietary form host
- `server/utils/expiry.js` — `getExpiryDays`, `getExpiryStatus` confirmed sufficient

# Dependency Chain

```
Editing (011A):
- server/db/schema.js                          (add mealLogs table)
- server/db/migrations/0005_meal_logs.sql       (new)
- server/utils/foodNormalization.js             (new)
- server/data/purineIndex.js                    (new)
- server/services/mealLogService.js             (new)
- server/services/aiService.js                  (add 3 tool declarations + system prompt additions)
- server/routes/ai.js                           (add 3 tool handlers + update pantrySummary)

Editing (011B):
- server/db/schema.js                           (add 3 columns to households)
- server/db/migrations/0006_household_dietary_profile.sql  (new)
- server/services/dietaryService.js             (new)
- server/routes/dietary.js                      (new)
- server/app.js                                 (mount dietaryRouter)
- server/services/aiService.js                  (add dietaryContext param to chat())
- server/routes/ai.js                           (inject dietaryContext)
- client/src/components/settings/DietaryProfileForm.jsx  (new)
- client/src/hooks/useDietaryProfile.js         (new)
- client/src/pages/HouseholdPage.jsx            (mount DietaryProfileForm)

Editing (011C):
- server/utils/recipeScorer.js                  (new)
- server/services/aiService.js                  (add 2 tool declarations)
- server/routes/ai.js                           (add 2 tool handlers)
- server/utils/foodNormalization.test.js        (new — required before 011C ships)

Requires (read-only):
- server/services/pantryService.js
- server/services/recipeService.js
- server/middleware/auth.js
- server/middleware/validate.js

Irrelevant:
- server/routes/recipes.js
- server/routes/shopping.js
- server/routes/push.js
- server/services/pushService.js
- client/src/pages/PantryPage.jsx
- client/public/sw.js
```

# Architecture Notes
- Three staged deliverables: 011A → 011B → 011C (strict dependency order)
- 011A is foundational: meal_logs table + consume/update/remove agent tools
- 011B depends on 011A (meal_logs must exist for getRecentSince)
- 011C depends on 011B (dietaryContext must be injectable into chat)
- All normalization logic lives in server/utils/foodNormalization.js (single source of truth)
- Allergy detection uses lightNormalizeForAllergy() + containsWholeWord() ONLY — Invariant 12
- getRecentLimit(n) for display; getRecentSince(isoTimestamp) for purine load — two separate methods
- TEXT-JSON pattern maintained throughout (not JSONB) — intentional debt tracked as TASK-012
- No new env vars required

# Key Decisions Made (do not re-litigate)
- Dietary profile on household (not user) — ADR-001
- meal_logs append-only — ADR-002 / Invariant 2
- Static purine index, no USDA API — ADR-003
- TEXT columns for JSON, not JSONB — ADR-004 (TASK-012 planned)
- Substring overlap scoring with normalization, not embeddings — ADR-005
- Staged delivery 011A/B/C — ADR-006
- Server owns skip-deduction policy — ADR-007
- foodNormalization.js as SPOF — ADR-008 / Invariant 11
- meal log immutability; corrections restore pantry only — ADR-009
- getRecentLimit for display, getRecentSince for purine classification (no LIMIT on time-range query)
- stripIngredientPrefix lives in foodNormalization.js (not recipeScorer.js)
- medium purine keywords checked before high (prevents kidney bean → kidney misclassification)

# Remaining Work
1. 011A implementation (foundational — ship first)
2. 011B implementation (depends on 011A)
3. 011C implementation + foodNormalization.test.js (depends on 011B)
4. TASK-012 — JSONB migration (separate task, not blocking)

# Known Risks
- foodNormalization.js is a semantic SPOF — Invariant 11 requires unit tests before 011C ships
- Concurrency on consume_pantry_item (race on quantity read-modify-write) — future hardening with SELECT FOR UPDATE; not in scope for 011A
- 3 Gemini calls per suggest_recipes turn — acceptable for MVP; cache deferred to post-launch
- No settings page client-side — DietaryProfileForm mounts on HouseholdPage.jsx
- TEXT-JSON debt across schema — tracked as TASK-012

# Verification Results
N/A — spec only, no code written this session

# Pre-Deploy Checklist (for implementation agent)
- [ ] 011A: Run 0005_meal_logs.sql in Neon SQL Editor
- [ ] 011B: Run 0006_household_dietary_profile.sql in Neon SQL Editor
- [ ] npm run build passes after each stage
- [ ] Full flow smoke test: consume → meal log → dietary context → suggest_recipes → save_recipe

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
- All spec iterations (DRAFT-1 through DRAFT-7) preserved in ai/tasks/TASK-011.md revision table

# PowerShell Merge Block
N/A — working directly on main. Commit the spec file only.
