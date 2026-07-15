# TASK-034 — Recipe Suggestions: Ingredient Targeting, Real Diversity, Prose Suppression, and a User Blocklist

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post architect review, round 2)

**Depends on [TASK-020](TASK-020-spec.md)** (dedup, saved-first ranking, slim model output) — this task revises three of TASK-020's own mechanisms after live use exposed problems, and adds one new feature (the blocklist) on top of the same pipeline.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.0/10 — approve after one revision pass | Praised: every major change traces to an identified failure mode rather than speculative improvement; scope discipline (explicitly declined MMR, manual blocklist entry, Eat-This-Now integration, scorer redesign); hard-tier ingredient matching as "exactly right" rather than a score bonus (the classic recommendation-system mistake); penalty-over-exclusion as "dramatically cleaner" than the old filter+bad-fallback; blocklist schema correctly avoiding a `recipes.blocked` column. Required: extract the recency-penalty constant out of inline business logic; remove ambiguity from the rotation mechanism's description; explicitly define target-ingredient matching semantics; reconsider the blocklist DELETE endpoint's use of a DB id vs. the source/sourceId identity model; state migration/backfill status explicitly; add an explicit pipeline-order diagram. Also raised (considered and declined, reasoning below): a length/boilerplate-based heuristic for partial prose suppression instead of unconditional suppression — rejected as reintroducing exactly the text-shape-dependent fragility this same review praised the spec for avoiding elsewhere, and as working against the user's own categorical requirement ("only cards, no plain text"). All actionable items incorporated in DRAFT-2; the one declined item is recorded in Known Risks with reasoning, matching this project's established practice (TASK-026) of recording declined-but-considered review points rather than silently dropping them. |
| DRAFT-2 | 9.7/10 — approved for implementation | Praised: all five DRAFT-1 architectural concerns effectively resolved (named ranking constant, unambiguous rotation semantics, explicit inherited matching semantics, explicit no-backfill statement, pipeline-order diagram); the declined heuristic-suppression suggestion was handled correctly — documented with rationale and tied back to the user's explicit requirement, rather than silently dropped. Remaining points explicitly non-blocking ("polish rather than architectural blockers," "not required," "not worth changing the spec over"): rename the pipeline diagram's tiering step from "Split" to "Partition" (tiering is a partition, not a scoring operation); note that a dedicated ranking-constants file may become worthwhile *if* more constants accumulate later (explicitly "not needed now"); document that `getBlockedKeys()`'s returned `Set` should be treated as immutable by callers; add a negative acceptance criterion verifying steelhead does not prioritize salmon-only recipes (directly exercises the TASK-011-inherited matching semantics); confirm the rotation modulo is safe when the non-expiring pantry list is empty or very small. All incorporated below since each is cheap and closes a real (if minor) ambiguity. |

---

## Origin

TASK-020 shipped dedup, saved-source ranking bonus, and slim model output. Live use since then surfaced three problems TASK-020 didn't fully solve, plus one new feature request:

1. **Same recipes keep resurfacing.** [ai.js:538-540](../../server/routes/ai.js) — when the "already shown" filter empties the candidate pool, the fallback reruns scoring on the *unfiltered* pool, re-serving exactly what was just filtered out. This triggers routinely, not rarely: `recipeSearchService.findByPantry` always queries the same 5 pantry-derived ingredients and caches that result for 6 hours, so the candidate pool barely changes between calls in a session.
2. **Named ingredients are ignored.** "What should I make with steelhead" has no way to influence retrieval — `suggest_recipes` has no parameter for a named ingredient, so `findByPantry` picks its 5 query ingredients by expiring-status and arbitrary order, not by what the user actually asked about.
3. **Prose still appears above the cards.** TASK-020 addressed this with a prompt rule only ("one brief sentence at most"), which TASK-020's own spec acknowledged was "the last line of defense, not the primary mechanism" for a related problem — that lesson wasn't applied here. [ChatPage.jsx:198](../../client/src/pages/ChatPage.jsx) renders the text bubble unconditionally whenever the reply has content.
4. **New ask: a user-editable "do not suggest" list.** Recipes the user flags this way must never be suggested again — permanently, not subject to the same-session soft filtering above.

---

## Part A — Ingredient Targeting

### Decision A1 — `targetIngredients` as a new `suggest_recipes` parameter

`suggest_recipes`'s tool schema gains an optional `targetIngredients: string[]`, filled by the model when the user names one or more specific ingredients (e.g. `["steelhead"]` for "what should I make with steelhead", `["chicken", "rice"]` for "what can I make with chicken and rice"). Array, not a single string — real phrasing commonly names more than one ingredient, and a one-element array costs nothing extra over a scalar.

System prompt addition: an instruction telling the model to populate `targetIngredients` whenever the user names specific ingredients in a recipe request, and to leave it empty/omitted for generic requests ("what should I eat").

### Decision A2 — Target ingredients are used two different ways, not one

- **For the external API query** (`recipeSearchService.findByPantry`): the literal named strings are used as-is (not resolved against pantry item names first) — better recall against Spoonacular/TheMealDB's own ingredient vocabulary than a resolved pantry item name like "Steelhead Trout Fillets" might give. `findByPantry` gains an optional `targetIngredients` param; when present, these are placed first in the ingredient list sent to the API (still capped at 5 total, expiring/other pantry items fill remaining slots), guaranteeing inclusion instead of competing for a slot.
- **For scoring** (both saved and API candidates): target ingredients are matched against each candidate's own ingredient list using the existing `foodsMatch()`/`normalizeFood()` utilities already used by `recipeScorer.score()` — a candidate "contains a target ingredient" if any of its ingredients fuzzy-matches any target ingredient string.

### Decision A3 — Target-ingredient match is a hard tier, not a score bonus

When `targetIngredients` is non-empty, candidates are split into two tiers before the existing strategy sort: **Tier 1** — candidates containing at least one target ingredient; **Tier 2** — everything else. Tier 1 is always ranked above Tier 2 in full; strategy-based sort (`effectiveScore`, expiring-first, dietary-safe) applies normally *within* each tier. This is a hard split because "does this recipe answer the literal thing the user asked about" is a yes/no fact, not a quantity to blend with a tunable bonus constant — a recipe using steelhead is a correct answer to "what can I make with steelhead" regardless of its overall pantry-overlap score, and a recipe that doesn't use it is not, regardless of how high that score is.

When `targetIngredients` is empty (the general "what should I eat" case), tiering does not apply — TASK-020's existing saved-source ranking bonus (`+0.2`) is unchanged. This task does not reopen that general-case tradeoff; the architect's original reasoning there (a 2%-overlap saved recipe shouldn't beat a 95%-overlap API recipe) still holds, and no evidence has surfaced that the general case is broken — only the named-ingredient case.

### Decision A3.1 — Matching semantics are inherited exactly from `foodsMatch()`, not reinvented

"Does this candidate contain a target ingredient" uses the same `foodsMatch()`/`normalizeFood()` call `recipeScorer.score()` already makes for every other ingredient comparison in this pipeline — no separate synonym table, embedding similarity, or category-expansion logic is introduced for target-ingredient tiering specifically. This means it inherits `foodsMatch()`'s existing, already-shipped invariant from TASK-011 ([TASK-011.md:1079](TASK-011.md)): different varieties within the same ingredient category do **not** match each other (e.g. "black bean" vs. "kidney bean" — token overlap of "bean" alone isn't enough). Concretely: a target ingredient of "steelhead" will **not** match a recipe calling for "salmon" or "sockeye" — they're different fish, and this pipeline has never treated same-category variants as interchangeable. This is stated explicitly so two people implementing this independently converge on the same behavior rather than each assuming their own notion of "contains."

### Decision A4 — Zero Tier-1 matches is not an error

If no candidate (saved or API) contains any target ingredient after the full pipeline runs, fall through to the normal Tier-2-only ranking (i.e. behave exactly as if `targetIngredients` were empty) rather than returning nothing. The model's text reply in this case should say the pantry/API didn't turn up a direct match — an existing, un-changed prompt concern, not a new mechanism.

---

## Part B — Real Diversity Instead of Reset-to-Repeat

### Decision B1 — Replace the hard filter+bad-fallback with a recency penalty

Remove the current mechanism ([ai.js:481-486](../../server/routes/ai.js), [538-540](../../server/routes/ai.js)): a hard "already shown" filter that, on exhaustion, discards the filter entirely and re-scores the full unfiltered pool. Replace with a **soft recency penalty** applied during scoring: a candidate whose key appears in `extractSuggestedRecipeKeys(history)` gets a fixed penalty subtracted from `effectiveScore` instead of being excluded outright.

The penalty value is a named, exported constant at the top of `ai.js` — not an inline literal in the scoring function:

```js
// Subtracted from effectiveScore for recipes already shown in this session's loaded history.
// Chosen empirically (comparable in magnitude to the saved-source ranking bonus below) —
// not derived from an existing convention. Tune here if suggestions feel too sticky or too random.
const RECENT_RECIPE_PENALTY = 0.5;
```

This keeps the value discoverable and documented at the point of definition rather than buried as a magic number inside the scoring closure. If future work adds more ranking constants alongside this one (e.g. a freshness weight), consider promoting them to a dedicated small module at that point — not needed now for a single constant.

This is deliberately *not* a full Maximal Marginal Relevance re-ranking (which would need a similarity metric between candidate recipes to penalize redundancy pairwise) — this app's candidate pool is realistically 10-20 recipes per request, not a large-scale corpus where pairwise redundancy matters. A flat recency penalty solves the actual observed bug (identical top-5 repeating) without inventing a new similarity computation this codebase doesn't need yet.

A recently-shown recipe can still surface if nothing else scores competitively (e.g. a very small pantry with few real candidates) — this is intentional and is what "penalty" means as opposed to "exclusion." It will simply rank behind anything fresher of comparable relevance.

**Interaction with blocklist (Part D):** the recency penalty is unrelated to and does not substitute for the blocklist's hard exclusion. A blocklisted recipe is removed before scoring ever runs and can never resurface via this penalty mechanism or any fallback; a recently-shown-but-not-blocked recipe is merely penalized and can resurface.

### Decision B2 — Rotate which pantry ingredients anchor the API query

`findByPantry`'s ingredient selection currently always takes the same first-5 slice (expiring-first, then arbitrary order) every call, and the 6-hour cache is keyed on that exact ingredient set — so repeated calls in one session hit the same cache entry and get the same API results. Add a deterministic rotation, driven by a value specifically named to make its scope unambiguous:

```js
// Count of PRIOR assistant messages in `history` whose metadata.recipeSuggestions is
// non-empty — i.e. how many suggestion rounds have already happened in this session.
// Deliberately NOT a count of all assistant messages: an unrelated question asked in
// between two recipe requests (e.g. "how long does milk last?") must not shift rotation.
const priorSuggestionRounds = history.filter((m) => m.metadata?.recipeSuggestions?.length > 0).length;
```

The non-expiring portion of the ingredient slice is offset by `priorSuggestionRounds` (modulo the number of available non-expiring items). This changes the cache key across suggestion *rounds* in a session — not across turns of conversation generally — without any extra API cost or quota usage. Expiring items always still take priority slots regardless of rotation, per the existing "expiring first" behavior. `targetIngredients` (Part A) take priority over rotation — they always occupy the first slots when present.

**Small-collection safety, stated explicitly:** if there are zero non-expiring items (e.g. everything in the pantry is currently expiring), the modulo divisor is zero — the rotation offset computation must be skipped entirely in that case (guard: only compute/apply the offset when the non-expiring list is non-empty), not attempted and caught. With one non-expiring item, modulo-1 always yields `0` — rotation is correctly a no-op since there's nothing to rotate between, not a bug.

### Decision B3 — Dedup and blocklist filtering remain hard; only the "recently shown" step changes

To be explicit about what's *not* changing: cross-candidate deduplication ([ai.js:469-478](../../server/routes/ai.js)) stays a hard filter (a genuine duplicate is never useful to show twice in the same list, unlike "shown recently" which is a preference, not a correctness issue). The new blocklist filter (Part D) is also hard. Only the "shown in recent history" mechanism moves from hard-filter-with-bad-fallback to soft-penalty.

---

## Part C — Structural Prose Suppression

### Decision C1 — Client suppresses the text bubble when recipe cards are present, not the prompt

[ChatPage.jsx](../../client/src/pages/ChatPage.jsx)'s message rendering: when `msg.recipeSuggestions?.length > 0`, do not render the assistant text bubble at all — cards only. This mirrors TASK-020's own Decision 1 reasoning (structural suppression, prompt as secondary safeguard only) applied to the piece TASK-020 left prompt-only.

**Known tradeoff, accepted deliberately:** the system prompt already instructs the model to answer a distinct question in the same turn as a tool call (e.g. "I ate the eggs, how many calories is that?" → perform the action, then answer the question in text). If a message combines a recipe request *and* a distinct question ("what can I make with chicken, and how long does cooked chicken keep?"), that answer text would also be suppressed under this rule.

**Considered and declined: a length- or boilerplate-pattern-based heuristic** (suppress only if the reply is short, or matches a known filler phrase) instead of unconditional suppression. Declined on two grounds: (1) neither heuristic reliably distinguishes a real short answer from a filler intro sentence — the model phrases its one-sentence intro differently each time, so pattern-matching against its shape is exactly the kind of prompt-output-dependent fragility this task's own diagnosis (and TASK-020's) already identified as unreliable, just moved from "prompt compliance" to "text-shape compliance"; (2) the user's actual requirement was categorical — "I want only the cards and no plain text. It clutters up the conversation" — not conditional, so a heuristic that sometimes shows text anyway would violate that non-deterministically rather than honor it. Unconditional suppression is accepted as the correct match for what was actually asked, with the tradeoff above named rather than hidden. The practical mitigation, if this ever bites: ask the separate question as its own message — it returns no `recipeSuggestions` and renders its text reply normally.

The existing prompt rule ("one brief sentence at most") stays as-is — harmless now that it's no longer the only enforcement, and it still shapes reply text for the rare non-suppressed case above.

---

## Part D — User-Editable "Do Not Suggest" Blocklist

### Decision D1 — New dedicated table, not a boolean column on `recipes`

A boolean column on `recipes` only covers *saved* recipes. Most of the repetition/steelhead complaints were about API-sourced cards that are never saved — a boolean flag has nowhere to live for those. A new table covers both using the same `source`/`sourceId` identity scheme TASK-020 already established for dedup:

```js
// server/db/schema.js
export const recipeBlocklist = pgTable('recipe_blocklist', {
  id:          serial('id').primaryKey(),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  source:      text('source').notNull(),      // 'saved' | 'spoonacular' | 'mealdb'
  sourceId:    text('source_id').notNull(),    // recipes.id (as string) when source='saved'; API's own id otherwise
  name:        text('name').notNull(),         // display snapshot only — not used for matching
  blockedAt:   text('blocked_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

`sourceId` is `NOT NULL` — every surface this feature's "Don't suggest again" button appears on (chat suggestion cards, saved `RecipeCard`, `RecipesPage`'s web-suggestion cards) already carries a concrete `source` + `sourceId` (saved recipes use `source: 'saved', sourceId: String(recipe.id)`, deliberately overriding `recipes.source` which means something unrelated — the *save method*, upload/ai_suggested/web_suggested/manual — exactly as TASK-020's pipeline already does at [ai.js:457-461](../../server/routes/ai.js)). No name-only fallback path is needed because no in-scope surface lacks an id.

Unique constraint `(household_id, source, source_id)`, matching the existing precedent for `recipes_household_name_unique` ([0013_chat_metadata.sql](../../server/db/migrations/0013_chat_metadata.sql)) — inserts use `onConflictDoNothing`, same pattern as `recipeService.createOrIgnore`.

**No backfill.** This is a new, empty table — there is no prior "do not suggest" state anywhere in this codebase to migrate. Every household starts with zero blocked recipes.

**DELETE addresses the row by its own `id`, not by `source`/`sourceId`.** Considered addressing deletion via `source`/`sourceId` instead, to keep the public API shaped like the identity model used everywhere else in this pipeline. Declined: the only consumer of delete is `BlockedRecipesModal`, which is acting on rows it just received from `GET /blocklist` — those rows already carry `id`. Requiring `source`+`sourceId` instead would mean threading two fields through the URL for no benefit to that one caller. This also isn't a deviation from this codebase's convention — `server/routes/recipes.js`'s existing `PATCH`/`DELETE /:id` endpoints already address rows by DB id despite `recipes` having its own separate business-key uniqueness (`household_id, name`) used elsewhere for save-idempotency. The identity model (`source`+`sourceId`) governs matching and write-time dedup; the integer id is just a stable handle for a row you're already looking at in a list you fetched, same as everywhere else in this app.

### Decision D2 — Enforcement: hard, permanent, applied before scoring, never bypassed by any fallback

In the `suggest_recipes` pipeline, blocklisted candidates are removed immediately after dedup and before scoring — before the recency-penalty step (Part B), before tiering (Part A), before the strategy sort. Unlike the recency penalty, there is no path in this pipeline that ever re-admits a blocklisted candidate, including the sparse-pool case that used to trigger the bad fallback. If blocking leaves fewer than 5 (or zero) candidates, that's the correct result — it does not fall back to showing a blocked recipe anyway.

Applied in three places that all read from `findByPantry`/the same candidate pool:
1. The chat `suggest_recipes` tool handler (primary target of this whole task).
2. `POST /api/ai/suggest-recipes` (backs `RecipesPage`'s "Find Recipes Online" — same `findByPantry` output, filtered before returning).
3. Not applied to `/api/ai/eat-this-now` (dashboard "What Can I Make?" widget) — see Out of Scope.

### Decision D3 — Shared key-derivation helper (small DRY cleanup, not a new abstraction layer)

The `${source}:${sourceId}` key format is about to be computed in three places in `ai.js` (dedup, recency-penalty lookup, blocklist filter) instead of the current two (dedup, shown-filter). Extract the existing inline ternary into one named helper, e.g. `deriveRecipeKey(candidate)`, used by all three. This is a same-file, same-scope extraction of logic that already exists twice and is about to exist a third time — not a new architectural layer.

### Decision D4 — Blocking a saved recipe does not delete or hide it from the recipe library

Blocking only removes a recipe from the *suggestion* pipeline (Parts A/B above). A blocked saved recipe remains fully visible, editable, and browsable on `RecipesPage` exactly as before — "don't suggest this to me" and "I don't want this recipe anymore" are different user intents, and this feature only implements the first one. Existing delete (`DELETE /api/recipes/:id`) is unaffected and unrelated.

### Decision D5 — Entry points reuse existing UI patterns

- **Chat suggestion cards** ([ChatPage.jsx](../../client/src/pages/ChatPage.jsx)): a "🚫 Don't suggest again" button next to the existing "Save Recipe" button on each card. The card object already carries `name`/`source`/`sourceId` (TASK-020), so no new data plumbing is needed here.
- **Saved recipes** ([RecipeCard.jsx](../../client/src/components/recipes/RecipeCard.jsx)): a second icon-button alongside the existing favorite-star toggle, same interaction pattern (`onToggleFavorite` → parallel `onBlock` prop).
- **`RecipesPage`'s web-suggestion cards** (`WebSuggestionCard`, [RecipesPage.jsx](../../client/src/pages/RecipesPage.jsx)): same button, since these cards are already `findByPantry` output carrying `source`/`sourceId`.
- **Editing the list**: a new "🚫 Blocked Recipes" button in `RecipesPage`'s header row (alongside the existing "Upload" / "Find Recipes Online" buttons) opens a new `BlockedRecipesModal.jsx` listing blocked entries (name + source badge) with an "Unblock" action per row, following the existing modal pattern already used for `RecipeModal`/`RecipeUpload`/`RecipeReviewModal`.

### Decision D6 — Manually blocking a recipe you haven't seen is out of scope

The blocklist can only be populated via the "Don't suggest again" button on a card you've actually been shown or saved — there is no free-text "block a recipe by name" entry point in this task. See Out of Scope.

---

## Pipeline Order

The `suggest_recipes` handler's evaluation order, end to end, after this task (each stage's governing Decision noted):

```
1. Collect candidates: saved recipes + findByPantry (targetIngredients-anchored, rotation-offset)   [A1, A2, B2]
              ↓
2. Deduplicate across the merged pool (hard — ID-first, name fallback; unchanged from TASK-020)      [B3]
              ↓
3. Remove blocklisted candidates (hard, permanent — no fallback ever re-admits one)                   [D2]
              ↓
4. Score: overlapScore, effectiveScore = overlapScore + savedBonus − recentRecipePenalty              [B1]
              ↓
5. Partition into Tier 1 (contains a target ingredient) / Tier 2 (does not) — only when targetIngredients
   is non-empty; no-op otherwise. A partition, not a scoring step — it reorders by group, it doesn't
   change any candidate's effectiveScore.                                                             [A3]
              ↓
6. Strategy sort within each tier (expiring_first / dietary_safe / pantry_overlap)                     [TASK-020, unchanged]
              ↓
7. Take top 5 (Tier 1 first, then Tier 2, each internally strategy-sorted)
              ↓
8. Return: slim objects to the model, full objects to metadata/UI (TASK-020, unchanged)
```

Steps 2 and 3 are both hard filters but solve different problems (a true duplicate vs. a user's permanent preference) and must not be merged into one step. Step 4's penalty is soft and can be outweighed by anything else in the pool. Step 5 only reorders; it never removes candidates the way steps 2-3 do.

---

## Allowed Files

- `server/db/schema.js` — add `recipeBlocklist` table
- `server/db/migrations/0016_recipe_blocklist.sql` (new), `server/db/migrations/meta/_journal.json`
- `server/services/recipeBlocklistService.js` (new) — `getAll`, `add` (check-then-insert via `onConflictDoNothing`), `remove`, `getBlockedKeys(householdId)` returning `Set<string>` of `${source}:${sourceId}` (a freshly-constructed `Set` per call — callers must treat it as read-only; the service does not cache or share it across requests, so mutating a returned set has no effect on future calls but should still be avoided as a matter of caller hygiene)
- `server/routes/recipes.js` — new `GET /blocklist`, `POST /blocklist`, `DELETE /blocklist/:id`
- `server/routes/ai.js` — `suggest_recipes` handler: `targetIngredients` param handling, tiering (Part A), recency-penalty scoring + anchor rotation (Part B), blocklist filter (Part D), shared `deriveRecipeKey` helper (Decision D3); `POST /suggest-recipes` route gains blocklist filtering
- `server/services/aiService.js` — system prompt: `targetIngredients` extraction instruction (Part A); `PANTRY_TOOLS.suggest_recipes` schema gains `targetIngredients`
- `server/services/recipeSearchService.js` — `findByPantry` gains optional `targetIngredients` param (priority ingredient slots) and the anchor-rotation offset param (Part B)
- `client/src/pages/ChatPage.jsx` — suppress text bubble when `recipeSuggestions.length > 0` (Part C); "Don't suggest again" button on suggestion cards (Part D)
- `client/src/components/recipes/RecipeCard.jsx` — "Don't suggest again" icon-button
- `client/src/pages/RecipesPage.jsx` — "🚫 Blocked Recipes" header button + modal wiring; "Don't suggest again" on `WebSuggestionCard`
- `client/src/components/recipes/BlockedRecipesModal.jsx` (new)
- `client/src/hooks/useRecipeBlocklist.js` (new) — mirrors `useRecipes.js`'s shape (`{ blocklist, loading, error, refresh, addBlock, removeBlock }`)

## Forbidden Files

- `server/services/pantryService.js`, `server/routes/pantry.js` — unrelated to recipe suggestions
- `client/src/components/dashboard/EatThisNow.jsx` — explicitly out of scope, see below
- `client/src/components/shopping/*` — unrelated
- `server/utils/recipeScorer.js`'s allergy/health annotation logic — unchanged by this task; only `score()`'s consumer (the pipeline) changes how its output is used

---

## Constraints

1. `targetIngredients` is an optional array on `suggest_recipes`; empty/omitted behaves exactly as today (no tiering).
2. Target-ingredient match is a hard tier (Decision A3), never a blended score bonus.
3. The general no-target-ingredient saved-vs-API ranking bonus (TASK-020, `+0.2`) is unchanged.
4. The "already shown" mechanism becomes a soft, fixed-value penalty on `effectiveScore` — never a hard exclusion, and never the trigger for a fallback that ignores it entirely.
5. Blocklist filtering is hard and absolute — applied before scoring, with no fallback path that ever re-admits a blocklisted candidate, even when it leaves the result set smaller than 5 or empty.
6. Dedup (cross-candidate, same call) remains a hard filter, unchanged from TASK-020.
7. `recipe_blocklist.source_id` is `NOT NULL` — every entry point into this feature guarantees a concrete id.
8. Blocking a saved recipe never deletes it or removes it from `RecipesPage`'s normal recipe grid.
9. The text bubble is suppressed client-side (structural), not solely by prompt instruction, whenever `recipeSuggestions.length > 0`.
10. `POST /api/ai/eat-this-now` is unaffected by this task (Out of Scope).

---

## Schema Addition

```sql
-- 0016_recipe_blocklist.sql
CREATE TABLE IF NOT EXISTS recipe_blocklist (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  blocked_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
--> statement-breakpoint
ALTER TABLE recipe_blocklist
  ADD CONSTRAINT recipe_blocklist_unique UNIQUE (household_id, source, source_id);

-- Down migration (if needed):
-- DROP TABLE recipe_blocklist;
```

*(Exact default-timestamp expression to be reconciled with however `$defaultFn` actually materializes in this schema's existing text-timestamp columns at implementation time — this task follows the same column type/pattern already used throughout, e.g. `pantryItems.createdAt`.)*

## API Additions

```ts
// suggest_recipes tool parameters gain:
targetIngredients?: string[]

GET    /api/recipes/blocklist                 → { blocklist: [{ id, source, sourceId, name, blockedAt }] }
POST   /api/recipes/blocklist                 body: { source, sourceId, name } → { entry } | 200 no-op if already blocked
DELETE /api/recipes/blocklist/:id             → 204
```

---

## Dependency Chain

Editing:
- `server/db/schema.js`, `server/db/migrations/0016_recipe_blocklist.sql`, `meta/_journal.json`
- `server/services/recipeBlocklistService.js` (new)
- `server/routes/recipes.js`, `server/routes/ai.js`
- `server/services/aiService.js`, `server/services/recipeSearchService.js`
- `client/src/pages/ChatPage.jsx`, `client/src/pages/RecipesPage.jsx`
- `client/src/components/recipes/RecipeCard.jsx`, `BlockedRecipesModal.jsx` (new)
- `client/src/hooks/useRecipeBlocklist.js` (new)

Reads (pattern reference only):
- TASK-020's dedup/ranking pipeline — this task revises, does not replace, its structure
- `recipeService.createOrIgnore` — `onConflictDoNothing` pattern reused for blocklist inserts
- `0013_chat_metadata.sql`'s `recipes_household_name_unique` — precedent for the new unique constraint
- `useRecipes.js` — shape precedent for `useRecipeBlocklist.js`

Irrelevant:
- `server/services/pantryService.js`, `server/routes/pantry.js`
- `client/src/components/dashboard/EatThisNow.jsx`
- `client/src/components/shopping/*`

---

## Acceptance Criteria

**Ingredient targeting**
- [ ] "What should I make with steelhead" (or any pantry ingredient named by the user) results in `targetIngredients` being populated and at least one Tier-1 (matching) candidate appearing first, when any exists in saved recipes, Spoonacular, or TheMealDB results
- [ ] **Negative case**: asking for steelhead does not tier a salmon-only (or other same-category-but-different-variety) recipe into Tier 1 — it must not match on category alone, per Decision A3.1's inherited `foodsMatch()` semantics
- [ ] A generic "what should I eat" request leaves `targetIngredients` empty and produces unchanged (TASK-020) ranking behavior
- [ ] No candidates matching a named target ingredient → falls through to normal ranking, not an empty result

**Diversity / no more repeats**
- [ ] Asking "what should I eat" three times in a row in one session produces three different top-5 lists where fresh candidates exist, instead of the same list repeating after the pool is nominally "exhausted"
- [ ] A previously-shown-but-not-blocked recipe can still appear if nothing else scores competitively (soft penalty, not hard exclusion) — confirmed via a pantry small enough to exhaust real alternatives
- [ ] Repeating the same request across a session issues different Spoonacular/TheMealDB queries (confirmed via the anchor-rotation offset changing which ingredients are queried), not identical cached results every time

**Prose suppression**
- [ ] When recipe cards are returned, the assistant's chat bubble does not render at all — cards only
- [ ] A message with no recipe suggestions (e.g. "how do I store leftover rice") still renders its text reply normally

**Blocklist**
- [ ] Clicking "Don't suggest again" on a chat suggestion card, a saved recipe, or a `RecipesPage` web-suggestion card adds it to the blocklist and it never appears in `suggest_recipes` or `/api/ai/suggest-recipes` output again, in any session, regardless of pantry contents
- [ ] Blocking a saved recipe leaves it fully visible/editable in `RecipesPage`'s normal grid — it is not deleted
- [ ] The "🚫 Blocked Recipes" list shows every blocked entry with an "Unblock" action; unblocking makes the recipe eligible for suggestion again immediately
- [ ] A pantry/candidate pool where every otherwise-qualifying recipe is blocked correctly returns fewer (or zero) suggestions rather than surfacing a blocked one anyway
- [ ] Blocking the same recipe twice (e.g. double-click, or blocked via two different surfaces) does not create duplicate blocklist rows (`onConflictDoNothing`)

Verification is manual smoke testing against local dev (and, per this project's established pattern, ultimately against production Neon with explicit approval before the migration is applied) — no automated test suite exists in this repo.

---

## Known Risks

- **Production migration required** (new `recipe_blocklist` table) — must be explicitly approved and hand-applied in Neon's SQL Editor per this project's established practice (TASK-031/032/033 precedent).
- `RECENT_RECIPE_PENALTY` (Decision B1) and the anchor-rotation scheme (Decision B2) are judgment calls, not derived from an existing convention — reasonable defaults, not empirically tuned, same status as TASK-033's precision/bounds constants.
- Rotating API query ingredients means a given suggestion round's Spoonacular/TheMealDB results are less deterministic run-to-run within a session than before — acceptable given the entire point is to stop returning identical results, but worth naming as an intentional behavior change.
- `POST /api/ai/eat-this-now` suggestions have no stable `source`/`sourceId` at all (pure LLM text output) — the blocklist cannot reach that surface without restructuring it to carry stable ids, which this task does not do. A user could still be shown a blocked recipe's name via that widget specifically. See Out of Scope.
- **The text-bubble suppression (Part C) has the known combined-question tradeoff described in Decision C1 — accepted, not solved, in this task.** Raised during architect review as a candidate for a length/boilerplate-pattern heuristic instead; declined (reasoning in Decision C1 and the review-history table above) because such a heuristic is no more reliable than the prompt-only suppression this task is explicitly moving away from, and because the user's stated requirement is categorical, not conditional.

## Out of Scope

- `POST /api/ai/eat-this-now` (dashboard "What Can I Make?" widget) honoring the blocklist — would require giving that pipeline stable recipe ids first, a larger restructuring than this task's scope. Candidate for a follow-up task if it proves to matter in practice.
- Manually blocking a recipe by typing a name you haven't been shown or saved (Decision D6).
- True Maximal-Marginal-Relevance-style diversity re-ranking with a candidate-candidate similarity metric (Decision B1) — not justified at this app's candidate-pool scale.
- Any change to `recipeScorer.score()`'s allergy/health annotation logic.
- Bulk-unblocking or blocklist import/export.

---

## Note to User on Approval Status

Marked approved: the architect's round-2 review scored this 9.7/10 and stated "approved for implementation," with all remaining points explicitly non-blocking ("polish rather than architectural blockers," "not needed now," "not worth changing the spec over"). All five were incorporated anyway since each was cheap and closed a real, if minor, ambiguity. This remains a production-migration task (new `recipe_blocklist` table) — that step still needs your explicit go-ahead when implementation actually runs it, independent of this spec-level approval, matching TASK-031/032/033's established practice.
