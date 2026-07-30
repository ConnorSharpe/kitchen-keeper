# Task

TASK-049 implementation session: built `ai/tasks/TASK-049-spec.md` (DRAFT-3, approved) end to end —
blank-list creation, and the new add-recipe(s)-to-an-existing-list capability. **Implemented and
live-verified this session. Not yet committed** — working tree has the changes, no commit made (only
commit on explicit request, per session convention).

# Current Status

**Implementation complete, live-verified in the local dev environment, test data cleaned up. Awaiting
Connor's go-ahead to commit.**

## What was done this session

- Implemented exactly per the spec's Allowed Files list, no scope drift:
  - [shoppingService.js](../../server/services/shoppingService.js): extracted `aggregateIngredients` and
    `subtractPantry` out of `buildFromRecipes` as private helpers (no logic change — verified via a live
    2-recipe build, see below); added `subtractExistingListItems` (checked rows excluded from coverage,
    never mutates existing rows) and `addRecipesToList` per the spec's Design section 3, byte-matching the
    spec's own reference implementation for the tricky exclusion logic.
  - [shopping.js](../../server/routes/shopping.js): relaxed `buildSchema.recipeIds` to `.min(0).default([])`;
    added `POST /:id/add-recipes` with its own `.min(1)` schema and the same `not_found`/`invalid_recipes`
    status mapping used elsewhere in the file.
  - [useShopping.js](../../client/src/hooks/useShopping.js): added `addRecipesToList`.
  - New [RecipeSelectList.jsx](../../client/src/components/shopping/RecipeSelectList.jsx): extracted shared
    checkbox-list UI, used by both modals.
  - [BuildListModal.jsx](../../client/src/components/shopping/BuildListModal.jsx): recipe selection now
    optional, dynamic submit label (`Create List` / `Build List`), skips the result screen on a 0-recipe
    submit, retitled to "New Shopping List".
  - New [AddRecipesModal.jsx](../../client/src/components/shopping/AddRecipesModal.jsx): recipe picker
    reusing `RecipeSelectList`, "Add to List" submit, handles the 0-items-added case with dedicated copy.
  - [ShoppingPage.jsx](../../client/src/pages/ShoppingPage.jsx): "+ Add Recipe" button, `AddRecipesModal`
    wiring, `refreshKey` folded into `ShoppingList`'s existing `key`-triggers-refetch mechanism (no change
    to `ShoppingList.jsx` itself, per the spec's Forbidden Files), updated subtitle/empty-state copy.
- `npm run lint` clean on every changed/new file; `npm test --prefix server` — 82/82 passing (no
  shopping-service-specific tests exist in this repo to extend).
- Live-verified in the local dev environment (separate Neon branch from staging/prod — see
  [[feedback_dev_db_is_shared]]) against Connor's real local household data (2 saved recipes: "Lobster
  Pasta with Cream Sauce," "Caribbean Style Curry Cod"), using disposable test shopping lists deleted
  afterward via a direct `DELETE /api/shopping/:id` call (the UI's `window.confirm` didn't resolve
  through the automated browser tool, so cleanup went through the API instead of the confirm dialog).
  Confirmed live: blank-list creation with immediate no-result-screen landing (Verification Step 2);
  manual-add still works on a blank list (Step 3); the pre-extraction regression path (2 recipes sharing
  "garlic" at the same unit, 31 items, no crash, exact-match convention intact — Step 1, no live case
  existed in this household's 2 recipes for the unit-*mismatch* half of Step 1, covered instead by direct
  code inspection since the extraction is copy-only); a partial-overlap shortfall row (Butter 2 tbsps
  needed, 1 already on the list unchecked → new 1-tbsps row, original untouched — Step 5); **the
  architect-mandated checked-item-exclusion fix** — a checked "Garlic minced" row did not suppress a new
  recipe's need, a full new row was inserted and the checked row was left exactly as it was (Step 6, the
  highest-risk behavior in the whole spec); coverage correctly dropped 11 of 13 already-covered
  ingredients on a repeat add, only re-adding the two with no quantity (Salt, Pepper — confirms this is
  the spec's own intended `quantity !== null` guard, not a bug); both modals and the "+ Add Recipe" button
  render and remain usable at a 375px mobile viewport (Step 11). Steps 8/9 (cross-household/list-ownership
  guards) and Step 10 (sortOrder from the full existing set) were verified by direct code inspection
  against the spec's reference implementation rather than a live second-household test, since they
  mechanically match the exact pattern every other `:id` route in this file already uses.

# Decisions Made

- No implementation decisions diverged from the approved spec — implemented as designed, including the
  parts the spec was most explicit about getting right (D-2's checked/unchecked split, D-6's private
  helper extraction).

# Known Risks

- **Not yet committed.** Working tree has all seven Allowed Files changes; nothing pushed or committed
  this session — only commit on Connor's explicit request.
- Carried forward, unrelated to this session: OpenAI billing confirmation and Clerk sign-up hardening
  from the public-AI-access fix — see [[project_go_public_readiness]].

# Context Notes

- branch: `staging`.
- Dev servers were started via the project's `.claude/launch.json` configs (`server` on 3001, `client` on
  5183) — a stale `node index.js` from an earlier, uncleaned session was occupying port 3001 and was
  stopped first so the new code was actually what got exercised.

# Recommended Next Action

1. Review the diff, then let Claude know if/when to commit — no commit was made this session per the
   commit-only-on-request convention.
2. Unrelated carry-forward, not blocking TASK-049: OpenAI billing confirmation and Clerk sign-up hardening
   are still open per [[project_go_public_readiness]].

---

# Prior Handoff (TASK-049 spec-drafting session, now superseded above)

Spec-drafting session for `ai/tasks/TASK-049-spec.md`: let a user create a shopping list from scratch (no
recipe required), preserve the existing start-from-recipe flow, and add a new capability — add saved
recipe(s) to a list that already exists, inserting only the ingredients the household doesn't already
have. Read the full existing shopping/recipe/pantry code path before designing anything, researched and
deliberately declined fuzzy ingredient matching and automatic unit conversion in favor of extending the
app's existing exact-match convention (see the spec's Research section for sources), then went through two
rounds of GPT architect review (9.7/10 → 10/10 APPROVED). Round 1's one required change —
`subtractExistingListItems` must only treat **unchecked** existing rows as coverage, since `toggleItem`
never writes to `pantryItems` and a checked row can go stale — was verified directly against the code
before being accepted, not taken on the review's authority alone. No code was written in that session,
only the spec — implemented, live-verified, and documented in the session described above.

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
