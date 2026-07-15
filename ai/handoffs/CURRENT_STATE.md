# Task
TASK-027 — Shopping List Item Edit & Delete. Implemented and manually verified this session.

# Current Status
TASK-027 is **DONE**. Added per-item PATCH (edit) and DELETE endpoints to the shopping-list API, plus inline edit/delete affordances on each `ItemRow` in `ShoppingList.jsx`. Verified end-to-end in a live browser session against a real (test) list and item — not just code review. TASK-028 through TASK-033 remain approved-but-unbuilt, unchanged from last handoff.

# Files Modified
- `server/services/shoppingService.js` — added `updateItem()` and `deleteItem()`, copying `toggleItem()`'s two-step ownership-check pattern exactly.
- `server/routes/shopping.js` — added `PATCH /:id/items/:itemId` (validated via `manualItemSchema.partial()`) and `DELETE /:id/items/:itemId`.
- `client/src/components/shopping/ShoppingList.jsx` — added single-`editingId` inline edit form (Enter saves, Escape cancels) and a delete button per row, reusing the existing add-item form's field layout and client-side empty-string normalization.

# Files Required Next
- None for TASK-027 (closed out). For TASK-028/029: `server/services/aiService.js` or wherever `parseReceipt()` lives (spec-only prompt changes, not yet located this session).

# Files Already Reviewed
- `server/services/shoppingService.js`, `server/routes/shopping.js`, `server/middleware/validate.js`, `client/src/components/shopping/ShoppingList.jsx`, `client/src/api/index.js`, `server/services/pantryService.js` (merge-semantics reference).

# Dependency Chain

Editing:
- (none — TASK-027 complete)

Requires:
- n/a

Irrelevant:
- `client/src/pages/ShoppingPage.jsx`, `client/src/components/shopping/BuildListModal.jsx` — untouched, as forbidden by TASK-027 spec.

# Architecture Notes
- Confirmed live: editing an item unconditionally clears `hasUnitMismatch`; `isChecked` and `sortOrder` survive an edit untouched; whitespace-only unit input normalizes to `null` client-side before the PATCH is sent (matches the existing add-form pattern — no new server-side trimming introduced).
- Confirmed live: only one row can be in edit mode at a time — opening edit on a second row discards unsaved edits on the first (no save call fired), via the single `editingId` state design from the spec.
- Confirmed live: blank name disables Save client-side (button `disabled`, no request sent).
- **Operational note, not code**: this session found the local dev server (port 3001) was running as a bare `node server/index.js` process (no nodemon), started by a separate Claude session — file edits to `server/` did not take effect until that process was manually restarted (with user permission). If a future session's server-side changes don't seem to apply, check whether the running process is nodemon-managed before assuming the code is wrong.
- **Pre-existing, unrelated bug found and NOT touched** (out of TASK-027's allowed-files list, and `buildFromRecipes()` is explicitly forbidden by the TASK-027 spec): `POST /api/shopping/build` returns 500 Internal Server Error when building a list from at least one real recipe (`Caribbean Style Curry Cod`) in this household. Not investigated further — flagging for a dedicated task since it currently blocks the normal "build list from recipes" flow entirely.

# Decisions Made
- None new — implementation followed TASK-027-spec.md's decisions/constraints as written; no deviations.

# Remaining Work
1. **New/surfaced this session**: investigate the `POST /api/shopping/build` 500 error (real recipe → internal server error). Not scoped to any existing TASK-0XX file yet.
2. Implement TASK-028 — no dependencies, no migration, prompt-only.
3. Implement TASK-029 — no dependencies, no migration, prompt-only.
4. Implement TASK-030 — no dependencies, no migration.
5. Implement TASK-031 — **requires explicit user approval before running its migration**; must precede 032/033.
6. Implement TASK-032 — requires 031 done first.
7. Implement TASK-033 — requires 032 done first; **requires explicit user approval before running its migration**.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- AI extraction accuracy on iOS (wrong quantities/skipped steps) — being addressed by TASK-030.
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.

# Known Risks
- The newly-found `/api/shopping/build` 500 error is unrelated to TASK-027 but is a real, currently-reproducible bug blocking recipe-based list building for at least one household. Worth prioritizing investigation soon since it's the primary entry point for shopping list creation.
- Two pending production migrations (TASK-031, TASK-033) — still need explicit user sign-off at implementation time.
- No automated test suite anywhere in this repo — TASK-027 was verified via live manual smoke testing in a browser session (item add, edit, cancel, escape-key cancel, single-edit-row-at-a-time, badge-clear-on-edit, whitespace-unit-normalization, blank-name rejection, delete). Toggle-check regression also confirmed still working.

# Verification Results
- TASK-027 acceptance criteria manually verified live (see Architecture Notes above for specifics): edit/delete affordances present, inline edit pre-fill, Escape cancel, unit-mismatch badge clears on save, isChecked preserved through edit, delete removes immediately with no confirmation and updates checked/unchecked counts, blank-name client-side rejection, single-editing-row enforcement, whitespace-unit → null normalization, toggle-check regression check.
- Not separately re-verified live: cross-household 404 (relies on the same two-step ownership-check code path already used and tested by `toggleItem`, so treated as covered by code-pattern reuse rather than a fresh live test), failed-PATCH-keeps-form-open (incidentally observed during a genuine 404 while the dev server was stale — form stayed open with typed values intact, as required).
- Test data (one shopping list + two items) created directly via a temporary DB script (to route around the unrelated `/build` 500 error) and deleted again after verification — no lasting data changes.

# Recommended Next Action
Decide whether to investigate the `/api/shopping/build` 500 error next (blocks the primary list-building flow) or continue down the TASK-028→033 queue as originally planned. TASK-028/029 (prompt-only receipt fixes) remain the lowest-risk next implementation picks if the build bug is deferred.

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next.

# Context Notes
- branch: main
- worktree: none
- context pressure: medium (one long live-verification session with a dev-server restart detour)

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session. Changes are uncommitted; run the usual commit flow when ready:

```powershell
git add server/services/shoppingService.js server/routes/shopping.js client/src/components/shopping/ShoppingList.jsx ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-027: add shopping list item edit and delete"
```
