# Task

TASK-057 spec-drafting session: drafted and revised `ai/tasks/TASK-057-spec.md` through five architect
review rounds — **now DRAFT-6, APPROVED FOR IMPLEMENTATION (pending Connor's own final sign-off)** — a
visual design-system migration spec ("Modern Farmhouse") turning the 11 Gemini-generated scaffolds in
`ai/design/2026-08-gemini-redesign/` into a concrete, reusable token + component-class architecture. No
implementation code written this session. One real-build investigation was run directly against this
project's toolchain during round 2, fully reverted (`git status` confirmed clean after).

# What was done this session

**DRAFT-1 → DRAFT-4 (rounds 1-3, 8.6 → 9.2 → 9.7 → 9.8):** built the primitive→semantic→shared-class→
screen architecture from scratch against the codebase's actual state (zero design tokens; `orange-*`
hardcoded across 29 files) and the scaffold PNGs (pixel-sampled with Python/PIL, not eyeballed). Every
required review change across these rounds was resolved outright, several via direct empirical
verification rather than argument: recomputed and replaced 2 failing contrast values; removed Shopping's
mobile layout redesign from scope (→ future TASK-058, not drafted); traced Chat's "Action Confirmed"
feature into the real server code and removed it after finding its required signal missing for 3 of 4
tools; ran a real `npm run build` to test a reviewer's specific `@apply` claim (found wrong) and discovered
a more serious `@import`-ordering bug in the process (fixed); closed both Phase 0 decisions (5-variant
source badges with a restrained 2-tier color split; unified tag-chip tint) with concrete values, not
placeholders. Full per-round detail: the spec's own Architect Review History table.

**Review round 4 → DRAFT-5 (9.9/10):** 2 required changes, both real bugs in the spec's *prose*, not the
architecture: (1) DRAFT-4 falsely claimed untouched CRUD modals would "automatically inherit" the new
shared classes — fixed by stating plainly that `AddItemModal.jsx`/`SplitItemModal.jsx`/`BuildListModal.jsx`/
`AddToListModal.jsx`/`AddRecipesModal.jsx`/`DietaryProfileForm.jsx` get no migration in this spec and will
visibly clash with the rest of the app until a future task. (2) The contrast-check wording said "against
rendered pixels" — fetched the cited W3C non-text-contrast page directly (not trusted on citation alone),
confirmed it says contrast should be evaluated from resolved CSS values, not anti-aliased screenshot pixels;
reworded 4 sections accordingly.

**Review round 5 → DRAFT-6, this round (9.9/10 → APPROVED):** the review called this "the strongest spec in
the TASK-05x series" and required only one small clarification, applied along with 3 non-blocking
recommendations:
- Added an explicit rule that `.btn` is an internal CSS composition primitive, never consumed bare in JSX —
  only `.btn-primary`/`.btn-secondary`/etc. are valid call-site classes (Section 3).
- Added design-token governance comments to the token file itself (Section 2.1) — 3 rules (components
  consume semantic tokens only, never primitives directly; screens never introduce new raw colors).
- **Declined** the suggestion to rename `surface`/`page` to a more scalable vocabulary — the review's own
  text explicitly said not to unless a broader vocabulary is actually needed, which it isn't yet.
- Named the CRUD-modal gap's future task as a placeholder so it doesn't disappear from planning — **caught a
  self-inflicted naming collision while doing this**: DRAFT-2's own review history had already informally
  floated "TASK-059" for an unrelated future task (the icon-system follow-up); used **TASK-060** instead and
  documented why, so a future reader doesn't find two different tasks both informally called "TASK-059."
- Answered an open question the review raised rather than leaving it implicit: `components.css` stays the
  source of truth for shared visual patterns even if JSX component wrappers are introduced later; any future
  wrapper composes the existing classes rather than reimplementing styling (Section 12).

# Files Modified

- `ai/tasks/TASK-057-spec.md` (DRAFT-1 → DRAFT-6 across 5 review rounds; now APPROVED)
- `ai/handoffs/CURRENT_STATE.md` (this file)
- `ai/handoffs/archive/TASK-056.md` (created early in the session, unchanged since)
- **Not modified, net of cleanup:** `client/src/index.css`, `client/tailwind.config.js`,
  `client/src/styles/` — touched temporarily for round 2's build investigation, fully reverted.

# Decisions Made

- Caught and fixed a naming collision in my own review-history table (TASK-059 informally used for two
  different things across rounds) before it could confuse a future implementation session — worth noting
  since it's the kind of small consistency bug that's easy to introduce while iterating across many rounds.
- Declined a reviewer suggestion for the first time this spec's history for a clean reason (the review
  itself said not to apply it) rather than reflexively applying every suggestion — consistent with the
  "critically assess before applying" discipline maintained across all 5 rounds.

# Remaining Work

1. **Spec is architect-approved.** Awaiting Connor's own explicit go-ahead before an implementation session
   starts, per this repo's standing convention (spec approval and implementation are separate sessions).
2. TASK-058 (Shopping mobile layout) and TASK-060 (mechanical CRUD-modal class migration) are both named as
   placeholders in TASK-057-spec.md but neither is drafted yet.
3. Phase 0 of TASK-057 is fully closed — an implementation session can start directly at Phase 1 (Section 8)
   once Connor gives the go-ahead.

# Known Risks / Open Questions

- None remaining in the spec itself. The CRUD-modal visual gap and the Shopping mobile-layout gap are both
  known, accepted, and explicitly documented limitations with named future tasks, not open questions.
- Carried forward, unrelated to this task: TASK-054's `consume_pantry_item`-on-truncated-item gap; TASK-053's
  Vercel Preview streaming verification; OpenAI billing confirmation; `server/.env.vercel`'s fate; the two
  outstanding Manual Developer Actions (root `.env` deletion, `server/.env.local` cleanup) from TASK-055;
  TASK-056's own carried-forward Pantry-overflow-menu judgment call — see
  [archive/TASK-056.md](archive/TASK-056.md), [archive/TASK-055.md](archive/TASK-055.md), and
  [[project_go_public_readiness]].

# Recommended Next Action

Confirm with Connor that implementation should begin, then start a fresh session at TASK-057-spec.md's
Phase 1 (Section 8) — Phase 0's decisions are all closed, nothing blocks starting there directly.

# Context Notes

- branch: `staging`.
- No dev servers were started this round.
- No worktree was used.

---

## Archived History

- TASK-047 through TASK-053 (spec-drafting + TASK-053 streaming implementation session): see
  [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054 (chat context-size cap implementation session): see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055 (post-audit hardening implementation session): see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056 (UI/UX effort-reduction redesign implementation session): see
  [archive/TASK-056.md](archive/TASK-056.md)
