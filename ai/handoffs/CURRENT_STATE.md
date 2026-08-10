# Task

TASK-057 implementation: full visual design-system migration ("Modern Farmhouse") — Phases 1-3 of the
approved spec (`ai/tasks/TASK-057-spec.md`) shipped in one session, plus a Connor-authorized deviation
resolving judgment call #2 (below). Phase 4 (optional app-wide icon system, Section 6) not started — it was
always scoped as separable.

# Current Status

All of Phase 1 (token/component foundation), Phase 2 (Sidebar, Dashboard, Pantry, Chat), and Phase 3
(Recipes, Shopping, Household, Landing) are implemented, build-clean, lint-clean, and test-clean (98/98
passing, zero regressions). Contrast-gated per the spec's hard Phase 1 requirement — verified against live
computed CSS in the running app, not just hand math (see Verification Results). After the initial push,
Connor explicitly authorized migrating `DietaryProfileForm.jsx` (judgment call #2) to resolve the Section
4G / Forbidden Files contradiction in favor of the scaffold — done and pushed as a follow-up commit.

# Files Modified

- `client/src/index.css` — primitive token `:root` block + governance comment; `@import` moved to first line
- `client/tailwind.config.js` — semantic color extension (`primary`, `surface`, `status-*`, `accent-*`, etc.)
- `client/src/styles/components.css` — **new file**: `.btn-*`, `.card*`, `.input`, `.badge-*`,
  `.badge-source-*`, `.nav-link*`, `.chat-bubble-*`
- `client/src/utils/expiry.js` — `getExpiryBadgeClass`/`getExpiryRowClass` return semantic class names
- `client/src/components/layout/Sidebar.jsx`, `PageHeader.jsx`
- `client/src/pages/DashboardPage.jsx`, `client/src/components/dashboard/{ExpiryStrip,EatThisNow,QuickAdd}.jsx`
- `client/src/components/recipes/RecipeSuggestionCard.jsx` (shared card, migrated during Phase 2 since
  Dashboard consumes it)
- `client/src/pages/PantryPage.jsx`, `client/src/components/pantry/PantryTable.jsx`
- `client/src/pages/ChatPage.jsx`
- `client/src/components/recipes/{RecipeCard,AddRecipeMenu,RecipeModal,RecipeReviewModal}.jsx`,
  `client/src/pages/RecipesPage.jsx`
- `client/src/pages/ShoppingPage.jsx`, `client/src/components/shopping/ShoppingList.jsx`
- `client/src/pages/HouseholdPage.jsx`
- `client/src/pages/LandingPage.jsx`
- `ai/handoffs/CONVENTIONS.md` — added the semantic-token-over-raw-hue convention note (spec Section 2.2
  required this)

# Judgment Calls Made Beyond the Spec's Literal Text (flag for Connor's review)

1. **RESOLVED, and the inclusion decision itself confirmed correct by direct scaffold evidence.**
   `PantryPage.jsx` and `RecipesPage.jsx` were migrated even though neither is named in the spec's Allowed
   Files list (only `PantryTable/PantryCard` and `RecipeCard`/etc. are listed) — an inference, not an explicit
   instruction, unlike judgment call #2's actual contradiction. Checking `03-pantry-mobile.png` directly
   confirmed the inference: it depicts "Scan Receipt" and "+ Add Item" (both `PantryPage.jsx`, not
   `PantryTable.jsx`) as solid dark-green pills alongside the already-migrated card/badge/action-button
   treatment. One real deviation this check caught: `PantryPage.jsx`'s "Scan receipt" button had been styled
   `.btn-secondary` (outlined) — my own unverified choice to visually de-rank it below "+ Add item" — but the
   scaffold shows both buttons identically solid-filled, no outline/filled distinction at all. Fixed to
   `.btn-primary` (reused the existing class, no new CSS), live-verified both now render identically
   (`rgb(37,72,50)` bg, white text, full pill). Both are the page shells hosting the exact components the
   spec does name (Add Item/Add Recipe buttons, search/filter bars, loading skeletons) — leaving them
   raw-orange would have produced an immediately visible clash on the very screens Phase 2/3 claims to
   complete. Treated as the same class of gap DRAFT-4's review caught for CRUD modals, but judged in the
   opposite direction (include, not exclude) since these two files are structural
   page containers for in-scope components, not standalone CRUD forms. No longer needs Connor's review — this
   was a
   judgment call, not an explicit spec instruction.
2. **RESOLVED, by explicit Connor authorization (not a unilateral call).** Section 4G's Household chip
   instructions (`.chip-allergy`, `.badge-tag` for dietary/health chips) target markup that only exists
   inside `DietaryProfileForm.jsx` — confirmed live in the running app — which is also named in the spec's
   own excluded-CRUD-modal list (Forbidden Files). Root cause, confirmed by viewing
   `ai/design/2026-08-gemini-redesign/scaffolds/10b-household-mobile-fixed.png` directly: it's one flattened
   mockup image of the whole Household screen with no awareness of this codebase's component boundaries —
   Section 4G was written from that image without cross-checking that the chip markup lives in a file
   Forbidden Files excludes for an unrelated reason (the CRUD-modal sweep boundary). Connor reviewed this
   explanation and explicitly said to migrate the file to match the scaffold, overriding Forbidden Files for
   this one file. Done: `TagInput`'s chips now use `chipCls = isWarning ? 'chip-allergy' : 'badge-tag'`; the
   tag-input wrapper, remove-tag buttons, loading state, and Save button all migrated too (not just the two
   named classes) for the same "don't half-migrate a screen" reason as judgment call #1. One deliberate
   implementation choice: the wrapper div uses hand-written `focus-within:border-primary
   focus-within:ring-1 focus-within:ring-primary/40` rather than the `.input` shared class, because `.input`'s
   `focus:` pseudo-class wouldn't fire when a *child* `<input>` receives focus — reusing it as-is would have
   silently dropped the focus ring. Live-verified: `.badge-tag` chip renders at 11.34:1 contrast (matches
   spec's ≈11.35:1); Save button renders as a solid `rgb(37,72,50)`/white pill, matching the scaffold.
   `chip-allergy` wasn't exercisable live (this test household has no allergy tags set) but reuses the exact
   token pairing already verified elsewhere this session (chip-allergy ≈8.93:1, Section 2.1). TASK-060 should
   drop `DietaryProfileForm.jsx` from its scope now that it's done.
3. **Row-level expiry tint** (`getExpiryRowClass`) has no defined shared class in spec Section 3 — used
   `bg-status-critical-bg/30` / `bg-status-warning-bg/30` (opacity-modifier composition, not a new class) as
   the natural extension of the token system for a light wash background. Not spec-specified; a reasonable
   default.
4. Several genuinely undefined-in-spec cases were deliberately left as raw Tailwind (consistent with the
   spec's own "raw hue acceptable where no token exists" acceptance criterion): the "❄ Frozen" location tag
   (blue), `StatusLabel`'s "Frozen"/"Ripening" text (blue/purple — Ripening explicitly excluded by spec
   Section 2.2), Chat's `healthNote` (blue), a "recording" red dot in Chat's mic button, and RecipeModal's
   solid-red delete-confirm state (no "danger-filled button" token defined).

# Dependency Chain

Editing: all files above.
Requires: `client/tailwind.config.js` ↔ `client/src/index.css` (token pipeline); every screen depends on
`client/src/styles/components.css` existing and being imported first in `index.css`.
Irrelevant: `server/*` (unconditionally forbidden per spec), `shared/*`, DB/migrations — none touched.

# Architecture Notes

Two-layer token system (primitive `--kk-*` CSS vars → semantic Tailwind color names) plus a shared
`@layer components` class library. `.btn` is an internal composition primitive never used bare in JSX
(confirmed correctly tree-shaken from compiled output when unused). `@import './styles/components.css'` is
the first line of `index.css` — moving it after `@tailwind` directives silently drops the whole file with
only a build warning (verified during spec review, re-confirmed this session).

# Remaining Work

1. **Phase 4 (Section 6, optional)** — app-wide emoji→inline-SVG icon system. Not started. Explicitly
   splittable into its own follow-up task per the spec.
2. TASK-058 (Shopping mobile layout) and TASK-060 (mechanical CRUD-modal class migration — now covering only
   `AddItemModal.jsx`, `SplitItemModal.jsx`, `BuildListModal.jsx`, `AddToListModal.jsx`, `AddRecipesModal.jsx`
   — `DietaryProfileForm.jsx` is done, drop it from TASK-060's scope) are both still just named placeholders,
   not drafted.

# Known Risks / Open Questions

- Remaining CRUD modals (`AddItemModal.jsx`, `SplitItemModal.jsx`, `BuildListModal.jsx`, `AddToListModal.jsx`,
  `AddRecipesModal.jsx`) still render raw-orange styling and visually clash with every migrated screen around
  them — this is the spec's own accepted, named gap (Section 11), not new. `DietaryProfileForm.jsx` no longer
  belongs on this list (resolved, see Judgment Calls #2).
- Judgment call #1 (PantryPage/RecipesPage inclusion) is the one remaining place this session's
  implementation reasoning went beyond the spec's literal text without an explicit go-ahead — safe/
  conservative in the direction taken, but still worth a quick confirmation.
- Carried forward, unrelated to this task: TASK-054's `consume_pantry_item`-on-truncated-item gap; TASK-053's
  Vercel Preview streaming verification; OpenAI billing confirmation; `server/.env.vercel`'s fate — see
  [archive/TASK-055.md](archive/TASK-055.md) and [[project_go_public_readiness]].

# Verification Results

- `npm run build` (client): clean, no warnings beyond the pre-existing chunk-size notice, after every phase.
- `npm run lint` (root): clean.
- `npm test` (root): 98/98 passing, 0 failures — zero regressions.
- Contrast gate (Phase 1 hard requirement, live computed-CSS values from the running app, not hand math
  alone): `badge-status-critical` 5.17:1, `badge-status-warning` 5.34:1, `badge-status-ok` 7.85:1,
  `bg-primary`/`text-on-primary` (via `.btn-primary` and `.chat-bubble-user`) 10.24:1 — all clear WCAG AA
  4.5:1 with margin, matching Section 2.1's hand-computed values almost exactly.
- Responsive: Pantry table/card breakpoint checked live at 375px/768px/1280px — no horizontal overflow at
  any width, table↔card switch confirmed correct.
- Live smoke tests (real running app, real data, no mocks): Dashboard, Pantry (desktop table + action-button
  variants), Chat (48 real message bubbles rendered), Recipes (source badges with icons confirmed correct
  colors/icons live), Household (`.card-callout` confirmed) all checked via `read_page`/`get_page_text`/
  `getComputedStyle` — screenshots were unavailable this session (Browser pane wasn't compositing).
- `orange-` grep scoped to all touched files: zero matches after a full pass (one leftover instance in
  `RecipeReviewModal.jsx`'s Recipe Name input was caught by this grep and fixed).
- Shopping and Landing were verified by code review + build success only (not live-clicked) — every class
  used on those two pages was already live-verified elsewhere in the same session (`.btn-primary`, `.card`,
  `.input`, `text-primary`, etc.), so this is a reasonable-confidence gap, not a blind spot on novel classes.

# Recommended Next Action

Judgment call #1 (PantryPage/RecipesPage inclusion) is resolved: checking `03-pantry-mobile.png` directly
confirmed both "Scan Receipt" and "+ Add Item" are scaffold-depicted as identical solid-green pills (not one
outlined) — `PantryPage.jsx`'s "Scan receipt" button was wrongly styled `.btn-secondary` (my own unverified
choice, not scaffold-derived); fixed to `.btn-primary`, reusing the existing class, no new CSS. Live-verified
both buttons now render identically (`rgb(37,72,50)` bg, white text, full pill). Phase 4 (icons) and
TASK-058/TASK-060 remain separate, not-yet-started follow-ups.

# Context Notes

- branch: `staging`.
- Dev servers (`server` on 3001, `client` on 5183) were started and stopped this session; none left running.
- No worktree was used.

---

## Archived History

- TASK-047 through TASK-053 (spec-drafting + TASK-053 streaming implementation session): see
  [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054 (chat context-size cap implementation session): see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055 (post-audit hardening implementation session): see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056 (UI/UX effort-reduction redesign implementation session): see
  [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting session (5 architect review rounds, DRAFT-1 → DRAFT-6 approved): see
  [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
