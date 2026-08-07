# TASK-057 — Visual Design System Migration ("Modern Farmhouse")

Version: DRAFT-6 — APPROVED FOR IMPLEMENTATION (pending Connor's own final sign-off). No implementation
code has been written.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.6/10 — revise before approval | Praised the primitive→semantic→shared-pattern→screen migration hierarchy, the phasing, the explicit scope boundaries, and the handling of unreliable scaffold output (garbled Shopping image, garbled text) as "exactly the right relationship between AI-generated design artifacts and implementation." Four required changes, each independently verified rather than applied on faith: (1) **accepted, and resolved rather than merely flagged** — recomputed the WCAG relative-luminance contrast math independently (same formula, confirmed the review's ≈3.45:1/≈3.71:1 figures for the estimated rose/gold text colors, both genuine AA failures for normal text) and derived replacement values that clear 4.5:1 with margin (`--kk-rose-800` → `#501a15`, ≈5.17:1 against `#da877f`; `--kk-gold-800` → `#5c4415`, ≈5.35:1 against `#e8c07a`) — Section 2.1. Kept a Phase 1 contrast-checker verification step regardless, since hand-computed sRGB math on sampled-not-rendered values is a strong prior, not a substitute for checking the actual rendered pixels. (2) **accepted** — added `ink-muted`/`ink-subtle` semantic tokens (Section 2.2), aliasing Tailwind's existing gray-600/gray-400 values rather than inventing new primitives (no scaffold shows a distinctly-styled muted/disabled state to sample from — documented as a pragmatic default, not a scaffold-derived value), and moved `.input`/`.nav-link` off raw `text-gray-*` (Section 3). **Pushed back on one sub-point**: the review's suggested `focus-ring` token is unnecessary — `.btn`/`.input`'s existing `ring-primary/50`/`ring-primary/40` already derive from the semantic `primary` token via Tailwind's opacity modifier, which is the system working correctly, not a gap; no new token added for it. (3) **accepted in full** — removed the Shopping mobile layout redesign from this spec entirely (old Section 5 and Phase 4); Shopping is retint-only here (Section 4F), the structural fix is left for a future TASK-058 once this spec's tokens/components exist for it to build on. (4) **accepted, and resolved rather than restructured** — actually inspected `server/services/aiService.js`'s tool-call handling instead of leaving the investigation as a to-do: confirmed `itemsAdded` (the only signal surfaced to the client today) tracks `add_pantry_item` outcomes only — `update_pantry_item`/`remove_pantry_item`/`consume_pantry_item` have no equivalent client-facing signal. Per the review's own decision rule ("signal doesn't exist → defer"), the Action Confirmed chip is removed from this spec entirely (not conditionally scoped) — implementing it for `add` only would be visibly inconsistent with the scaffold's own example (which shows it on a removal), so partial implementation isn't a reasonable middle ground. The conditional `server/` exception is removed from Forbidden Files; `server/` is now unconditionally out of scope. Five smaller refinements (also accepted): shared-pattern-vs-local-composition convention added to Section 3; explicit ownership split (`expiry.js` selects status, `components.css` renders it) stated in Section 3/4C; source-badge open question reframed from "design during implementation" to a stated architectural requirement (5 named, information-bearing semantic slots, exact treatment pending decision) in Section 7; `--kk-amber-highlight-bg`/`-border` renamed to plain primitive names (`--kk-amber-100`/`--kk-amber-300`) since a primitive shouldn't carry a purpose-word; acceptance criteria and the "independently revertible" phasing claim both reworded per the review's more precise framing (Sections 8, 11, Acceptance Criteria). |
| DRAFT-2 | 9.2/10 — revise once more before approval | Confirmed all four DRAFT-1 required changes landed correctly, specifically praising the Action-Confirmed investigation as "probably the strongest revision" and the Shopping-scope separation as "exactly the right boundary." Two required changes and one recommended wording fix, each verified against the real project rather than argued from documentation: (1) **investigated empirically, reviewer's specific theory disproven, but a real and more serious bug found in its place.** The review's concern was that `@apply btn` — composing a custom `@layer components` class from within another such class — might not be valid Tailwind v3 usage, since the docs describe `@apply` as being for "inlining existing utility classes." This was tested directly against this project's actual `npm run build` (Vite 5 + Tailwind 3.4.3), not argued from memory: a minimal `.foo-primary-test { @apply foo-base-test bg-red-500; }` with a real JSX consumer of `foo-primary-test` (but never of bare `foo-base-test`) compiled correctly — `foo-primary-test`'s output CSS contained every declaration from `foo-base-test` fully inlined, exactly as intended; `foo-base-test` itself was correctly tree-shaken as a redundant standalone rule once its content was inlined elsewhere, since nothing references it bare. **`@apply` of a custom component class is real, working, verified Tailwind v3 behavior — the specific technical claim in the review is incorrect.** However, the review's underlying instinct (verify before approving) caught something real: this spec's own Section 3 told implementers to import `components.css` "after the Tailwind directives," and testing that exact placement — `@tailwind components; @import './styles/components.css'; @tailwind utilities;` — reproduces a genuine bug: `@import` must precede all other statements per the CSS spec, and Vite's CSS pipeline silently drops the entire imported file with only a build warning, no error, regardless of whether any class inside it is referenced in JSX. Fixed by moving `@import` to the first line of `index.css` (verified this exact fix compiles cleanly with real JSX consumers, full correct output) — Section 3 now shows the complete corrected wiring and calls out the tree-shaking behavior explicitly so a future implementer isn't alarmed to find `.btn` itself absent from devtools (only `.btn-primary`/`.btn-secondary` etc. are ever used bare in JSX, by the shared-class-vs-local-composition convention already in this spec — `.btn` alone is expected to never survive as a standalone rule, and that's correct, not a bug). (2) **confirmed and fixed** — recomputed the WCAG contrast formula for `ink-subtle` (`--kk-gray-400`, `#9ca3af`) against `.input`'s actual background (`--kk-cream-100`/`#fdfaf5`) and reproduced the review's ≈2.44:1 figure exactly — a real AA failure, and DRAFT-2's "already-AA-tested" claim was simply wrong for this specific pairing (true against white, not against this app's warm cream surface). Replaced with Tailwind's gray-500 (`#6b7280`), computed ≈4.64:1 against the same background, confirmed passing. Re-audited every other text/background pairing in the token system while in there (not just the flagged one, since one wrong "AA-tested" claim is reason to distrust the rest of that claim rather than just the one instance) — `ink-muted` (gray-600) against both `surface` and `page`, `status-ok-text` against `status-ok-bg`, `chip-allergy`'s `status-critical-text` against `accent-coral-bg`, `accent-tan-text` against `accent-tan-bg`, and the base `text-ink`-on-`bg-surface` pairing all independently recomputed and confirmed to pass with large margins (Section 2.1, Section 9). (3) **accepted** — "byte-identical request shapes" reworded to the semantic invariant the review correctly identified as the actual thing worth checking (Verification Steps). Two suggestions explicitly not applied, with reasoning: the review's "icons should distinguish source badges without relying on color alone" is a good idea folded into Section 7's existing Phase 0 gate rather than added as a new requirement, since the gate already covers "how each of the 5 stays distinct" and icon-plus-color is one candidate answer, not a separately-tracked item; a proposed TASK-059 for the icon phase is noted as a reasonable option but not acted on, since Section 6 already treats it as optional and independently splittable, which was explicitly not flagged as blocking. |
| DRAFT-3 | 9.7/10 — approve after closing the two Phase 0 decisions | Confirmed every prior required change landed correctly and explicitly listed each as no longer a blocking concern (contrast, `ink-subtle`, Shopping scope, Action Confirmed, ownership boundary, acceptance criteria, phase dependency language). Treated the two remaining Phase 0 items as decisions to close now rather than leave for implementation, and proposed concrete resolutions for both — accepted in substance, with the actual color/CSS specifics worked out independently rather than left as `{ ... }` placeholders (the review's own snippets used placeholders for the exact values; this round fills them in for real, staying inside the review's own stated constraint against inventing a second color system). (1) **Source badges, accepted with the specific implementation reasoned out below (Section 3, Section 7):** kept the review's core structure (`.badge-source` shared base + 5 named variants, icon-plus-label as the primary distinguishing mechanism, color as secondary reinforcement, not required to be five different hues) but chose the *specific* colors deliberately rather than picking five arbitrary tints: `source-ai` keeps the one scaffold-confirmed treatment (solid `bg-primary`/`text-on-primary`, unchanged from DRAFT-3's `.badge-source`); the other 4 (Uploaded/Web/Manual/URL Import — none of which have any scaffold evidence either way) share one identical neutral outline treatment (`border-border`/`text-ink-muted`/transparent fill), differentiated from each other by icon and label only. This reuses only already-established tokens (`primary`, `on-primary`, `border`, `ink-muted`) — zero new primitives, the most restrained answer available, and it also avoids a real semantic collision the review's own table didn't flag: reusing `rose`/`gold`/`coral` (this system's status/alarm colors) for neutral recipe metadata would risk a user misreading a "Manual" recipe badge as some kind of warning, so those were deliberately not candidates. One small correction to the review's own table: its shorthand labels ("Web," "URL Import") don't match `RecipeCard.jsx`'s actual current copy ("From Web," "Imported from URL") — the existing labels are kept verbatim; only the CSS class/token names use short slugs. (2) **Tag-chip unification, accepted outright** — this was already what Section 3's code did (`.badge-tag` already used `--kk-tan-100` uniformly); the only real change is removing the "still open" framing from Section 7, which had fallen out of sync with the code. (3) **The `.badge-source` base/variant restructuring the review asked for in Section 3, applied** — the single old `.badge-source` class is now the shared base plus 5 named variants, matching the review's own proposed shape. One point flagged rather than silently resolved: the 4 non-AI variants need real icons (camera/upload, globe, pencil, link-document, per the review's own suggestions, kept as-is — sensible, uncontroversial choices) that must ship in Phase 3 alongside Recipes, which is *not* gated behind Section 6's optional, deferrable icon-system phase — that distinction is now stated explicitly (Section 6) so the two don't get conflated during implementation. |
| DRAFT-4 | 9.8/10 — approve after two small revisions | Confirmed the architecture has "crossed the threshold from design proposal to implementation-ready migration specification," specifically praising the `bg-orange-600`→`bg-primary` (not →`bg-green-800`) distinction, the ownership boundaries, the pattern of empirical verification over assumption throughout the review history, the restrained 2-tier source-badge resolution, and the Shopping/Action-Confirmed removals. Two required changes, both real bugs in the spec's own prose rather than the architecture, both fixed: (1) **accepted, and worse than described** — Section 4's claim that untouched CRUD modals "inherit `.card`/`.btn`/`.input` automatically once those primitives exist" is simply false (a class only applies to markup that references it by name); fixed by stating plainly that these files receive no migration in this spec, keep their current raw-orange styling, and will visibly clash with the rest of the app — a named, accepted gap (Section 4, Section 11) rather than a glossed-over one, left for a future mechanical sweep rather than expanding this spec's Allowed Files further at this stage. (2) **accepted, and independently verified rather than taken on the review's word** — fetched the cited W3C non-text-contrast page directly rather than trusting the citation, confirmed it does say to evaluate contrast from resolved CSS/markup color values rather than rendered/anti-aliased screenshot pixels; reworded every instance of "against the rendered pixels"/"against rendered output" (Section 8 Phase 1 item 8, Section 9, Acceptance Criteria, Verification Steps) to specify reading each element's computed CSS color values (devtools computed-styles panel or `getComputedStyle`) instead — while keeping the underlying check itself (confirming the *build* resolved Section 2.1's hand-verified values correctly, not re-deriving the math) exactly as originally intended. One non-blocking recommendation, accepted: added an explicit migration-completion boundary to Acceptance Criteria and Verification Steps — this spec requires semantic-token migration within touched-phase scope, not zero raw Tailwind hues repo-wide; the `orange-*` grep is now explicitly scoped to each phase's own touched files, not a repo-wide sweep, so it can't be misread as "zero orange anywhere or the phase fails." |
| DRAFT-5 | 9.9/10 — APPROVED after one minor clarification | Called this "the strongest spec in the TASK-05x series" and "probably the cleanest architectural spec in the Kitchen Keeper redesign sequence," specifically praising the token model's dependency direction, the Phase 1 verification chain (primitive → semantic mapping → build → computed styles → contrast), the source-badge decision's durability (text/icon before color, so the palette itself can evolve without breaking the information model), and the discipline of rejecting Shopping/Action-Confirmed/icon-overhaul scope expansions that "were not actually consequences of the token migration problem." One required change, accepted: added an explicit rule that `.btn` is an internal CSS composition primitive, never consumed bare in JSX — only `.btn-primary`/`.btn-secondary`/etc. are valid call-site classes (Section 3). Three non-blocking recommendations: (1) renaming `surface`/`page` to a more scalable vocabulary — **not applied**, since the review's own text explicitly said not to change this unless a broader token vocabulary is actually needed, which it isn't yet; (2) design-token governance comments in the token file, accepted and added (Section 2.1); (3) naming the CRUD-modal gap's future task so it doesn't disappear from planning — accepted, now referenced as a placeholder "TASK-060 — Mechanical Component Class Migration" (Section 4, Section 11), matching how TASK-058 is already referenced for Shopping — numbered 060, not 059, since DRAFT-2's own review history row already informally floated "TASK-059" for a different possible future task (the icon-system follow-up), and reusing that number here for an unrelated task would recreate the exact ambiguity this change exists to prevent. One open question, answered rather than left implicit: whether `components.css` is meant to be the durable home for shared visual patterns even if JSX component wrappers (`Button.jsx`, etc.) are introduced later — resolved in Section 12: the CSS layer stays the source of truth for the visual treatment; any future JSX wrapper composes the existing classes rather than reimplementing styling, so the two systems can't compete. |

---

## 0. Framing

TASK-056 fixed *effort* (fewer taps, fewer decisions, responsive layouts) without touching visual style.
This spec is the visual layer on top of that work: it adopts the "Modern Farmhouse" direction established
in the 11 Gemini-generated scaffolds at
[`ai/design/2026-08-gemini-redesign/`](../design/2026-08-gemini-redesign/README.md) (deep forest green +
warm cream, real food photography, a consistent status-color system) and turns it into an actual,
maintainable design system — not a one-time coat of paint.

The concrete deliverable the user asked for is a system that is **shareable and centrally controlled**:
colors defined once as CSS variables, not repeated as raw Tailwind hue classes (`bg-orange-600`, `text-
red-500`, …) scattered across dozens of files, and common visual patterns (buttons, badges, cards, chips)
defined once as reusable classes, not re-typed as long utility strings at every call site. Sections 2-3
below are the concrete architecture for that. Everything else in this spec (per-screen application,
phasing, open questions) exists to apply that architecture correctly, not to relitigate it.

**Explicitly not proposed:** a Tailwind v3→v4 upgrade. v4's CSS-first `@theme` directive is the more modern
way to define this same kind of token system, but v3's documented CSS-variable + `<alpha-value>` pattern
(Section 2) achieves the same robustness — semantic names, opacity-modifier support, single source of
truth — inside the current toolchain. A v4 migration is a real, separate undertaking (new PostCSS plugin,
config-file format change, verifying every existing utility class still resolves) that isn't justified by
this spec's actual goal. Revisit only if a future need specifically requires v4.

---

## 1. Current State — What Exists Today

Read directly from the code:

- **No design tokens of any kind.** [`client/src/index.css`](../../client/src/index.css) is 3 lines — the
  bare `@tailwind base/components/utilities` directives, nothing else.
  [`client/tailwind.config.js`](../../client/tailwind.config.js) has an empty `theme.extend`. Every color in
  the app is a raw Tailwind palette class written inline in JSX.
- **The orange accent is the de facto brand color today,** used inconsistently: `orange-600`/`orange-700`
  for primary buttons and links (48+ and 24+ occurrences respectively across the codebase), `orange-100`/
  `orange-400`/`orange-500` for lighter accents, spread across 29 files with no shared source of truth —
  changing the brand color today means editing every file individually.
- **One genuine bright spot: the status-color mapping already has a single point of change.**
  [`client/src/utils/expiry.js`](../../client/src/utils/expiry.js)'s `getExpiryBadgeClass(status)` and
  `getExpiryRowClass(status)` are the *only* two functions in the codebase that centralize a color decision
  — every pantry expiry badge/row color already flows through these two functions, returning raw Tailwind
  strings (`'bg-red-100 text-red-700'`, etc.) today. This is exactly the kind of choke point a token system
  should route through, not replace with something new.
- **Everywhere else, color is duplicated per call site**, e.g.
  [`Sidebar.jsx`](../../client/src/components/layout/Sidebar.jsx)'s inline `navClass` function
  (`bg-orange-100 text-orange-700`), [`RecipeCard.jsx`](../../client/src/components/recipes/RecipeCard.jsx)'s
  `SOURCE_BADGE` map (5 separate raw-hue pairs: blue/purple/orange/gray/teal), and one-off buttons repeating
  `bg-orange-600 hover:bg-orange-700 text-white rounded-lg px-4 py-2` (or close variants of it) at each of
  ~15+ button call sites with no shared class.
- **No shared component classes exist.** No `.btn`, `.card`, `.badge`, or equivalent — every button, card,
  and pill re-derives its full utility-class string locally. `@layer components` is unused in `index.css`.
- **Recipes already support real photography** — `RecipeCard.jsx:44-56` renders `recipe.imageUrl` when
  present (server already stores this field —
  confirmed in [`server/db/schema.js`](../../server/db/schema.js) and
  [`server/services/recipeService.js`](../../server/services/recipeService.js)) with an emoji-in-gradient
  placeholder when absent. This spec restyles that existing pattern; it does not add a new capability.
  **Pantry items have no photo field and none is proposed** — the scaffolds' liberal use of food photography
  on Pantry cards is illustrative of the direction, not a literal feature to build (there is no image
  source for a pantry item today, and adding one is out of scope here).
- **Icons are emoji throughout** (💬🏠🥦📖🛒📷🚫📸🔗🔍✨❄️🧊🥫), already correctly `aria-hidden` everywhere per
  TASK-056's audit — a consistency/polish issue, not an accessibility blocker. TASK-056 explicitly deferred
  fixing this (its own P2-1) as "a large, low-risk-but-high-diff change" not worth bundling into an
  effort-reduction spec. It's revisited here in Section 6 because the scaffolds happen to establish a
  simple, consistent line-icon vocabulary as a side effect of the redesign — see that section for why it's
  now in scope as an optional phase rather than a hard requirement.
- **Shopping's mobile layout bug is real and reproducible in code, independent of any scaffold:**
  [`ShoppingPage.jsx:94-96`](../../client/src/pages/ShoppingPage.jsx) is a fixed `flex gap-6` two-column
  layout (`<aside className="w-56 flex-shrink-0">` next to a `flex-1` detail pane) with **no `md:`
  breakpoint at all** — unlike Pantry's table (which at least had a working desktop layout before TASK-056
  added a mobile one), Shopping has never had a mobile-specific layout. This matches the design README's
  claim exactly.

---

## 2. Token Architecture (the "colors stored in variables" requirement)

Two-layer system — **primitives** (raw palette values) and **semantic tokens** (named by purpose, pointing
at a primitive) — the standard pattern for exactly this problem: primitives are what a re-theme changes,
semantics are what components reference, so a future palette swap touches one file instead of every
component. [Tailwind's own documented pattern](https://v3.tailwindcss.com/docs/customizing-colors) for this
in v3 is CSS variables holding only color *channels* (no `rgb()`/`hsl()` wrapper), referenced from
`tailwind.config.js` via `rgb(var(--x) / <alpha-value>)` — omitting the wrapper in the CSS variable and
using the `<alpha-value>` placeholder in the config is specifically what keeps opacity modifiers
(`bg-primary/50`) working; skipping either half of that breaks it.

### 2.1 Primitives

Sampled directly from the source PNGs in `ai/design/2026-08-gemini-redesign/scaffolds/` (pixel-picked with
PIL, not eyeballed) except `--kk-rose-800`/`--kk-gold-800`, which are **not sampled from a scaffold at
all** — no scaffold shows dark-enough text-on-pill contrast to sample a working value from, so these two
are computed from scratch (see below) rather than estimated.

A note on what "primitive" means here, since DRAFT-1 blurred it in two places (now fixed): a primitive is
a raw palette value with no purpose baked into its name — `--kk-amber-100` is a primitive, `--kk-amber-
highlight-bg` was not (the "highlight" in the name already encodes *how it's used*, which belongs in the
semantic layer, Section 2.2). Renamed accordingly below.

**Governance comment, added on architect review** — this token file will become the single most-referenced
CSS file in the app, so its own header states the rules explicitly rather than leaving them implicit in
this spec alone:

```css
/* client/src/index.css — @layer base */
/*
 * Design token rules:
 * 1. Components (client/src/styles/components.css) consume semantic tokens (Section 2.2) only.
 * 2. Components never reference these primitives directly — that's the whole point of the semantic layer.
 * 3. Screens/JSX never introduce new raw color values — reach for an existing semantic token or shared
 *    component class; propose a new token here if neither fits, don't invent one inline.
 */
@layer base {
  :root {
    /* Forest green family — sampled from the header bar (01, 02, 06) and every solid
       button (Suggest Meals, Add, Scan Receipt, Edit/Mark Used/Freeze). All scaffold
       greens cluster tightly (#21442e-#274a34); one canonical value is enough. */
    --kk-green-900: 33 68 46;    /* #21442e — hover/active state */
    --kk-green-800: 37 72 50;    /* #254832 — canonical brand green */

    /* Warm neutrals — sampled from card interiors (01, 02) and the page background (01, 03) */
    --kk-cream-100: 253 250 245; /* #fdfaf5 — card/surface background */
    --kk-cream-300: 237 229 218; /* #ede5da — page background */
    --kk-cream-500: 215 207 196; /* #d7cfc4 — borders, muted dividers */

    /* Ink — sampled from body/heading text (01) */
    --kk-ink-900: 45 38 28;      /* #2d261c */

    /* Status family — pill backgrounds sampled from the pantry/dashboard urgency pills (01, 03);
       text colors computed (not sampled — see note above), verified via the WCAG 2.1 relative-
       luminance formula against the paired background, not just visual inspection:
         L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin (sRGB-linearized channels)
         contrast = (L_lighter + 0.05) / (L_darker + 0.05)
       DRAFT-1's estimated values (#7a2e28 on #da877f ≈ 3.45:1; #7a5a18 on #e8c07a ≈ 3.71:1) were
       independently recomputed during architect review and confirmed to fail the 4.5:1 AA normal-text
       target — both replaced below with values that clear it with margin. */
    --kk-rose-200: 218 135 127;  /* #da877f — critical/expired pill background */
    --kk-rose-800: 80 26 21;     /* #501a15 — computed ≈5.17:1 against rose-200 (was #7a2e28 ≈3.45:1, failed AA) */
    --kk-gold-200: 232 192 122;  /* #e8c07a — urgent/warning pill background */
    --kk-gold-800: 92 68 21;     /* #5c4415 — computed ≈5.35:1 against gold-200 (was #7a5a18 ≈3.71:1, failed AA) */
    --kk-sage-200: 216 230 204;  /* #d8e6cc — ok/fine pill background */

    /* Tag/callout family — sampled from Recipes' tag chips (07, 09) and Household's join-code callout (10b) */
    --kk-tan-100: 245 223 160;   /* #f5dfa0 — recipe/dietary tag chip background */
    --kk-amber-100: 255 242 226; /* #fff2e2 — callout box background (join-code box) */
    --kk-amber-300: 235 224 204; /* #ebe0cc — callout box border */

    /* Allergy/safety-critical chips — sampled from Household's allergy chips (10b); visibly more
       saturated than the rose-200 status color, so kept as its own primitive rather than reused */
    --kk-coral-300: 255 191 183; /* #ffbfb7 */

    /* Muted text — NOT sampled from any scaffold (none shows a distinctly-styled placeholder/disabled
       state); aliases Tailwind's own gray scale rather than inventing new gray primitives with no evidence
       behind them. DRAFT-2 called gray-400 "already-AA-tested" — true against white (Tailwind's own docs
       context), false against this app's actual cream surface: computed ≈2.44:1 against --kk-cream-100,
       confirmed during architect review, a real AA failure. Replaced with gray-500, computed ≈4.64:1
       against the same surface — passes. gray-600 (used for ink-muted, not ink-subtle) was independently
       re-checked against both surface (≈7.25:1) and page (≈6.06:1) and is unaffected — it was never the
       problem. */
    --kk-gray-600: 75 85 99;     /* #4b5563 — Tailwind's gray-600 */
    --kk-gray-500: 107 114 128;  /* #6b7280 — Tailwind's gray-500 — replaces gray-400, see note above */
  }
}
```

### 2.2 Semantic tokens (what components actually reference)

```js
// client/tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--kk-green-800) / <alpha-value>)',
        'primary-hover': 'rgb(var(--kk-green-900) / <alpha-value>)',
        'on-primary': 'rgb(255 255 255 / <alpha-value>)',

        surface: 'rgb(var(--kk-cream-100) / <alpha-value>)',
        page: 'rgb(var(--kk-cream-300) / <alpha-value>)',
        border: 'rgb(var(--kk-cream-500) / <alpha-value>)',
        ink: 'rgb(var(--kk-ink-900) / <alpha-value>)',
        'ink-muted': 'rgb(var(--kk-gray-600) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--kk-gray-500) / <alpha-value>)',

        highlight: 'rgb(var(--kk-amber-100) / <alpha-value>)',
        'highlight-border': 'rgb(var(--kk-amber-300) / <alpha-value>)',

        'status-critical-bg': 'rgb(var(--kk-rose-200) / <alpha-value>)',
        'status-critical-text': 'rgb(var(--kk-rose-800) / <alpha-value>)',
        'status-warning-bg': 'rgb(var(--kk-gold-200) / <alpha-value>)',
        'status-warning-text': 'rgb(var(--kk-gold-800) / <alpha-value>)',
        'status-ok-bg': 'rgb(var(--kk-sage-200) / <alpha-value>)',
        'status-ok-text': 'rgb(var(--kk-green-800) / <alpha-value>)',

        'accent-tan-bg': 'rgb(var(--kk-tan-100) / <alpha-value>)',
        'accent-tan-text': 'rgb(var(--kk-ink-900) / <alpha-value>)',
        'accent-coral-bg': 'rgb(var(--kk-coral-300) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
```

**No separate `focus-ring` token is added**, despite it being a reasonable-sounding suggestion during
review — `.btn`/`.input` (Section 3) already write `ring-primary/50`/`ring-primary/40`, which *is* the
semantic `primary` token combined with Tailwind's opacity modifier. That's the token system already working
correctly for this case, not a gap to fill with a new name.

`theme.extend.colors` **adds** these names alongside Tailwind's full default palette — it does not remove
`orange-*`/`red-*`/etc. Nothing breaks on day one; the migration (Section 4) is about *moving* existing
usages onto the semantic names over time, not a flag-cut. Going forward, new UI code should reach for
`bg-primary`/`text-status-critical-text`/etc. instead of a raw hue — a documented convention (add to
[`ai/handoffs/CONVENTIONS.md`](../handoffs/CONVENTIONS.md)), not an enforced lint rule; this codebase
doesn't currently have a custom ESLint rule mechanism for that and building one isn't justified by this
spec alone.

**"Ripening" status (purple-100/700) is intentionally left alone** — none of the 11 scaffolds depict this
state (Gemini was only shown the 3 most common statuses), so there's no evidence to retint it from. Keeping
it as a raw Tailwind class for now is a deliberate scope boundary, not an oversight; revisit if a future
scaffold pass covers it.

---

## 3. Shareable Component Classes (the "shareable CSS classes" requirement)

Defined once via Tailwind's `@layer components` + `@apply` in a new `client/src/styles/components.css`.
This is the layer that eliminates the "retype the same 8-utility-class string at every button" problem —
one edit here propagates everywhere the class is used, the same leverage `getExpiryBadgeClass` already has
today for status colors, extended to every other repeated pattern in the app.

**Verified against this project's actual `npm run build` (Vite 5 + Tailwind 3.4.3) during architect review**
— not assumed from documentation. Two things were tested directly, since one confirmed a suspicion and the
other disproved it:

1. **`@apply btn` inside `.btn-primary` (composing a custom `@layer components` class from another one) is
   valid and compiles correctly.** A real build of this exact pattern showed `.btn-primary`'s output CSS
   contains every declaration from `.btn` fully inlined, plus its own. The bare `.btn` rule itself does
   **not** survive as a standalone selector in the compiled output — Tailwind correctly tree-shakes it once
   its content has been inlined everywhere it's used, since nothing in this app ever uses bare `.btn` in a
   `className` (only `.btn-primary`/`.btn-secondary`/etc., per the shared-class convention above). **This is
   correct, verified behavior, not a bug** — don't be alarmed if `.btn` alone is absent from devtools; check
   `.btn-primary` instead.
2. **`@import`'s position in `index.css` matters and is easy to get wrong.** An earlier draft of this spec
   placed the import after the `@tailwind` directives (`@tailwind components; @import
   './styles/components.css'; @tailwind utilities;`) — this is invalid per the CSS spec (`@import` must
   precede all other statements) and Vite's build **silently drops the entire imported file**, with only a
   build warning, no error, regardless of whether any of its classes are used in JSX. The fix, verified to
   compile cleanly with real usage: put the import as the very first line.

```css
/* client/src/index.css — the corrected, verified wiring */
@import './styles/components.css';

@tailwind base;
@layer base {
  :root {
    /* token block, Section 2.1 */
  }
}
@tailwind components;
@tailwind utilities;
```

```css
/* client/src/styles/components.css */
@layer components {
  /* Buttons — base + variant, matching the scaffolds' full-pill (rounded-full) button shape.
     RULE, added on architect review: `.btn` is an internal CSS composition primitive only — it has no
     complete visual treatment on its own (no fill, no border, no text color) and must never be used bare
     in JSX. Application markup consumes `.btn-primary`/`.btn-secondary`/etc. only. This is also why `.btn`
     itself never appears as a standalone rule in compiled output (Section 3's build-verification note
     below) — nothing should ever reference it directly, so there's nothing to tree-shake away from. */
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold
      transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
      disabled:opacity-50 disabled:cursor-not-allowed;
  }
  .btn-primary   { @apply btn bg-primary text-on-primary hover:bg-primary-hover; }
  .btn-secondary { @apply btn border border-primary text-primary bg-transparent hover:bg-primary/5; }
  .btn-text-danger {
    @apply text-sm font-medium text-status-critical-text hover:underline;
  }

  /* Cards — the generic surface container used for every panel/section */
  .card {
    @apply bg-surface rounded-2xl border border-border shadow-sm;
  }
  .card-callout {
    @apply bg-highlight border border-highlight-border rounded-2xl;
  }

  /* Form inputs */
  .input {
    @apply bg-surface border border-border rounded-lg px-3 py-2 text-sm text-ink
      placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-primary/40
      focus:border-primary;
  }

  /* Badges/pills — base + status/tag/source variants */
  .badge {
    @apply inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium;
  }
  .badge-status-critical { @apply badge bg-status-critical-bg text-status-critical-text; }
  .badge-status-warning  { @apply badge bg-status-warning-bg text-status-warning-text; }
  .badge-status-ok       { @apply badge bg-status-ok-bg text-status-ok-text; }
  .badge-tag             { @apply badge bg-accent-tan-bg text-accent-tan-text; }
  .chip-allergy          { @apply badge bg-accent-coral-bg text-status-critical-text font-semibold; }

  /* Recipe source badges — shared base + 5 named variants, resolved during architect review (Section 7).
     Icon + label is the primary distinguishing mechanism; color is deliberately restrained to 2 visual
     tiers (AI-generated vs. human-provided), not 5 arbitrary hues — see Section 7 for the full reasoning.
     Zero new primitives: reuses primary/on-primary/border/ink-muted only. */
  .badge-source { @apply badge font-semibold; }
  .badge-source-ai { @apply badge-source bg-primary text-on-primary; }
  .badge-source-uploaded,
  .badge-source-web,
  .badge-source-manual,
  .badge-source-url {
    @apply badge-source bg-transparent border border-border text-ink-muted;
  }

  /* Nav links (Sidebar) */
  .nav-link {
    @apply flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
      text-ink-muted hover:bg-page hover:text-ink;
  }
  .nav-link-active { @apply nav-link bg-status-ok-bg text-primary; }

  /* Chat bubbles */
  .chat-bubble-user      { @apply bg-primary text-on-primary rounded-2xl px-4 py-3; }
  .chat-bubble-assistant { @apply bg-surface text-ink rounded-2xl px-4 py-3 shadow-sm; }
}
```

**One implementation note, flagged rather than resolved with the same rigor as the AA-critical pairings:**
`border-border` (`--kk-cream-500`) against `bg-surface` (`--kk-cream-100`) computes to only ≈1.48:1 — the
outline on the 4 neutral source-badge variants will read as very subtle, close to invisible, against a
card's surface. This is consistent with the intent (these 4 are deliberately lower-emphasis than
`.badge-source-ai`, per Section 7's "secondary reinforcement" framing) and doesn't fail any accessibility
requirement — the badge's actual informational content is carried by its icon and label text, both
independently legible, not by the outline being visible. But it's a real visual-weight judgment call, not
an AA-gated one, so it's called out rather than silently assumed correct: if it reads as *too* subtle once
built, swap the border for a slightly darker tone or a light `bg-page` fill instead — a one-line change,
not an architectural one.

This list is deliberately scoped to patterns that **already recur 3+ times** in the current codebase or in
the scaffold set (buttons, cards, inputs, badges, nav links, chat bubbles) — not a speculative full
component library.

**Shared class vs. local composition — a convention worth stating explicitly, added during architect
review:** shared classes (`.btn-primary`, `.card`, `.badge-status-critical`) encode *stable visual
patterns* — color, shape, typography, the things that should change in exactly one place. Layout-specific
concerns — width, positioning, responsive behavior, one-off spacing — stay as local Tailwind utilities
composed alongside the class at the call site (`className="btn-primary w-full md:w-auto"`), never baked
into a new shared-class variant. Concretely: don't create `.btn-primary-large`/`.btn-primary-mobile`/
`.btn-primary-icon`-style variants — reach for `.btn-primary` plus local utilities instead. This is what
keeps the shared layer from growing into a parallel component framework that re-fragments the same problem
this spec exists to solve.

**Ownership split, made explicit:** `expiry.js` (Section 1) owns *which* status applies to a given item —
that's business logic and stays there unchanged. `components.css` owns *how that status looks* — the
`badge-status-*` definitions above. `getExpiryBadgeClass`/`getExpiryRowClass` get their return values
swapped from raw Tailwind strings to these class names (`'badge-status-critical'` instead of `'bg-red-100
text-red-700'`) — same single point of change, same function, only the output format changes. This
boundary matters going forward: `expiry.js` should never grow into a second, competing styling system by
picking arbitrary visual variants itself — any new visual variant is added in `components.css`, referenced
by name from `expiry.js`, not defined inline there.

---

## 4. Per-Screen Application

Ordered by traffic/leverage, matching TASK-056's own prioritization logic rather than the scaffolds' file
numbering.

**A. Global layout** — [`Sidebar.jsx`](../../client/src/components/layout/Sidebar.jsx): header brand text on
a `bg-primary` bar (currently transparent/white with orange text — scaffolds 01/02/03/06 all show a solid
green header bar, a real layout change not just a recolor), `navClass` migrated to `.nav-link`/
`.nav-link-active`, page/`<aside>` backgrounds migrated to `bg-page`/`bg-surface`. Desktop scaffold (06)
shows the active nav item as a soft highlight (sampled: the same sage/`status-ok-bg` tint, not a solid
green fill) — confirmed distinct from the mobile scaffolds' unstyled nav list, applied as one consistent
active-state style across both breakpoints per the same consistency principle TASK-056 already established
for other patterns.

**B. Dashboard** ([`DashboardPage.jsx`](../../client/src/pages/DashboardPage.jsx), `ExpiryStrip`,
`EatThisNow.jsx`, `QuickAdd.jsx`): cards → `.card`, primary buttons → `.btn-primary`, expiry pills already
route through `getExpiryBadgeClass` (Section 2/3 handles this centrally).

**C. Pantry** (`PantryTable.jsx`'s `PantryCard`/table, `StorageBadge`, `ExpiryBadge`, `StatusLabel`,
`ActionButton`, `ItemOverflowMenu` — all from TASK-056): badges/rows via the now-semantic
`getExpiryBadgeClass`/`getExpiryRowClass`; `ActionButton` migrated to `.btn-primary`/`.btn-secondary`
depending on destructiveness (Edit/Mark Used/Freeze stay primary-filled per scaffold 03; Delete inside the
overflow menu becomes `.btn-text-danger`, consistent with the recipe-detail modal's plain-red "Delete"
text-link treatment in scaffold 05 — the one point of visual distinction the scaffolds actually draw
between ordinary and destructive actions).

**D. Recipes** (`RecipeCard.jsx`, `AddRecipeMenu.jsx`, `RecipeSuggestionCard.jsx`, `RecipeReviewModal.jsx`):
tag chips → `.badge-tag`; `RecipeCard.jsx`'s `SOURCE_BADGE` map's 5 entries migrate to the 5
`.badge-source-*` classes resolved in Section 7 (`upload`→`.badge-source-uploaded`,
`ai_suggested`→`.badge-source-ai`, `web_suggested`→`.badge-source-web`, `manual`→`.badge-source-manual`,
`url_import`→`.badge-source-url`) — existing label copy ("Uploaded," "AI Suggested," "From Web," "Manual,"
"Imported from URL") stays exactly as-is, only the styling changes; each variant also gets its icon
(camera, sparkle, globe, pencil, link-document respectively — hand-authored inline SVG, same approach as
Section 6, but shipped here in Phase 3 regardless of whether Section 6's broader optional icon phase
happens, since these 5 are required by the source-badge decision itself, not by that separate phase);
"Add Recipe" trigger and modal primary actions → `.btn-primary`; recipe-detail modal's photo-first layout
(scaffold 05) applied to the existing `RecipeModal.jsx` image slot (no change to the underlying
`recipe.imageUrl` fallback logic, Section 1).

**E. Chat** (`ChatPage.jsx`): user/assistant bubbles → `.chat-bubble-user`/`.chat-bubble-assistant`. **The
scaffolds' "Action Confirmed" chip is not included in this spec** — see Section 7 for why (the underlying
client-facing signal it would need doesn't exist yet for 3 of the 4 pantry-mutating tools). This is a
scope removal, not a deferred/conditional item.

**F. Shopping** (`ShoppingPage.jsx`): retint only (buttons, cards, list-item hover states). The mobile
layout bug itself (Section 1) is real but is **not fixed by this spec** — see Section 7 for why it's left
for a separate follow-up task instead.

**G. Household** (`HouseholdPage.jsx`): join-code box → `.card-callout`; allergy chips → `.chip-allergy`;
regular dietary/health chips → `.badge-tag`, same canonical treatment as Recipes' tag chips (Section 7
resolved the two scaffolds' conflicting tints in favor of the more visible Recipes value — no separate
Household-specific chip class).

**H. Landing** (`LandingPage.jsx`): hero heading in `text-primary`, CTA → `.btn-primary`, secondary "Log
in" → `.btn-secondary`, feature-list cards → `.card`.

**Not restyled by this spec — corrected on review, since the DRAFT-4 wording here was inaccurate:**
Clerk-hosted sign-in/sign-up (out of scope per the design README's own triage — restyling Clerk's theme is a
small, separate follow-up once the palette is finalized here) and simple CRUD modals (Add/Edit Item, Split
Quantity, New Shopping List, Add to List, Add Recipe to List, etc. — `AddItemModal.jsx`, `SplitItemModal.jsx`,
`BuildListModal.jsx`, `AddToListModal.jsx`, `AddRecipesModal.jsx`, `DietaryProfileForm.jsx`). **These
receive no migration in TASK-057 and do not automatically pick up the new classes** — DRAFT-4 claimed they
"inherit `.card`/`.btn`/`.input` automatically," which isn't how CSS classes work: a class only applies to
markup that references it by name, and none of these files are in this spec's Allowed Files. They keep
their current raw-Tailwind (`bg-orange-600`, etc.) styling and will visually clash with the migrated screens
around them — a real, accepted gap, not a hidden one (see Section 11) — until a future task (placeholder
name **TASK-060 — Mechanical Component Class Migration**, not drafted, named here on architect review so
this debt doesn't quietly disappear from planning, same shape as TASK-055's own mechanical-cleanup
precedent) adds them to an Allowed Files list and wires the existing shared classes into their markup.

---

## 5. Shopping Mobile Layout — Out of Scope for This Spec (see Section 7)

**Removed during architect review.** DRAFT-1 proposed fixing `ShoppingPage.jsx`'s real, code-confirmed
mobile-layout bug (Section 1) as this spec's own Phase 4, working from the design README's written
description of `04-shopping-mobile-fixed.png` since that scaffold file is itself a garbled, unusable
comparison artifact (not the clean mockup the README describes). That's a genuine bug and a genuine
scaffold defect, both correctly identified — but fixing it means picking a *navigation model* (a pill-tab
list switcher replacing the current sidebar-based list selector) and *layout structure* (a progress bar,
full-width checklist rows), which are interaction/IA decisions, not applications of the visual token/
component system this spec exists to build. Bundling them here would blur exactly the scope line TASK-055
and TASK-056 have each maintained.

**This spec now retints Shopping only** (Section 4F) and leaves the structural fix for a separate follow-up
— tentatively "TASK-058 — Shopping Mobile Layout," not drafted yet, to be written once TASK-057's tokens/
components exist for it to build on. The scaffold-defect finding and the two remediation options (regenerate
the one broken image vs. implement from the README's written description) remain valid input for whoever
specs that task — recorded in Section 7 rather than as this spec's own phase.

---

## 6. Icon System — Optional Phase, Not a Hard Requirement

**Not to be confused with the 5 source-badge icons (Section 4D, Section 7)** — those are a separate,
required, narrowly-scoped need (camera/sparkle/globe/pencil/link-document, exactly 5 icons for exactly one
component) created by the source-badge decision itself, and ship in Phase 3 regardless of what happens to
this section's broader, optional proposal. This section is about the app-wide emoji vocabulary
(💬🏠🥦📖🛒📷🚫📸🔗🔍✨❄️🧊🥫) TASK-056 already deferred once — a much larger, genuinely optional undertaking,
kept separate on purpose so approving one doesn't imply approving the other.

TASK-056 deferred replacing emoji-as-icons (its P2-1) as a large, high-diff change not worth bundling into
an effort-reduction spec. It resurfaces here because the scaffolds incidentally establish a small, working
line-icon vocabulary (the fork-and-plate logomark on `12-landing-mobile.png`, and 6 simple line icons for
the landing page's feature list) — meaning some of the design work this would need already exists as a
reference, lowering the cost relative to when TASK-056 shelved it.

**Recommendation: hand-authored inline `<svg>` icons, matching `Sidebar.jsx`'s existing hamburger-button
icon** (`Sidebar.jsx:137-149` is already a raw inline `<svg>`, not an emoji or a library import) — this
is precedent-consistent and adds no new npm dependency, keeping this spec's "no new dependencies" posture
(Constraints, below) intact. An icon library (e.g. a small, tree-shakeable set) is a viable alternative but is a
dependency-adding decision this spec doesn't make unilaterally — flagged for architect review if the
inline-SVG hand-authoring cost turns out larger than expected once scoped.

**Given the size of Sections 2-4 already, this is proposed as Phase 4 (Section 8) — genuinely optional,
splittable into its own follow-up task without blocking anything else in this spec**, exactly as TASK-056
treated it. Not a redesign blocker either way.

---

## 7. Resolved-During-Review Findings

**No Phase 0 architectural decisions remain open.** All four are closed — Section 8's Phase 0 checklist
reflects this. The two carried from DRAFT-2 are resolved below, alongside the two resolved earlier.

### Resolved — Recipe source badges

`RecipeCard.jsx`'s `SOURCE_BADGE` map's 5 distinct hues (blue/purple/orange/gray/teal) let a user
distinguish Uploaded vs AI Suggested vs Web vs Manual vs URL Import at a glance — a real information
signal, not decoration. Collapsing all 5 into one generic badge was ruled out for exactly that reason.
**Resolution: 5 named semantic classes (Section 3 — `.badge-source-ai`/`-uploaded`/`-web`/`-manual`/`-url`,
sharing a `.badge-source` base), with icon + label as the primary distinguishing mechanism and color
deliberately restrained to 2 visual tiers rather than 5 arbitrary hues:**

- `source-ai` keeps the one treatment a scaffold actually confirmed (05, 07 — solid `bg-primary`/
  `text-on-primary`), unchanged from DRAFT-3's single `.badge-source`.
- The other 4 — none of which have any scaffold evidence either way — share one identical neutral outline
  treatment (`border-border`/`text-ink-muted`/transparent), differentiated from each other only by icon
  (camera, globe, pencil, link-document respectively) and their existing label text.

This uses zero new primitives (only `primary`/`on-primary`/`border`/`ink-muted`, all already defined) and
deliberately avoids reusing this system's status/alarm colors (rose/gold/coral) for neutral metadata — that
would risk a user misreading a "Manual" recipe badge as some kind of warning, a real semantic collision the
5-arbitrary-hues framing doesn't surface but a 2-tier "AI vs. human-provided" framing avoids by construction.
Existing label copy ("Uploaded," "AI Suggested," "From Web," "Manual," "Imported from URL") is preserved
exactly — only the class names and, for 4 of 5, the addition of an icon change.

### Resolved — Tag-chip inconsistency

Recipes' tag chips (07, 09 — visible amber/tan, `#f5dfa0`) and Household's health-condition chips (10b —
much fainter near-white tan, `#f7f3e8`) sample as two different values for what the design README frames as
the same "tag chip" concept — read as an unintentional generation inconsistency, not a deliberate two-tier
design. **Resolution: one canonical treatment, `--kk-tan-100`, used uniformly by `.badge-tag` for both
Recipes and Household** (Section 3 already implemented this in DRAFT-2; the only change this round is
removing the "still open" framing that had fallen out of sync with the code) — a chip needs to be legible/
scannable in both contexts, and nothing in either scaffold's own notes suggests the two are meant to carry
different semantic weight. No `.badge-recipe-tag`/`.badge-household-tag` split is introduced.

### Resolved earlier — Shopping mobile layout

Moved out of this spec's scope entirely (Section 5) — the underlying bug is real and independently
confirmed (`ShoppingPage.jsx:94-96`, Section 1), but fixing it is an interaction/IA decision, not a visual-
token application. Recorded as input for a future, not-yet-drafted TASK-058: either regenerate the one
broken `04-shopping-mobile-fixed.png` scaffold or implement from the design README's written description
alone (pill-tab list switcher, progress bar, full-width checklist).

### Resolved earlier — Chat Action Confirmed

Removed from this spec entirely, not conditionally deferred (Section 4E) — `aiService.js`'s `chat()`
function (`server/services/aiService.js:949-1027`) only tracks `add_pantry_item` outcomes into the
`itemsAdded` array returned to the client; `update_pantry_item`/`remove_pantry_item`/`consume_pantry_item`
have no equivalent signal today. Implementing the chip for `add` only would be visibly inconsistent with the
scaffold's own example (shown on a *removal*), so it's out of scope entirely rather than partially built —
revisit only if the server-side signal is separately extended to the other 3 tools.

### Noted, not a decision — garbled scaffold text

`10b-household-mobile-fixed.png`'s garbled "Ginale-Preferred" chip (a known Gemini text-rendering flaw,
already called out in the design README) — cosmetic only, corrected to whatever the real dietary tag
should read during implementation, not copied verbatim. Recorded here only so it isn't rediscovered as a
"bug" later.

---

## 8. Phased Implementation Plan

### Phase 0 — Preflight decisions
Added on review: architectural decisions that must be *made*, not discovered mid-implementation. **All 4
are now closed** — none remain for implementation to improvise.
1. ~~Resolve status-color contrast~~ — **done**, Section 2.1 (`--kk-rose-800`/`--kk-gold-800`
   recomputed to clear 4.5:1 AA). `--kk-gray-400`→`--kk-gray-500` (`ink-subtle`) fixed the same way in
   DRAFT-3 after the same problem was found there during the DRAFT-2 review round.
2. ~~Resolve the Chat Action-Confirmed data-shape question~~ — **done**, Section 7 (signal
   doesn't exist for 3 of 4 mutating tools; chip removed from scope entirely).
3. ~~Decide the source-badge treatment~~ — **done**, Section 7: 5 named `.badge-source-*` classes
   (Section 3), icon + label as the primary distinguishing mechanism, color restrained to 2 tiers
   (AI-generated vs. human-provided) rather than 5 arbitrary hues — not color-alone, per the constraint
   DRAFT-2's review round added.
4. ~~Decide the tag-chip tint policy~~ — **done**, Section 7: one canonical `--kk-tan-100` treatment for
   both Recipes and Household via `.badge-tag`; no split classes.

### Phase 1 — Foundation
5. Add the primitive/semantic token layer to `index.css`/`tailwind.config.js` (Section 2).
6. Add `client/src/styles/components.css` with the shared component classes (Section 3); wire the
   `@import` at the **very first line** of `index.css` (Section 3 shows the exact, build-verified order —
   getting this wrong silently drops the entire file with no build error, confirmed during the DRAFT-2
   review round).
6a. **Build-verify before moving on:** run `npm run build` and confirm at least one class from
   `components.css` (wired into any single real call site is enough for this check) actually appears in the
   compiled output CSS — a direct repeat of the check already performed once during DRAFT-2's review
   (Section 3), done again here because that check was against temporary probe files, not the real
   implementation.
7. Migrate `getExpiryBadgeClass`/`getExpiryRowClass` (`utils/expiry.js`) to return the new class names.
8. **Hard gate, not a QA suggestion — methodology corrected on review.** For every `bg-status-*-bg`/
   `text-status-*-text` pairing and `bg-primary`/`text-on-primary`: open the built app, read each element's
   **computed CSS color values** (browser devtools' computed-styles panel, or `getComputedStyle`) — not a
   screenshot pixel sample — and run those resolved values through a WCAG contrast checker. This is a
   deliberate correction from an earlier draft's "against the rendered pixels" phrasing: per
   [W3C's own guidance](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html), anti-aliasing
   means on-screen pixels can read fainter than a color's actual defined value, so the normative check is
   against the resolved CSS, not a screenshot — confirmed by fetching that page directly during this
   review round, not assumed. This step still matters despite Section 2.1's math already being verified by
   hand twice: it catches a different class of bug (a config typo, an opacity modifier resolving wrong,
   `<alpha-value>` not substituting correctly) that hand-checking primitives on paper can't catch — it's
   confirming the build produced what Section 2.1 specifies, not re-deriving the math. Separately, a plain
   visual/screenshot pass remains worthwhile for things contrast math doesn't cover (thin border visibility,
   icon legibility, overall visual hierarchy) — but that's ordinary visual QA, not the WCAG gate itself. No
   phase after this one proceeds until every pairing passes.
9. No other visible screen changes required to land this phase beyond whatever picks up the badge-class
   change automatically (Pantry/Dashboard expiry pills) — this phase is infrastructure.

### Phase 2 — Highest-traffic screens
10. Sidebar/global layout (Section 4A).
11. Dashboard (Section 4B).
12. Pantry (Section 4C).
13. Chat (Section 4E) — bubbles only; no Action Confirmed chip (removed from scope, Section 7).

### Phase 3 — Remaining screens
14. Recipes (Section 4D) — executes Phase 0 item 3's already-resolved source-badge treatment; no design
    decision left to make here.
15. Shopping retint only (Section 4F) — no layout changes; the structural fix is a separate future task
    (Section 5).
16. Household (Section 4G) — executes Phase 0 item 4's already-resolved tag-chip treatment; no design
    decision left to make here.
17. Landing (Section 4H).

### Phase 4 — Optional, splittable into its own task
18. Icon system (Section 6) — emoji → inline-SVG line icons.

**Phases are dependency-ordered, not independently revertible** — a more accurate framing than DRAFT-1's
"each phase is independently shippable and independently revertible," corrected on review: Phase 1
establishes the token/class infrastructure every later phase's diff depends on, so reverting Phase 1 after
Phase 2 has shipped means reverting Phase 2 too. What *is* true, and worth keeping: each phase is
independently reviewable and independently shippable going forward — Connor can stop after any phase and
have a working, internally-consistent app, same discipline as TASK-056 — just not independently revertible
once a later phase builds on it.

---

## 9. Accessibility Considerations

- **Contrast is computed and provisionally resolved, but a live check against actual computed CSS values is
  still a hard Phase 1 gate (Section 8, Phase 1 item 8), not optional QA.** DRAFT-1's estimated
  `--kk-rose-800`/`--kk-gold-800` values were independently recomputed during architect review using the
  WCAG 2.1 relative-luminance formula and confirmed to fail 4.5:1 AA for normal text (≈3.45:1, ≈3.71:1);
  Section 2.1's replacement values (`#501a15`, `#5c4415`) compute to ≈5.17:1 and ≈5.35:1 against their
  respective backgrounds. Hand-computed sRGB math on the intended primitive values is a strong prior, not
  proof that the *build* actually produced those values — the Phase 1 gate reads each element's resolved
  CSS color (devtools' computed-styles panel, not a screenshot) to confirm the config/opacity-modifier
  wiring didn't introduce a different bug than the one already checked by hand. **Not** a screenshot pixel
  sample: per [W3C's own guidance](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html),
  confirmed by direct fetch during this review round, anti-aliasing means on-screen pixels can read fainter
  than a color's actual defined value, so pixel-sampling a rendered screenshot is the wrong methodology for
  this specific check — an earlier draft's "against the rendered pixels" wording conflated the two. This is
  new verification work the current raw-Tailwind classes (`bg-red-100 text-red-700`, etc.) already satisfy
  by virtue of being standard, well-tested Tailwind pairs — the new custom values need the same bar met
  explicitly.
- **`ink-subtle` had the same problem, found during the DRAFT-2 review round, and is fixed the same way.**
  DRAFT-2 claimed `--kk-gray-400` was "already-AA-tested" — true against a white background (Tailwind's own
  docs context) but not against this app's actual cream `surface` token: independently recomputed at
  ≈2.44:1, a genuine AA failure for `.input`'s placeholder text. Replaced with Tailwind's gray-500
  (≈4.64:1 against the same surface, passes). Because that one wrong claim was reason to distrust the rest
  of it, every other text/background pairing in the token system was re-audited in the same pass, not just
  the flagged one: `ink-muted` (gray-600) against both `surface` and `page` (≈7.25:1, ≈6.06:1),
  `status-ok-text` against `status-ok-bg` (≈7.86:1), `chip-allergy`'s `status-critical-text` against
  `accent-coral-bg` (≈8.93:1), `accent-tan-text` against `accent-tan-bg` (≈11.35:1), and the base
  `text-ink`-on-`bg-surface` pairing used everywhere by default (≈14.35:1) — all confirmed passing with
  large margins, no further changes needed.
- Preserve TASK-056's existing pattern of pairing color with text (`StatusLabel`, "Expiring soon" not just
  a colored dot) — this spec restyles colors, it doesn't remove the text labels that make them accessible.
- `.chip-allergy`'s higher-saturation coral (Section 2.1) should read as *more* visually urgent than a
  regular status-critical badge, consistent with "Safety Critical" allergy labeling already present in
  `HouseholdPage.jsx` — verify this ordering holds (allergy chip visually louder than expiry-critical badge)
  once both are on screen together, since they're now drawn from different-but-adjacent color families.
- No touch-target or keyboard-behavior changes are proposed here — TASK-056 already brought Pantry's action
  buttons and the disclosure-menu patterns up to WCAG 2.5.5/2.5.8; this spec only recolors/reclasses
  existing interactive elements, it doesn't resize or restructure them.

## 10. Responsive Behavior

No new breakpoints — this spec reuses `md`/`sm`/`lg` exactly as TASK-056 established. Verify Phase 2 and
Phase 3 screens at 375px / 768px / 1280px per the repo's Local Smoke Testing Protocol, same three widths
TASK-056 used, since token/class migration can change effective padding/line-height in ways a pure logic
change wouldn't (e.g. `.btn`'s `rounded-full` vs today's `rounded-lg`/`rounded-md` mix changes tap-target
visual weight even though the underlying padding is unchanged).

## 11. Risks

- **Simple CRUD modals and forms not in any phase's Allowed Files (Section 4) will visually clash with the
  migrated screens around them** — corrected on review from an earlier draft that incorrectly claimed they'd
  "automatically inherit" the new classes; a class only applies where it's actually referenced in markup,
  and none of these files are touched by this spec. `AddItemModal.jsx`, `SplitItemModal.jsx`,
  `BuildListModal.jsx`, `AddToListModal.jsx`, `AddRecipesModal.jsx`, and `DietaryProfileForm.jsx` will keep
  their current raw-orange styling after every phase ships — an accepted, visible gap, not a hidden one,
  left for a placeholder future task (**TASK-060 — Mechanical Component Class Migration**, not drafted;
  same shape as TASK-055's precedent) rather than expanding this spec's already-large diff further.
- **Phase 0's two design decisions (source-badge treatment, tag-chip tint) are now closed (Section 7)** —
  the residual risk is narrower than "decision not made": the 4 non-AI source-badge colors and their icons
  have zero scaffold evidence behind them (Section 7 says as much), so they're a reasoned design choice
  rather than a scaffold-derived one. Worth a quick visual sanity check once built (Phase 3), not a reason
  to reopen the decision itself.
- **Contrast verification (Section 9, Phase 1 item 8) is real, uncosted work, now a hard gate** — budget
  time for it before Phase 2 begins rather than discovering a failing pairing after several screens already
  depend on it.
- **This is a large diff across every page in the app** — unlike TASK-056 (6 files touched), a full token
  migration necessarily touches every file with a hardcoded color. Phasing (Section 8) exists specifically
  so each phase's diff stays reviewable, even though (per Section 8's corrected framing) phases are
  dependency-ordered rather than each independently revertible.
- **Removing the Shopping layout fix and the Action Confirmed chip narrows this spec's scope, on purpose**
  — both were genuine findings worth keeping on record (Section 7), but neither belongs in a visual-
  migration spec's own implementation phases. This is treated as a risk worth naming, not a loss: a
  narrower TASK-057 is easier to review and land correctly than a broader one that mixes concerns.

## 12. Component Ownership

Tokens (`index.css`'s `:root` block) and shared classes (`client/src/styles/components.css`) are owned
globally — every component is a consumer, none is an owner, matching how `shared/pantryCategories.js`
(TASK-055) and `RecipeSuggestionCard.jsx` (TASK-056) already establish "shared thing lives in one place,
screens import from it" as this codebase's standing convention.

**Answered explicitly on architect review, since it was raised as an open question:** is
`client/src/styles/components.css` meant to be the durable home for shared visual patterns even after this
spec ships, including if this codebase ever grows JSX component wrappers (a `Button.jsx`, `Card.jsx`, etc.
— none exist today, and this spec doesn't propose creating any)? **Yes — the CSS layer stays the source of
truth for the visual treatment.** If a future JSX wrapper is ever introduced for ergonomic reasons (e.g. a
`<Button variant="primary">` component), it should *compose* the existing `.btn-primary` class (render it
into `className`), not reimplement the styling as inline Tailwind utilities or a second parallel definition.
This keeps a single source of truth for "what a primary button looks like" regardless of whether it's
consumed as a bare class or wrapped in a component — the two systems can't drift apart if one always
delegates to the other. No such wrapper is being built now; this is a standing rule for if/when one is,
consistent with this spec's own "don't introduce abstractions ahead of actual need" discipline (Section 3).

## 13. Sources Cited

- [Tailwind CSS v3 — Customizing Colors (CSS variables + `<alpha-value>` opacity pattern)](https://v3.tailwindcss.com/docs/customizing-colors)
- [Tailwind CSS — Theme variables (v4 `@theme`, cited only to explain why a v4 migration isn't proposed)](https://tailwindcss.com/docs/theme)
- Design tokens two-layer (primitive/semantic) architecture — corroborated across multiple current
  (2026) sources returned by web search on this topic; no single canonical source, cited as a converged
  industry pattern rather than one author's opinion.
- [`ai/design/2026-08-gemini-redesign/README.md`](../design/2026-08-gemini-redesign/README.md) — the
  scaffold set this spec is built from.
- WCAG 2.1 relative-luminance/contrast-ratio formula (used to independently verify Section 2.1's status-
  color text values during architect review, not just cited abstractly) — standard formula, not tied to a
  single source; any WCAG 2.1 contrast reference documents the same calculation.
- This project's own `npm run build` (Vite 5.4.21 + Tailwind 3.4.3 + Autoprefixer, per
  [`client/postcss.config.js`](../../client/postcss.config.js)) — the actual authority Section 3's `@apply`/
  `@import` claims were checked against during the DRAFT-2 review round, not Tailwind's documentation read
  in isolation.
- [W3C — Understanding SC 1.4.11: Non-text Contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)
  — fetched directly during the DRAFT-4 review round (not taken on the review's citation alone) to confirm
  its explicit guidance that contrast should be evaluated from resolved CSS/markup color values, not
  rendered/anti-aliased screenshot pixels; corrected Sections 8/9 and the Acceptance Criteria/Verification
  Steps wording accordingly.

---

## Allowed Files

- `client/src/index.css` (new `:root` token block)
- `client/tailwind.config.js` (semantic color extension)
- `client/src/styles/components.css` (new file — shared component classes)
- Every file identified in Section 4 as part of a given phase (Sidebar, PageHeader, DashboardPage,
  ExpiryStrip, EatThisNow, QuickAdd, PantryTable/PantryCard, RecipeCard, AddRecipeMenu,
  RecipeSuggestionCard, RecipeReviewModal, RecipeModal, ChatPage, ShoppingPage + its sub-components,
  HouseholdPage, LandingPage)
- `client/src/utils/expiry.js` (badge/row class return values only — no logic change)
- `ai/handoffs/CONVENTIONS.md` (add the semantic-token-over-raw-hue convention note, Section 2.2)

## Forbidden Files

- **Anything under `server/`, unconditionally** — no exception, gated or otherwise. DRAFT-1 carried a
  conditional exception here pending the Chat Action-Confirmed data-shape investigation; that investigation
  is now resolved (Section 7) and the chip is out of scope entirely, so no server-side change of any kind
  is part of this spec.
- `shared/*` — no shared-module changes anticipated.
- Database/migration files — no schema changes; recipe photography reuses the existing `imageUrl` field
  as-is.

## Constraints

- No new npm dependencies — Section 6's icon system explicitly stays dependency-free (hand-authored inline
  SVG) for this reason; if a library alternative is ever chosen instead, that's a deviation requiring its
  own explicit approval, not something this spec pre-clears.
- No behavior/endpoint changes, anywhere, at all — no exceptions remain (see Forbidden Files above).
- No functionality removed.
- Existing Tailwind default palette remains available (`theme.extend`, not a full `theme.colors`
  override) — nothing outside this spec's scope is put at risk of breaking.

## Acceptance Criteria (draft — to firm up post-review)

- All semantic color tokens resolve correctly with opacity modifiers (e.g. `bg-primary/10` renders at 10%
  opacity, not solid or transparent) — verified in-browser, not just by config inspection.
- Every `bg-status-*`/`text-status-*` pairing and `bg-primary`/`text-on-primary` passes the WCAG AA
  criterion that actually applies to it: 4.5:1 for the pill/badge text itself (normal-sized text), 3:1
  only for non-text UI elements (e.g. a border or icon-only indicator with no text) — these are two
  different criteria for two different kinds of content, not interchangeable, and every pairing in this
  spec is text-bearing so the 4.5:1 bar is the one that actually governs here. Checked against each
  element's **resolved CSS color values** (devtools' computed-styles panel or `getComputedStyle`, per
  [W3C's non-text-contrast guidance](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html) on
  why a rendered screenshot's anti-aliased pixels are the wrong input for this calculation) — not assumed
  from the source scaffolds (visual references, not contrast-audited) and not assumed from the hand-computed
  primitive values in Section 2.1 alone, which this check exists to confirm the build actually produced.
- **Semantic ownership within touched scope, not repo-wide raw-hue elimination.** Repeated brand/status/
  component colors in a file a TASK-057 phase actually touches use the defined semantic token or shared
  component class (`bg-primary`, `.badge-status-critical`, etc.); a raw Tailwind hue class is acceptable
  only where no corresponding semantic token exists yet. Swapping `bg-orange-600` for `bg-green-800` (a raw
  hue for a raw hue) does not satisfy this criterion even though it matches the new palette — this is the
  acceptance bar the review specifically asked for, distinct from a purely visual match. **This criterion
  does not require zero `orange-*` anywhere in `client/src`** — files this spec doesn't touch (Section 4's
  "Not restyled by this spec" list, plus anything simply not listed in any phase) are explicitly out of
  scope and will still contain raw Tailwind hues after TASK-057 ships; that's an accepted, visible gap
  (Section 11), not a criterion failure. The `orange-*` grep below is a secondary mechanical check scoped
  to touched files only, not a repo-wide pass/fail gate.
- `getExpiryBadgeClass`/`getExpiryRowClass` callers render identically in structure/behavior, only the
  returned class names change — zero logic regression.
- `npm run lint` and `npm test` (root) remain clean after each phase.
- All 3 widths (375px/768px/1280px) show no horizontal overflow or broken layout introduced by the class
  migration itself, on every screen touched in that phase.

## Verification Steps

- Manual smoke test at 375px/768px/1280px per phase, per the repo's Local Smoke Testing Protocol.
- Contrast-check every new color pairing before Phase 2 begins (Section 9, Phase 1 item 8) — hard gate, not
  a suggestion, and read from each element's resolved CSS color values (devtools computed-styles panel),
  not a screenshot pixel sample, per the corrected methodology above.
- Per phase, confirm touched files satisfy the semantic-ownership acceptance criterion above (spot-check,
  not purely mechanical); `grep -r "orange-" <files touched by this phase>` afterward as a secondary,
  purely mechanical completeness check scoped to that phase's own file list — not a repo-wide sweep (files
  this spec doesn't touch are expected to still contain `orange-*`, per the Acceptance Criteria note above),
  and not itself proof the migration was done correctly on its own, just that nothing *intended* for this
  phase was missed.
- Confirm zero regressions in the existing test suite; confirm via `read_network_requests` during smoke
  testing that no endpoint, HTTP method, request payload semantics, or response handling changed —
  no exceptions remain, so nothing here should differ intentionally. (Not "byte-identical requests" —
  that's a stricter bar than a visual-only change needs to clear, and incidental differences like request
  timing or header ordering aren't regressions worth failing on.)
