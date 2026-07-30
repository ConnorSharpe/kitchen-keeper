# TASK-050 — Shopping List Flow Correction: Suggest-Recipes Button, Recipe→List Entry Point, Read More/Less

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 9.7/10 — approve after small revision | Praised the scope discipline (reusing `buildList`/`addRecipesToList` unchanged, no backend churn), D-5's service ownership, saved-recipes-only restriction, reuse of `recipeScorer`/the 0.25 threshold, the Forbidden Files list, and the DOM-measurement approach to read-more/less. Five required changes, all accepted below: (1) `useEffect` instead of `useLayoutEffect` for truncation detection — no synchronous-layout requirement, a one-frame flicker is an acceptable tradeoff; (2) a `ResizeObserver` per card instead of a `window.resize` listener per card — strictly better than the shared-hook alternative also suggested, since it reacts to the card's own box size changing for any reason, not just viewport breakpoints; (3) an explicit `suggestedIds` state, kept separate from `selectedIds`, with a precisely defined label condition; (4) the saved-recipe scoring/qualification check extracted into one shared helper both `rankSavedByPantry` and `suggestForChat` call, instead of the same `0.25`/`1` literals living in two places — verified this is feasible without dragging `rankSavedByPantry` into `suggestForChat`'s unrelated chat-history/tiering/strategy logic, since only the scoring+qualification sub-step needed extracting, not the whole function; (5) a shared `ShoppingResultSummary` component extracted from `BuildListModal`/`AddRecipesModal`/`AddToListModal`'s near-identical result views, addressing the reviewer's "three shopping modals" duplication concern without fully merging the pickers (which differ genuinely in what's fixed vs. chosen — see D-13). One suggestion evaluated and declined with reasoning: moving `GET /suggested-for-shopping` under `/api/shopping` instead of `/api/recipes` — kept under `/api/recipes` per existing precedent (`AddRecipesModal` already calls `GET /api/recipes` directly from shopping-domain UI), justification added to Design 1 rather than moved (see D-14). One item noted as already-fine, no change: `AddToListModal` re-fetching `lists` on every open — acceptable at today's scale, explicitly not revisited. |
| DRAFT-2 | 10/10 — APPROVED FOR IMPLEMENTATION | Confirmed all five required changes landed correctly, specifically praising: the `ResizeObserver` choice as stronger than the original ask (reacts to any box-size cause, not just viewport resize, with no global listener); the `suggestedIds`/`selectedIds` split as making every edge case deterministic, especially the re-check-after-uncheck case now covered by Verification Step 15; `qualifiesAsPantryMatch` as the correct abstraction boundary (extracting only the duplicated qualification check, not forcing `rankSavedByPantry` to call `suggestForChat` wholesale); D-13's explicit reasoning for keeping the three modals' pickers separate while only sharing the result view, flagged as the kind of reasoning that "prevents future developers from DRYing the wrong thing"; and D-14's route-ownership justification (resource domain over consuming UI). Two non-blocking naming/style observations, not requiring another revision: `qualifiesAsPantryMatch` could arguably be named `scorePantryMatch` long-term since it returns more than a boolean — noted here as a possible future rename, not applied now (the current name still accurately describes its primary use at each call site); confirmed `MAX_SUGGESTIONS` and the `heading`/`bodyText`/`warnings` prop shape for `ShoppingResultSummary` (deliberately not owning its own copy) were both already exactly right. No remaining architectural risks identified — only ordinary implementation risks (forgetting `stopPropagation()`, not disconnecting the `ResizeObserver`, preserving exact result copy and `suggestForChat` behavior), all already covered by this spec's Constraints and Verification Steps. |

---

## Request

Connor's original ask for TASK-049 was implemented and committed (`ef0b166`), but on review it wasn't
the fix he actually intended. This spec re-scopes the work correctly. Connor asked for:

1. A user should be able to create a shopping list **before** adding any recipes to it — start blank,
   add staples like "milk" manually. From there, hit a button for **the agent to suggest recipes** and
   add those recipes to the list.
2. Once a list exists and has items, checking an item off is a **visual aid only** — it doesn't need to
   sync to anything else.
3. From a recipe (card or detail view), there should be an option to add that recipe to an **existing**
   shopping list, or start a **new** one from scratch.
4. Recipe cards should show a **"Read more"** button when the description is cut off by the card's
   border, and **"Read less"** to collapse it back.
5. The Shopping page currently has two buttons that both open the same "create a list" modal — remove
   the redundant one in the center of the empty state, keep the one in the page header.

See Current Behavior below for which of these are already done and don't need new code.

---

## Current Behavior (confirmed by reading the code, including TASK-049's shipped result)

**Already done — no new code needed for these two:**

- **Blank-first list creation (item 1, first half).** `BuildListModal`
  ([BuildListModal.jsx](../../client/src/components/shopping/BuildListModal.jsx)) already creates a list
  immediately from just a name, with recipe selection optional (`POST /api/shopping/build` with
  `recipeIds: []`). This already matches "start a list blank and add milk and other staples" — confirmed
  live-verified per `ai/handoffs/CURRENT_STATE.md`. **What's missing is only the second half of item 1**
  (the agent-suggest button) — see Design 1 below.
- **Checking an item is already visual-only (item 2).** `toggleItem`
  ([shoppingService.js:48-81](../../server/services/shoppingService.js)) only flips `shoppingListItems.isChecked`.
  It has no write to `pantryItems` and nothing else reads `isChecked` outside the shopping list UI itself
  ([ShoppingList.jsx](../../client/src/components/shopping/ShoppingList.jsx) renders it as a checkbox +
  strikethrough, nothing more). This is already exactly "visual aid only." **No change needed** — listed
  here so it's verified, not silently assumed (see Verification Step 1).

**Not done — this spec covers these three:**

- **No agent-suggest-recipes affordance anywhere (item 1, second half).** The existing "+ Add Recipe"
  button on `ShoppingPage` opens `AddRecipesModal`
  ([AddRecipesModal.jsx](../../client/src/components/shopping/AddRecipesModal.jsx)), which is a **manual**
  alphabetical checkbox list of every saved recipe — the user has to already know which recipe(s) they
  want. There is no scoring against pantry contents and no one-click "suggest" action anywhere in the
  shopping flow.
  - A pantry-based recipe-ranking engine already exists but lives in two places, neither of which fits
    directly: `aiService.suggestRecipes` → `recipeSearchService.findByPantry`
    ([recipeSearchService.js:219](../../server/services/recipeSearchService.js)), wired to `POST
    /api/ai/suggest-recipes` and the Recipes page's "🔍 Find Recipes Online" button
    ([RecipesPage.jsx:136-154](../../client/src/pages/RecipesPage.jsx)) — this returns **ephemeral,
    not-yet-saved** recipes from Spoonacular/TheMealDB that would need a "Save Recipe" step before they
    have a real `recipeId` `addRecipesToList` could use. The other is `recipeSearchService.suggestForChat`
    ([recipeSearchService.js:360](../../server/services/recipeSearchService.js)), the AI chat tool's
    suggestion logic — it mixes saved recipes with the same external API calls, needs chat `history` for
    its recency-penalty and rotation logic, and is only ever invoked as a tool call inside an active chat
    turn. Neither is a direct fit for a plain button click on the Shopping page — see Design 1 for what's
    actually reused.
- **No recipe→shopping-list entry point (item 3).** Neither `RecipeCard.jsx` nor `RecipeModal.jsx` has any
  reference to shopping lists — confirmed by reading both files in full. All list-building UI lives on the
  Shopping page.
- **No read-more/read-less on recipe cards (item 4).** `RecipeCard.jsx`'s description is rendered with a
  hardcoded `line-clamp-2` and no way to expand it
  ([RecipeCard.jsx:76-80](../../client/src/components/recipes/RecipeCard.jsx)). `RecipeModal.jsx`'s
  description is already shown in full, unclamped — the detail view has no truncation problem; only the
  card does.
- **Duplicate "create a list" button (item 5).** Confirmed in
  [ShoppingPage.jsx](../../client/src/pages/ShoppingPage.jsx) — both the `+ New List` button in
  `PageHeader`'s `actions` slot ([ShoppingPage.jsx:65-73](../../client/src/pages/ShoppingPage.jsx)) and
  the `New Shopping List` button in the empty state
  ([ShoppingPage.jsx:91-96](../../client/src/pages/ShoppingPage.jsx)) call the identical
  `setShowModal(true)`, opening the same `BuildListModal`. The empty-state button only renders when
  `lists.length === 0`, so the header button is the only one visible once any list exists — the
  duplication is specifically an empty-household/new-user redundancy. Note on position: per
  [PageHeader.jsx](../../client/src/components/layout/PageHeader.jsx), the title sits left and `actions`
  render right (`justify-between`), so the surviving header button is actually in the page's **upper
  right**, not upper left. Flagging this now in case "upper left" meant something more specific — see
  Design 4.

---

## Design

### 1. "Suggest recipes for me" — score the household's own saved recipes against pantry, reuse the existing add-to-list endpoint

**New service export**, `recipeSearchService.rankSavedByPantry(householdId)`
([recipeSearchService.js](../../server/services/recipeSearchService.js) — same file that already owns
`findByPantry` and `suggestForChat`, i.e. all existing pantry-based recipe ranking):

1. Fetch the household's saved recipes (`recipeService.getAll`) and active pantry items
   (`pantryService.getAll`) — both already-existing calls, same as `suggestForChat`'s inputs.
2. Score and qualify each saved recipe using a **new shared helper**,
   `qualifiesAsPantryMatch(recipe, allItems)` (added to `recipeSearchService.js` alongside
   `rankSavedByPantry`) — wraps the existing `recipeScorer.score(recipe, allItems)`
   ([recipeScorer.js:22](../../server/utils/recipeScorer.js)) and applies the qualification bar
   `overlapScore >= 0.25 && matchedIngredients.length >= 1`, returning `{ overlapScore,
   matchedIngredients, qualifies }`. This same threshold was previously inlined directly inside
   `suggestForChat`'s `scoreCandidates` closure
   ([recipeSearchService.js:449-452](../../server/services/recipeSearchService.js)) as the saved-source
   filter condition — that inline check is replaced with a call to `qualifiesAsPantryMatch`, so the
   `0.25`/`1` figures exist in exactly one place instead of two. `suggestForChat`'s own scoring (the
   `+0.2` saved bonus, recency penalty, tiering, strategy sort) stays exactly where it is — only the
   qualification sub-step moves into the shared helper, not the whole scoring pipeline, since the rest is
   chat-specific (history-based recency, target-ingredient tiering) and `rankSavedByPantry` has no
   equivalent need for it. See D-12.
3. Filter to recipes where `qualifies === true`, sort descending by `overlapScore`, take the top
   `MAX_SUGGESTIONS` (a module-level constant, `= 5`) — not a bare literal.
4. Return `[{ id, name, tags, overlapScore, matchedCount }]` — enough for the client to pre-select and
   label matches, nothing more (no need to ship full ingredient lists back down for this UI).

**Why saved-recipes-only, no external API call**: the whole point of this button is "add ingredients to
my shopping list," which requires a real `recipeId` that `addRecipesToList`
([shoppingService.js](../../server/services/shoppingService.js), added in TASK-049) can look up and trust
belongs to the household. An ephemeral Spoonacular/TheMealDB result has no such id — using it here would
mean silently bolting on a "save this recipe first" step the user didn't ask for. Restricting to saved
recipes means the suggestion can go straight into the existing add-to-list flow with zero new endpoints
downstream of the ranking itself. Flagged as a possible future enhancement in Out of Scope, not built now.

**New route**: `GET /api/recipes/suggested-for-shopping` in
[recipes.js](../../server/routes/recipes.js), following the existing specialized-read-route pattern
already used for `GET /api/recipes/blocklist` in the same file. Returns `{ suggestions: [...] }` from
step 4 above. Read-only, no body. Kept under `/api/recipes` rather than `/api/shopping` even though its
only consumer is shopping UI: the operation itself — scoring saved recipes against pantry — is a recipe
read, not a shopping-list mutation or list-scoped query, and this codebase already has direct precedent
for shopping-domain UI reading straight from `/api/recipes` (`AddRecipesModal.jsx` already calls `GET
/api/recipes` today). See D-14.

**Client**: `AddRecipesModal.jsx` gains a `✨ Suggest recipes for me` button above the existing
`RecipeSelectList`, plus a new, independent piece of state: `suggestedIds` (a `Set`, default empty —
distinct from `selectedIds`, which remains the single source of truth for what's checked). On click:
- Calls the new endpoint.
- **Replaces** `suggestedIds` wholesale with the returned recipe IDs (a later click replaces, never
  merges, the previous suggestion set).
- Adds those same IDs into `selectedIds` (union, not replace — anything the user already had checked
  manually stays checked). **No change to `RecipeSelectList.jsx`** needed, since it already renders
  whatever `selectedIds` it's given.
- Shows the `Suggested based on your pantry` label whenever `[...selectedIds].some(id =>
  suggestedIds.has(id))` is true — i.e. at least one currently-checked recipe is a member of the
  suggested set. `suggestedIds` itself never changes as the user checks/unchecks boxes, so the label's
  membership test is well-defined in every case: unchecking a suggested recipe drops it out of the
  label condition (unless another suggested one is still checked); manually re-checking it later still
  counts, because it's still in `suggestedIds` — that Set was never mutated by the checkbox
  interactions, only replaced by a fresh suggest click.
- If zero recipes qualify, shows *"No strong pantry matches among your saved recipes right now."* — a
  toast, not a broken empty state — and leaves both `suggestedIds` and `selectedIds` untouched.
- The user can still deselect/add manually before hitting the existing "Add to List" button — this is a
  pre-fill, not a forced action, consistent with how `BuildListModal`'s recipe selection has always been
  freely editable.

This directly satisfies "hit a button for the agent to suggest recipes and add those recipes to the
list": one click ranks, pre-selects, and the existing (already-shipped) `addRecipesToList` call does the
rest.

### 2. Recipe → shopping list entry point

**New shared component**, `client/src/components/shopping/AddToListModal.jsx`. Props: `recipeId`,
`recipeName`, `onClose`. Internally calls `useShopping()` for its own `lists`/`buildList`/
`addRecipesToList` — a fresh hook instance scoped to this modal, not shared state with `ShoppingPage`
(see Decisions, D-1).

- Fetches `lists` on mount (`fetchLists()`).
- Two modes, switched by a small tab/radio control:
  - **"Add to existing list"** (default when the household has ≥1 list): a `<select>` of the household's
    lists. Submit calls `addRecipesToList(listId, [recipeId])` — the exact TASK-049 endpoint, unchanged.
  - **"Start a new list"**: a name input. Submit calls `buildList(name, [recipeId])` — the exact
    TASK-049-relaxed `POST /api/shopping/build` endpoint, unchanged (this is precisely the pre-existing
    "build from recipe" flow, just entered from the recipe side instead of the Shopping page).
  - If the household has zero lists, skip the tab control and show only the "new list" name field.
- Result view: renders the new shared `ShoppingResultSummary` component (Design 5) rather than a
  fourth copy of the "Added N items" / unit-mismatch-warning block — same response shape
  (`{ items, warnings }`) as `BuildListModal` and `AddRecipesModal` already produce.
- **No backend change for this section at all** — both endpoints it calls already exist and already
  accept a single-recipe-id array.

**Two entry points into this same modal** (see Decisions, D-2 for why both):
- `RecipeCard.jsx`: a new 🛒 icon button in the existing top-right icon row (alongside the favorite ☆/★
  and 🚫 block icons), `aria-label="Add to shopping list"`, `e.stopPropagation()` so it doesn't also
  trigger `onOpen`.
- `RecipeModal.jsx`: a new `🛒 Add to Shopping List` button in the footer action row, next to the existing
  `Delete`/`Close` buttons.

### 3. Read more / Read less on recipe card descriptions

`RecipeCard.jsx` gains local state: `expanded` (bool, default `false`) and `isTruncated` (bool, default
`false`).

- The description `<p>` gets a `ref`. A `useEffect` (not `useLayoutEffect` — see D-10) compares
  `el.scrollHeight > el.clientHeight` while the paragraph is still clamped, on mount and whenever
  `recipe.description` changes, and sets `isTruncated` accordingly. A `ResizeObserver` (see D-9),
  attached to the same element in that same effect and disconnected on unmount, re-runs the same
  measurement whenever the element's own box size changes — which covers the grid's `sm`/`lg`
  breakpoint-driven width changes (the original motivation) plus any other cause of the card resizing,
  without a global `window` listener.
- `className` on the `<p>` becomes conditional: `expanded ? '' : 'line-clamp-2'`.
- The "Read more" / "Read less" toggle button renders **only when `isTruncated || expanded`** — a
  description that already fits in 2 lines never shows a toggle it doesn't need (this is the literal
  ask: "if the recipe description is cut off by the border of the card").
- Button click calls `e.stopPropagation()` (same pattern as the favorite/block icons) so it doesn't also
  open the recipe modal, and toggles `expanded`.
- No change to `RecipeModal.jsx` — its description was never clamped, nothing to fix there.

### 4. Shopping page — remove the duplicate "create a list" button

Delete the empty-state's `New Shopping List` button and its `onClick`
([ShoppingPage.jsx:91-96](../../client/src/pages/ShoppingPage.jsx)) — the surrounding empty-state copy
("No lists yet." / "Start a blank list, or build one from your saved recipes.") stays, it just no longer
has its own duplicate call-to-action beneath it. The header's `+ New List` button
([ShoppingPage.jsx:65-73](../../client/src/pages/ShoppingPage.jsx)) is untouched and remains the only way
to open `BuildListModal` from this page — it's already visible in the empty state today (the header
renders unconditionally, above the empty-state block), so removing the center button loses no
functionality, only the redundant second click target.

### 5. Shared result-summary component, extracted from all three shopping modals

New presentational component, `client/src/components/shopping/ShoppingResultSummary.jsx`. Props:
`heading` (e.g. `"List Built"` / `"Recipe Added"`), `bodyText` (the one pre-composed sentence — e.g.
`"Added 3 items."` or the 0-items copy each caller already has its own wording for), `warnings` (array of
strings), `onDone`. Renders exactly the block that's currently written out three times: the body text,
the amber unit-mismatch-warning box when `warnings.length > 0`, and the `Done` button.

- `BuildListModal.jsx`, `AddRecipesModal.jsx`, and the new `AddToListModal.jsx` all render this instead
  of their own copy of the result view. Each caller keeps composing its own `heading`/`bodyText` (the
  wording differs slightly — "created with N items" vs. "Added N items" vs. AddToListModal's own two
  submit paths — see D-13 for why the callers keep this much control rather than the component owning
  the copy).
- `BuildListModal.jsx` and `AddRecipesModal.jsx` change **only** in their result-view JSX — swapped for
  `<ShoppingResultSummary .../>` — with the same props they already compute today. No change to either
  file's picker view, submit handlers, or the data they call `onBuild`/`onAdd` with. Verify this is a
  pure extraction (see Constraints and Verification Steps): both modals' picker behavior and result
  *content* must be pixel-for-pixel identical before and after, only the JSX's location changes.

---

## Decisions

- **D-1**: `AddToListModal` calls its own `useShopping()` instance rather than lifting shopping-list
  state up to a shared context or prop-drilling it from `ShoppingPage`. `useShopping()` is already a
  self-contained hook with its own `lists` state and no cross-component synchronization requirement today
  — the modal only needs a fresh `fetchLists()` on open and to fire one of two mutations. Introducing
  shared/global shopping state for this would be new architecture the request doesn't ask for; the modal
  living on the Recipes page has no need to see `ShoppingPage`'s copy of `lists` or vice versa.
- **D-2**: The recipe→list entry point is added to **both** `RecipeCard` and `RecipeModal`, not just one.
  Connor's phrasing ("if a user is on a recipe card") is genuinely ambiguous between the grid tile
  component literally named `RecipeCard.jsx` and the detail view a user reaches by opening one (commonly
  called "the recipe card" in conversation). Both call sites share the same `AddToListModal`, so the
  marginal cost of wiring both is one icon button + one footer button, not a duplicated modal — low
  enough cost to cover the ambiguity rather than guess and risk building the wrong one.
- **D-3**: "Suggest recipes for me" ranks **only saved recipes**, never the external
  Spoonacular/TheMealDB pool `findByPantry` also has access to. See Design 1's rationale — an external
  candidate has no stable `recipeId` `addRecipesToList` can consume, and silently requiring a save-first
  step would be scope the request didn't ask for. If Connor wants "suggest recipes I don't have yet"
  folded into this same button later, that's a bigger follow-up (needs a save-then-add two-step flow) —
  named explicitly in Out of Scope, not built now.
- **D-4**: The saved-recipe qualification bar (`overlapScore >= 0.25 && matchedIngredients.length >= 1`)
  is shared with `suggestForChat` via one helper (`qualifiesAsPantryMatch`, see D-12) rather than
  re-derived or merely value-matched. One scoring convention for "is this saved recipe a good pantry
  match," enforced by one function both the chat suggestion tool and this new button call, is less
  fragile than the app having the same threshold hand-copied into two places that could quietly drift.
- **D-5**: `rankSavedByPantry` is a new function in `recipeSearchService.js`, not `shoppingService.js`.
  Ranking recipes against pantry contents is exactly what this file already does (`findByPantry`,
  `suggestForChat`) — it owns the "recipe scoring" domain. `shoppingService.js` stays focused on list/item
  CRUD and the aggregation helpers from TASK-049; it doesn't need to import `recipeScorer` or take on a
  new scoring responsibility duplicating logic that already lives one file away.
- **D-6**: Read-more/read-less uses a DOM measurement (`scrollHeight` vs `clientHeight`) rather than a
  fixed character-count heuristic (e.g. "show the button if `description.length > 120`"). A character
  count doesn't account for the card's actual rendered width (which changes at grid breakpoints) or
  variable-width characters — it would either show a needless button on a description that happens to fit
  in 2 short lines, or hide a needed one on a description of narrow characters that still wraps to 3+
  lines. Measuring the real rendered box is the only way to satisfy the literal ask ("cut off by the
  border of the card") accurately.
- **D-7**: No change to `WebSuggestionCard` in `RecipesPage.jsx`, even though it has the same
  `line-clamp-2` description pattern. Connor's request named "recipe cards" specifically, and
  `WebSuggestionCard` is an ephemeral, not-yet-saved search result with a different card component
  entirely — extending read-more there is a reasonable future ask but not what was requested. Named in
  Out of Scope.
- **D-8**: The surviving "create a list" button is the existing `PageHeader` `+ New List` button, left in
  its current position (upper right, per `PageHeader`'s left-title/right-actions layout) rather than
  moved. Connor described it as "upper left," which doesn't match either button's actual on-screen
  position today (the title is upper left; both buttons are elsewhere). Read literally as "keep the
  header button, delete the center one" — the unambiguous, low-risk part of the instruction — rather than
  also relocating the surviving button to a corner neither button currently occupies, which would be a
  layout change nobody asked for outright. If a literal upper-left position was intended, that's a
  one-line follow-up (move the button into the title's flex container) once confirmed.
- **D-9**: Truncation detection uses a `ResizeObserver` on each card's description element rather than a
  shared/global `window.resize` listener. This is a stronger fix than just deduplicating the listener
  count: a `ResizeObserver` fires whenever the *observed element's* box actually changes size, for any
  reason (grid breakpoint change, sidebar collapse, font load reflow, container query), whereas a window
  resize listener only fires on viewport resize and would miss any other cause of a card changing width.
  It's also simpler to implement per-card than threading a shared debounced resize hook through the grid,
  since each card's observer is self-contained (attached and disconnected in its own effect) with no
  coordination needed across cards.
- **D-10**: Truncation detection uses `useEffect`, not `useLayoutEffect`. Nothing here needs to block
  paint — `useLayoutEffect` exists for cases where a visible flicker would otherwise occur (e.g.
  measuring for a tooltip position before the browser paints it in the wrong place). Here, the worst case
  of `useEffect`'s async timing is the "Read more" button popping in one frame after the card first
  renders, which is imperceptible and an acceptable tradeoff for not blocking paint on every card in the
  grid.
- **D-11**: `suggestedIds` is tracked as its own `Set`, independent of `selectedIds`, rather than trying
  to infer "was this a suggestion" from `selectedIds` alone. See Design 1's client bullets for the exact
  membership rule the label uses. Keeping these two Sets separate is what makes "user manually re-checks
  a previously-unchecked suggestion" well-defined rather than ambiguous — `selectedIds` alone can't
  distinguish "checked because suggested" from "checked because the user picked it," and the label
  doesn't need to make that distinction once `suggestedIds` exists as its own record.
- **D-12**: `rankSavedByPantry` and `suggestForChat` share one qualification helper
  (`qualifiesAsPantryMatch`) rather than `rankSavedByPantry` calling `suggestForChat` wholesale.
  `suggestForChat` is deeply entangled with concerns `rankSavedByPantry` has no use for — merging
  external API candidates, chat-history-based recency penalties, target-ingredient tiering, and
  strategy-based sorting (`expiring_first`/`dietary_safe`) — none of which apply to a plain "rank my saved
  recipes against pantry" button. Extracting just the scoring+qualification sub-step (the part that was
  actually duplicated in spirit — the `0.25`/`1` threshold) is the right-sized fix; pulling the whole
  function in would drag chat-specific behavior into a UI that has no chat context to give it.
- **D-13**: The three shopping modals (`BuildListModal`, `AddRecipesModal`, `AddToListModal`) share a
  result-view component (Design 5) but are **not** merged into one parameterized picker component. Their
  picker UIs genuinely differ in what's fixed vs. chosen: `BuildListModal` fixes nothing (name + optional
  multi-recipe-select), `AddRecipesModal` fixes the list and varies recipes (multi-select), `AddToListModal`
  fixes the recipe and varies the destination (single list, existing-or-new). A single component flexible
  enough to cover all three pickers would need enough conditional prop-driven branching to become harder
  to read than three small, single-purpose ones — the actual duplication was the result view (identical
  content, three copies), which Design 5 now removes, not the pickers themselves.
- **D-14**: `GET /suggested-for-shopping` stays under `/api/recipes` rather than moving to
  `/api/shopping` — see Design 1's route bullet. The operation is a recipe read (score saved recipes
  against pantry), and this codebase already has a direct precedent of shopping-domain UI reading
  directly from `/api/recipes` (`AddRecipesModal.jsx`'s existing `GET /api/recipes` call) — consumer
  domain and route ownership aren't the same axis in this codebase today, so this isn't a new pattern.

---

## Allowed Files

- `server/services/recipeSearchService.js` — add `rankSavedByPantry(householdId)` and
  `qualifiesAsPantryMatch(recipe, allItems)`; change `suggestForChat`'s `scoreCandidates` to call
  `qualifiesAsPantryMatch` instead of its current inlined `0.25`/`1` check (behavior-preserving — see
  Constraints).
- `server/routes/recipes.js` — add `GET /suggested-for-shopping`.
- `client/src/components/shopping/AddRecipesModal.jsx` — add "✨ Suggest recipes for me" button,
  `suggestedIds` state, pre-selection wiring; swap its result view for `ShoppingResultSummary`.
- `client/src/components/shopping/BuildListModal.jsx` — swap its result view for
  `ShoppingResultSummary` only (Design 5). No change to its picker view or submit logic.
- New: `client/src/components/shopping/ShoppingResultSummary.jsx`.
- New: `client/src/components/shopping/AddToListModal.jsx`.
- `client/src/components/recipes/RecipeCard.jsx` — 🛒 icon button (opens `AddToListModal`); read-more/
  read-less state, ref, and conditional button.
- `client/src/components/recipes/RecipeModal.jsx` — `🛒 Add to Shopping List` footer button (opens
  `AddToListModal`).
- `client/src/pages/RecipesPage.jsx` — wiring to open/close `AddToListModal` from either entry point
  (shared `addToListRecipe` piece of state, similar to the existing `openRecipe` pattern already in this
  file).
- `client/src/pages/ShoppingPage.jsx` — remove the empty-state's `New Shopping List` button only (Design
  4). No other change in this file.

## Forbidden Files

- `server/services/shoppingService.js`, `server/routes/shopping.js` — both existing endpoints
  (`build`, `add-recipes`) are reused unchanged. No new shopping route or service logic is needed for any
  part of this spec.
- `client/src/components/shopping/RecipeSelectList.jsx`,
  `client/src/components/shopping/ShoppingList.jsx` — TASK-049's blank-list-creation and checked-item
  behavior are already correct (see Current Behavior); untouched here. (`BuildListModal.jsx` moved to
  Allowed Files above — Design 5 touches its result view only, not this behavior.)
- `client/src/pages/ShoppingPage.jsx` — beyond the single deletion in Design 4/Allowed Files above, the
  rest of this file (header button, list panel, `AddRecipesModal`/`BuildListModal` wiring) is untouched.
- `server/services/recipeScorer.js`, `server/services/aiService.js`,
  `server/services/chat/handlers/suggestRecipes.js`, `server/services/chat/**` — the chat-tool suggestion
  path and the "Find Recipes Online" web-suggestion path are unrelated to this task and continue to work
  exactly as they do today. `rankSavedByPantry` calls `recipeScorer.score` but does not modify it.
- `server/db/schema.js` / any new migration — no schema change; every new capability is additive on top
  of columns that already exist (`recipes.id`/`.name`/`.tags`, `shoppingLists`, `shoppingListItems`).

## Constraints

- Zero new npm dependencies.
- `addRecipesToList` and `buildList`/`POST /api/shopping/build` must be called with the exact same
  request shapes TASK-049 already established (`{ recipeIds: [...] }`, `{ name, recipeIds }`) — this task
  adds new callers of those endpoints, not new endpoints or new accepted shapes.
- `rankSavedByPantry` must not be callable to leak another household's recipes or pantry data — same
  `householdId`-scoped queries every other service function in this codebase already uses
  (`recipeService.getAll(householdId)`, `pantryService.getAll(householdId)`), no new cross-household
  surface introduced.
- The read-more/read-less toggle must not interfere with the card's existing `onClick={() =>
  onOpen(recipe)}` — every new interactive element added to `RecipeCard.jsx` (🛒 icon, Read more/less
  button) must call `e.stopPropagation()`, matching the existing pattern already used by the favorite and
  block icons in this file.
- `suggestForChat`'s existing output must be byte-identical before and after `scoreCandidates`'s inlined
  saved-recipe check is replaced with a call to `qualifiesAsPantryMatch` — same discipline TASK-049 used
  for its own `buildFromRecipes` extraction. Verify explicitly (see Verification Steps), don't just assume
  the extraction is behavior-preserving.
- `BuildListModal.jsx` and `AddRecipesModal.jsx`'s result-view *content* (copy, warning rendering, Done
  button behavior) must be identical before and after swapping in `ShoppingResultSummary` — this is a
  pure extraction, not a copy change.

## Out of Scope (v1)

- **Folding external (Spoonacular/TheMealDB) results into the shopping-list suggest button** — see D-3.
  Would need a save-then-add two-step flow this request didn't ask for.
- **Read more/less on `WebSuggestionCard`** (Recipes page web-search results) — see D-7. Same pattern,
  different component, not requested.
- **Editing/removing a list from inside `AddToListModal`** — the modal only creates or adds to a list; if
  a household wants to rename/delete a list, that's the existing Shopping page UI, unchanged.
- **A visible "pantry match %" score anywhere in the UI** — `rankSavedByPantry` computes `overlapScore`
  server-side for ranking/qualification only; the client shows a plain "Suggested based on your pantry"
  label, not a numeric score. A visible score badge could be a future enhancement.

## Known Risks

- **Ambiguity resolved by building both entry points (D-2)** — if Connor actually only wanted one (e.g.
  just the card icon, not the modal footer button), the other is small enough to trivially remove after
  review; called out explicitly so it isn't mistaken for scope creep during review.
- **`ResizeObserver` + `scrollHeight` truncation detection runs per-card** — on a very large recipe grid
  (hundreds of cards) this is a per-card DOM read on mount and on every observed resize. Acceptable at
  this app's realistic household-recipe-collection scale (tens of recipes, not hundreds); flagged in case
  the Recipes page ever needs virtualization for unrelated reasons, at which point this would need
  revisiting alongside it.
- **`rankSavedByPantry`'s qualification bar (D-4/D-12) may return zero suggestions for a household with
  few saved recipes or a sparse pantry** — handled explicitly via the toast message in Design 1, not a
  silent empty state, but worth calling out so it isn't "fixed" later by loosening the threshold in
  `qualifiesAsPantryMatch` without realizing it would also change the chat suggestion tool's saved-recipe
  behavior (same shared helper, now literally shared code, not just a matching constant).
- **`scoreCandidates` inside `suggestForChat` now calls out to `qualifiesAsPantryMatch`** instead of
  inlining the check — a future change to one must consider the other's caller. This is the intended
  outcome of D-12 (one place to change), called out so it's understood as deliberate coupling, not
  accidental.

## Verification Steps

1. **Confirm already-correct behavior, don't regress it**: create a blank list (no recipes selected),
   confirm it lands immediately with no result screen; check an item off, confirm nothing outside the
   shopping list UI changes (no pantry quantity change) — this is the "visual aid only" behavior Connor
   asked for, already shipped, just verify it's still true after this task's changes.
2. **Suggest recipes for me — happy path**: seed a household with ≥1 saved recipe that shares ≥25% of its
   ingredients with the current pantry, open "+ Add Recipe" → click "Suggest recipes for me" → confirm
   that recipe is pre-checked and labeled, then "Add to List" behaves exactly as today's manual path
   (same items inserted, same warnings).
3. **Suggest recipes for me — no matches**: a household with recipes that share none of their
   ingredients with pantry → click suggest → confirm the toast message appears and no recipes are
   pre-checked (not a broken/empty picker).
4. **Suggest, then manually adjust**: click suggest, then uncheck one pre-selected recipe and check a
   different one manually before submitting — confirm the final selection (not the original suggestion)
   is what gets added.
5. **Recipe card → add to existing list**: from the Recipes page, click the 🛒 icon on a card with ≥1
   existing shopping list, select an existing list, submit — confirm the recipe's ingredients land on
   that list via the existing `addRecipesToList` behavior (pantry + existing-item coverage still applies,
   per TASK-049).
6. **Recipe card → start new list**: same entry point, choose "Start a new list," name it, submit —
   confirm a new list is created with that recipe's ingredients (existing `buildList` behavior).
7. **Recipe modal → same two paths**: repeat Steps 5 and 6 from the `🛒 Add to Shopping List` button in
   the recipe detail modal instead of the card icon — confirm identical behavior from both entry points.
8. **Zero existing lists**: on a household with no shopping lists at all, open `AddToListModal` from a
   recipe — confirm it skips straight to "Start a new list" with no broken/empty `<select>`.
9. **Read more / read less — truncated description**: a recipe with a long description that visibly wraps
   past 2 lines on its card — confirm "Read more" appears, expands the full text on click, and "Read
   less" re-collapses it.
10. **Read more / read less — short description**: a recipe whose description fits within 2 lines —
    confirm no "Read more" button renders at all.
11. **Read more / read less — viewport resize**: with a card whose description just barely fits at one
    breakpoint, resize the window across the `sm`/`lg` grid breakpoints — confirm the `ResizeObserver`
    fires and the button appears/disappears correctly as the card's width (and thus wrap point) changes.
12. **Click-through isolation**: clicking the 🛒 icon, and clicking "Read more"/"Read less," on a card
    must not also open the recipe detail modal (confirms `stopPropagation()` on both new interactive
    elements).
13. Mobile (375px) and desktop viewports: `AddToListModal`, the 🛒 icon row on `RecipeCard`, the new
    `RecipeModal` footer button, and the "Suggest recipes for me" button all remain usable.
14. **Duplicate button removed**: on a household with zero shopping lists, confirm the empty state no
    longer shows a "New Shopping List" button — only the header's `+ New List` button is present and
    still opens `BuildListModal` correctly.
15. **`suggestedIds` semantics (D-11)**: click "Suggest recipes for me" (recipes A, B, C suggested and
    pre-checked) → uncheck A → confirm the "Suggested based on your pantry" label still shows (B/C still
    checked and suggested) → uncheck B and C too → confirm the label disappears → manually re-check A →
    confirm the label reappears (A is still a member of `suggestedIds`, which was never mutated by the
    checkbox clicks).
16. **`suggestForChat` regression (D-12)**: exercise the existing AI chat "suggest a recipe" flow before
    and after the `qualifiesAsPantryMatch` extraction, with the same household/pantry/chat-history state
    — confirm identical suggestions, scores, and tiering as before the refactor. This is the
    extraction-regression risk called out in Constraints; verify it explicitly rather than assuming the
    extraction is behavior-preserving.
17. **Result-view extraction regression**: build a list from ≥1 recipe via `BuildListModal` and add
    recipe(s) to a list via `AddRecipesModal`, both with a unit-mismatch warning present — confirm the
    rendered result view (copy, warning box, Done button) is identical to its pre-extraction appearance.
