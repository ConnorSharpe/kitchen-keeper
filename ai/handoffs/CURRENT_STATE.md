# Task
TASK-029 — Receipt Item Name Normalization. Implemented this session; NOT yet live-verified (no photographed receipt available).

# Current Status
TASK-029 is **implemented, pending manual smoke test**. Added a "For the "name" field:" bullet-list block to `parseReceipt()`'s prompt (per architect review round 1's structure preference), inserted between the JSON schema description and the `estimatedExpiryDays` guidance. Rules cover: abbreviation expansion with one example each from meat/produce/dairy (per spec Constraint 2 — multi-category, not meat-only), specificity preservation, sentence case (matching `AddItemModal.jsx`'s existing convention, not Title Case), brand-name confidence bar, no embellishment/marketing adjectives, no inferred package size/quantity, and "leave unexpanded if not confident" for illegible/store-specific codes. `classification` guidance (TASK-028), `estimatedExpiryDays`, `category`, `quantity`, `unit` prompt text all untouched, per spec constraint 6. No response schema change — `name` stays a plain string. Verified `node --check` passes (syntax only) — this is an LLM-prompt change with no automated eval harness (per spec, consistent with TASK-015/024/025/026/028 precedent), so the acceptance-criteria table in TASK-029-spec.md still needs a live test against a real receipt photo with abbreviated items across multiple categories — not run this session, same reasoning as TASK-028 (no receipt image available, simulating one spends OpenAI credits on a synthetic test).

# Files Modified
- `server/services/aiService.js` — `parseReceipt()` prompt string only: inserted the "name" field naming-rules bullet list. No other function or prompt guidance touched.

# Files Required Next
- For live verification of TASK-029 (and re-verification of TASK-028, since both prompt changes are now combined in the same call, per spec acceptance criterion "confirm no interaction/regression between the two prompt changes"): a real receipt photo with abbreviated multi-category items (e.g. meat, produce, dairy) run through `POST /api/ai/parse-receipt`, checking both the expanded `name` values and the `classification`/log-line counts together.
- For TASK-030: not yet read this session — next no-dependency, no-migration task per CURRENT_STATE ordering.

# Files Already Reviewed
- `server/services/aiService.js` (`parseReceipt()` and surrounding context, lines ~273-333).
- `ai/tasks/TASK-029-spec.md` (full spec, this session).

# Dependency Chain

Editing:
- (none — TASK-029 code changes complete, pending live verification)

Requires:
- n/a

Irrelevant:
- `server/routes/ai.js`, `client/src/components/pantry/ReceiptUpload.jsx`, `server/services/shelfLifeService.js`, `server/services/pantryService.js` — untouched, as forbidden by TASK-029 spec.

# Architecture Notes
- Naming rules presented as an enumerated bullet list embedded in the prompt text (via `\n` + `- ` lines), not prose, per architect review round 1 — models follow enumerated imperative rules more reliably.
- No `rawName`/`displayName` split — `name` is expanded in place, per spec's explicit rejection of that split for v1 (nothing downstream consumes a raw/original field today).
- Sentence case chosen (not Title Case) to match `AddItemModal.jsx`'s actual placeholder convention (`"e.g. Chicken breast"`), correcting the architect's initial assumption.
- TASK-031 (not yet implemented) will make `name` specificity load-bearing for FoodKeeper expiry matching, not just cosmetic — flagged in the spec as a re-verification trigger once 031 ships.
- **Still open, carried from earlier sessions**: `POST /api/shopping/build` returns 500 Internal Server Error when building a list from at least one real recipe (`Caribbean Style Curry Cod`) in this household. Not investigated this session either (out of TASK-029's scope) — still unscoped, still blocks the normal "build list from recipes" flow.

# Decisions Made
- None new — implementation followed TASK-029-spec.md verbatim (Decision sections on in-place expansion, sentence case, brand-name confidence bar); no deviations.

# Remaining Work
1. **Live smoke test TASK-029** against the acceptance-criteria table (abbreviation expansion across meat/produce/dairy, specificity preserved, no embellishment, brand handling, illegible-line fallback, sentence case, "Bananas"-style regression check) using a real photographed receipt.
2. **Combined re-check**: confirm TASK-028's `classification` output and TASK-029's `name` expansion don't interact badly on the same test receipt (spec acceptance criterion).
3. **Carried forward, still unscoped**: investigate the `POST /api/shopping/build` 500 error (real recipe → internal server error).
4. Implement TASK-030 — no dependencies, no migration.
5. Implement TASK-031 — **requires explicit user approval before running its migration**; must precede 032/033. Note: once shipped, re-verify TASK-029's name specificity against FoodKeeper match rate, not just readability (per TASK-029 spec's Known Risks).
6. Implement TASK-032 — requires 031 done first.
7. Implement TASK-033 — requires 032 done first; **requires explicit user approval before running its migration**.

## Backlog (carried forward, unchanged)
- iOS PWA has no way to upload an existing photo (camera-only) — unscoped, fix identified (add a second file input without `capture`).
- AI extraction accuracy on iOS (wrong quantities/skipped steps) — being addressed by TASK-030.
- Receipt preview table (`ReceiptUpload.jsx`) is read-only checkboxes, not per-field editable — a user can't correct a wrong AI-expanded name in the moment, only exclude the row or fix it later in `AddItemModal.jsx`. Flagged by TASK-029 spec as a real but separate, smaller UI gap (Out of Scope), mirrors TASK-027's shopping-list edit pattern if the user wants it fixed.
- Migration history reconciliation (0001–0013 lack `--> statement-breakpoint` markers) — still a hand-applied workaround.
- No Clerk webhook sync for deleted accounts — deferred, no urgency indicated.
- TASK-021 v2 (fuzzy annotation matching) — HOLD, no usage evidence yet.
- TASK-022 v2 (language preference) — HOLD, English-only is sufficient for now.

# Known Risks
- TASK-029 code changes are unverified against a live model response — this is a non-deterministic prompt change with no eval harness, so "implemented" is not the same as "confirmed effective" until a real receipt is run through it.
- TASK-028 and TASK-029 prompt changes now ship together in the same `parseReceipt()` call, unverified in combination — worth checking together, not just individually, on the first live test.
- The `/api/shopping/build` 500 error is still unrelated to TASK-029 but is a real, currently-reproducible bug blocking recipe-based list building for at least one household. Still worth prioritizing since it's the primary entry point for shopping list creation.
- Two pending production migrations (TASK-031, TASK-033) — still need explicit user sign-off at implementation time.
- No automated test suite anywhere in this repo.

# Verification Results
- `node --check server/services/aiService.js` — PASS (syntax only).
- TASK-029 acceptance criteria (abbreviation expansion table, specificity, no embellishment, brand handling, illegible fallback, sentence case, regression on already-clear names, no TASK-028 interaction) — **NOT YET RUN**. Requires a real photographed receipt (or a deliberately constructed one) and an actual OpenAI API call; deferred to next session or to the user's own smoke test.

# Recommended Next Action
Smoke-test TASK-029 (and re-confirm TASK-028) against a real receipt photo with abbreviated multi-category items (meat/produce/dairy ideally), checking both the expanded `name` values and the classification log line together. If it holds up, move to TASK-030 next — no dependencies, no migration. The `/api/shopping/build` 500 error remains an open, unscoped bug worth prioritizing separately.

# Forbidden Exploration
Each `ai/tasks/TASK-0XX-spec.md` has its own Allowed/Forbidden Files section — read the specific spec for whichever task is being implemented next.

# Context Notes
- branch: main
- worktree: none
- context pressure: low

# PowerShell Merge Block
N/A — worked directly on main, no worktree used this session. Changes are uncommitted; run the usual commit flow when ready:

```powershell
git add server/services/aiService.js ai/handoffs/CURRENT_STATE.md
git commit -m "TASK-029: expand abbreviated receipt item names to human-readable form"
```
