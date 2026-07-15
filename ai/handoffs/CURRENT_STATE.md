# Task
TASK-027 through TASK-033 — six approved specs, ready for implementation. No code was written this session; this was a pure spec-drafting and architect-review session.

# Current Status
Six new task specs were drafted (originating from a single conversation about shopping-list and pantry/receipt/recipe accuracy issues) and each went through 1–3 rounds of external architect review via the established spec workflow. **All six are now `APPROVED FOR IMPLEMENTATION`.** None have been built yet — this handoff exists so implementation can begin cold in a future session.

TASK-026 (household members card) remains DONE from the previous session — see git history for its detail; this file has been re-condensed now that TASK-027–033 are the active queue.

# Files Modified (this session — specs only, no application code)
- `ai/tasks/TASK-027-spec.md` (new) — Shopping List Item Edit & Delete. DRAFT-2, approved round 1.
- `ai/tasks/TASK-028-spec.md` (new) — Receipt Non-Food Classification Accuracy. DRAFT-2, approved round 1.
- `ai/tasks/TASK-029-spec.md` (new) — Receipt Item Name Normalization. DRAFT-2, approved round 1.
- `ai/tasks/TASK-030-spec.md` (new) — Recipe Image Extraction Accuracy + Mid-List Step Insertion. DRAFT-3, approved round 2.
- `ai/tasks/TASK-031-spec.md` (new) — Pantry Storage Location & FoodKeeper-Driven Expiry. DRAFT-4, approved round 3 (schema migration required).
- `ai/tasks/TASK-032-spec.md` (new) — Pantry Quantity Split Across Storage Locations. DRAFT-2, approved round 1. Depends on TASK-031.
- `ai/tasks/TASK-033-spec.md` (new) — Servings-Per-Purchase-Unit Tracking. DRAFT-3, approved round 2 (schema migration required). Depends on TASK-032.

# Dependency Chain

**Independent — any order, any session, could be parallelized:**
- TASK-027, TASK-028, TASK-029, TASK-030

**Strictly sequential — do not start out of order:**
- TASK-031 → TASK-032 → TASK-033 (031 introduces `storageLocation`/`computeExpiryForStorage()` that 032 requires; 032's `splitItem()` is required by 033's servings-conversion extension)

Note: TASK-029 (receipt name specificity) and TASK-031 (FoodKeeper matching) have a soft cross-dependency documented in both spec files — TASK-029's output quality affects TASK-031's match rate — but neither blocks the other's implementation order.

# Architecture Notes

## Cross-cutting decisions worth knowing before implementing any of these
- **Two of the six require a production Neon schema migration** (TASK-031: `storage_location`, `pre_freeze_storage_location`; TASK-033: `servings_per_purchase_unit`). Per this project's established practice, migrations are hand-applied in Neon's SQL Editor with explicit user approval — do not attempt to run them automatically via `drizzle-kit` or any automated path.
- **This project's DB driver is `drizzle-orm/neon-http`** (`server/db/client.js`), which does **not** support interactive/session transactions — `SELECT ... FOR UPDATE` row locking is not available. TASK-032 solves its concurrency requirement with an atomic conditional `UPDATE ... WHERE quantity >= splitQuantity` instead. Keep this driver limitation in mind for any other concurrency-sensitive work later, not just TASK-032.
- **TASK-031 introduces `computeExpiryForStorage({ name, category, storageLocation, purchaseDate, existingExpiry, source })`**, a shared helper used by `create()`, `update()`, `bulkCreate()`, `toggleFreeze()`, and (via TASK-032/033) split. Critical detail from that spec's round-3 review: `source` describes whether *the current request* carries an explicit `expiryDate` — it is **not** a caller-identity tag. Getting this backwards was an actual logical bug caught during review; re-read TASK-031's Decision 1/4 carefully before implementing anything that calls this helper.
- **`isFrozen` is deprecated, not dropped**, in TASK-031's migration — matches this schema's existing precedent for `households.aiProvider`/`aiApiKey`. `storageLocation === 'freezer'` becomes the application-level source of truth; `isFrozen` stays in the schema unused.
- **TASK-031's thaw behavior restores `preFreezeStorageLocation`**, not a fixed `'refrigerator'` default — this was reversed mid-review after a concrete counterexample (pantry item frozen then thawed would otherwise get stuck in the fridge permanently).

## Per-task one-liners (full detail in each spec file)
- **027**: adds `PATCH`/`DELETE` for individual shopping-list items (edit/delete), previously only whole-list delete and check-toggle existed.
- **028**: prompt-only fix to `parseReceipt()` — leads with an explicit non-food principle instead of an ever-growing category list, fixes the "dog treats/pet products" miss.
- **029**: prompt-only fix to `parseReceipt()` — expands abbreviated receipt names ("BNLS/SL BRST" → "Boneless skinless chicken breast") using the model's own knowledge, no external lookup (researched and ruled out barcode/store-API approaches).
- **030**: `parseRecipeImage()` gets an explicit `detail: 'high'` param (previously unset, defaulting to `'auto'` — a real bug candidate found during review), a transcription-style prompt rewrite, a `gpt-4o` model bump, and a bounded single retry; `RecipeReviewModal.jsx` gains mid-list step insertion (not just append).
- **031**: pantry items get a real `storageLocation` field; expiry calculation prefers a deterministic FoodKeeper lookup over AI guesses when available — this is the direct fix for the reported bug (receipt-imported chicken expiring as if refrigerated when most of it went to the freezer).
- **032**: lets a pantry item's quantity be split across two storage locations after purchase (e.g. "5 of 6 pouches to the freezer, 1 stayed in the fridge") — the actual missing capability behind the reported bug.
- **033**: optional servings-per-purchase-unit tracking so splits can be expressed in servings instead of raw units.

# Remaining Work
1. Implement TASK-027 — good starting point, no dependencies, no migration.
2. Implement TASK-028 — no dependencies, no migration, prompt-only.
3. Implement TASK-029 — no dependencies, no migration, prompt-only.
4. Implement TASK-030 — no dependencies, no migration.
5. Implement TASK-031 — **requires explicit user approval before running its migration**; must precede 032/033.
6. Implement TASK-032 — requires 031 done first.
7. Implement TASK-033 — requires 032 done first; **requires explicit user approval before running its migration**.

## Backlog (carried forward, unchanged — not touched this session)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- AI extraction accuracy on iOS (wrong quantities/skipped steps) — this is now being addressed by TASK-030.
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround, not a real fix.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.

# Known Risks
- Two pending production migrations (TASK-031, TASK-033) — need explicit user sign-off at implementation time, independent of the spec-level approval already obtained.
- No automated test suite anywhere in this repo — every spec's Acceptance Criteria are written for manual smoke testing, consistent with TASK-024/025/026 precedent.
- FoodKeeper dataset coverage is limited (251 entries) — TASK-031's fix concentrates on whole/base foods, not branded/packaged items.
- TASK-030's model/prompt changes reduce (not eliminate) recipe-extraction errors — no accuracy benchmark exists to measure this quantitatively.

# Verification Results
N/A this session — no code was implemented, only specs written and reviewed. Each spec file's own Acceptance Criteria section is the verification plan for when that task is actually built.

# Recommended Next Action
Start with any of TASK-027/028/029/030 (independent, no migrations, lowest risk) — TASK-027 is likely the simplest first pick. Save TASK-031→032→033 for a session where a production migration can be reviewed and approved end-to-end.

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented rather than assuming file access carries over between tasks. No cross-task file overlap is expected except where a Dependency Chain above explicitly notes one.

# Context Notes
- branch: main
- worktree: none
- context pressure: low (this was a planning-only session; no large file diffs)

# PowerShell Merge Block
N/A — working directly on main, no worktree used this session.
