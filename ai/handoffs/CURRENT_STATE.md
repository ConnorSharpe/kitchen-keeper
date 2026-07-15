# Task
TASK-034 — Recipe Suggestions: Ingredient Targeting, Real Diversity, Prose Suppression, and a User Blocklist. **Spec-only session — DRAFT-3, APPROVED FOR IMPLEMENTATION (architect round 2, 9.7/10). No code has been written yet.** Background: TASK-029.5 through TASK-033 (previous sessions) are all implemented and live smoke-tested — clean pass, considered done.

# Current Status

**TASK-034 spec finalized, not yet implemented.** This session was pure spec drafting + two rounds of architect review, no application code touched. The spec at [ai/tasks/TASK-034-spec.md](../tasks/TASK-034-spec.md) is ready for a fresh implementation session.

What TASK-034 covers (see spec for full detail):
- **Part A — Ingredient targeting**: `suggest_recipes` gains `targetIngredients: string[]`, used to anchor the API query and as a hard Tier-1/Tier-2 partition in ranking (not a score bonus). Matching semantics are explicitly inherited from the existing `foodsMatch()`/`normalizeFood()` + TASK-011 invariant (no cross-variety matching — steelhead ≠ salmon).
- **Part B — Real diversity**: replaces the current "filter already-shown, then on exhaustion ignore the filter and re-serve the same list" bug ([ai.js:538-540](../../server/routes/ai.js)) with a soft `RECENT_RECIPE_PENALTY` constant subtracted from score, plus a deterministic API-query ingredient rotation (`priorSuggestionRounds`, counting only prior recipe-suggestion rounds, not all assistant messages) so the 6-hour cache key actually changes across a session.
- **Part C — Structural prose suppression**: client-side, `ChatPage.jsx` suppresses the assistant text bubble entirely when `recipeSuggestions.length > 0` — cards only. Deliberate, documented tradeoff: a message combining a recipe request with a distinct question loses that answer's text (workaround: ask it as a separate message).
- **Part D — New feature: user-editable "do not suggest" blocklist**. New `recipe_blocklist` table (`household_id, source, source_id, name, blocked_at`, unique on `household_id+source+source_id`), enforced as a hard/permanent pre-scoring filter with no fallback that can ever re-admit a blocked recipe. Entry points on chat suggestion cards, saved `RecipeCard`, and `RecipesPage`'s web-suggestion cards; management via a new `BlockedRecipesModal.jsx`. Explicitly does **not** cover `EatThisNow.jsx` (no stable recipe id in that pipeline) — logged as Out of Scope / Known Risk, not silently dropped.

Went through two architect review rounds (DRAFT-1 → 9.0/10 "approve after one revision pass", DRAFT-2 → 9.7/10 "approved for implementation"). Two DRAFT-1 suggestions were deliberately declined rather than applied — both documented in the spec with reasoning rather than silently dropped: (1) DELETE-by-source/sourceId instead of DB id for the blocklist endpoint — kept `:id`, matches existing `recipes.js` convention and the only consumer already has the row; (2) a length/boilerplate heuristic for conditional prose suppression instead of unconditional — kept unconditional, since a heuristic reintroduces exactly the text-shape fragility this task is otherwise removing, and the user's own requirement was categorical ("only cards, no plain text").

# Files Modified
- `ai/tasks/TASK-034-spec.md` (new) — full spec, DRAFT-3, approved for implementation.
- `ai/handoffs/CURRENT_STATE.md` — this handoff.

No application code (`server/`, `client/`) touched this session.

# Files Required Next
Implementation of TASK-034, in the order its own Allowed Files section implies (schema/migration first, then pipeline logic, then UI):
- `server/db/schema.js`, `server/db/migrations/0016_recipe_blocklist.sql` (new), `server/db/migrations/meta/_journal.json`
- `server/services/recipeBlocklistService.js` (new)
- `server/routes/recipes.js` (blocklist endpoints), `server/routes/ai.js` (pipeline rewrite: tiering, recency penalty, rotation, blocklist filter, `deriveRecipeKey` helper)
- `server/services/aiService.js` (system prompt + tool schema), `server/services/recipeSearchService.js` (`targetIngredients` + rotation param on `findByPantry`)
- `client/src/pages/ChatPage.jsx`, `client/src/pages/RecipesPage.jsx`, `client/src/components/recipes/RecipeCard.jsx`, `client/src/components/recipes/BlockedRecipesModal.jsx` (new), `client/src/hooks/useRecipeBlocklist.js` (new)

Full Allowed/Forbidden Files, Constraints, Schema/API additions, and Acceptance Criteria are all in the spec — read it in full before starting, not just this summary.

**Still open, carried forward from TASK-032/033's sessions, unaddressed for three sessions running now**: `shoppingService.buildFromRecipes()`'s `db.transaction()` call is confirmed broken on this driver (`neon-http` has zero transaction support — throws unconditionally) and is the likely real cause of the long-standing `POST /api/shopping/build` 500. Not touched this session either — out of scope for a spec-only session. Worth a dedicated session, and arguably now higher priority than TASK-034 itself if that 500 is still live.

A repo-wide grep for other `db.transaction(` call sites was recommended after TASK-032's session and still hasn't been done.

# Files Already Reviewed
Full reads, this session (research for spec accuracy, no edits):
- `server/routes/ai.js`, `server/services/aiService.js`, `server/services/recipeSearchService.js`, `server/utils/recipeScorer.js` — full `suggest_recipes` pipeline, confirmed the reset-to-repeat bug and the missing-ingredient-parameter gap by reading actual code, not assumption.
- `client/src/pages/ChatPage.jsx` — confirmed the text bubble has no conditional suppression today.
- `server/db/schema.js` (recipes table), `server/services/recipeService.js`, `server/routes/recipes.js` — confirmed `isFavorite` toggle pattern and `createOrIgnore`/`onConflictDoNothing` precedent used as the blocklist's design basis.
- `client/src/components/recipes/RecipeCard.jsx`, `client/src/pages/RecipesPage.jsx`, `client/src/hooks/useRecipes.js` — confirmed favorite-toggle UI pattern and hook shape to mirror for the blocklist UI.
- `client/src/components/dashboard/EatThisNow.jsx` — confirmed this surface has no stable recipe id, which is why it's explicitly Out of Scope rather than silently inconsistent.
- `server/db/migrations/0013_chat_metadata.sql`, `0015_pantry_servings.sql`, `meta/_journal.json` — confirmed migration numbering (next is `0016`) and the `recipes_household_name_unique` precedent reused for the blocklist's unique constraint.
- `ai/tasks/TASK-020-spec.md`, `TASK-011.md` (full reads) — TASK-020 is what this task revises; TASK-011's `foodsMatch()` invariant is what Part A's matching semantics explicitly inherit.

# Dependency Chain

Editing:
- (none this session — spec-only)

Next session editing (per TASK-034-spec.md):
- See "Files Required Next" above; full chain is in the spec's own Dependency Chain section.

Irrelevant:
- `server/services/pantryService.js`, `server/routes/pantry.js` — unrelated to recipe suggestions
- `client/src/components/shopping/*` — unrelated

# Architecture Notes
- **The `suggest_recipes` pipeline's full intended post-TASK-034 order is now documented as an explicit diagram in the spec itself** (`## Pipeline Order`) — implement top-to-bottom against that, not by re-deriving order from the Decisions prose.
- **`db.transaction()` is still completely unusable on this driver** (`drizzle-orm@0.29.5` + `neon-http`) — unchanged, not touched this session, still blocking `/api/shopping/build`.
- This repo has a **single Neon database** shared by local dev and production — unchanged. TASK-034's new `recipe_blocklist` table migration will need the same hand-apply-then-verify treatment as `0014`/`0015` before any live verification of Part D can run.
- **Dev-environment gotcha, carried from every prior session**: the shared backend dev process on port 3001 runs via plain `nohup` (not nodemon) — an independent instance + temporarily repointing `client/vite.config.js`'s proxy has been needed every session that did live verification. Not relevant this session (no live verification — spec-only) but will apply to TASK-034's implementation session.

# Decisions Made
- This session's actual decisions are the ones in the spec itself (four Parts, ~20 named Decisions) — not duplicated here. See TASK-034-spec.md.
- Two DRAFT-1 architect review suggestions were deliberately declined (blocklist DELETE key shape, conditional prose-suppression heuristic) — both documented in the spec's own Architect Review History and Known Risks with reasoning, not silently dropped, matching this project's established practice (TASK-026 precedent) for handling review feedback the author disagrees with.
- Spec-drafting and code-implementation kept as separate sessions/modes, per this project's established workflow — no implementation attempted in the same session as the spec, even though nothing technically blocks it.

# Remaining Work
1. **Implement TASK-034** — spec is approved, ready for a fresh session. Start with schema/migration, then the `ai.js` pipeline rewrite, then UI. Flag the production migration to the user before applying, per established practice.
2. **Carried forward, arguably now higher priority**: fix `shoppingService.buildFromRecipes()`'s broken `db.transaction()` call — concrete, verified diagnosis exists from TASK-032's session, unaddressed for three sessions running.
3. **Carried forward, low priority**: repo-wide grep for other `db.transaction(` call sites.
4. **Carried forward, low priority**: the migration-boot landmine — `0001`–`0013` still lack `--> statement-breakpoint` markers; `0014`/`0015` (and TASK-034's planned `0016`) are safe.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.
- One real household item (`BNLS/SL BRST`, id 19) still has `storageLocation: 'pantry'` from TASK-031's session testing — cosmetic.
- `POST /api/ai/eat-this-now` doesn't honor the new blocklist (TASK-034's Out of Scope) — candidate for a follow-up task if it proves to matter in practice; would need that pipeline to carry stable recipe ids first.

# Known Risks
- **`db.transaction()` is unusable on this driver** — unchanged, three sessions running without a fix; any future feature assuming multi-statement atomicity will hit this, and TASK-034's blocklist writes are simple single-row inserts/deletes so it doesn't hit this itself, but worth remembering before implementing anything more complex against `recipe_blocklist`.
- No automated test suite anywhere in this repo — TASK-034's implementation session will need the same manual smoke-testing method as every prior task.
- The `/api/shopping/build` 500 error remains unfixed.
- TASK-034 itself: see the spec's own Known Risks section (production migration requirement, judgment-call constants, rotation making API results less deterministic run-to-run by design, `EatThisNow.jsx` not honoring the blocklist, the accepted combined-question prose-suppression tradeoff).

# Verification Results
N/A this session — no code changed, nothing to verify. TASK-034's implementation session will need full manual smoke testing per the spec's Acceptance Criteria (ingredient targeting, diversity/no-repeats, prose suppression, blocklist — four separate criteria groups in the spec).

# Recommended Next Action
Start a fresh session to implement TASK-034 against the approved spec. Read [ai/tasks/TASK-034-spec.md](../tasks/TASK-034-spec.md) in full first — Allowed/Forbidden Files, all Decisions, Constraints, and Acceptance Criteria are load-bearing, not just the summary in this handoff. Flag the `recipe_blocklist` migration to the user before applying it, per established practice. Second priority, if not folded into the same session: `shoppingService.buildFromRecipes()`'s `db.transaction()` fix, unaddressed for three sessions now.

# Forbidden Exploration
For TASK-034 implementation specifically: `server/services/pantryService.js`, `server/routes/pantry.js`, `client/src/components/shopping/*` (unrelated), `client/src/components/dashboard/EatThisNow.jsx` (explicitly out of scope — do not wire the blocklist into it without a new task), `server/utils/recipeScorer.js`'s allergy/health annotation logic (unchanged by this task).

# Context Notes
- branch: main
- worktree: none
- context pressure: medium

# PowerShell Merge Block
Spec-only session — no application code changed. Commit covers the spec file and this handoff only.

```powershell
git add ai/tasks/TASK-034-spec.md ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-034: recipe suggestions spec approved for implementation (architect round 2, 9.7/10)"
git push
```
