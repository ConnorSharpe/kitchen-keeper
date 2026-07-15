# TASK-033 — Servings-Per-Purchase-Unit Tracking

Version: DRAFT-3 — APPROVED FOR IMPLEMENTATION (post-architect review, round 2)

**Depends on [TASK-032](TASK-032-spec.md)** (split action) — this task extends split to accept a servings-based input as an alternative to a raw unit quantity.

**Flag for the user before implementation: this task requires a production Neon schema migration** (new `servings_per_purchase_unit` column). Per this project's established practice (see TASK-031), the migration must be explicitly approved and hand-applied by the user in Neon's SQL Editor, not auto-run.

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 | Praised: narrow single-concern scope, the manual-only decision (no source can reliably infer package serving counts — "Family Size Chicken Nuggets" is not a knowable serving count from a receipt line), explicit XOR validation over an implicit truthy check, reusing TASK-032's split logic via a conversion step rather than duplicating it. Required: define an explicit precision/rounding policy for servings→quantity conversion (checked directly — no such policy exists anywhere else in this codebase to reuse, so one is defined fresh here rather than claimed as reuse of something that doesn't exist); add sensible validation bounds on the servings-per-unit value itself, not just positivity; clarify how editing an existing item's value actually happens (checked directly — `AddItemModal.jsx` already handles both add and edit via its existing `isEdit` branching, so this isn't a missing UI, just an underspecified claim in the Goal); restate the production-migration requirement explicitly, matching TASK-031's precedent; specify the split modal's UX so a user can't fill in both a quantity and a servings input at once; clarify PATCH null-vs-omitted semantics, matching TASK-027's established convention; specify whether fractional servings are allowed (yes, matching `quantity`'s existing non-integer `real` type); add a display location so the field isn't invisible metadata once set; add a regression-guarding acceptance criterion (editing the per-unit value later must not retroactively alter stored quantity); state explicitly that `quantity` remains the sole canonical stored value in purchase units, with this field as conversion metadata only. Also adopted a naming change (`servingsPerUnit` → `servingsPerPurchaseUnit`) since the existing `unit` column already means something else entirely (oz/lb/each/bag) sitting right next to it — free to change before any implementation exists. All incorporated in DRAFT-2. |
| DRAFT-2 | 9.7/10 — approved from an architectural standpoint | Praised: the canonical-quantity invariant made explicit, the honestly-derived (not falsely-claimed-as-reused) precision policy, verifying the existing edit flow rather than inventing new UI, the mutually-exclusive toggle UX, reusing TASK-027's PATCH convention, the display location, generous-but-bounded validation, and — noted approvingly — that this revision clarified behavior rather than expanding scope in response to review, unlike a common failure mode in AI-authored spec revisions. All remaining points explicitly non-blocking ("not required," "not a blocker," "polish rather than structural"): note that `real` intentionally matches `quantity`'s existing type and should migrate alongside it if that type ever changes; one more regression criterion (split-by-servings then split-the-child-by-quantity should total the same as splitting by quantity alone throughout); extract the servings→quantity conversion into a small named helper for future reuse (consume-by-servings, recipe servings); reword one sentence that read as an empirical justification rather than a stated judgment call. All four incorporated below despite being optional, since each is cheap and genuinely useful. |

---

## Origin

Split out of TASK-031 per architect review round 1, alongside TASK-032. The architect's round-1 review of the original bundled spec suggested removing this feature entirely, reasoning it has little relationship to storage and adds unrelated complexity. **Declined** — the user explicitly requested servings-per-unit tracking earlier in this project's working session (chosen directly over "existing unit only" when asked). The architect's actual underlying concern — regression surface from bundling — is addressed by giving this its own task, without reversing that decision.

---

## Goal

Let a pantry item optionally record how many servings one purchase-unit represents (e.g. "2 servings per pouch"), so splits can be expressed in servings instead of purchase units when that's more natural. This is settable both when adding a new item and when editing an existing one — both flows share `AddItemModal.jsx` today (its existing `isEdit = Boolean(item)` branching), so no separate edit surface is needed.

---

## Decision: Manual-Only, Never Inferred

`servingsPerPurchaseUnit` is never set automatically by any code path — no receipt scan, recipe import, or chat-agent action infers it. A receipt line has no visibility into package serving counts; this is purely an optional field the user sets by hand.

## Decision: `quantity` Remains the Sole Canonical Stored Value

`servingsPerPurchaseUnit` is conversion metadata only — it is never written into, derived into, or substituted for `quantity`. `quantity` continues to be stored exclusively in purchase units (pouches, lbs, items, whatever the item's existing `unit` already denotes) for every pantry row, with or without this field set. This is stated explicitly to preempt a plausible future mistake: nothing in this task's design should ever tempt a later change to store `quantity` in servings instead.

## Decision: Precision Policy for Servings↔Quantity Conversion (Defined Fresh — No Existing Convention to Reuse)

No rounding/precision policy exists anywhere else in this codebase for quantity arithmetic (`shoppingService.buildFromRecipes()`'s quantity summation, for example, applies none) — so rather than claim to "match an existing policy," this task defines one specifically for this conversion: `splitQuantity = splitServings / servingsPerPurchaseUnit`, rounded to 6 decimal places (`Math.round(x * 1e6) / 1e6`) before being handed to TASK-032's split logic. This absorbs ordinary floating-point noise (e.g. `0.1 + 0.2` artifacts) without meaningfully constraining legitimate precision for any realistic purchase unit. TASK-032's own quantity validation (`splitQuantity` must be finite, positive, and not exceed the available amount) still applies unchanged after this rounding step — this task only adds the conversion in front of it.

**Extracted into a small, named helper** — e.g. `computeSplitQuantityFromServings(splitServings, servingsPerPurchaseUnit)` in `pantryService.js` — rather than inlined directly inside `splitItem()`. This is purely for future reuse: if a later feature needs the same conversion (consuming pantry items by servings, recipe-servings math, etc.), the logic already exists as a callable unit rather than needing to be re-extracted out of `splitItem()` at that point.

**Schema note**: `servingsPerPurchaseUnit` is stored as `real`, intentionally matching `quantity`'s existing type for consistency — both are subject to the same floating-point characteristics as a result, which this task's rounding policy accounts for. If `quantity` (or numeric columns generally) ever migrates to `DECIMAL`/`NUMERIC` in a future task, this column should migrate alongside it rather than being left as the sole outlier.

## Decision: Validation Bounds on `servingsPerPurchaseUnit`

Beyond `.positive()`, the value is bounded to a plausible range — `0.1` to `1000` — rejecting both accidental near-zero and absurdly large entries (e.g. a fat-fingered `999999999999`) that would otherwise sit in the database as unusable garbage. These bounds are a judgment call for this task specifically (no existing numeric field in this schema has bounds to match against) — intentionally generous, existing only to reject obviously erroneous input, not derived from any empirical study of real household purchases.

## Decision: Fractional Servings Are Allowed

Both `servingsPerPurchaseUnit` and `splitServings` accept non-integer values (e.g. `2.5` servings) — consistent with `quantity` already being a `real`, non-integer column throughout this schema. No integer constraint is introduced here that doesn't already exist for the values this feature interacts with.

## Decision: Split Modal Presents Quantity and Servings as Mutually Exclusive Inputs, Not Two Simultaneous Fields

When an item has `servingsPerPurchaseUnit` set, `SplitItemModal` (from TASK-032) shows a toggle (e.g. "Split by: Units | Servings") that determines which single input field is visible and active — never both a quantity field and a servings field editable at once. This is a UI-level guarantee, not just a backend validation rule: relying on the API's XOR check alone to catch a user who filled in both fields would be a confusing dead-end UX (which one "won"?) rather than a prevented mistake.

## Decision: Split Accepts `splitServings` as an Alternative to `splitQuantity`, Mutually Exclusive

TASK-032's `POST /api/pantry/:id/split` gains an optional `splitServings` field. The request must supply **exactly one** of `splitQuantity` or `splitServings`, not both and not neither — enforced via an explicit Zod refinement (`.refine()` checking exactly one is present), not left as an implicit "whichever is truthy" check. When `splitServings` is supplied, it's converted to a unit quantity per the precision policy above, then handed to TASK-032's existing split logic unchanged — this task does not duplicate split's transaction/clone/expiry logic, only adds a conversion step in front of it.

If `servingsPerPurchaseUnit` is null on the item, `splitServings` is rejected (400) — there's nothing to convert against.

## Decision: PATCH Semantics Match TASK-027's Established Convention

Editing `servingsPerPurchaseUnit` via `PATCH /api/pantry/:id` follows the same omitted-vs-explicit rule TASK-027 already established for shopping-list items: an **omitted** key leaves the existing value unchanged; an **explicit `null`** clears it. No new convention is being introduced — this is the same partial-update semantics already used throughout `pantryService.update()`.

## Decision: Display Location

`servingsPerPurchaseUnit`, once set, is shown as a small annotation next to the quantity/unit display in `PantryTable.jsx` (e.g. "3 pouches · 2 servings/pouch") — otherwise the field is invisible metadata that a user has no way to confirm is actually set without reopening the edit modal.

---

## Allowed Files

- `server/db/schema.js` — add `servingsPerPurchaseUnit`
- `server/db/migrations/0015_pantry_servings.sql` (new), `server/db/migrations/meta/_journal.json`
- `server/services/pantryService.js` — new `computeSplitQuantityFromServings()` helper (precision-rounded per Decision above); `splitItem()` (from TASK-032) calls it when `splitServings` is supplied
- `server/routes/pantry.js` — `createSchema`/`updateSchema` gain `servingsPerPurchaseUnit` (bounded per Decision above); split route's body schema gains `splitServings` with the XOR refinement
- `client/src/components/pantry/AddItemModal.jsx` — optional servings-per-purchase-unit field (used for both add and edit, per its existing `isEdit` branching)
- `client/src/components/pantry/PantryTable.jsx` — display annotation (Decision above)
- `client/src/components/pantry/SplitItemModal.jsx` (from TASK-032) — mutually-exclusive quantity/servings toggle, shown only when the item has `servingsPerPurchaseUnit` set

## Forbidden Files

- `server/services/aiService.js` / `server/routes/ai.js` — no AI path ever sets this field
- `client/src/components/shopping/*` — servings-aware shopping-list math is explicitly out of scope (shopping remains purchase-unit-only)
- TASK-031/TASK-032's core storage/split logic beyond the one conversion step described above

---

## Constraints

1. **`servingsPerPurchaseUnit` is nullable, never auto-set** — see Decision above.
2. **`quantity` is never replaced or derived from servings** — see Decision above; this is a hard invariant, not a style preference.
3. **Servings→quantity conversion is rounded to 6 decimal places** before being passed into TASK-032's split validation — see Decision above.
4. **`servingsPerPurchaseUnit` is bounded `0.1`–`1000`**, not just positive — see Decision above.
5. **Fractional values are allowed** for both `servingsPerPurchaseUnit` and `splitServings` — no integer constraint.
6. **Split's `splitQuantity`/`splitServings` are mutually exclusive at both the API layer** (explicit Zod `.refine()`, not an implicit truthy check) **and the UI layer** (a toggle, not two simultaneously-editable fields) — see Decisions above.
7. **`splitServings` without a `servingsPerPurchaseUnit` on the item is a 400**, not a silent fallback or a division by null.
8. **PATCH omitted vs. explicit `null` follows TASK-027's existing convention** — see Decision above.
9. **No schema/logic change to TASK-032's actual split mechanics** — this task only adds a conversion step ahead of the existing `splitQuantity` path.

---

## Schema Addition

```sql
-- 0015_pantry_servings.sql
ALTER TABLE pantry_items ADD COLUMN servings_per_purchase_unit real;
```

```js
// server/db/schema.js — pantryItems addition
servingsPerPurchaseUnit: real('servings_per_purchase_unit'),  // null unless the user sets it manually; bounded 0.1-1000 at the API layer
```

## API Additions

```ts
POST /api/pantry/:id/split
Body: { splitQuantity?: number, splitServings?: number, storageLocation: 'pantry'|'refrigerator'|'freezer' }
// exactly one of splitQuantity / splitServings required (Zod .refine())
```

`createSchema`/`updateSchema` in `pantry.js` gain:
```js
servingsPerPurchaseUnit: z.coerce.number().min(0.1).max(1000).nullable().optional(),
```

---

## Dependency Chain

Editing:
- `server/db/schema.js`, `server/db/migrations/0015_pantry_servings.sql`, `server/db/migrations/meta/_journal.json`
- `server/services/pantryService.js` (conversion step in `splitItem()`)
- `server/routes/pantry.js`
- `client/src/components/pantry/AddItemModal.jsx`, `PantryTable.jsx`, `SplitItemModal.jsx`

Reads (pattern reference only):
- TASK-032's `splitItem()` — hard dependency, must exist before this task starts
- `client/src/components/pantry/AddItemModal.jsx`'s existing `isEdit` branching — confirms no new edit surface is needed
- TASK-027's PATCH omitted-vs-null convention — reused, not reinvented

Irrelevant:
- `server/services/aiService.js`, `server/routes/ai.js`
- `client/src/components/shopping/*`

---

## Acceptance Criteria

- [ ] Manual add: optional servings-per-purchase-unit field, defaults to unset/null
- [ ] The same field is editable on an existing item via `AddItemModal`'s edit mode, not just at creation
- [ ] Values outside `0.1`–`1000`, or non-positive, are rejected (400)
- [ ] Fractional values (e.g. `2.5`) are accepted for both the per-unit field and `splitServings`
- [ ] Setting `servingsPerPurchaseUnit` on an item and later splitting by `splitServings` produces the same result as manually computing the equivalent `splitQuantity`, rounded per the 6-decimal-place policy
- [ ] **Conversion-layer regression guard**: splitting an item by servings, then splitting the resulting child row again by a plain quantity, produces the same final inventory totals as performing both splits using quantity alone throughout — confirms the servings conversion step never silently mutates anything beyond the one value it's supposed to compute
- [ ] Submitting both `splitQuantity` and `splitServings` in one request is rejected (400)
- [ ] Submitting neither is rejected (400)
- [ ] Submitting `splitServings` on an item with no `servingsPerPurchaseUnit` set is rejected (400), not silently treated as a unit-quantity split
- [ ] The split modal shows only one active input (quantity or servings) at a time via its toggle — never both simultaneously editable
- [ ] Omitting `servingsPerPurchaseUnit` from a PATCH request leaves the existing value unchanged; explicitly sending `null` clears it
- [ ] **Changing `servingsPerPurchaseUnit` on an item does not alter its already-stored `quantity`** — e.g. an item with `quantity: 3` and `servingsPerPurchaseUnit: 2` still shows `quantity: 3` after the per-unit value is edited to `4`; only future conversions use the new value
- [ ] Once set, `servingsPerPurchaseUnit` is visibly displayed on the pantry table row, not just retrievable by reopening the edit modal
- [ ] Regression: TASK-032's plain `splitQuantity` path is unaffected for items with no `servingsPerPurchaseUnit` set

Verification is manual smoke testing against local dev (and, per this project's established pattern, ultimately against production Neon with explicit approval before the migration is applied) — no automated test suite exists in this repo.

---

## Known Risks

- **Production migration required** — must be explicitly approved and hand-applied in Neon's SQL Editor, not auto-run, matching TASK-031's precedent.
- Depends on TASK-032 shipping first.
- No servings-aware shopping-list generation — a shopping list built from recipes still operates in purchase units, not servings; this task is pantry-side tracking only, not an end-to-end servings feature.
- The `0.1`–`1000` bounds and 6-decimal rounding policy are this task's own judgment calls, not derived from an existing project convention — reasonable defaults, not empirically tuned.

## Out of Scope

- Servings-aware shopping-list math (TASK-027 remains purchase-unit-only)
- Inferring `servingsPerPurchaseUnit` from any source (receipt, recipe, or otherwise) — always manual
- Bulk-setting servings-per-unit across multiple existing items

---

## Note to User on Approval Status

Marked approved: the architect's round-2 review stated this was "approved from an architectural standpoint" with all remaining points explicitly non-blocking ("not required," "not a blocker," "polish rather than structural"). All four were incorporated anyway since each was cheap and genuinely useful. This remains a production-migration task — that step still needs your explicit go-ahead when implementation actually runs it, independent of this spec-level approval.
