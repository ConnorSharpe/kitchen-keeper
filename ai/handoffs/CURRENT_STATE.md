# Task

Spec-drafting session for `ai/tasks/TASK-048-spec.md` — a public landing page shown to signed-out
visitors at `/`, describing the app's purpose with "Create account" and "Log in" buttons. Connor asked
for this directly (no prior bug report/investigation trigger) as part of the app's ongoing move toward
being publicly reachable (see TASK-037). **Spec only — DRAFT-3, APPROVED FOR IMPLEMENTATION after two
rounds of GPT architect review (9.7/10 → 10/10). No code written yet this session.**

# Current Status

**Spec: APPROVED. Implementation: NOT STARTED.** This session did research + spec drafting only, per
[[feedback_spec_workflow]] — draft, then external GPT architect review rounds, then implement in a
(possibly later) session. Both review rounds are recorded directly in the spec file's Architect Review
History table; nothing further is pending on the spec itself.

## What was done this session

- Read `AI_Dev_Agent_Efficiency_Guide_v3_addendum.md` (Connor's attached context-management guide) — not
  materially relevant to this task (it's about agent context/token budgeting, not app features), so it
  didn't shape the spec beyond confirming there was nothing applicable to apply.
- Read the current codebase to establish ground truth before designing anything: `client/src/App.jsx`
  (routing + the existing `PrivateRoute`), `client/src/pages/JoinPage.jsx` (the one existing precedent for
  a route reachable while signed out), `client/src/components/layout/AppLayout.jsx`/`Sidebar.jsx` (the
  authenticated shell `ChatPage` depends on), `README.md` (source of truth for the landing page's copy —
  deliberately not inventing new marketing language), `client/index.html` (confirmed no `<meta
  description>` exists today), and `client/package.json` (confirmed `@clerk/clerk-react@^5.61.8` — the
  plain SPA package, not `@clerk/react-router`, which matters because some 2026 web results describe a
  newer `<Show>`-component pattern that doesn't apply to this app's actual installed package).
- **Read the installed Clerk source directly** (`client/node_modules/@clerk/clerk-react/dist/index.js`)
  rather than trusting docs, to settle whether `SignedIn`/`SignedOut` can flash the wrong state during
  Clerk's initial load: confirmed `SignedIn` requires a truthy `userId`, `SignedOut` requires `userId ===
  null` (strict), and `userId` is `undefined` (neither truthy nor `null`) until Clerk actually resolves —
  so both components render nothing during that gap. This proved a manual `isLoaded` gate is unnecessary
  for this task, which the DRAFT-1 architect review round explicitly praised as stronger than "I think
  Clerk handles this."
- Drafted DRAFT-1 of `ai/tasks/TASK-048-spec.md`, sent it through two rounds of external GPT architect
  review, and updated the spec in response to each round (see the spec's own Architect Review History table
  for full detail — not duplicated here).
  - **Round 1** required one architectural change: `PrivateRoute` (the routing component that gates all six
    private paths) should not hardcode an import of the new `LandingPage` — that conflates "gate private
    content" with "know about the marketing homepage." The reviewer's own suggested fix (a standalone
    `RootPage` route sitting outside `AppLayout` entirely) was evaluated and **declined with reasoning**:
    `ChatPage` isn't self-contained — it depends on `AppLayout`'s `<Outlet/>` for `Sidebar`,
    `PantryProvider`, `OnboardingGate`, and shared `mobileNavOpen` context, so pulling `/` out to a fully
    separate route would force either a second `AppLayout` mount (a real regression: `PantryProvider`,
    and therefore pantry data, would refetch on every nav between `/` and any other private page) or
    changes to `AppLayout` itself to support two mounting styles. Adopted the underlying principle a
    different way instead: `PrivateRoute` now takes the signed-out root's element as a `publicHomeElement`
    prop from `App.jsx`'s route definitions, rather than hardcoding it.
  - **Round 2**: 10/10, approved outright, confirming the round-1 revision was the right call and that the
    declined `RootPage` alternative was correctly declined given the codebase constraint. One
    non-blocking, non-actioned observation for future reference: if more public/authenticated route
    carve-outs are ever needed beyond this single `/` case, revisit whether `publicHomeElement` is still
    the right abstraction — not relevant today with only one carve-out.
- Updated this file (the handoff you're reading) and committed both to `staging`.

## Design the spec settled on (for the next agent to implement — not yet written to code)

- `client/src/pages/LandingPage.jsx` (new): a single static page, copy drawn from `README.md`'s existing
  description/feature list, with `<Link>`s to `/sign-up` and `/sign-in` (not Clerk's modal-triggering
  buttons — this app already committed to path-based auth routing). Must never import `AppLayout` or
  `PantryProvider` — an explicit, spec-documented invariant, not just an implied side effect.
- `client/src/App.jsx`: `PrivateRoute` gains an optional `publicHomeElement` prop; when signed out and
  `location.pathname === '/'`, it renders that element instead of `RedirectToSignIn`. The one route usage
  that wraps `AppLayout` passes `publicHomeElement={<LandingPage />}`. No other route, and no other file,
  changes.
- `client/index.html`: one new `<meta name="description">` tag — purely additive.

Full code (not just a description) for all three changes is already written out in the spec's Design
section — the next agent should be able to implement directly from
[`ai/tasks/TASK-048-spec.md`](../tasks/TASK-048-spec.md) without re-deriving the design.

# Decisions Made

- Spec-then-review-then-implement, not implement-directly — per [[feedback_spec_workflow]] and since this
  touches the app's root routing/auth-gating path, exactly the kind of change worth a second opinion before
  code exists.
- Declined the architect review's literal `RootPage` restructuring suggestion (round 1) with a concrete,
  codebase-specific counter-argument (`AppLayout`/`PantryProvider`/`Outlet` coupling) rather than accepting
  it at face value — the reviewer agreed with this reasoning in round 2 rather than pushing back further.
- Did not implement any code this session — Connor's request was specifically to draft and review the
  spec, then hand off; implementation is explicitly the next agent's job.

# Known Risks

Carried from the spec (all still accurate, see `ai/tasks/TASK-048-spec.md`'s own Known Risks section for
full detail):

- SPA client-side rendering means non-JS crawlers won't see the landing copy on first paint — accepted for
  v1, not solved (would need SSR/prerendering, out of scope).
- `PrivateRoute` is shared code gating five other private paths besides `/` — the implementer must verify
  (spec's Verification Steps #4) that signed-out deep links to `/dashboard`, `/pantry`, `/recipes`,
  `/shopping`, `/household` still hard-redirect to sign-in exactly as today; a mistake in the
  `publicHomeElement`/`pathname === '/'` check would silently make more than just the root path public.

# Context Notes

- branch: `staging`.
- worktree: none.
- No dev servers were started this session — this was a research/spec-drafting session, no code to
  preview.
- **Unrelated pre-existing uncommitted work still sits in the working tree** and was deliberately left
  untouched by this session's commit (scoped to just the spec + this handoff, per Connor's explicit "commit
  the docs" instruction): `ai/tasks/TASK-047-spec.md` and its full implementation (`server/db/schema.js`,
  `server/db/migrations/0020_suggestions.sql` + journal entry, `server/services/suggestionService.js`,
  `server/routes/suggestions.js`, `server/app.js`, `client/src/components/dashboard/SuggestionBox.jsx`,
  `client/src/pages/DashboardPage.jsx`) — per the prior handoff below, this was implemented and
  live-verified in an earlier session but is **still awaiting Connor's review before it's committed**. Also
  still present: `.claude/settings.local.json`'s pre-existing local diff (carried uncommitted since
  TASK-040, per every handoff since). None of this is TASK-048's concern — noted here only so the next
  agent doesn't mistake it for something this session touched or that needs cleaning up as part of
  TASK-048.

# Recommended Next Action

1. Implement `ai/tasks/TASK-048-spec.md` (DRAFT-3, APPROVED FOR IMPLEMENTATION) verbatim — all three file
   changes are fully specified with code in the spec's Design section.
2. Live-verify against local dev per the spec's own Verification Steps (8 steps: signed-out landing render,
   sign-up flow, sign-in flow, deep-link regression check on the five other private paths, no
   signed-in flash, responsive check, meta tag present, keyboard/accessibility check).
3. Leave the TASK-047 suggestion-box work (see Context Notes above) alone unless Connor separately asks for
   it — it's a different, already-implemented, already-reviewed-by-architect feature waiting on Connor's
   own diff review, not this task's responsibility.

---

# Prior Handoff (TASK-047 implementation session, now superseded above)

Implementation session for `ai/tasks/TASK-047-spec.md` — private, owner-only "Suggest an Improvement"
feedback box on the Dashboard. The spec went through two rounds of GPT architect review (9.6/10 →
9.9/10 APPROVED) before implementation, plus two scope questions resolved directly with Connor before
drafting (no read UI — DB-only; fire-and-forget submitter UX). **Implemented and live-verified that
session; still not committed/pushed as of this handoff** — left for Connor to review the diff before it
lands on `staging`. Full detail (files created/changed, verification performed, test data left in the
shared DB) is preserved in git history of this file as of the TASK-047 session — see that commit if ever
needed again, not duplicated here to keep this handoff from growing unbounded.

# Prior-Prior Handoff (TASK-046 implementation session)

Fixed two pre-existing onboarding-tour completion bugs (`StaplesChecklist` not appearing after the last
step; desktop tour sometimes not starting), both root-caused via `driver.js`'s bundled source and fixed
in `client/src/components/onboarding/productTour.js` (a `finished` idempotency guard called before
`driverObj.destroy()` at all five end-of-tour call sites, and swapping a `requestAnimationFrame` gate for
a plain `setTimeout`). Live-verified, committed and pushed to `staging` and fast-forwarded to `main`
(production). Full detail in git history / the TASK-046 spec if ever needed again.
