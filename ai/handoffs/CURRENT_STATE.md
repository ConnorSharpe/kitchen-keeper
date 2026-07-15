# Task
TASK-028 — Receipt Non-Food Classification Accuracy. Implemented this session; NOT yet live-verified (no photographed receipt available).

# Current Status
TASK-028 is **implemented, pending manual smoke test**. Rewrote the `non_food` classification guidance in `parseReceipt()`'s prompt (principle-first framing, explicit pet-food disambiguation, representative-not-exhaustive example list, warehouse-receipt store-context reminder) and extended the existing summary `console.log` to include `item_count_non_food`/`item_count_uncertain` alongside the existing extracted/food counts. `uncertain`-bias default and the `items.filter(i => i.classification !== 'non_food')` filter code are both untouched, per spec constraints. Verified `node --check` passes (syntax only) — this is an LLM-prompt change with no automated eval harness (per spec, consistent with TASK-015/024/025/026 precedent), so the acceptance-criteria table in TASK-028-spec.md (dog food/laundry detergent/paper towels → non_food; chicken/milk/bananas → food; no overcorrection on ambiguous food like protein bars/vitamins) still needs a live test against a real or simulated receipt photo — not run this session because no receipt image was available and simulating one would spend OpenAI credits on a synthetic test.

# Files Modified
- `server/services/aiService.js` — `parseReceipt()` prompt string rewritten (classification guidance only); summary log line extended with `item_count_non_food`/`item_count_uncertain`. No other function in the file touched.

# Files Required Next
- For live verification of TASK-028: a real (or carefully simulated) receipt photo with a food + pet-treat + general-merchandise mix, run through `POST /api/ai/parse-receipt`, checking the extended log line's classification distribution.
- For TASK-029: `server/services/aiService.js` `parseReceipt()` again (name normalization — separate concern, same function) or wherever else TASK-029-spec.md scopes it — not yet read this session.

# Files Already Reviewed
- `server/services/aiService.js` (`parseReceipt()` and surrounding context, lines ~260-330).

# Dependency Chain

Editing:
- (none — TASK-028 code changes complete, pending live verification)

Requires:
- n/a

Irrelevant:
- `server/routes/ai.js`, `client/src/components/pantry/ReceiptUpload.jsx`, other `parse*`/`chat`/`suggestRecipes`/`expandSuggestion` functions in `aiService.js` — untouched, as forbidden by TASK-028 spec.

# Architecture Notes
- Prompt now leads with the principle ("not intended for human consumption or pantry/kitchen storage") before examples, per architect review round 1 — avoids the model treating a fixed category list as implicitly exhaustive.
- Pet food/treats disambiguation is explicit and separate from the example list: "edible does not mean human food."
- Example list (pet products, sporting/outdoor goods, electronics, apparel, furniture/home goods, automotive, toys, office supplies, household paper goods, cleaning supplies) is labeled "NOT exhaustive" directly in the prompt text.
- `uncertain`-bias default sentence kept verbatim/unchanged, immediately after the new content — TASK-015's false-positive-is-worse-than-false-negative reasoning is not being revisited.
- **Still open, carried from last session**: `POST /api/shopping/build` returns 500 Internal Server Error when building a list from at least one real recipe (`Caribbean Style Curry Cod`) in this household. Not investigated this session either (out of TASK-028's scope) — still flagging for a dedicated task, still blocks the normal "build list from recipes" flow.

# Decisions Made
- None new — implementation followed TASK-028-spec.md's Decision section verbatim; no deviations.

# Remaining Work
1. **Live smoke test TASK-028** against the acceptance-criteria table (chicken/milk/bananas → food; dog food/laundry detergent/paper towels → non_food; protein bars/vitamins/spices → not overcorrected to non_food) using a real photographed receipt, before considering TASK-028 fully done.
2. **Carried forward, still unscoped**: investigate the `POST /api/shopping/build` 500 error (real recipe → internal server error).
3. Implement TASK-029 — no dependencies, no migration, prompt-only (receipt item name normalization, same `aiService.js` file).
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
- TASK-028 code changes are unverified against a live model response — this is a non-deterministic prompt change with no eval harness, so "implemented" is not the same as "confirmed effective" until a real receipt is run through it.
- The `/api/shopping/build` 500 error (carried from TASK-027 session) is still unrelated to TASK-028 but is a real, currently-reproducible bug blocking recipe-based list building for at least one household. Still worth prioritizing since it's the primary entry point for shopping list creation.
- Two pending production migrations (TASK-031, TASK-033) — still need explicit user sign-off at implementation time.
- No automated test suite anywhere in this repo.

# Verification Results
- `node --check server/services/aiService.js` — PASS (syntax only).
- TASK-028 acceptance criteria (classification table, no-regression on normal receipts, no overcorrection on ambiguous food items, extended log line accuracy) — **NOT YET RUN**. Requires a real photographed receipt (or a deliberately constructed one) and an actual OpenAI API call; deferred to next session or to the user's own smoke test.

# Recommended Next Action
Smoke-test TASK-028 against a real receipt photo (ideally one with pet products or general merchandise, similar to the Costco receipt that surfaced the original bug) and check the extended `item_count_non_food`/`item_count_uncertain` log line. If it holds up, move to TASK-029 (same file, item-name normalization) next — no dependencies, no migration. The `/api/shopping/build` 500 error remains an open, unscoped bug worth prioritizing separately.

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
git commit -m "TASK-028: improve receipt non-food classification prompt"
```
