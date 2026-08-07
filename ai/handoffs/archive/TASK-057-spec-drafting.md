# Task

TASK-057 spec-drafting session: drafted and revised `ai/tasks/TASK-057-spec.md` through five architect
review rounds to DRAFT-6, APPROVED FOR IMPLEMENTATION. No implementation code written this session. One
real-build investigation was run directly against this project's toolchain during round 2, fully reverted.

# What was done this session

DRAFT-1 → DRAFT-6 built the primitive→semantic→shared-class→screen migration architecture from scratch
against the codebase's actual state (zero design tokens; `orange-*` hardcoded across 29 files) and the
scaffold PNGs (pixel-sampled with Python/PIL). Closed both Phase 0 decisions (status-color contrast,
source-badge treatment, tag-chip tint) with concrete values. Removed Shopping mobile layout redesign and
Chat's "Action Confirmed" chip from scope (deferred to future tasks). Full detail: the spec's own Architect
Review History table in `ai/tasks/TASK-057-spec.md`.

# Decisions Made

- 5 named `.badge-source-*` classes for recipe source badges, icon+label primary, color restrained to 2
  tiers (AI vs. human-provided).
- One canonical `.badge-tag` tint for both Recipes and Household chips.
- CRUD modals (AddItemModal, SplitItemModal, BuildListModal, AddToListModal, AddRecipesModal,
  DietaryProfileForm) explicitly out of scope — named future task TASK-060.

# Remaining Work (at end of this session)

Spec was architect-approved, awaiting Connor's explicit go-ahead to start implementation — see the
implementation session's handoff in the live CURRENT_STATE.md for what happened next.
