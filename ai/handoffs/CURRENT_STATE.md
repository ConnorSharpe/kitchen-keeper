# Task

Spec-drafting session for `ai/tasks/TASK-049-spec.md`: let a user create a shopping list from scratch
(no recipe required), preserve the existing start-from-recipe flow, and add a new capability — add saved
recipe(s) to a list that already exists, inserting only the ingredients the household doesn't already
have. **Spec is fully approved (two rounds of GPT architect review, 9.7/10 → 10/10). Implementation has
NOT started this session** — no code was written, only the spec.

# Current Status

**DRAFT-3, APPROVED FOR IMPLEMENTATION. No code changes yet — next session should implement directly
against the spec.**

## What was done this session

- Read the full existing shopping/recipe/pantry code path before designing anything: `buildFromRecipes`
  ([shoppingService.js](../../server/services/shoppingService.js)) already does recipe-ingredient
  aggregation + pantry cross-referencing for a *fresh* list; the only creation path today requires
  `recipeIds.min(1)`; `addManualItem` already lets a user add one item at a time to an *existing* list
  with no dedup; no recipe→shopping-list UI exists outside the Shopping page.
- Researched 2026 practice on ingredient-name matching (fuzzy/Levenshtein) and unit conversion libraries
  before deciding what to extend — deliberately declined both in favor of extending the app's existing
  exact-match convention, since fuzzy matching risks wrong auto-merges and unit conversion needs a
  per-ingredient density table this app doesn't have. See the spec's Research section for sources.
- Drafted DRAFT-1: blank lists via `recipeIds: []` on the existing build endpoint (no new endpoint), a
  new `POST /:id/add-recipes` endpoint reusing extracted `aggregateIngredients`/`subtractPantry` helpers
  plus a new `subtractExistingListItems` pass, never mutating pre-existing list rows.
- Architect review round 1 (9.7/10): required one change — `subtractExistingListItems` must only treat
  **unchecked** existing rows as coverage. Verified the reasoning against the actual code before accepting
  it, not on the review's authority alone: `toggleItem` only flips `isChecked` and never writes to
  `pantryItems`, so a checked row can go stale (already used up since a prior trip) on a list the
  household hasn't cleared — letting it silently suppress a new recipe's real ingredient need would be a
  correctness bug. Applied the fix (DRAFT-2), added a dedicated verification step for it.
- Architect review round 2 (10/10, approved): confirmed the fix and its "pantry = inventory, shopping
  list = purchasing workflow" framing. One non-blocking observation (in-place mutation in the new helper,
  consistent with the existing pattern) documented as D-7 rather than acted on. Folded the review's
  implementation-risk checklist into a new "Implementation Notes" section in the spec so it reaches
  whoever implements this next, not just the review history table.

# Decisions Made

- Blank-list creation reuses `POST /api/shopping/build` with `recipeIds: []` rather than a second create
  endpoint — the existing service function already produces a correct empty list for a zero-recipe call
  with no logic change, confirmed by reading it.
- No fuzzy ingredient matching, no automatic unit conversion, no schema change (no `sourceRecipeId`
  provenance column) — all explicitly scoped out, see the spec's Decisions/Out of Scope sections.
- Existing-list coverage checking only consults **unchecked** rows and never mutates any existing row
  (checked or unchecked) — inserts a fresh row for the shortfall instead. Two independent invariants,
  kept separate in the spec (D-2) after architect review round 1 split them apart for future-maintenance
  clarity.
- `aggregateIngredients`, `subtractPantry`, `subtractExistingListItems` are private, unexported helpers
  inside `shoppingService.js` — not a general-purpose utility surface.

# Known Risks

- **None new from this session** — no code was written, so no new runtime risk. The spec's own Known
  Risks section (extraction-regression risk on `buildFromRecipes`, doubled exact-match brittleness,
  intentional same-name duplicate rows after a partial-overlap add) applies once implementation starts.
- Carried forward, unrelated to this session, still open: OpenAI billing confirmation and Clerk sign-up
  hardening from the public-AI-access fix (see [[project_go_public_readiness]] — not re-detailed here,
  tracked in memory since it's still accurate and this session didn't touch it).

# Context Notes

- branch: `staging`.
- No dev servers were started this session — this was pure spec drafting (reading code + one round of web
  research + two rounds of architect review), no UI to preview yet since nothing was implemented.

# Recommended Next Action

1. **Implement `ai/tasks/TASK-049-spec.md` directly** — it's fully approved, DRAFT-3. Follow its Allowed
   Files / Forbidden Files sections exactly, and pay particular attention to the four points in its new
   Implementation Notes section (byte-identical `buildFromRecipes` extraction, `sortOrder` using the full
   existing-item set not the unchecked subset, filtering checked rows before building the coverage map,
   and confirming the `refreshKey` remount actually surfaces new items in the UI).
2. Run the spec's own Verification Steps (11 of them) before considering this done — Step 6 in particular
   exercises the round-1 architect fix and must not be skipped.
3. Unrelated carry-forward, not blocking TASK-049: OpenAI billing confirmation and Clerk sign-up hardening
   are still open per [[project_go_public_readiness]] — worth surfacing to Connor if this session has
   spare time, but not part of this task.

---

# Prior Handoff (Production AI chat 403 fix for new public sign-ups)

Production support investigation, no prior spec: Connor's father John Sharpe signed up as a real public
user and hit a 403 on in-app AI chat. Traced through `ChatPage.jsx` → `api/index.js` → `routes/ai.js` →
`resolveProvider.js`'s `NoApiKeyError`, then confirmed directly against the live production DB
(read-only first) that his household was owned by a different Clerk user, had no BYOK OpenAI key, and
`platform_settings.public_ai_access_enabled` was `false` — reproducing the symptom deterministically.
This is the still-open TASK-037/[[project_go_public_readiness]] risk: public sign-ups have no working AI
path without either a BYOK key or the platform toggle, and neither Clerk hardening nor OpenAI prepaid
billing were ever confirmed before TASK-048 shipped a public landing page inviting exactly this kind of
sign-up. Asked Connor rather than assuming which fix to apply; he chose the global toggle. Applied
`public_ai_access_enabled = true` directly to production via SQL, after verifying (by diffing Neon
hostnames, not trusting a `vercel env pull` that came back blank) the write hit the correct DB. Also
corrected this file's own stale status at the time — TASK-048 and TASK-047 were already implemented and
committed (`7506748`, `f9eed51`) despite this file previously describing them as not yet done. **Biggest
open carry-forward**: OpenAI prepaid billing / auto-recharge-off was never confirmed set up, and public
AI access is now live in production — see [[project_go_public_readiness]]. Full detail in git history at
commit `561d0da` if ever needed again.

# Prior-Prior Handoff (TASK-048 spec + implementation, now superseded above)

Spec-drafting session for `ai/tasks/TASK-048-spec.md` — a public landing page shown to signed-out visitors
at `/`, with "Create account" and "Log in" buttons, per two rounds of GPT architect review (9.7/10 →
10/10). Design: `client/src/pages/LandingPage.jsx` (new, static, copy from README, links to `/sign-up` /
`/sign-in`, never imports `AppLayout`/`PantryProvider`); `client/src/App.jsx`'s `PrivateRoute` gained an
optional `publicHomeElement` prop rather than hardcoding the landing page import; one additive `<meta
name="description">` in `client/index.html`. Declined the architect's suggested `RootPage` restructuring
with a concrete codebase-specific counter-argument (`AppLayout`/`PantryProvider`/`Outlet` coupling) — agreed
correct in round 2. **Implemented and committed in a later session (`7506748`)** — this file previously
described it as not-yet-implemented; that was stale as of the correction above. Full design detail
preserved in `ai/tasks/TASK-048-spec.md` and this file's git history as of the spec-approval commit
(`96c671e`) if ever needed again.

# Prior-Prior-Prior Handoff (TASK-047 implementation session)

Private, owner-only "Suggest an Improvement" feedback box on the Dashboard. Two rounds of GPT architect
review (9.6/10 → 9.9/10 APPROVED) before implementation, plus two scope questions resolved directly with
Connor (no read UI — DB-only; fire-and-forget submitter UX). **Implemented, live-verified, and committed in
a later session (`f9eed51`)** — this file previously described it as awaiting Connor's review before
commit; that was stale as of the correction above. Full detail in git history as of the TASK-047
implementation session if ever needed again.
