# Kitchen Keeper UI Redesign — Gemini Scaffolds (2026-08)

AI-generated UI mockups produced with free-tier Gemini (Nano Banana 2), for the next agent to use as the
basis of a redesign spec (drafted per the usual TASK-XXX.md + GPT architect review workflow). These are
**visual/directional references, not pixel-accurate specs** — treat them as strong starting points for
layout, color, type, and component style, not as literal implementation targets. Flag any place a generated
image's copy or micro-content doesn't match real app data/behavior; it should be corrected in the spec, not
copied verbatim.

## Process

Produced via a 3-phase workflow (full writeup in [`ai/handoffs/CURRENT_STATE.md`](../../handoffs/CURRENT_STATE.md)
history and the standalone brief this was based on): (1) a text-only triage pass with Gemini to decide which
of the app's 18 screens + 31 modals actually warranted a generated mockup, given free-tier's ~20
generations/day cap; (2) one "anchor" generation (Dashboard, mobile) to establish the whole visual language;
(3) propagation — every subsequent generation reused the anchor's established style, attaching only that
screen's own current-app reference screenshot. All 11 kept images came from a single Gemini chat thread, so
they're internally consistent (same recipe — Sheet-Pan Lemon Chicken — even reused verbatim across three
different screens as a coherence check).

## Design system established

- **Name (unofficial, working title only):** "Modern Farmhouse"
- **Primary accent:** deep forest green
- **Surfaces:** warm cream / oat-beige neutrals (not stark white)
- **Type:** clean geometric sans-serif throughout (headers and body)
- **Corner radii:** soft, ~12–16px
- **Photography:** real food photography used liberally (pantry items, recipe hero images) — a deliberate
  departure from the current app's plain/iconography-only look
- **Status colors:** urgency pills (red = critical/expired, amber = urgent, green = fine) carried consistently
  across Dashboard, Pantry, and Recipe cards
- **Action-taking chat replies:** a green "ACTION CONFIRMED ✓" chip pattern distinguishes messages where the
  AI assistant actually modified the pantry vs. ones that only answered a question — this is a new UX pattern
  not present in the current app, worth carrying into the spec
- Explicitly **not** locked in — the current app's orange accent was deliberately dropped; nothing here is
  final brand direction, just Gemini's proposal reacted-to and approved across this session

## Files

| File | Screen/modal | Viewport | Notes |
|---|---|---|---|
| `01-dashboard-mobile-anchor.png` | Dashboard | Mobile | **The anchor** — every other image's style derives from this one |
| `02-chat-mobile.png` | Chat (home screen) | Mobile | Includes the new "ACTION CONFIRMED" chip pattern |
| `03-pantry-mobile.png` | Pantry | Mobile | Card-per-item layout; urgency pill system visible across mixed statuses |
| `04-shopping-mobile-fixed.png` | Shopping | Mobile | **Solves a real bug** — today's Shopping screen doesn't adapt to mobile at all (two-column desktop layout squeezed into cramped columns); this proposes a real fix: pill-tab list switcher + progress bar + full-width checklist |
| `05-recipe-detail-modal.png` | Recipe Detail (modal) | Mobile | Richest modal in the app — hero photo, stat row, checklist-style ingredients, numbered steps |
| `06-dashboard-desktop.png` | Dashboard | Desktop (1440px) | Establishes persistent sidebar nav + wide-layout adaptation |
| `07-recipes-grid-mobile.png` | Recipes list/grid | Mobile | Filter bar + single-column card stack |
| `08-scan-receipt-modal.png` | Scan a Receipt (modal) | Mobile | Empty/waiting-state drop-zone pattern — same pattern should be reused for the near-identical "Upload Recipe Image" modal, which was not separately generated |
| `09-review-extracted-recipe-modal.png` | Review Extracted Recipe (modal) | Mobile | Manual recipe editor; shown pre-filled with the Sheet-Pan Lemon Chicken recipe as a mid-edit example |
| `10b-household-mobile-fixed.png` | Household/Settings | Mobile | Second-pass version — first attempt had garbled body text under "Platform AI Settings" (a known Gemini weakness with dense small text); this version has real, legible copy. **Known minor flaw:** one dietary tag chip reads "Ginale-Preferred" (garbled) instead of a real tag — cosmetic, not fixed |
| `12-landing-mobile.png` | Landing page (logged out) | Mobile | Only screen intentionally given more marketing-page personality (hero photo, warmer copy) than the rest of the app |

## Not generated (explicit triage decisions, not oversights)

Per the Phase-1 triage, these were deliberately skipped as low-value for a first design pass — derive them
from the design system above rather than treating their absence as incomplete work:

- **Sign-in / Sign-up** — Clerk-hosted default theme; restyle with the new palette/buttons/radii, no new layout needed
- **Simple CRUD modals** (Add/Edit Item, Split Quantity, New Shopping List, Add to List, Add Recipe to List) —
  all reuse one shared modal-container pattern (see any of the generated modals above) with straightforward
  form inputs; low value to generate individually
- **Item overflow menu, tooltips, the 11-step onboarding tour, empty states (e.g. Blocked Recipes)** — small,
  derivable components once the core system is set
- **Pantry desktop table view** — mirror `03-pantry-mobile.png`'s data into a standard data table using
  `06-dashboard-desktop.png`'s sidebar/layout conventions
- **Upload Recipe Image modal** — near-identical to `08-scan-receipt-modal.png`; same drop-zone pattern, different label text

## Source references

Each generation was grounded in a real screenshot of the current app (captured directly from a running local
instance, one per screen/modal, at 375px mobile or 1440px desktop). Those reference screenshots were session-
local working files and are **not** committed to this repo — if the original reference set is needed again
(e.g. to regenerate a screen, or to compare against exactly what Gemini saw), re-capture screenshots from the
running app using the same screen/modal list in the table above; the current app's structure is unchanged
from what's live on `staging` as of this commit.
