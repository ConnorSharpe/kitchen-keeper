# TASK-031 — Pantry Storage Location & FoodKeeper-Driven Expiry

Version: DRAFT-4 — APPROVED FOR IMPLEMENTATION (post-architect review, round 3)

**Flag for the user before implementation: this task requires a production Neon schema migration** (new `storage_location`, `pre_freeze_storage_location` columns, narrow backfill for existing frozen items). Per this project's established practice, the migration must be explicitly approved and hand-applied by the user in Neon's SQL Editor, not auto-run.

**Scope note:** this task was originally drafted as one spec covering storage location, quantity split, and servings-per-unit. It has been split into three: **this file (core storage + expiry fix)**, [TASK-032](TASK-032-spec.md) (quantity split, depends on this task), and [TASK-033](TASK-033-spec.md) (servings-per-unit, depends on TASK-032).

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.8/10 | Praised: correct root-cause diagnosis, full end-to-end trace of the receipt→expiry flow, deterministic-over-AI-guess precedence, transactional split thinking, explicitly flagging the `isFrozen`/`storageLocation` question. Required: split into three tasks; resolve `isFrozen` vs `storageLocation` definitively (recommended eliminating `isFrozen`); define expiry precedence explicitly; specify recompute behavior on post-creation storage edits, including the anchor date; constrain `storage_location` at the DB level; resolve `toggleFreeze()`'s static-table inconsistency with the new FoodKeeper-based logic. Also raised: clone-by-exclusion for split; deferred `purchaseGroupId`; cache invalidation (checked directly — no caching layer exists in this app); fractional split precision (accepted as an inherent limitation); removing servings-per-unit (declined — user's explicit prior decision; split into its own task instead). |
| DRAFT-2 | 9.6/10 | Praised: the task split, the `isFrozen` retirement plan (deprecate, don't drop), the shared `computeExpiryForStorage()` abstraction, explicit post-edit recompute behavior, storage-location UI visibility. Required: the expiry-override rule was still implicit in *which function* called it (`bulkCreate` overrides, `create` doesn't) rather than an explicit, self-documenting parameter — resolved below by giving the shared helper an explicit `source` parameter; the chat-agent path was grouped with "manual" without justifying why, when its `shelfLifeDays` is actually AI-reasoned, not human-typed — resolved below by placing it in the same override-eligible tier as receipts; the "always thaw to refrigerator" simplification loses real information (a pantry item frozen then thawed would incorrectly end up refrigerated forever) — reversed below, adding a `preFreezeStorageLocation` column now rather than deferring, since the cost is identical either way; the migration should explicitly note it assumes existing freeze-related data is internally consistent; `computeExpiryForStorage()`'s contract needed to explicitly take `existingExpiry` rather than reading it from surrounding state; one more acceptance criterion needed for a storage change with no FoodKeeper match at the new location. Also requested removing "per architect review" narration from technical decision text, keeping process history only in this table — applied throughout below. |
| DRAFT-3 | 9.8/10 — architecturally approved pending 3 clarifications | Praised: the explicit `source` parameter as a genuine API rather than hidden call-site behavior, the chat/receipt provenance unification, the `preFreezeStorageLocation` reversal, documenting the migration's consistency assumption. Required (all logical/clarity, no new structural concerns): Decision 4 actually contradicted Decision 1 — it called `computeExpiryForStorage()` with `source: 'manual'` for a storage-only edit while also expecting that case to be recompute-eligible, which Decision 1's own rule (manual + non-null existingExpiry → never override) directly forbids. Root cause: `source` was ambiguously defined as "who initiated the request" when it needed to mean "was a manual expiry supplied in *this* request" — since there is no persisted provenance column (correctly identified as unnecessary schema surface), the only knowable signal is whether the current request body actually contains an `expiryDate` key. Resolved below by tying `source` directly to that presence check, reusing the exact `.partial()`-omission mechanism TASK-027 already established. Also requested: not mandating a specific return-value representation (ISO string) from `computeExpiryForStorage()` — the helper returns whatever the service layer's existing convention is, not a format the helper itself dictates; one more acceptance criterion for a freeze→thaw→freeze cycle correctly refreshing `preFreezeStorageLocation` rather than reading a stale snapshot. All incorporated below. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Pantry schema | `server/db/schema.js:28-47` `pantryItems` | No storage-location concept today. `isFrozen`/`frozenAt`/`originalExpiryDate`/`freezeNotes` model a binary freezer toggle layered on an assumed-fridge base state. |
| Expiry-on-create | `server/services/pantryService.js:8-16` `enrichWithExpiry()` | If `expiryDate` is already set, this function no-ops entirely — FoodKeeper lookup only runs when `expiryDate` is null. |
| Root cause of the reported bug | `server/routes/ai.js:100-113` `/parse-receipt` | Every receipt-imported candidate gets `expiryDate` computed from the AI's own flat `estimatedExpiryDays` guess before it reaches `enrichWithExpiry()`, which then no-ops on it. FoodKeeper (`server/data/foodkeeper.json`, 251 entries with separate `pantryDays`/`refrigeratorDays`/`freezerDays`) is never consulted for receipt items today. Confirmed: chicken breast is `{ refrigeratorDays: 2, freezerDays: 270 }` — a 135x gap, exactly the shape of the reported bug. |
| Chat agent's expiry is also AI-generated | `server/routes/ai.js:268-310` `add_pantry_item` | Takes a conversational-model-reasoned `shelfLifeDays` and converts it to `expiryDate` before calling `pantryService.create()` — architecturally the same "algorithm produced a guess" shape as the receipt path, not a human typing a date into a form field. This distinction drives the `source` parameter design below. |
| Existing freeze toggle | `server/services/pantryService.js:85-117` `toggleFreeze()` + `client/src/components/pantry/PantryTable.jsx:79-81` | Works today, but (a) operates on the entire row's quantity (fixed in TASK-032, not here), and (b) computes its extension from a static **category-level** table (`server/utils/freezeDefaults.js` `FREEZE_EXTENSION_DAYS`) rather than FoodKeeper's per-food `freezerDays` — unified onto the same lookup below. |
| Existing deprecated-column precedent | `server/db/schema.js:11-12` | `households.aiProvider`/`aiApiKey` are kept in the schema marked `// deprecated — kept for schema compat` rather than dropped. Applied to `isFrozen` below — mark deprecated, don't drop. |
| Existing constant+wrapper pattern | `server/utils/freezeDefaults.js` | `FREEZE_EXTENSION_DAYS` (exported object) + `getStaticFreezeExtension()` (wrapper) — the exact shape reused for `CATEGORY_STORAGE_DEFAULTS`/`getDefaultStorageLocation()` below. |
| Chat pantry summary also reads `isFrozen` | `server/routes/ai.js:254` | `frozen: i.isFrozen` inside the chat route's `pantrySummary` construction — needs updating to `i.storageLocation === 'freezer'`. |
| No caching layer anywhere | Confirmed via repo-wide search this session | No cron/scheduler exists; every consumer queries Postgres live, consistent with TASK-026's explicit "no caching" decision. A `storageLocation` edit is visible everywhere immediately. |

---

## Goal

1. Every pantry item — however created (manual add, receipt import, chat agent) — has an explicit storage location (`pantry` / `refrigerator` / `freezer`), defaulted sensibly but always user-editable, and visible in the pantry table.
2. That storage location, not a fixed priority guess, drives expiry calculation whenever the food is in the FoodKeeper dataset — deterministic data beats an algorithmic, storage-blind guess when available.
3. `isFrozen` is retired from application logic (superseded by `storageLocation === 'freezer'`), and `toggleFreeze()` uses the same deterministic calculation as everything else in this task.

---

## Decision 1: One Shared, Explicitly-Parameterized Expiry Helper

**`computeExpiryForStorage()` takes every input it needs as an explicit argument — it does not infer behavior from which function happens to be calling it.**

```
computeExpiryForStorage({ name, category, storageLocation, purchaseDate, existingExpiry, source })
→ returns the expiry value to use (whatever representation this service layer already uses for expiryDate — the helper does not dictate a serialization format)
```

Internal logic, in order:
1. **`source === 'manual'` and `existingExpiry` is non-null → return `existingExpiry` unchanged.** Nothing overrides it.
2. **Otherwise, attempt a FoodKeeper lookup** via `shelfLifeService.lookup(name, storageLocation)`. If a match exists with a nonzero day-count for that storage context, compute the expiry from `purchaseDate` and return it — this is the deterministic value, and it overrides whatever `existingExpiry` held (an algorithmic guess, or nothing).
3. **No FoodKeeper match → return `existingExpiry` unchanged** (whatever it was — an AI guess, or null). This function never fabricates a value it can't ground in either a manually-supplied value or a dataset match.

**`source` describes the provenance of `existingExpiry` in *this specific call* — it is not a record of who created the row historically, and nothing persists it.** There is no provenance column in the schema, and none is needed: the only moment "manual" is actually knowable is whether the *current* request body contains an explicit `expiryDate`. Concretely:

- **`source: 'manual'`** whenever the immediate caller is passing along a value a human just typed into a field in this exact request — i.e., the incoming request body (after Zod `.partial()`/schema validation) actually contains an `expiryDate` key. This reuses the same omitted-vs-explicit mechanism TASK-027 already established for its PATCH semantics: an absent key is different from an explicit value, and only the latter counts as "manual" here.
- **`source: 'ai_estimate'`** for everything else with a non-null `existingExpiry` — including a receipt candidate's `estimatedExpiryDays`-derived guess, the chat agent's `shelfLifeDays`-derived guess (both are algorithm-produced, not human-typed, regardless of a human being present in the chat), **and** an already-saved `expiryDate` being carried into a request that isn't itself supplying a fresh one (e.g. a storage-only edit — see Decision 4). A previously-saved value that nobody is freshly re-entering right now is, for this call's purposes, not a manual entry — it's just whatever was there before, and remains eligible for a better deterministic answer.

This makes the actual business rule visible in one place, driven by one observable fact per call (was `expiryDate` present in *this* request), rather than a caller-identity assumption that could drift out of sync with what's actually in the request.

## Decision 2: Retire `isFrozen`, Add `preFreezeStorageLocation` Instead of Defaulting Thaw to Refrigerator

`storageLocation === 'freezer'` becomes the single source of truth for "is this frozen." `isFrozen` stops being read or written by any application code — `PantryTable.jsx`'s freeze badge/button and the chat route's `pantrySummary` both switch to checking `storageLocation` directly. The column is **kept, marked deprecated**, matching this codebase's existing precedent for `households.aiProvider`/`aiApiKey` — not dropped in this migration.

`frozenAt` and `originalExpiryDate` are kept — freezing is an event (worth recording when it happened) with reversible consequences (the expiry that applied before), not just a state flag.

**Reversed from the prior draft:** thawing does not unconditionally default to `'refrigerator'`. A concrete counterexample makes the information loss real, not hypothetical: an item stored in the **pantry**, then frozen, then thawed, would incorrectly end up in the refrigerator permanently under a fixed-default rule — peanut butter doesn't need refrigeration, but a fixed thaw-target would put it there anyway with no way back except a manual edit. A new nullable column, `preFreezeStorageLocation`, is snapshotted alongside `originalExpiryDate` when freezing (recording whatever `storageLocation` held immediately before, defaulting to `'refrigerator'` only if that value itself was null — e.g. a pre-TASK-031 row) and restored on thaw, then cleared. The marginal migration cost of one more nullable column is effectively zero, so there's no reason to defer this to a later cleanup the way `isFrozen`'s eventual column drop is deferred.

## Decision 3: One Shared Calculation, Including `toggleFreeze()`

Since retiring `isFrozen` already requires restructuring `toggleFreeze()`'s code, there is no additional cost to also routing its expiry math through `computeExpiryForStorage()` (with `source: 'ai_estimate'`, `storageLocation: 'freezer'`) rather than the static `FREEZE_EXTENSION_DAYS` category table. `getStaticFreezeExtension()` is not deleted — it remains the fallback specifically inside `toggleFreeze()` when `computeExpiryForStorage()` returns the pre-existing (unchanged) expiry, i.e. when FoodKeeper has no match for that food. This means chicken breast gets its correct 270-day freezer life via the deterministic path, while a food FoodKeeper doesn't know about still gets a reasonable category-level estimate rather than no change at all.

## Decision 4: Recomputing Expiry When `storageLocation` Is Edited Post-Creation

Editing `storageLocation` via `PATCH /api/pantry/:id` (not the dedicated split flow in TASK-032) calls `computeExpiryForStorage()` following Decision 1's rule exactly, with no special case:

- **If the same PATCH request body also contains an explicit `expiryDate` key** — the user is deliberately setting both at once — pass `source: 'manual'`, `existingExpiry` = that newly-supplied value. Decision 1's rule 1 applies and it's returned unchanged, protecting the fresh manual entry.
- **If the PATCH request body has no `expiryDate` key** (a storage-only edit — the common case) — pass `source: 'ai_estimate'`, `existingExpiry` = the item's current, already-saved `expiryDate`. Per Decision 1, a previously-saved value that nobody is freshly re-typing right now is not being treated as a manual entry in this call, so it's eligible for the FoodKeeper lookup to replace it with a value correct for the *new* storage location.

This is the same rule as every other call site, not a special case for edits — the only input that changes is which `expiryDate` key presence check applies, exactly mirroring TASK-027's PATCH-semantics precedent.

**Anchor date is always the item's `purchaseDate`** (or `createdAt` if null) — never "today," and never the item's *current* `expiryDate`. FoodKeeper's day-counts are relative to acquisition. This can produce an already-past expiry for an old purchase moved to a shorter-lived storage mode — accurate given the new assignment, not a bug.

## Decision 5: Category Defaults as an Exported Constant

Matching the existing pattern in `server/utils/freezeDefaults.js` (`FREEZE_EXTENSION_DAYS` constant + `getStaticFreezeExtension()` wrapper): `server/utils/pantryDefaults.js` exports `CATEGORY_STORAGE_DEFAULTS` (e.g. `Frozen` → `'freezer'`; `Meat|Seafood|Dairy|Produce|Bakery` → `'refrigerator'`; `Pantry|Beverages|Condiments|Other` → `'pantry'`) as a plain object, with `getDefaultStorageLocation(category)` as a thin wrapper. Reused by the manual-add form's initial state, the receipt-review preview's per-row default, and the chat tool's fallback.

---

## Allowed Files

- `server/db/schema.js` — add `storageLocation`, `preFreezeStorageLocation`; mark `isFrozen` deprecated (comment only, column retained)
- `server/db/migrations/0014_pantry_storage.sql` (new), `server/db/migrations/meta/_journal.json`
- `server/services/shelfLifeService.js` — `lookup()` accepts an optional `storageLocation` param
- `server/services/pantryService.js` — `enrichWithExpiry()`, `bulkCreate()`, new `computeExpiryForStorage()` (Decision 1), `toggleFreeze()` rewritten onto `storageLocation` + `preFreezeStorageLocation` + the shared helper (Decisions 2/3), `update()` recompute-on-storage-edit (Decision 4)
- `server/utils/pantryDefaults.js` (new) — `CATEGORY_STORAGE_DEFAULTS` + `getDefaultStorageLocation()`
- `server/routes/pantry.js` — extend `createSchema`/`updateSchema` with `storageLocation`
- `server/routes/ai.js` — narrowly: `/parse-receipt` candidate schema gains a defaulted `storageLocation`; `add_pantry_item` chat tool gains an optional `storageLocation` param and calls `computeExpiryForStorage()` with `source: 'ai_estimate'`; the chat route's `pantrySummary` construction (`frozen: i.isFrozen` → `frozen: i.storageLocation === 'freezer'`). No other part of this file changes.
- `client/src/components/pantry/AddItemModal.jsx` — storage-location field
- `client/src/components/pantry/ReceiptUpload.jsx` — storage-location column in the preview table, defaulted per row, editable
- `client/src/components/pantry/PantryTable.jsx` — visible storage-location indicator per row; Freeze/Thaw button and badge read `storageLocation` instead of `isFrozen`

## Forbidden Files

- `server/services/shoppingService.js` — unrelated
- `server/services/aiService.js` — no AI prompt changes in this task; defaults are computed deterministically from `category`, not by asking the model
- `client/src/components/recipes/*` — unrelated
- Quantity split, servings-per-unit — see [TASK-032](TASK-032-spec.md) / [TASK-033](TASK-033-spec.md)

---

## Constraints

1. **Migration is additive; only backfill is the narrow `isFrozen → storageLocation` case.** `storageLocation` is nullable with no general backfill. The one exception: `UPDATE pantry_items SET storage_location = 'freezer' WHERE is_frozen = true` — narrow and fully-determined. **This migration assumes existing freeze-related data is internally consistent** (e.g. no row has `isFrozen = false` with a non-null `originalExpiryDate`, which would indicate a pre-existing data anomaly). This assumption is not verified or repaired by the migration itself — worth a one-time manual spot-check against production before running it, not an automated safeguard.
2. **`storage_location` is constrained at the DB level** — a `CHECK (storage_location IN ('pantry', 'refrigerator', 'freezer'))` constraint or a native Postgres enum type; either is acceptable, implementer's choice (a native enum is marginally preferable for a fixed three-value set, but the CHECK constraint achieves the same practical goal of preventing case-drift). This deviates from this schema's usual all-Zod-no-DB-constraint convention (e.g. `category` has neither) but is justified for a brand-new column at trivial cost.
3. **`getDefaultStorageLocation()` is the single source of default logic** — reused by all three creation paths, not duplicated.
4. **`computeExpiryForStorage()`'s override behavior is entirely determined by its explicit parameters** (`source`, `existingExpiry`), never by which calling function invoked it — see Decision 1. `source: 'manual'` is set if and only if the current request body contains an explicit `expiryDate` key (post-validation); every other case with a non-null `existingExpiry` passes `source: 'ai_estimate'`, including a plain storage-location edit carrying forward an already-saved value (Decision 4). Do not special-case behavior inside `create()`/`update()`/`bulkCreate()`/etc. beyond this one presence check.
5. **`isFrozen` is deprecated, not deleted** — no application code reads or writes it after this task; the column stays in the schema, commented, per this codebase's established precedent.
6. **Editing `storageLocation` via `PATCH /api/pantry/:id` recomputes expiry from `purchaseDate`** via `computeExpiryForStorage()`, using `source: 'manual'` only if the same request explicitly supplies `expiryDate`, otherwise `source: 'ai_estimate'` (Decision 4) — this is the same presence-check rule as every other call site, not an edit-specific exception.
7. **`toggleFreeze()` uses `computeExpiryForStorage()` as its primary source**, falling back to `getStaticFreezeExtension()` only when FoodKeeper has no match (Decision 3).
8. **Freezing snapshots `preFreezeStorageLocation`; thawing restores it and clears the snapshot** (Decision 2) — not a fixed default target.
9. **Pantry table visibly distinguishes storage location** — e.g. a small badge/icon per row — so two rows of the same food are distinguishable at a glance.

---

## Schema Addition

```sql
-- 0014_pantry_storage.sql
ALTER TABLE pantry_items ADD COLUMN storage_location text
  CHECK (storage_location IN ('pantry', 'refrigerator', 'freezer'));
ALTER TABLE pantry_items ADD COLUMN pre_freeze_storage_location text
  CHECK (pre_freeze_storage_location IN ('pantry', 'refrigerator', 'freezer'));

-- Narrow, fully-determined backfill (Constraint 1) — assumes existing freeze data is consistent
UPDATE pantry_items SET storage_location = 'freezer' WHERE is_frozen = true;
```

```js
// server/db/schema.js — pantryItems additions
storageLocation:          text('storage_location'),            // 'pantry' | 'refrigerator' | 'freezer' | null
preFreezeStorageLocation: text('pre_freeze_storage_location'),  // snapshotted on freeze, restored+cleared on thaw
// isFrozen deprecated as of TASK-031 — kept for schema compat, use storageLocation === 'freezer' instead.
```

## API Additions

`createSchema`/`updateSchema` in `pantry.js` gain:
```js
storageLocation: z.enum(['pantry', 'refrigerator', 'freezer']).nullable().optional(),
```

---

## Dependency Chain

Editing:
- `server/db/schema.js`, `server/db/migrations/0014_pantry_storage.sql`, `server/db/migrations/meta/_journal.json`
- `server/services/shelfLifeService.js`, `server/services/pantryService.js`
- `server/utils/pantryDefaults.js` (new)
- `server/routes/pantry.js`, `server/routes/ai.js` (narrowly — see Allowed Files)
- `client/src/components/pantry/AddItemModal.jsx`, `ReceiptUpload.jsx`, `PantryTable.jsx`

Reads (pattern reference only):
- `server/utils/freezeDefaults.js` — static extension table (now the fallback) and existing constant+wrapper pattern
- `server/db/schema.js:11-12` — deprecated-column precedent
- `server/data/foodkeeper.json` — sampled this session to confirm per-storage day-count structure
- `server/routes/ai.js:254`, `server/routes/ai.js:268-310` — chat's existing `isFrozen` read and AI-reasoned `shelfLifeDays`

Irrelevant:
- `server/services/shoppingService.js`
- `server/services/aiService.js`
- `client/src/components/recipes/*`
- Split and servings-per-unit — see TASK-032/TASK-033

---

## Acceptance Criteria

- [ ] Manual add: storage location field present, defaults from selected category via `getDefaultStorageLocation()`, user can override before saving
- [ ] Receipt review: each candidate row shows a storage-location selector, defaulted per its `category`, editable before confirming
- [ ] Chat agent: `add_pantry_item` accepts an optional storage location; its AI-reasoned expiry is subject to FoodKeeper override the same as receipt items (`source: 'ai_estimate'`)
- [ ] Creating a pantry item for a food present in FoodKeeper (e.g. "chicken breast") with `storageLocation: 'freezer'` produces an expiry ~270 days out; the same food with `'refrigerator'` produces ~2 days
- [ ] A food not in FoodKeeper falls back to whatever `expiryDate` was already supplied — no crash, no null expiry
- [ ] A receipt-imported item's AI-guessed `expiryDate` is overridden by the FoodKeeper value when a match exists — the direct regression test for the reported bug
- [ ] A manually-added item's explicitly-typed `expiryDate` is never overridden by a FoodKeeper match
- [ ] Editing an existing item's `storageLocation` (e.g. fridge → freezer) recomputes its expiry from `purchaseDate`
- [ ] Editing `storageLocation` in the same request as an explicit new `expiryDate` respects the explicit value
- [ ] **Editing storage from freezer to pantry for a food with no FoodKeeper pantry-context data does not erase or null out the existing expiry** — confirms `computeExpiryForStorage()`'s no-match fallback (rule 3) holds on the edit path, not just at creation
- [ ] Freeze/Thaw button continues to work, now reading/writing `storageLocation` instead of `isFrozen`; freezing a FoodKeeper-known food (e.g. chicken) produces the FoodKeeper freezer day-count (270), not the static category default (120)
- [ ] Thawing an item returns it to whatever `preFreezeStorageLocation` recorded (not unconditionally `'refrigerator'`) — verify specifically with a pantry-stored item (e.g. peanut butter) frozen then thawed, ending back in `'pantry'`
- [ ] Freeze → thaw → freeze again on the same item correctly refreshes `preFreezeStorageLocation` to whatever the location was immediately before the *second* freeze, not a stale value left over from the first cycle
- [ ] Existing pantry rows (`storageLocation = null`, `isFrozen` from before this migration) continue to display and compute expiry correctly — the backfill means an already-frozen item still shows as frozen post-migration
- [ ] Pantry table visibly shows each item's storage location
- [ ] Chat's pantry summary correctly reflects frozen status via `storageLocation`

Verification is manual smoke testing against local dev (and, per this project's established pattern, ultimately against production Neon with explicit approval before the migration is applied) — no automated test suite exists in this repo.

---

## Known Risks

- **Production migration required** — must be explicitly approved and hand-applied in Neon's SQL Editor, not auto-run.
- **Migration backfill assumes existing freeze-related data is internally consistent** (Constraint 1) — not verified or repaired by the migration itself.
- **FoodKeeper coverage is limited (251 entries)** — most branded/packaged grocery items won't match at all; impact concentrates on whole/base foods.
- **Fractional quantity/split precision** is not addressed at the schema level (relevant once TASK-032 ships) — no per-unit precision metadata exists to build a rule from.
- No automated regression suite — verification is manual.

## Out of Scope

- Quantity splitting across storage locations — see [TASK-032](TASK-032-spec.md)
- Servings-per-unit tracking — see [TASK-033](TASK-033-spec.md)
- Backfilling `storageLocation` on pre-existing non-frozen rows
- A UI to bulk-set storage location across multiple existing items at once
- Dropping the deprecated `isFrozen` column — a later cleanup, not bundled here

---

## Note to User on Approval Status

Marked approved this round: the architect's round-3 review explicitly stated they'd consider this architecturally approved once the three remaining clarifications (the `source`/Decision 4 contradiction, provenance being per-request rather than persisted, and not mandating a return-value format) were resolved — all three are incorporated above, and no new structural questions were raised across three full review rounds. This remains the one task in the batch requiring a production Neon migration — that step still needs your explicit go-ahead when implementation actually runs it, independent of this spec-level approval.
