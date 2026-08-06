# TASK-056 — UI/UX Redesign: Reduce User Effort Across Core Flows

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (pending Connor's own final sign-off). No implementation code
has been written. Per explicit instruction, this spec stops at design + phased plan; implementation begins
only after approval.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 — revise before approval | Praised the "reduce effort not redesign" framing, scope discipline (no server/API/DB changes), the P0/P1/P2 prioritization (confirmed as essentially the same ranking the reviewer would independently produce), and the duplicated-recipe-card finding specifically ("the strongest architectural observation in the document"). Required changes, assessed individually: (1) **accepted, scoped down** — Design A (`RecipeSuggestionCard`) softened from a mandated single component into a UX requirement ("one consistent visual language") plus non-binding implementation guidance requiring a composition-vs-single-component investigation before committing, with an explicit prop-count smell test; the review's own suggested 3-component split is noted as one candidate outcome of that investigation, not prescribed. (2) **accepted in full** — Pantry mobile section (Design B) expanded into a concrete interaction spec covering long-name handling, frozen-state/split display, empty/loading states, keyboard behavior, sorting, and pagination — resolving each by either specifying new behavior or explicitly stating "preserves today's status quo" rather than leaving it open. (3) **accepted in full** — search behavior (matching rules, scope, debounce, persistence) made explicit for both Pantry and Recipes search. (4) **accepted, with pushback on one alternative** — Quick Add: kept the category select (rejected the review's "AI classify" suggestion outright, since it would add a server round-trip/cost to the fast-add path and directly contradicts this spec's own no-server-changes constraint) but added "default to last-used category" via `localStorage`, which better answers the review's actual friction concern than any of its three suggested alternatives. (5) **accepted, scoped down** — "mixing UX and implementation" flagged as the review's most debatable point: this repo's own prior approved specs (TASK-055 et al.) blend design intent with file/function-level guidance as a matter of established convention, so a full requirements/implementation split was not applied document-wide; instead, UX-requirement vs. implementation-guidance framing was added specifically to Designs A and B, the two places the review's concern was concretely correct. (6) **accepted** — concrete interaction model specified for the "Add Recipe" menu (popover/disclosure pattern, same on desktop and mobile, standard keyboard behavior) rather than left as an unspecified "menu." (7) **accepted** — Dashboard↔Chat cross-link upgraded from a copy-only note to a small CTA link, without adopting the review's larger "deep links / quick actions" suggestion, which isn't justified for what the spec itself already identified as its softest, lowest-priority finding. (8) **accepted** — UXPin/AppyPie citations removed from the "mobile touch ergonomics" reasoning in Section 3, where they were being used to support a claim (action-ordering within a menu) those sources never actually tested; the underlying point now rests on the already-cited WCAG target-size guidance instead. (9) **accepted** — added Performance/Scalability and Component Ownership sections; added a "deferred, not acted on" note about a broader shared-UI-primitives layer (`FilterBar`/`ActionMenu`/`SearchInput`/etc.), explicitly not pursued now per the same "don't introduce abstractions for hypothetical reuse" principle TASK-055 established (its own D-2). |
| DRAFT-2 | 9.6/10 — APPROVE after one small revision | Confirmed DRAFT-1's revisions landed correctly, specifically praising the UX-requirement/implementation-guidance split on Design A, the ~4-5-prop smell test as a concrete stopping rule, the fully-specified Pantry interaction spec, the explicit search-matching rules, and the last-used-category Quick Add fix. One required change, accepted without pushback: Design C's "anchored popover — not modal, not bottom sheet" language was itself over-specifying a widget choice rather than stating the required behavior; reworded to a behavioral requirement (one disclosure trigger exposing three options, standard keyboard model) that explicitly defers to any existing menu primitive in the codebase rather than mandating "popover" specifically. One non-blocking suggestion, accepted: added an acceptance criterion protecting save/block interaction parity across all three recipe-suggestion contexts through the Design A consolidation, guarding against exactly the regression risk Design A itself flags. No remaining architectural concerns — approved for implementation. |

---

## Framing

This is not a visual refresh. The goal is to reduce the number of decisions, taps, and page-visits a user
needs to complete the app's core jobs: *check what's expiring*, *decide what to cook*, *manage the pantry*,
*manage recipes*, *build a shopping list*. Every change below is justified by a specific usability problem
found in the current code, not by aesthetic preference. All existing functionality is preserved; nothing is
deleted. Findings are backed by outside UX research where the underlying principle isn't obvious from the
code alone (cited inline, sources listed at the end).

---

## 1. Current Interface — What Exists Today

Read directly from the code, not from memory of prior sessions:

- **Nav (**[Sidebar.jsx](../../client/src/components/layout/Sidebar.jsx)**):** 6 top-level items — Chat,
  Dashboard, Pantry (with an expiring-count badge), Recipes, Shopping, and a visually-demoted Household.
  Fixed left sidebar on desktop (`md:` breakpoint), full-screen slide-in overlay on mobile behind a
  hamburger button.
- **Routing (**[App.jsx](../../client/src/App.jsx)**):** the index route `/` renders `ChatPage`, not
  `DashboardPage` — chat is the de facto home screen. `/dashboard` is a separate, one-click-away page.
- **Chat** ([ChatPage.jsx](../../client/src/pages/ChatPage.jsx)): free-text assistant. Empty state offers 3
  suggested prompts (one of which is "What can I make with what I have?"). Assistant replies can include
  inline recipe-suggestion cards with their own save/block buttons and ingredient have/missing breakdown.
- **Dashboard** ([DashboardPage.jsx](../../client/src/pages/DashboardPage.jsx)): 4 stacked zones —
  horizontally-scrolling "Expiring Soon" strip, an AI "Eat This Now" panel (button-triggered, pantry-only
  suggestions with their own card component), a "Quick Add" mini-form, and an owner-only feedback box.
- **Pantry** ([PantryPage.jsx](../../client/src/pages/PantryPage.jsx) /
  [PantryTable.jsx](../../client/src/components/pantry/PantryTable.jsx)): a single dense 8-column HTML
  table (Name, Category, Qty, Unit, Storage, Expires, Status, Actions) wrapped in `overflow-x-auto`, no
  breakpoint-specific layout. Each row has 5 text-link actions (Edit, ✓ Used, Freeze/Thaw, Split, Delete).
  No search or sort control of any kind.
- **Recipes** ([RecipesPage.jsx](../../client/src/pages/RecipesPage.jsx)): a header row with 4 co-equal
  buttons (🚫 Blocked Recipes, 📸 Upload Recipe Image, 🔗 Import from URL, 🔍 Find Recipes Online), a
  separate filter bar below it (source dropdown, favorites checkbox, tag text filter — no name search),
  then a responsive card grid. "Find Recipes Online" triggers its own web-search suggestion panel with a
  *third* distinct card component (`WebSuggestionCard`).
- **Shopping** ([ShoppingPage.jsx](../../client/src/pages/ShoppingPage.jsx)): two-panel master/detail
  (list-of-lists on the left, selected list's items on the right). This is the app's most mature IA pattern
  today — referenced below as a reuse target, not a problem.

---

## 2. Usability Problems, Prioritized by Impact × Frequency

### P0 — highest leverage (touch daily-use flows, backed by concrete evidence in the code)

**P0-1. Pantry — the single most-referenced screen in a grocery-tracking app has no mobile layout, no
search, and sub-target touch actions.**
`overflow-x-auto` on an 8-column table means small-screen users horizontally scroll to see Status/Actions.
[NN/g's mobile-tables research](https://www.nngroup.com/articles/mobile-tables/) treats this pattern as a
known failure mode for exactly this reason — dense tables don't survive the transition to small screens
without a layout change, not just a scroll container. Each row's 5 actions
(`text-xs px-2 py-1` in [PantryTable.jsx:211-219](../../client/src/components/pantry/PantryTable.jsx)) are
comfortably under both the WCAG 2.5.8 (AA) 24×24px floor and the 44×44px target [WCAG 2.5.5 / Apple HIG /
Material Design](https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size) recommend for comfortable
tap targets — on a phone, mis-taps on Delete next to Edit are a real risk. Separately, there is no way to
type a name and jump to an item — [NN/g's "Data Tables: Four Major User Tasks"](https://www.nngroup.com/articles/data-tables/)
lists *search* as one of four canonical table tasks; this table supports none of the four (no search, no
sort, no filter, no read-optimized layout on mobile).

**P0-2. Three different visual/interaction patterns for the same job: "here's a recipe, do you want to save
it."**
`EatThisNow.jsx`'s `SuggestionCard`, `RecipesPage.jsx`'s `WebSuggestionCard`, and `ChatPage.jsx`'s inline
recipe-card JSX are three separately-implemented components with different layouts, different metadata
placement, and different save-button styling, for what is functionally the same action in the same app.
This violates the *consistency and standards* heuristic directly — a user who learns the save/block pattern
in one place has to re-learn its shape in the other two, and every future change to "how a recipe
suggestion looks" has to be made three times, which is exactly the kind of duplicated design decision
[NN/g's "Reduce Redundancy" article](https://www.nngroup.com/articles/reduce-redundancydecrease-duplicated-design-decisions/)
warns compounds over time.

**P0-3. Recipes page front-loads 4 co-equal actions plus a 3-control filter bar before any content.**
[NN/g's F-pattern eye-tracking research](https://www.nngroup.com/articles/data-tables/) (and the general
finding that cluttered interfaces measurably slow task completion) motivates keeping the top of a
content-heavy page lean. Today, "Blocked Recipes" (a rarely-used moderation/settings action) sits at equal
visual weight next to the three actual *add-a-recipe* affordances (Upload/Import/Find), and there is no
single obvious "add a recipe" entry point — a new user has to read and choose between three buttons before
they can add anything.

### P1 — real but lower-frequency or lower-severity

**P1-1. Silent miscategorization in Quick Add.**
[QuickAdd.jsx:28](../../client/src/components/dashboard/QuickAdd.jsx) always POSTs `category: 'Other'`
regardless of what the item actually is, while the full [AddItemModal](../../client/src/components/pantry/AddItemModal.jsx)
lets the user pick a real category. A user who quick-adds "Spinach" from the Dashboard gets a silently
wrong category with no indication anything was defaulted — they only discover it later while scanning the
Pantry table by category. This is a *visibility of system status* violation: the system made a decision on
the user's behalf without saying so.

**P1-2. No name search on the Recipes grid either.**
The existing filter bar has source/favorites/tag filters but nothing that matches on recipe *name* — the
one field most users will actually try to type first.

**P1-3. Chat and Dashboard have overlapping "what's the state of my kitchen" purposes with no cross-link
between them.**
This is a softer finding than P0-1..3 — the two pages are not literally duplicating UI (Chat is
conversation-only; it does not render pantry data directly), and having a conversational primary surface
plus a structured secondary status page is a defensible pattern, not an obvious mistake. Flagged as P1
specifically because there's currently zero signposting between them (a user on the Dashboard has no hint
that asking the same question in Chat is also an option, and vice versa) — worth a light-touch fix, not a
merge.

### P2 — hygiene / explicitly out of scope for this spec's implementation phases

**P2-1. Emoji-as-icon system.** Used throughout (💬🏠🥦📖🛒📷🚫📸🔗🔍✨❄️). Renders inconsistently across
OS/browser font stacks and doesn't share a consistent visual weight. `aria-hidden` is already applied
correctly everywhere it appears, so this is a consistency/polish issue, not an accessibility blocker.
Touching every page's icon usage is a large, low-risk-but-high-diff change that doesn't belong bundled with
effort-reduction work — recommend a separate follow-up task if/when Connor wants it.

**P2-2. Hard-coded coordination between the mobile hamburger button and `PageHeader`'s `pl-12`.**
[Sidebar.jsx:128-130](../../client/src/components/layout/Sidebar.jsx) and
[PageHeader.jsx:1-2](../../client/src/components/layout/PageHeader.jsx) both carry comments warning the
other to stay in sync if either one's size/position changes. This is a maintenance-risk code smell, not a
present user-facing bug (it works correctly today) — noted as a risk, not addressed by this spec.

---

## 3. Proposed Information Architecture

**Guiding principles, cited:**
- Keep top-level nav choices few and *distinct* — NN/g's IA guidance targets roughly 7 choices per level;
  [NN/g's reduce-redundancy article](https://www.nngroup.com/articles/reduce-redundancydecrease-duplicated-design-decisions/)
  specifically calls out that redundant *destinations* (two places that do the same job) are worse than
  redundant *paths* (cross-links to the same destination, which it treats as a legitimate and even helpful
  pattern). This spec applies that distinction: it does **not** propose merging Chat and Dashboard (they
  aren't actually redundant destinations once you look past the surface), but it does propose collapsing
  the *three separately-built* recipe-suggestion UI patterns into one shared component (which *is* redundant
  by that definition).
- Consistency over novelty — reuse the visual/interaction patterns this codebase has already validated
  (the Recipes grid's responsive card breakpoints, the Shopping page's master-detail split, the existing
  filter-bar pattern) rather than inventing new ones.
- Mobile touch ergonomics — the same [WCAG 2.5.5/2.5.8 target-size guidance](https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size)
  cited in P0-1 is the basis for keeping the *most-used* pantry-row actions visibly sized and reachable, and
  demoting only the *least-used* ones behind a secondary control. (An earlier draft of this section also
  cited general mobile-nav-pattern blog research here; removed — those sources measured top-level
  tab-bar-vs-hamburger navigation, not action-ordering within an in-page control, so they weren't actually
  evidence for this specific claim. WCAG's own reasoning is sufficient on its own.)

**A. Recipe suggestions — one consistent visual language** (addresses P0-2)

*UX requirement:* recipe-suggestion presentation (name, description/metadata, save/block actions) should
look and behave the same wherever it appears — Dashboard's pantry-based suggestions, Recipes' web
suggestions, and Chat's inline suggestions currently don't, and a user who learns the pattern in one place
shouldn't have to re-learn it in the other two.

*Implementation guidance (non-binding — requires investigation before implementation):* the three source
data shapes differ meaningfully (pantry have/missing ingredient breakdown vs. web-suggestion tags/source
link vs. dashboard's simpler name/description/difficulty), so a single mandated component is not decided
here. Before implementation, evaluate composition options against all 3 real data shapes — e.g. a shared
layout/actions shell with per-caller content, vs. smaller composable pieces (metadata block, actions block)
each caller assembles independently, vs. one component after all if the shapes turn out to unify cleanly.
Treat needing more than ~4-5 boolean `show*`-style visibility props as a signal the chosen approach is
wrong and a different composition should be tried — that smell is the concrete stop condition, not a
vague "keep it simple." Whatever shape wins, no new endpoints and no behavior change — this is
presentational consolidation only.

**B. Pantry — responsive layout + search + touch-target fix** (addresses P0-1)

*UX requirement:* Pantry should be fully usable on a phone without horizontal scrolling, with all 5
per-item actions reachable at a real touch-target size, and with a way to jump to a specific item by name.

*Interaction spec (below the existing `md` breakpoint — the same one the Sidebar already treats as the
mobile cutoff):*
- **Layout:** stacked cards replace the table, reusing the card-grid visual language already established
  on the Recipes page rather than inventing a new one. Card content order: Name + Expiry badge + Status
  label first (the fields users scan for first, matching what's visually leftmost/most-emphasized in the
  table today); Category / Qty / Unit / Storage as smaller secondary text within the same card, in that
  order.
- **Long names:** truncate with CSS ellipsis and a `title` attribute holding the full name, exactly the
  pattern `ExpiryStrip.jsx` already uses for its own item-name truncation (`title={item.name}`) — reused,
  not invented.
- **Frozen state / split items:** carry the table's existing inline "❄ Frozen" badge next to the name into
  the card header unchanged; split items already appear as separate rows/cards per storage location in the
  underlying data today (no new display logic needed — a "split" item is just two ordinary items with
  different `storageLocation` values, same as it is in the table).
- **Actions:** Edit, ✓ Used, and Freeze/Thaw stay directly visible and tappable at a real touch-target size;
  Split and Delete (least-frequent, and Delete the most consequential/destructive) move behind a small "⋯"
  overflow control — accessibility behavior specified in Section 5.
- **Multiple/simultaneous actions, batch selection:** out of scope. No multi-select or batch action exists
  in today's table either; the card view preserves that status quo rather than introducing new capability.
- **Sorting:** out of scope. Today's table has no sort control (implicit array order only); the card view
  preserves that same implicit order. Not a gap this spec introduces.
- **Pagination:** none today (the full item list renders at once), none added. Real current pantry size is
  small (~30 items per the most recent session's live data) — see Section 9 for the scalability note.
- **Empty / loading states:** reuse `PantryPage.jsx`'s existing skeleton-table and empty-state markup,
  adapted to render as skeleton cards / an empty-state card below `md` instead of skeleton table rows — not
  a new state model, same loading/empty logic the page already has.
- **Filtering:** a single client-side name-filter input above the list/table, mirroring the existing
  filter-input pattern already used on the Recipes page (`filterTag`) — see Section 8 below for exact
  matching behavior. Same component style, no new endpoint.
- **Keyboard navigation:** cards are plain document-flow elements with buttons inside, so default tab order
  (top-to-bottom through each card's visible actions, then into the overflow menu trigger) requires no new
  keyboard-handling code beyond the overflow menu's own disclosure behavior (Section 5). No custom
  roving-tabindex or grid-navigation pattern is being introduced.
- The desktop table itself is structurally unchanged — this is an additive `md`-and-below render path using
  the same data and the same `onEdit`/`onMarkUsed`/`onToggleFreeze`/`onSplit`/`onDelete` callbacks, not a
  replacement.

**C. Recipes — header hierarchy fix** (addresses P0-3, P1-2)

*UX requirement:* there should be one obvious way to start adding a recipe, and "Blocked Recipes" (a
moderation/settings action used far less often than any add action) shouldn't compete visually with it.

*Interaction spec (behavioral requirement, not a widget mandate):*
- Consolidate Upload Image / Import URL / Find Online under a single "Add Recipe" trigger that, on
  activation, discloses exactly those 3 options as a lightweight anchored menu — proportionate to a 3-item
  choice, and the same pattern on desktop and mobile rather than branching into two separate
  implementations. If this codebase already has a reusable menu/dropdown/popover primitive, use it — the
  requirement is the disclosure behavior below, not a specific widget class. Only build a new primitive if
  none already exists.
- Behavior: opens on click/tap of the trigger; closes on selecting an option, on `Escape`, or on
  click-outside. Keyboard: trigger is a normal focusable button (`Enter`/`Space` opens it); `ArrowDown` on
  open moves focus into the first menu item; `Escape` closes and returns focus to the trigger — the
  standard disclosure-menu pattern already referenced in Section 5, made concrete here instead of left
  implicit. This behavior applies regardless of which underlying widget implements it.
- Demote "Blocked Recipes" out of the primary action row to a lower-emphasis text link near the filter bar.
- Add a name-search input to the existing filter bar (matching behavior specified in Section 8) — one more
  control alongside source/favorites/tag, same bar, same styling, not a new UI surface.

**D. Quick Add — close the silent-default gap, without adding pure friction** (addresses P1-1)

Add a lightweight category select to `QuickAdd.jsx`, sourced from the same category list `AddItemModal.jsx`
already uses (the `shared/pantryCategories.js` module introduced in TASK-055 — confirm the exact import
during implementation). To keep this from just trading one kind of friction for another, the select
**defaults to the user's last-used category** (persisted client-side, e.g. `localStorage`) rather than
always defaulting to "Other" — a user repeatedly quick-adding produce items sees "Produce" pre-selected
after the first time, and can still override it in one tap when adding something different. This was
weighed against two alternatives and rejected them: inferring category purely from the item-name string is
unreliably guessable without also calling an AI classifier, and an AI-classify round-trip would add a
server dependency and latency to what's supposed to be the *fast* add path — directly against this spec's
own no-server-changes constraint. The explicit-select-with-smart-default keeps the fix entirely client-side
while cutting the common case down to zero extra taps.

**E. Chat ⇄ Dashboard cross-link** (addresses P1-3)

A small CTA, not a UI overhaul: Dashboard's "Eat This Now" idle/empty state gets a short note plus a text
link that opens Chat (e.g. "Prefer to just ask? → Chat"); no change to Chat's existing empty-state prompts
(they already nudge in the other direction). This is deliberately proportionate to what this spec itself
already identified as its softest, lowest-confidence finding (P1-3) — a larger discoverability mechanism
(deep-linking, a quick-actions system) isn't justified without evidence this specific gap is actually
costing users anything; a link is cheap, reversible, and easy to remove if it turns out not to matter.

**Explicitly not proposed:** merging Chat and Dashboard into one page, replacing the sidebar with a bottom
tab bar on desktop, removing any of Upload Image / Import URL / Find Online / Blocked Recipes as
capabilities (all three add-paths and the blocklist remain fully available, just re-organized), or an icon
system rewrite (P2-1, deferred).

---

## 4. Phased Implementation Plan

Phases are ordered by impact-to-churn ratio — highest-leverage, lowest-risk items first. Each phase is
independently shippable; none depends on a later phase.

### Phase 1 — P0 items (highest leverage)
1. Investigate and land a consistent recipe-suggestion presentation per Design A (Section 3) — composition
   vs. single component decided against the ~4-5-prop smell test, then wired into `EatThisNow.jsx`,
   `RecipesPage.jsx`, and `ChatPage.jsx`. No endpoint changes. Exact file count depends on which composition
   the investigation lands on (see Allowed Files).
2. Recipes header restructure: single "Add Recipe" menu, demoted "Blocked Recipes" link. Presentational +
   interaction only — reuses existing `showUpload`/`showUrlImport`/`handleFindOnline`/`handleOpenBlocklist`
   handlers unchanged, just re-arranges what triggers them.
3. Pantry responsive card view + overflow menu for Split/Delete below `md`. Reuses existing
   `onEdit`/`onMarkUsed`/`onToggleFreeze`/`onSplit`/`onDelete` handlers unchanged — purely a new render path
   for the same data and the same callbacks.

### Phase 2 — P1 items
4. Pantry name-search input (client-side filter, no API change).
5. Recipes name-search input (extends the existing `filtered` `useMemo`, no API change).
6. Quick Add category select (adds one field to an existing POST body the server already accepts).
7. Dashboard/Chat cross-link copy.

### Phase 3 — explicitly deferred, not part of this spec's implementation
8. Icon system audit (P2-1) — separate future task, out of scope here.
9. Sidebar/PageHeader hard-coded coupling (P2-2) — tech-debt note, not a redesign item; flag for a future
   mechanical-cleanup task in the style of TASK-055 rather than bundling into a UX spec.

---

## 5. Accessibility Considerations

- Touch targets: Phase 1's Pantry action buttons should meet the 44×44px AAA/HIG/Material recommendation
  where feasible, and must clear the WCAG 2.5.8 (AA) 24×24px floor at minimum — current `px-2 py-1 text-xs`
  buttons do not.
- The new Pantry overflow ("⋯") control needs `aria-haspopup`, `aria-expanded`, and a labelled menu — follow
  the same `aria-label`/`title` pairing pattern already used on `PantryTable.jsx`'s existing `ActionButton`.
- Preserve the existing color-plus-text status pattern (`StatusLabel` already pairs color with a text label,
  e.g. "Expiring soon" not just an amber dot) — do not introduce a color-only status indicator anywhere new.
- Recipes' new "Add Recipe" menu needs standard disclosure-menu keyboard behavior (Enter/Space to open,
  Escape to close, arrow-key item navigation) — check whatever menu primitive/pattern gets used against
  these before implementation, not after.

## 6. Responsive Behavior

- Reuse the codebase's existing breakpoint vocabulary: `md` is already the sidebar's mobile/desktop cutoff;
  `sm`/`lg` are already used for the Recipes grid's column counts. New Pantry card-vs-table logic should key
  off `md` for consistency, not introduce a new breakpoint.
- Verify Phase 1 across three widths at minimum (mobile ~375px, tablet ~768px, desktop ~1280px) per this
  repo's Local Smoke Testing Protocol — tablet width is the one most likely to fall awkwardly between the
  new Pantry card view and the existing table, so it needs explicit manual QA, not just assumed inheritance
  from mobile behavior.

## 7. Risks / Open Questions

- **Recipe-suggestion component design risk:** Design A no longer mandates one component precisely because
  of this risk (see Section 3) — the residual risk is process, not outcome: the required
  composition-vs-single-component investigation takes real implementation time before Phase 1's first
  visible progress, and could still land on a shape that isn't obviously right on the first attempt. Budget
  for that investigation explicitly rather than treating Phase 1 item 1 as a known-quantity extraction.
- **Pantry overflow menu hides Split/Delete one tap deeper.** For a single-household app (not large-N
  usage), Connor may prefer all 5 actions to stay visible even on mobile at the cost of density — this is a
  judgment call flagged for architect/Connor review, not decided unilaterally here.
- **Category source for Quick Add (Design D):** TASK-055 introduced `shared/pantryCategories.js` for
  exactly this kind of shared-constant reuse — confirm `AddItemModal.jsx` already sources from it before
  implementation; if it doesn't yet, that's a one-line import fix bundled into Design D rather than a
  reason to duplicate the category list again.
- Nothing in this spec touches the server, the database, or any API contract — every phase is a client-only
  change. No migration, no schema, no new endpoint.

## 8. Search Behavior (Pantry name-filter, Recipes name-filter)

Both new search inputs (Design B for Pantry, Design C for Recipes) share the same, deliberately simple,
matching rules — decided now rather than left for an implementer to guess:

- **Matching:** case-insensitive substring match — `item.name.toLowerCase().includes(query.toLowerCase())`,
  the exact pattern `RecipesPage.jsx`'s existing `filterTag` logic already uses today. No fuzzy matching, no
  accent-folding — not justified by the actual gap identified (P0-1/P1-2 are about *no search existing at
  all*, not about the precision of an existing one).
- **Scope:** name field only. Category/storage/tag/source already have their own discrete filter controls
  (existing on Recipes, added for Pantry only if a future task identifies the need) — a combined
  fuzzy-everything search isn't what either P0-1 or P1-2 asked for.
- **Debounce:** none. Both filters run client-side over an already-loaded, already-small array
  (`.filter()` on each keystroke) — the existing `filterTag` input has no debounce today and shows no
  perceptible lag at realistic list sizes; adding one would be solving a performance problem that doesn't
  exist yet (see Section 9).
- **Persistence:** not persisted to the URL and not preserved across navigation — matching the existing
  Recipes filter bar's own behavior (its filters already reset on remount), for consistency rather than by
  omission.

## 9. Performance & Scalability

Card layouts render more DOM per item than table rows (each card repeats structural markup a `<tr>`
doesn't need). This is a real cost, not zero — but at today's actual data size (a single household's
pantry, ~30 items in the most recent live session) it's not a problem worth designing around yet. No
virtualization (`react-window` or similar) is proposed in this spec. Flagged here as a forward-looking note
only: if item counts grow materially (multi-household aggregation, a bulk-import feature, etc. — none of
which are currently planned), revisit with real numbers at that time rather than pre-optimizing now.

## 10. Component Ownership

`RecipeSuggestionCard` (or whatever composition Design A's investigation lands on) lives under
`client/src/components/recipes/` — the Recipe domain is its natural owner, since a recipe suggestion is
fundamentally a recipe-shaped object; Dashboard and Chat are *consumers* importing from there, not
co-owners. This follows the same direction-of-dependency principle TASK-055 already established for
`shared/pantryCategories.js` (chat handlers depend on the domain module, not the other way around) — applied
here to a UI component instead of a constants module. This codebase has no `components/shared/` directory
today, and this spec doesn't propose creating one for a single component; that's only worth revisiting if a
second, genuinely cross-domain shared *component* need shows up later.

## 11. Deferred Design-System Considerations (Not Acted On)

Worth naming, not worth pursuing in this spec: several of the patterns touched here (a filter/search input,
an overflow action menu, a status badge, a disclosure menu) already recur 2-3 times across this codebase
even before this spec's changes, and will recur more after. Formalizing them into named shared primitives
(`FilterBar`, `ActionMenu`, `SearchInput`, `StatusBadge`) could be higher-leverage than any single component
in this spec. Not pursued here, for the same reason TASK-055 declined to export a standalone
`isExpiringWithin` helper with no second caller yet (its own D-2, "don't introduce abstractions for
hypothetical reuse") — this spec's changes give each of those patterns at most 2 concrete instances, not
enough to confidently generalize from. Revisit if a third real instance of any one of them appears.

---

## Sources Cited

- [NN/G — Mobile Tables: Comparisons and Other Data Tables](https://www.nngroup.com/articles/mobile-tables/)
- [NN/G — Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/)
- [NN/G — Reduce Redundancy: Decrease Duplicated Design Decisions](https://www.nngroup.com/articles/reduce-redundancydecrease-duplicated-design-decisions/)
- [Deque University — WCAG 2.1 2.5.5 Target Size (AAA)](https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size)

(An earlier draft also cited two general mobile-navigation blog posts (UXPin, AppyPie) to support an
action-ordering claim in Section 3. Removed on review — those sources measured top-level tab-bar-vs-hamburger
navigation, not action-ordering within an in-page control, so they weren't actually evidence for that claim.
NN/g and WCAG are sufficient support for every claim actually made in this revision.)

---

## Allowed Files (anticipated — for Phase 1, pending approval)

- `client/src/components/recipes/RecipeSuggestionCard.jsx` and/or sub-pieces (new — exact filename(s)
  depend on Design A's composition investigation; all live under `components/recipes/` per Section 10)
- `client/src/components/dashboard/EatThisNow.jsx`
- `client/src/components/recipes/RecipeCard.jsx` (only if a shared sub-piece is reused here too — TBD at
  implementation time)
- `client/src/pages/RecipesPage.jsx`
- `client/src/pages/ChatPage.jsx`
- `client/src/pages/PantryPage.jsx`
- `client/src/components/pantry/PantryTable.jsx`
- `client/src/components/dashboard/QuickAdd.jsx` (Phase 2)

## Forbidden Files

- Anything under `server/` — this spec is client-only.
- `shared/*` — read-only reuse (e.g. `shared/pantryCategories.js` if it applies to Design D), no new shared
  modules anticipated.
- Database/migration files — none of this spec's scope touches persisted data shape.

## Constraints

- No new npm dependencies unless a specific need is identified and called out during architect review (none
  anticipated — this is Tailwind + existing React patterns throughout).
- No behavior/endpoint changes — every phase preserves existing API calls and handler logic; only rendering
  and interaction structure change.
- No functionality removed — Upload Image, Import URL, Find Online, Blocked Recipes, Split, and Delete all
  remain fully available.

## Acceptance Criteria (draft — to firm up post-review)

- All 6 existing pages render with no visual regression at desktop width.
- Pantry is fully usable (all 5 actions reachable, all data visible) at ~375px width without horizontal
  scrolling.
- Recipes page's primary "Add Recipe" entry point is reachable within 1 click/tap; all 3 underlying add
  flows (Upload/Import/Find) remain reachable and functionally unchanged.
- The consolidated recipe-suggestion presentation (Design A) renders correctly from all 3 call sites with
  their real data shapes (pantry suggestion, web suggestion, chat recipe) and stays under the ~4-5-prop
  smell-test threshold — verified via the Local Smoke Testing Protocol, not just visual inspection.
- Existing save/block interactions remain functionally identical across all three recipe-suggestion
  contexts (Dashboard, Recipes, Chat) after Design A's consolidation — same underlying calls
  (`addRecipe`/`handleSaveWebSuggestion`/`handleSaveRecipe`-equivalent, `addBlock`), same toast/success
  feedback, same disabled/saving states, just a shared presentation layer around them.
- `npm run lint` and `npm test` (root) remain clean.

## Verification Steps

- Manual smoke test at 375px / 768px / 1280px widths per the repo's Local Smoke Testing Protocol.
- Confirm no server/API request shapes changed (`read_network_requests` during smoke testing should show
  identical endpoints/payloads to pre-change behavior).
- Confirm zero regressions in existing test suite.
