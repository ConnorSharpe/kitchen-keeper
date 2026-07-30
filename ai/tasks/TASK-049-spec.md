# TASK-049 — Shopping Lists From Scratch, Plus Add-Recipe-to-List

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.7/10 — approve after one revision | Praised reusing `POST /shopping/build` with `recipeIds: []` instead of a second create endpoint, the restraint on fuzzy matching/unit conversion, the shared-helper extraction, and D-2's never-mutate-existing-rows rule. Required change, accepted: `subtractExistingListItems` must only treat **unchecked** existing rows as coverage — a checked row is a completed-workflow marker ("no longer outstanding on this list"), not necessarily a true current-inventory signal, especially on a list the household keeps around across multiple trips rather than clearing after each one. Verified directly against the code before accepting, not taken on the review's authority alone: `toggleItem` ([shoppingService.js:48-81](../../server/services/shoppingService.js)) only flips `isChecked` — it has no write to `pantryItems` — so checking an item off a shopping list is never synced to real pantry stock. That confirms a checked row can go stale (the household may have already used up what they checked off, days or weeks earlier) in a way an unchecked row can't, which is exactly the failure mode the review flagged. Two minor observations accepted: the three new aggregation/subtraction helpers are explicitly private/unexported (not a general-purpose utility surface), and the never-mutate-existing-rows rule (D-2) is now stated as applying to unchecked rows specifically, since checked rows are excluded from consideration entirely rather than "counted but protected from mutation." One minor observation declined, per the review's own framing as a non-issue: endpoint naming (`add-recipes` vs. `recipes`) — review explicitly raised no objection, kept as originally proposed for consistency with this codebase's existing verb-suffixed route style. |
| DRAFT-2 | 10/10 — APPROVED FOR IMPLEMENTATION | Confirmed the checked/unchecked distinction is architecturally sound (pantry = inventory, shopping list = purchasing workflow — different domains) and that separating D-2 into two independent invariants (checked rows excluded from coverage; unchecked rows still never mutated) makes future maintenance safer. Praised the strengthened never-mutate rationale — framed as avoiding an unhandled read/write race on a row that could flip checked mid-request, not just an `isChecked`-semantics concern — and the explicit full-set-vs-unchecked-set distinction for `sortOrder` vs. coverage. Confirmed the verification matrix now covers every edge, particularly Verification Step 6 exercising the exact scenario the round-1 revision was written to prevent. One **non-blocking** observation, explicitly not requiring another revision: `subtractExistingListItems` mutates `entry.quantity` in place, consistent with the existing pantry-subtraction helper it mirrors — acceptable for an internal helper with today's controlled call sites; noted below as a documented, deliberate choice rather than an oversight, in case this service gains more callers later. Also handed over an "implementation risk" checklist (not spec changes, since the spec already covers them) — folded into a new Implementation Notes section below so it reaches whoever implements this, not just this review record. |

---

## Request

Today the only way to create a shopping list is `BuildListModal`, which requires selecting at least one
saved recipe up front (`recipeIds: z.array(...).min(1)` in
[shopping.js:12-15](../../server/routes/shopping.js)). Connor asked for two things:

1. A user can create a shopping list **from scratch** — empty, name only, no recipe required.
2. Preserve the existing "start a list from a recipe" flow, **and** add the ability to add saved
   recipe(s) to a list **that already exists** (whether it started blank or from a recipe) — inserting
   only the ingredients the household doesn't already have.

"Doesn't already have" needs a precise definition, since it now applies in two places (fresh build, and
adding to an existing list). See Research and Design below for what "have" means and why.

---

## Research — how the existing pantry cross-reference works, and whether to extend it

Before designing, I checked whether the existing ingredient-matching approach is still the right one to
extend, or whether a more "robust" 2026-era technique (fuzzy string matching, automatic unit conversion)
should replace it.

**What the app does today** (`buildFromRecipes`, [shoppingService.js:200-267](../../server/services/shoppingService.js)):
exact match on `name.trim().toLowerCase()`, and only reduces/skips a needed quantity when the matched
pantry entry's `unit` is *exactly* equal too. A mismatched unit is never auto-converted — the ingredient
is kept in full and flagged `hasUnitMismatch` for the user to resolve manually (this flag and its
"editing clears it" behavior is deliberate, established design — TASK-027).

**What current tooling offers, if this were being built as a bigger investment:**
- Fuzzy name matching (Levenshtein distance, or the faster RapidFuzz-style token matching) to catch
  near-duplicates like "Roma tomato" vs "tomatoes, roma."
- Automatic volume↔weight unit conversion (e.g. `convert`, `js-quantities`, `recipe-converter`) — but
  these all require an ingredient-specific *density* figure to convert cups→grams correctly; without one,
  a generic converter silently produces wrong quantities for solids.

**Why I'm not adopting either here:** fuzzy matching trades exact-but-occasionally-missed matches for a
new failure mode — a *wrong* auto-merge (e.g. "sugar" fuzzy-matching "brown sugar") that's far more
confusing than the current "shows up as two lines, user reconciles" behavior, and it's a genuinely new
runtime dependency + tuning surface for a feature that today is a small, auditable `Map` loop. Automatic
unit conversion has the density problem above — doing it wrong is worse than not doing it, and the app
has no ingredient-density data source. The existing exact-match-with-a-visible-mismatch-flag approach is
the conservative, already-shipped, already-understood choice, and this task is additive to it, not a
redesign of it. I'm extending the same matching convention to a second surface (list items) rather than
introducing a new one. Flagged as a possible **future** enhancement in Out of Scope, not built now.

Sources: [Fuzzy Matching 101 (DataLadder)](https://dataladder.com/fuzzy-matching-101/),
[js-quantities](https://github.com/gentooboontoo/js-quantities),
[recipe-converter](https://github.com/justinmklam/recipe-converter) (volumetric→weight, requires a
density table per ingredient — confirms the conversion-needs-density problem above).

---

## Current Behavior (confirmed by reading the code)

- **Creating a list is only possible via recipes.** `POST /api/shopping/build`
  ([shopping.js:32-58](../../server/routes/shopping.js)) requires `recipeIds.min(1)`. `BuildListModal`
  ([BuildListModal.jsx](../../client/src/components/shopping/BuildListModal.jsx)) disables its submit
  button whenever `selectedIds.size === 0`, so the UI enforces the same restriction.
- **`buildFromRecipes`** ([shoppingService.js:200-267](../../server/services/shoppingService.js)) already
  does exactly what "only ingredients they don't have" means for a *fresh* list: it aggregates ingredients
  across the selected recipes (deduping by lowercase-trimmed name, flagging `hasUnitMismatch` on unit
  disagreement), then cross-references active (non-consumed) pantry stock and either skips an ingredient
  entirely (pantry fully covers it) or reduces its quantity (pantry partially covers it).
- **Adding one item at a time to an existing list already exists** — `addManualItem`
  ([shoppingService.js:166-197](../../server/services/shoppingService.js)) via
  `POST /api/shopping/:id/items`, wired to the manual-add form at the bottom of
  [ShoppingList.jsx:53-73](../../client/src/components/shopping/ShoppingList.jsx). This has no dedup
  logic at all — adding "Garlic" twice manually today just creates two rows. There is no bulk
  "add a recipe's ingredients" path onto an existing list.
- **No recipe→shopping-list entry point exists outside the Shopping page.** `RecipeCard.jsx` and
  `RecipeModal.jsx` have no shopping-list references — all list-building UI lives in
  `ShoppingPage`/`BuildListModal`, so this task's new UI stays contained there too.
- **Schema** ([schema.js:83-109](../../server/db/schema.js)): `shoppingListItems` has no
  `sourceRecipeId` / provenance column — items are just `{ ingredientName, quantity, unit, isChecked,
  sortOrder, hasUnitMismatch }`. No schema change is needed for this task (see Decisions, D-4).

---

## Design

### 1. Blank-start lists — relax the existing build endpoint, don't add a new one

`POST /api/shopping/build` becomes the single creation endpoint for both flows. The only change is the
zod schema:

```diff
 const buildSchema = z.object({
   name: z.string().min(1).max(200),
   recipeIds: z
     .array(z.coerce.number().int().positive())
-    .min(1, 'Select at least one recipe'),
+    .min(0)
+    .default([]),
 });
```

`shoppingService.buildFromRecipes` needs **no logic change** for this part: `recipeIds = []` makes
`recipeRows` an empty array, the `some((r) => r === null)` ownership check trivially passes, the
`ingredientMap` loop never runs, `needed` stays `[]`, and the existing `if (needed.length > 0)` guard
already skips the items insert — the function already produces "a list with zero items" correctly for a
zero-recipe call. Confirmed by reading the function, not assumed.

### 2. `BuildListModal` — recipe selection becomes optional

- Submit is enabled whenever `listName.trim()` is non-empty, regardless of `selectedIds.size`.
- Submit button label is dynamic: `selectedIds.size > 0 ? 'Build List' : 'Create List'`.
- Add a hint under "Select recipes": *"Optional — leave unselected to start with a blank list."*
- **Skip the result screen for a 0-recipe submission.** The existing result screen exists to surface item
  counts and unit-mismatch warnings — neither is meaningful for a list built with 0 recipes (always 0
  items, 0 warnings). On a 0-recipe submit, call `onClose()` immediately after `onBuild()` resolves
  instead of setting `result`, so the user lands straight on their new (empty) list.
- Rename the modal's static copy from recipe-only language ("Build Shopping List") to something that
  covers both paths — e.g. title `New Shopping List`.

### 3. New capability — add recipe(s) to an existing list

**New endpoint**: `POST /api/shopping/:id/add-recipes`, body `{ recipeIds: [...] }` (same shape/validation
as `buildSchema.recipeIds`, but `min(1)` here — there's no "add nothing" case worth supporting via this
endpoint). Returns `{ items, warnings }` — only the *newly inserted* items, same response shape
`buildFromRecipes` already returns, so the client-side result UI can be reused as-is.

**New service function** `addRecipesToList(householdId, listId, recipeIds)`
([shoppingService.js](../../server/services/shoppingService.js)):

1. Verify the list belongs to `householdId` (same lookup `getItems`/`toggleItem`/etc. already use) →
   `not_found` if not.
2. Verify every `recipeId` belongs to `householdId` (identical check to `buildFromRecipes`) →
   `invalid_recipes` if not.
3. **Aggregate ingredients** across the selected recipes — identical logic to `buildFromRecipes`'s
   `ingredientMap` loop. Extract this into a shared private helper, `aggregateIngredients(recipeRows)`,
   used by both `buildFromRecipes` and `addRecipesToList` — it's the exact same ~20 lines today; sharing
   it means a future fix to the dedup/mismatch logic only has one place to change.
4. **Cross-reference active pantry** — identical logic to `buildFromRecipes`'s pantry loop. Extract as
   `subtractPantry(householdId, entries)`, returning the reduced/filtered `needed` list. Used by both
   functions.
5. **New: cross-reference the list's own existing *unchecked* items**, using the same matching
   convention (exact lowercase-trimmed name + exact unit), so a recipe added on top of a list that
   already has an unchecked "flour, 2 cups" (from an earlier recipe, or typed in manually) doesn't
   produce a second "flour" row for a 3-cup recipe need — instead a single "flour, 1 cup" row is added
   (the shortfall). **Checked items are excluded before this pass even runs** — see below for why.
   Implemented the same *shape* as the pantry step, deliberately never mutating the pre-existing row:

   ```js
   function subtractExistingListItems(existingItems, entries) {
     // Only unchecked rows count as "already outstanding on this list" — see D-2.
     const unchecked = existingItems.filter((it) => !it.isChecked);
     const listMap = new Map();
     for (const it of unchecked) {
       const key = it.ingredientName.trim().toLowerCase();
       const cur = listMap.get(key);
       if (cur && cur.unit === it.unit) {
         cur.quantity = (cur.quantity ?? 0) + (it.quantity ?? 0);
       } else if (!cur) {
         listMap.set(key, { quantity: it.quantity, unit: it.unit });
       }
     }
     const result = [];
     for (const entry of entries) {
       const key = entry.ingredientName.trim().toLowerCase();
       if (!entry.hasUnitMismatch && entry.quantity !== null) {
         const onList = listMap.get(key);
         if (onList && onList.unit === entry.unit && onList.quantity !== null) {
           if (onList.quantity >= entry.quantity) continue; // list already covers it — drop entirely
           entry.quantity = entry.quantity - onList.quantity; // insert only the shortfall
         }
       }
       result.push(entry);
     }
     return result;
   }
   ```

   **Why checked rows are excluded entirely** (added per architect review round 1): `isChecked` is a
   pure list-completion marker, not an inventory record — `toggleItem`
   ([shoppingService.js:48-81](../../server/services/shoppingService.js)) only flips the boolean and
   never writes to `pantryItems`. A household that keeps a list around across multiple shopping trips
   (rather than deleting it right after checking out) can easily have a checked "Milk" row from a trip
   days ago that's since been fully used up. If that stale checked row silently suppressed a new recipe's
   milk requirement, the user would never be prompted to re-buy it — a silent, incorrect drop of a real
   need. An unchecked row carries no such staleness risk: it's still, right now, an acknowledged
   outstanding purchase. So only unchecked rows are consulted for coverage; checked rows are neither
   counted nor mutated.

   **Why the pre-existing (unchecked) row is still never mutated**, even though it *is* counted: keeping
   one code path — always insert a new row for the computed shortfall, never `UPDATE` an existing one —
   avoids a second, harder case entirely: a row can flip from unchecked to checked between the moment it's
   read and the moment a merge would be written (no transaction spans that gap — see the existing
   no-`db.transaction()` note in `buildFromRecipes`), so "merge into an unchecked row" would need its own
   race-handling story for no real benefit. Inserting a fresh row for just the shortfall sidesteps that,
   at the cost of two rows with the same name sitting on the list side by side when there's a partial
   overlap. Accepted — see D-2.
6. Insert the final `needed` list as new `shoppingListItems` rows. `sortOrder` continues from the
   **full** `existingItems` set's current max — checked items still occupy sort positions and must not
   have their slots reused, even though they're excluded from the coverage check in step 5. (Same
   `existingItems` fetch is reused for both step 5's filtering and this max-sort calculation — no second
   query.)
7. Return `{ status: 'ok', items, warnings }` (`warnings` = names of newly-inserted items with
   `hasUnitMismatch`, same as `buildFromRecipes`).

**Client**:
- `useShopping.js`: add `addRecipesToList(listId, recipeIds)` → `POST /api/shopping/:id/add-recipes`,
  returns `{ items, warnings }`. Doesn't touch the `lists` array (list metadata is unchanged by adding
  items — consistent with `addManualItem`'s existing behavior, which also never updates `lists`).
- New `client/src/components/shopping/AddRecipesModal.jsx` — same recipe-checkbox-list UI as
  `BuildListModal`, minus the name field (the list already exists), submit button "Add to List." Result
  view: "Added N items" + the same unit-mismatch warning block `BuildListModal` already renders. If the
  server returns 0 items (every ingredient was already covered by pantry + list), show *"Every ingredient
  from the selected recipe(s) is already in your pantry or on this list."* instead of "Added 0 items."
- **Shared recipe-checkbox-list**: `BuildListModal` and `AddRecipesModal` need the identical
  recipes-with-checkboxes block ([BuildListModal.jsx:122-164](../../client/src/components/shopping/BuildListModal.jsx)).
  Extract it into `client/src/components/shopping/RecipeSelectList.jsx` (props: `recipes`, `loading`,
  `selectedIds`, `onToggle`), used by both modals — this isn't speculative reuse, both call sites exist in
  this same task.
- `ShoppingPage.jsx`: add an "+ Add Recipe" button next to the selected list's title (only rendered when
  `selectedList` exists), opening `AddRecipesModal`. On successful add, force `ShoppingList` to refetch by
  bumping a `refreshKey` state and folding it into the existing `key={selectedId}` prop
  (`key={`${selectedId}-${refreshKey}`}`) — this reuses the remount-triggers-refetch mechanism the
  component already relies on for list switching, rather than lifting `items` state up or adding an
  imperative refetch handle.
- Update `ShoppingPage`'s header subtitle and empty-state copy, which currently assert lists are *only*
  "Built from your saved recipes" — no longer true.

---

## Decisions

- **D-1**: Blank-list creation reuses `POST /api/shopping/build` with `recipeIds: []`, rather than adding
  a separate "create empty list" endpoint. `buildFromRecipes` already produces the correct empty-list
  result for a zero-recipe call with no code change — introducing a second endpoint for a case the
  existing one already handles would be needless duplication.
- **D-2**: Two related but distinct rules, both revised per architect review round 1:
  1. **Only unchecked existing items count as coverage.** `isChecked` is a workflow-completion marker,
     never synced to `pantryItems` (`toggleItem` only flips the boolean — confirmed by reading it, see
     Architect Review History). A checked row can be stale — already used up since a prior shopping trip
     on a list the household hasn't cleared — so letting it silently suppress a genuinely-needed new
     ingredient would be a real correctness bug, not just cosmetic. Checked rows are excluded before the
     coverage check runs; they're neither counted nor touched.
  2. **Even a counted (unchecked) row is never mutated** — only the *new* row being inserted has its
     quantity reduced, or is dropped entirely if fully covered. This avoids needing any read/write race
     handling for a row that could flip checked mid-request (see Design section 3, step 5), not
     specifically the `isChecked`-mutation concern that motivated rule 1 above.
  The tradeoff for both rules together: a partial overlap against an unchecked row still produces two
  same-name rows instead of one merged row — accepted as the safer, more visible failure mode, consistent
  with how `hasUnitMismatch` already surfaces unit disagreements today rather than guessing.
- **D-3**: No fuzzy name matching, no automatic unit conversion — see Research above. Extends the
  existing exact-match convention to a second surface rather than replacing it app-wide.
  - **D-3.5 — Boundary of this decision**: the exact-match convention now runs twice in `addRecipesToList`
    (once against pantry, once against list items), using the household's food-name spelling as the
    unwritten canonical form. This is exactly as brittle to spelling drift ("tomato" vs "tomatoes") as
    today's pantry cross-reference already is for a fresh build — not a new risk this task introduces, but
    doubled exposure to it. Worth naming explicitly since it wasn't obvious until aggregation was extended
    to a second matching pass; still not enough to justify fuzzy matching per D-3's reasoning.
- **D-4**: No schema change. `shoppingListItems` doesn't gain a `sourceRecipeId` / provenance column —
  nothing in the request asks for "which recipe did this item come from" to be queryable later, and
  `buildFromRecipes` never tracked that either (it already merges same-name ingredients from multiple
  recipes into one row, discarding per-recipe origin by design). Adding provenance now would be scope
  creep relative to both the request and the existing convention.
- **D-5**: `addRecipesToList` does not update `shoppingLists.updatedAt`. `addManualItem` doesn't do this
  today either (checked directly — [shoppingService.js:166-197](../../server/services/shoppingService.js)
  has no `updatedAt` write), so this keeps the new bulk-add path consistent with the existing single-item
  add path rather than introducing an inconsistency between the two "add to a list" mechanisms.
- **D-6**: `aggregateIngredients`, `subtractPantry`, and `subtractExistingListItems` are extracted from
  `buildFromRecipes` into shared helpers rather than duplicated into `addRecipesToList`. Both functions
  need byte-identical dedup/mismatch-flagging/pantry-reduction behavior — duplicating ~35 lines of
  matching logic across two functions is the kind of drift risk (fix one, forget the other) worth
  avoiding via one extraction, not a speculative abstraction for a hypothetical third caller. All three
  helpers stay **private, unexported functions within `shoppingService.js`** (per architect review round
  1) — they encode matching/mutation assumptions specific to this file's own call sites (e.g. the
  never-mutate rule in D-2), and exporting them would invite reuse in a context where those assumptions
  silently stop holding.
- **D-7**: `subtractExistingListItems` (and `subtractPantry`, which it mirrors) mutate `entry.quantity` in
  place on the in-memory aggregated ingredient objects, rather than returning new objects. Flagged as a
  non-blocking observation in architect review round 2 — acceptable today because both helpers are
  private, with a small, controlled set of call sites (D-6), so the mutation is fully contained within a
  single request's processing. If this service ever grows more callers, revisit in favor of an immutable
  transform then — not a reason to change it now.

---

## Allowed Files

- `server/routes/shopping.js` — relax `buildSchema.recipeIds` to `.min(0).default([])`; add
  `POST /:id/add-recipes` route + its zod schema.
- `server/services/shoppingService.js` — extract `aggregateIngredients`/`subtractPantry` helpers from
  `buildFromRecipes`; add `subtractExistingListItems` and `addRecipesToList`.
- `client/src/hooks/useShopping.js` — add `addRecipesToList`.
- `client/src/components/shopping/BuildListModal.jsx` — optional recipe selection, dynamic button label,
  skip result screen on 0-recipe submit, use extracted `RecipeSelectList`.
- New: `client/src/components/shopping/AddRecipesModal.jsx`
- New: `client/src/components/shopping/RecipeSelectList.jsx`
- `client/src/pages/ShoppingPage.jsx` — "+ Add Recipe" button, `AddRecipesModal` wiring, `refreshKey`,
  updated subtitle/empty-state copy.

## Forbidden Files

- `client/src/components/shopping/ShoppingList.jsx` — untouched. It already refetches on `listId`
  (via its `key`) change; the `refreshKey` mechanism in `ShoppingPage` reuses that existing behavior
  rather than modifying this component to accept new props.
- `server/routes/recipes.js`, `server/services/recipeService.js`,
  `client/src/components/recipes/**`, `client/src/hooks/useRecipes.js` — no recipe-side change is needed;
  recipes are only ever read here, never modified.
- `server/db/schema.js` / any new migration — see D-4, no schema change.
- `server/services/recipeUrlImportService.js`, `recipeScorer.js`, `recipeBlocklistService.js` — unrelated
  to shopping list building.
- Pantry routes/services (`server/routes/pantry.js` if present, `pantryItems` writes) — pantry is
  read-only reference data for this task, exactly as it already is in `buildFromRecipes` today.

## Constraints

- Zero new npm dependencies (per D-3 — no fuzzy-matching or unit-conversion library).
- `buildFromRecipes`'s behavior for `recipeIds.length >= 1` must be byte-identical to today's — this is a
  regression risk specifically because the shared aggregation/pantry helpers are being extracted out of a
  function other code already depends on. Verify explicitly (see Verification Steps), don't just assume
  the extraction is behavior-preserving.
- `addManualItem` and its existing manual-add UI in `ShoppingList.jsx` are unchanged — this task adds a
  bulk recipe-based add path alongside it, not a replacement.
- `addRecipesToList` must reject recipe IDs that don't belong to the caller's household with the same
  `invalid_recipes` semantics `buildFromRecipes` already uses (400, not a silent skip) — a cross-household
  ID guess must not be able to probe or pull ingredient data from another household's recipe.

## Out of Scope (v1)

- **Fuzzy ingredient-name matching** (Levenshtein/RapidFuzz-style) — see D-3. Would reduce missed matches
  from spelling variants but introduces a new wrong-merge failure mode; not worth it for this task.
- **Automatic unit conversion** (cups↔grams etc.) — see D-3/Research. Needs a per-ingredient density table
  this app doesn't have; doing it without one produces silently wrong quantities, which is worse than
  today's visible `hasUnitMismatch` flag.
- **Removing/consolidating items on the list UI** when a recipe-add creates a same-name shortfall row next
  to an existing row (D-2's accepted tradeoff) — the user reconciles manually, same as they already do for
  `hasUnitMismatch` today. A "merge these two rows" UI affordance could be a future enhancement.
- **Per-item recipe provenance** ("this item came from Recipe X") — see D-4. Not requested, and
  `buildFromRecipes` already discards this by design when it merges same-name ingredients from multiple
  recipes.
- Reordering/drag-and-drop of shopping list items — unrelated to this task, not touched.

## Known Risks

- **Extraction regression risk on `buildFromRecipes`** — see Constraints. Mitigated by explicit
  before/after verification of the existing recipe-only build flow, not just the new paths.
- **Doubled exact-match brittleness** (D-3.5) — a household with inconsistent ingredient naming
  ("scallion" in one recipe, "green onion" in another) will see more, not fewer, near-duplicate rows as
  more surfaces (list *and* pantry) get cross-referenced. Pre-existing risk, now exercised twice per
  add-recipe call instead of once.
- **Two same-name rows after a partial-overlap add** (D-2) — intentional, but worth calling out
  explicitly as expected behavior during verification, not a bug, so it isn't "fixed" by an unplanned
  merge that reintroduces the race/mutation problem D-2 was written to avoid.
- **Resolved by D-2's checked-item exclusion, called out so it isn't silently reintroduced**: a stale
  checked row (e.g. "Milk," checked off during a shopping trip days or weeks ago, on a list the household
  hasn't cleared since) must never suppress a genuinely-needed new ingredient. Verification Step 6 below
  exercises this directly — don't treat "checked rows still count as coverage" as a harmless simplification
  if this logic gets touched again later.

## Implementation Notes

Carried over from architect review round 2's implementation-risk checklist — these are ordinary coding
risks, not open design questions (the spec above already resolves each one), but worth having in front of
whoever writes the code rather than only in the review history table above:

1. **Extracting `aggregateIngredients`/`subtractPantry` out of `buildFromRecipes` must preserve
   byte-identical behavior for the existing recipe-only build path.** This is the single highest-risk step
   — verify with Verification Step 1 before moving on to the new `addRecipesToList` path.
2. **`sortOrder` for newly inserted items must be computed from the full `existingItems` set** (checked
   + unchecked), not the unchecked-only subset used for coverage filtering — see Design section 3, step 6.
   Using the filtered subset here would let a new item's `sortOrder` collide with a checked row's existing
   slot.
3. **Filter to unchecked rows before building `subtractExistingListItems`'s internal `listMap`**, not
   after computing the shortfall — i.e., the `.filter((it) => !it.isChecked)` happens on `existingItems`
   as the very first line of the helper (see the code in Design section 3, step 5), so a checked row can
   never contribute to `listMap` in the first place.
4. **The `refreshKey`-driven remount in `ShoppingPage.jsx` must reliably trigger `ShoppingList.jsx`'s
   existing `fetchItems` effect** after a successful add-recipes call — confirm the new items actually
   appear without a manual page reload (Verification Step 11 exercises the modals; explicitly watch the
   list panel update after closing `AddRecipesModal`, not just that the modal itself reports success).

## Verification Steps

1. **Regression — existing recipe-build flow unchanged**: build a list from 2+ recipes sharing an
   ingredient at the same unit (should merge/reduce by pantry as before); build a list from 2 recipes
   with a genuine unit mismatch on a shared ingredient (should still flag `hasUnitMismatch` and produce
   the same warning as before extraction).
2. **Blank list creation**: open the (renamed) modal, type a name, select zero recipes, submit — new
   empty list appears immediately (no result screen), selected in the sidebar, "This list has no items
   yet" shown.
3. **Blank list creation, then manual add**: on the new blank list, use the existing manual-add form to
   add an item — confirms `addManualItem` path is untouched and still works on a list that didn't start
   from a recipe.
4. **Add recipe to a blank list**: on a blank list, use "+ Add Recipe," select a recipe with an
   ingredient already in the household's active pantry at a sufficient quantity — confirm that ingredient
   is *not* added, while other ingredients are.
5. **Add recipe to a list with an overlapping *unchecked* manual item**: manually add "Flour, 2, cups"
   to a list (leave it unchecked), then add a recipe needing 5 cups flour — confirm the result is a
   *second* row "Flour, 3, cups" (the shortfall), the original "Flour, 2, cups" row is untouched and
   still unchecked, not merged into one row of 5.
6. **Checked existing items must not suppress a new need (the architect-review-round-1 fix)**: manually
   add "Milk" to a list, check it off, then add a recipe requiring milk — confirm a *new*, full "Milk"
   row is added (the checked row is not treated as coverage), and the original checked "Milk" row is
   left exactly as it was. This is the scenario the required revision exists to prevent regressing.
7. **Add recipe fully covered by pantry + an unchecked list item combined**: confirm the "every
   ingredient already covered" message renders and 0 items are inserted, rather than a silent no-op or
   an error.
8. **Cross-household guard**: attempt `POST /api/shopping/:id/add-recipes` with a recipe ID belonging to
   a different household (e.g. via direct API call) — confirm `400 invalid_recipes`, not a 500 or a
   silent partial add.
9. **List ownership guard**: attempt the same endpoint against a `listId` belonging to a different
   household — confirm `404`, matching every other `:id` route in this file.
10. **Sort order after a mix of checked and unchecked items**: on a list with both checked and unchecked
    rows, add a recipe — confirm new rows' `sortOrder` continues past the *full* existing set (no
    collision with a checked row's slot), per step 6 of the Design section.
11. Mobile (375px) and desktop viewports: both modals (`BuildListModal`'s now-optional recipe picker,
    new `AddRecipesModal`) remain usable and the "+ Add Recipe" button is reachable on the Shopping page.
