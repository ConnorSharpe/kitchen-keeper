# TASK-027 — Shopping List Item Edit & Delete

Version: DRAFT-2 — APPROVED FOR IMPLEMENTATION (user sign-off after round 1)

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-1 | 8.5/10 — Approve with minor revisions | Praised: scope control (allowed/forbidden files, no schema change), reuse of `toggleItem()`'s ownership pattern, clean API separation (dedicated PATCH/DELETE routes vs. overloading), validation reuse via `manualItemSchema.partial()`, not renumbering `sortOrder`, clearing `hasUnitMismatch` on edit. Requested: explicit PATCH merge semantics (omit vs. null), empty-string unit normalization, explicit quantity-validation statement, documented double-delete race behavior, explicit client state-update strategy (replace vs. refetch), explicit `isChecked` preservation on edit, single-vs-multi row edit mode, keyboard shortcuts (Enter/Escape), delete-while-editing behavior, and error-handling behavior (keep form open vs. discard). Also suggested renaming `updateItem()`/`deleteItem()` to be shopping-list-specific (declined, see Known Risks — inconsistent with this file's existing unprefixed naming convention: `toggleItem`, `addManualItem`, `deleteList`). All actionable items incorporated in DRAFT-2; several "open questions" the architect couldn't answer (no file access) turned out to already have concrete answers in existing code, cited inline where relevant. |
| DRAFT-2 | Approved by user directly (no further architect round) | User reviewed the round-1 incorporation and signed off without sending DRAFT-2 back through another architect pass. Approved for implementation as written. |

---

## Codebase Reality Check

| What exists | File | Notes |
|---|---|---|
| Item toggle (check/uncheck) | `server/services/shoppingService.js:38` `toggleItem()` | Ownership pattern: verify list belongs to household, then verify item belongs to list. Two-step 404. This is the pattern to copy for edit/delete. |
| Manual item add | `server/services/shoppingService.js:71` `addManualItem()` | Appends at `maxSort + 1`; no gap-filling needed elsewhere in the file, `sortOrder` already tolerates gaps (items are ordered, not renumbered) after `deleteList`/cascade. |
| List delete (whole list) | `server/services/shoppingService.js:60` `deleteList()` + `client/src/pages/ShoppingPage.jsx:29` | Has a `window.confirm()` guard client-side — appropriate because it destroys an entire list. No equivalent exists for a single item today; there is no way to remove or fix one line. |
| Item row rendering | `client/src/components/shopping/ShoppingList.jsx:169` `ItemRow` | Currently only renders a checkbox + text + optional mismatch badge. No edit/delete affordance per row. |
| Manual-add form pattern | `client/src/components/shopping/ShoppingList.jsx:115-158` | Existing 3-field (name/qty/unit) inline form — the edit UI should reuse this exact layout, not invent a new one. |
| Unit-mismatch flag | `server/db/schema.js` `shoppingListItems.hasUnitMismatch` | Set by `buildFromRecipes()` when the same ingredient appears with conflicting units across recipes ([shoppingService.js:119](../../server/services/shoppingService.js)). Currently nothing ever clears it once set — editing an item is the natural point to resolve it. |

---

## Goal

Let a user fix or remove a single shopping list item without deleting and rebuilding the whole list. Two new actions on `ShoppingList.jsx`: **edit** (name/quantity/unit) and **delete** (single item), both scoped to items — list-level delete is untouched.

---

## Decision: Edit Clears `hasUnitMismatch`

Editing a mismatched item's quantity/unit **is** the manual resolution the ⚠️ warning exists to prompt (see [shoppingService.js:190](../../server/services/shoppingService.js), `buildFromRecipes`'s Known Risk in TASK-023-era design). Once a user has hand-corrected the row, the warning no longer applies to it. `updateItem()` unconditionally sets `hasUnitMismatch: false` on any edit — it does not try to detect whether the edit "actually" resolved a conflict, since there's nothing left to compare against once the row is user-owned.

## Decision: No Confirmation on Item Delete

List delete has a `window.confirm()` because it's destructive to the whole list at once. A single item is low-stakes and trivially reversible (re-add via the existing manual-add form takes seconds) — matching the weight of the existing "×" remove-ingredient button in `RecipeReviewModal.jsx`, which also has no confirmation. Item delete follows that precedent, not the list-delete precedent.

## Decision: PATCH Merge Semantics — Omit Means Unchanged

**A field absent from the PATCH body leaves that column unchanged; there is no way to explicitly null out `ingredientName`, `quantity`, or `unit` via this endpoint** (quantity/unit can be nulled by the existing `manualItemSchema` shape, e.g. `{ quantity: null }`, but an *omitted* key is different from an *explicit* `null` — only the latter changes the value). This is not a new pattern — it's how `pantryService.update()` already works in this exact codebase: the validated body (from a `.partial()` schema) only contains keys actually sent, and `db.update(...).set({ ...data, updatedAt })` leaves any column whose key is absent from `data` untouched. `updateItem()` follows the identical pattern for consistency with the rest of the service layer.

## Decision: Client State Updates Follow Existing In-File Precedent, No Refetch

`ShoppingList.jsx` already has two working examples of this exact pattern: `handleToggle` replaces the toggled item in place via `setItems(prev => prev.map(i => i.id === itemId ? data.item : i))` ([ShoppingList.jsx:36](../../client/src/components/shopping/ShoppingList.jsx)), and `handleAddItem` appends the new item via `setItems(prev => [...prev, data.item])` ([ShoppingList.jsx:55](../../client/src/components/shopping/ShoppingList.jsx)) — neither refetches the list. Edit and delete follow the same style: `handleEditSave` replaces via `.map()` using the PATCH response; `handleDelete` removes via `.filter()`. No new fetch pattern is introduced.

## Decision: Empty-String Normalization Happens Client-Side, Matching the Add Form

The existing add-item form does not send raw empty strings to the server — it normalizes them in the browser before the request: `unit: addUnit.trim() || null` and `quantity: addQty ? Number(addQty) : null` ([ShoppingList.jsx:51-52](../../client/src/components/shopping/ShoppingList.jsx)). The server-side schema (`manualItemSchema`) never actually sees `""` from the existing add flow, and doesn't need to normalize it itself. The edit form must replicate this exact client-side normalization before calling PATCH — not add new server-side trimming logic, which would be inconsistent with how the add path already works.

---

## Allowed Files

- `server/routes/shopping.js` — add `PATCH /:id/items/:itemId` and `DELETE /:id/items/:itemId`
- `server/services/shoppingService.js` — add `updateItem()` and `deleteItem()`
- `client/src/components/shopping/ShoppingList.jsx` — per-row edit (inline form, reusing the existing manual-add field layout) and delete affordances

## Forbidden Files

- `client/src/pages/ShoppingPage.jsx` — list-level operations (build, delete list) are unrelated
- `client/src/components/shopping/BuildListModal.jsx` — unrelated, build-time flow only
- `server/services/shoppingService.js`'s `buildFromRecipes()` — do not touch aggregation logic

---

## Constraints

1. **Ownership check mirrors `toggleItem()` exactly** — verify the list belongs to `householdId`, then verify the item belongs to that list, returning `not_found` (→ 404) at either step. Do not shortcut with a single join query; match the existing two-step pattern already used three times in this file for consistency. A second delete of an already-deleted item (e.g. two browser tabs) hits the same ownership-lookup 404 path — no special-casing needed, this falls out of the existing pattern for free.
2. **Edit clears `hasUnitMismatch`; `isChecked` and `sortOrder` are preserved, not editable through this endpoint** — `isChecked` remains exactly as it was before the edit (the PATCH body has no field for it, and `updateItem()` must not touch that column); `sortOrder` stays creation-time-assigned, same as today.
3. **`ingredientName` cannot be edited to blank** — reuse (a `.partial()` of) the existing `manualItemSchema` from `shopping.js` for the PATCH body so name/quantity/unit validation stays identical to the add-item path; a blank name is already rejected there (`min(1)`), and quantity is already constrained to positive-or-null (`z.coerce.number().positive().nullable().optional()` — zero and negative values are already rejected by this reused schema, nothing new to add).
4. **PATCH merge semantics: omitted fields are left unchanged** — see Decision above; matches `pantryService.update()`'s existing behavior in this codebase.
5. **Empty-string unit/quantity normalization happens client-side before the request is sent**, mirroring the existing add-form's `trim() || null` / `addQty ? Number(addQty) : null` pattern — see Decision above. Do not add server-side empty-string handling that doesn't already exist for the add path.
6. **Delete does not renumber `sortOrder`** — matches existing tolerance for gaps; no other code assumes contiguous values.
7. **No confirmation dialog for item delete** — see Decision above.
8. **Client state updates via `.map()`/`.filter()` on the existing `items` state, no refetch** — see Decision above.
9. **Only one row may be in edit mode at a time** — a single `editingId` piece of state (not per-row local state) controls which row, if any, shows the inline edit form. Opening edit on a different row while one is already open closes the first without saving (equivalent to Cancel).
10. **Keyboard shortcuts in the edit form: Enter saves, Escape cancels** — matches the expected behavior of an inline single-purpose form.
11. **Clicking delete on a row currently in edit mode deletes it immediately** — same no-confirmation behavior as delete on a non-editing row (Constraint 7); edit mode is simply moot once the row is gone. Do not add a separate "cancel edit first" requirement.
12. **A failed PATCH keeps the edit form open with the user's in-progress edits intact and shows a toast error** — do not discard input or exit edit mode on failure. Matches the existing precedent in `handleAddItem`'s catch block, which does not clear `addName`/`addQty`/`addUnit` on error (only the success path resets them).

---

## API Additions

```ts
PATCH /api/shopping/:id/items/:itemId
Body: { ingredientName?: string, quantity?: number|null, unit?: string|null }
→ { item: ShoppingListItem }   // hasUnitMismatch forced false

DELETE /api/shopping/:id/items/:itemId
→ 204 No Content
```

---

## Dependency Chain

Editing:
- `server/routes/shopping.js`
- `server/services/shoppingService.js`
- `client/src/components/shopping/ShoppingList.jsx`

Reads (pattern reference only):
- `server/services/shoppingService.js:38-57` (`toggleItem`) — ownership pattern to copy
- `client/src/components/shopping/ShoppingList.jsx:115-158` — existing add-item form layout to reuse for the edit form

Irrelevant:
- `client/src/pages/ShoppingPage.jsx`
- `client/src/components/shopping/BuildListModal.jsx`
- `server/db/migrations/` — no schema change

---

## Acceptance Criteria

- [ ] Every item row (checked or unchecked) has an edit affordance and a delete affordance
- [ ] Clicking edit reveals inline name/qty/unit inputs pre-filled with current values; Save persists via `PATCH`, Cancel discards without a request
- [ ] Editing a row that had the ⚠️ unit-mismatch badge clears the badge after save
- [ ] Editing a row preserves its `isChecked` state — an editing a checked item keeps it checked (and styled accordingly) after save
- [ ] Delete removes the item immediately, no confirmation prompt; checked/unchecked counts update
- [ ] Editing or deleting an item belonging to another household's list returns 404
- [ ] Editing with a blank name is rejected client-side (button disabled / no request sent) and server-side (400) if bypassed
- [ ] Submitting a PATCH with only `quantity` set leaves `ingredientName` and `unit` unchanged (merge-semantics check)
- [ ] Typing a unit of only whitespace and saving results in `unit: null`, not an empty string (client-side normalization check)
- [ ] Opening edit on row B while row A is already being edited closes row A's edit form without saving
- [ ] Pressing Enter in the edit form saves; pressing Escape cancels
- [ ] Clicking delete on a row currently in edit mode removes it immediately, same as any other row
- [ ] A failed PATCH (e.g. simulate a network error) leaves the edit form open with the typed values intact and shows a toast error
- [ ] Toggling check state on an item still works unchanged after this task (regression check — `toggleItem` untouched)

---

## Known Risks

- No automated tests exist in this repo (see TASK-024/025/026 precedent) — verification is manual smoke testing against local dev.

### Explicitly declined (from architect review round 1)

- **Renaming `updateItem()`/`deleteItem()` to `updateShoppingListItem()`/`deleteShoppingListItem()`.** The architect's reasoning ("item" is generic) is sound in isolation, but `shoppingService.js`'s existing functions — `toggleItem`, `addManualItem`, `deleteList` — are already unprefixed, relying on the module name for context. Prefixing only the two new functions would make them the odd ones out rather than more readable. Keeping the existing local convention.

## Out of Scope

- Reordering items via drag-and-drop
- Bulk edit/delete (multi-select)
- Undo for a deleted item
