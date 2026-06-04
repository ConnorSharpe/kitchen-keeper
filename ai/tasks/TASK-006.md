# TASK-006 — readyDate / Ripening State

Version: DRAFT-3
Status: Awaiting architect review (Round 3).

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial design |
| DRAFT-2 | Not approved | getRipeningState() domain helper, explicit toISO guard, row class unification, field placement |
| DRAFT-3 | Pending | Schema typo fixed, ExpiryBadge decoupled (status prop at call site), Zod ordering confirmed |

## DRAFT-2 → DRAFT-3 Changes

### Adopted (real issues)

**Must-Fix #1 (schema typo):** Real bug introduced in the spec text. DRAFT-2 wrote
`expiryDate: text('ready_date')` — mapping two Drizzle fields to the same DB column.
Corrected to `expiryDate: text('expiry_date'), readyDate: text('ready_date')`.

**Must-Fix #3 (ExpiryBadge implicit coupling):** Adopted. `ExpiryBadge` is a local
function inside `PantryTable.jsx` (already in Allowed Files — no scope expansion).
Row render now computes `badgeStatus = item.isFrozen ? 'ok' : expiryStatus` explicitly
and passes it as a `status` prop. ExpiryBadge no longer accepts `isFrozen` — it becomes
a pure display component. Consistent with single-source-of-truth principle.

### Rejected with explanation (false alarms or out of scope)

**Must-Fix #2 (Zod ordering risk):** False alarm. The actual definition at
`server/routes/pantry.js:10` is:
`const dateField = z.string().datetime().nullable().optional();`
In Zod v3, `.nullable().optional()` and `.optional().nullable()` produce the same
resulting type (`string | null | undefined`). The ordering concern does not apply.
The spec now quotes this line explicitly so future reviewers can verify without
file access.

**Important #4 (getItemState unified struct):** Not adopted. Introducing a helper
that returns `{ temporal, expiry }` would require callers to destructure and
re-bind two values — no simpler than two named `const` calls. Two clearly-named
local variables (`ripeState`, `expiryStatus`) in the component are more readable
than a combined domain struct for this use case. The existing model is unified
enough: all frozen/ripening priority logic is in `getRipeningState`, all expiry
classification is in `getExpiryStatus`. Deferred to a future architectural pass.

**Important #5 (field placement):** Acknowledged. Current placement (Ready date
below purchase/expiry grid as a secondary field) is deliberately non-linear. This
is a conscious trade-off against restructuring familiar UI. Documented as a known
design decision, not an oversight.

---

# Goal

Allow users to tag a pantry item with a "ready date" — a future date when the item
becomes usable. Before that date the item shows a distinct "Not ready" visual state
(purple row tint, "Ready in Xd" status label). After the ready date, normal expiry
logic resumes.

Primary use cases: ripening avocados/bananas, fermenting sourdough starter, aging
cheese, marinating meat, proofing bread, homemade yogurt.

---

# Allowed Files

**Creating:**
- `server/db/migrations/0002_ready_date.sql` — migration SQL (run manually in Neon)

**Editing:**
- `server/db/schema.js` — add `readyDate` column definition
- `server/routes/pantry.js` — add `readyDate` to createSchema / updateSchema
- `client/src/utils/expiry.js` — add `getRipeningState()` + ripening helpers + extend badge/row classes
- `client/src/components/pantry/AddItemModal.jsx` — add "Ready date" form field
- `client/src/components/pantry/PantryTable.jsx` — add ripening state + decouple ExpiryBadge

---

# Forbidden Files

- `server/services/pantryService.js` — spread pattern picks up `readyDate` automatically
- `client/src/pages/PantryPage.jsx` — passes item data through untouched
- `server/routes/auth.js`, `server/routes/household.js` — unrelated
- All recipe, shopping list, and chat routes/services — unrelated
- `client/src/components/pantry/BarcodeScanner.jsx` — unrelated
- `client/src/components/pantry/ReceiptUpload.jsx` — unrelated

---

# Constraints

1. **Nullable column only.** `ready_date text` with no default and no NOT NULL.
   All existing rows implicitly get NULL — no backfill needed.

2. **Migration is manual.** Run `0002_ready_date.sql` directly in the Neon SQL Editor
   (consistent with project history on `0001_households.sql`). Update `schema.js` to
   match so Drizzle's query builder reflects the live schema.

3. **Status priority order — single source of truth via `getRipeningState(item)`:**
   ```
   item.isFrozen = true         → 'frozen'
   isRipening(item.readyDate)   → 'ripening'  (readyDate strictly > today)
   else                         → 'ready'
   ```
   All row coloring, status labels, and badge status are derived from this call.
   No inline priority logic in components.

4. **readyDate is additive and optional.** Items without `readyDate` behave exactly
   as before. Zero behavior regression for existing items.

5. **Date semantics: UTC midnight, consistent with all existing date fields.**
   All comparisons normalize via `date.setUTCHours(0, 0, 0, 0)` on both client
   and server. This ensures agreement regardless of browser timezone, and is the
   required basis for TASK-009 (push notifications) server-side cron jobs.

6. **`toISO` at call site must be explicit:**
   Use `form.readyDate ? toISO(form.readyDate) : null` — not `toISO(form.readyDate)`.
   Apply the same explicit guard to `purchaseDate` and `expiryDate` for consistency.

7. **`dateField` is already correctly typed.** Exact definition at
   `server/routes/pantry.js:10`:
   ```js
   const dateField = z.string().datetime().nullable().optional();
   ```
   In Zod v3, this accepts: valid ISO datetime strings, `null`, and `undefined`.
   It rejects non-ISO strings (e.g. `"not-a-date"`) with a 422 validation error.
   Adding `readyDate: dateField` requires no wrapper or modification to `dateField`.

8. **ExpiryBadge decoupled from domain state.** ExpiryBadge now accepts a pre-computed
   `status` prop instead of `isFrozen`. Row render computes `badgeStatus` explicitly.
   ExpiryBadge becomes a pure display component — no domain logic inside.

9. **No sorting or filtering by readyDate.** Out of scope.

10. **No AI/chat integration.** Recipe suggestion logic is TASK-008.

---

# Dependency Chain

Creating:
- `server/db/migrations/0002_ready_date.sql`

Editing:
- `server/db/schema.js`
- `server/routes/pantry.js`
- `client/src/utils/expiry.js`
- `client/src/components/pantry/AddItemModal.jsx`
- `client/src/components/pantry/PantryTable.jsx`

Irrelevant:
- `server/services/pantryService.js`
- `client/src/pages/PantryPage.jsx`
- All `server/routes/` except `pantry.js`
- `client/src/components/pantry/BarcodeScanner.jsx`
- `client/src/components/pantry/ReceiptUpload.jsx`
- `client/src/utils/openFoodFacts.js`

---

# Implementation Plan

## 1. `server/db/migrations/0002_ready_date.sql` — NEW

```sql
-- Migration: add ready_date to pantry_items for ripening/readiness state
-- Run manually in the Neon SQL Editor.
-- Safe: nullable column, no backfill, no constraints.

ALTER TABLE "pantry_items" ADD COLUMN "ready_date" text;
```

---

## 2. `server/db/schema.js` — Modify

Add `readyDate` after `expiryDate`:

```js
// Existing:
expiryDate:         text('expiry_date'),
// Add:
readyDate:          text('ready_date'),
// Existing continues:
isFrozen:           boolean('is_frozen').notNull().default(false),
```

---

## 3. `server/routes/pantry.js` — Modify

Add `readyDate` to the validation schema. `dateField` (line 10) is already
`z.string().datetime().nullable().optional()` — no wrapper needed:

```js
const createSchema = z.object({
  name:         z.string().min(1, 'Name is required').max(200),
  category:     z.string().min(1).max(50).default('Other'),
  quantity:     z.coerce.number().positive().default(1),
  unit:         z.string().min(1).max(50).default('item'),
  purchaseDate: dateField,
  expiryDate:   dateField,
  readyDate:    dateField,   // ← ADD; inherits nullable().optional() from dateField
  notes:        z.string().max(500).nullable().optional(),
});

const updateSchema = createSchema.partial(); // derives readyDate automatically
```

No route handler changes. `pantryService` spreads the validated body.

---

## 4. `client/src/utils/expiry.js` — Modify

### 4a. Ripening temporal helpers

```js
// Returns days until readyDate. Positive = not yet ready. 0 = ready today. null = no readyDate.
// UTC midnight-normalized — same basis as getExpiryDays.
export function getRipeningDays(readyDateStr) {
  if (!readyDateStr) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const ready = new Date(readyDateStr);
  ready.setUTCHours(0, 0, 0, 0);
  return Math.round((ready - today) / (1000 * 60 * 60 * 24));
}

// True only when readyDate is strictly in the future (> 0 days).
// readyDate = today → item is ready → false.
export function isRipening(readyDateStr) {
  const days = getRipeningDays(readyDateStr);
  return days !== null && days > 0;
}
```

### 4b. `getRipeningState` — single source of truth for item status priority

```js
// Returns the effective temporal state of a pantry item in priority order.
// Callers derive all row coloring and status labels from this one call.
export function getRipeningState(item) {
  if (item.isFrozen) return 'frozen';
  if (isRipening(item.readyDate)) return 'ripening';
  return 'ready';
}
```

### 4c. Extend `getExpiryRowClass`

```js
export function getExpiryRowClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-50';
    case 'critical': return 'bg-red-50';
    case 'warning':  return 'bg-amber-50';
    case 'ripening': return 'bg-purple-50';   // ← ADD
    default:         return '';
  }
}
```

### 4d. Extend `getExpiryBadgeClass`

```js
export function getExpiryBadgeClass(status) {
  switch (status) {
    case 'expired':  return 'bg-red-100 text-red-700';
    case 'critical': return 'bg-red-100 text-red-600';
    case 'warning':  return 'bg-amber-100 text-amber-700';
    case 'ok':       return 'bg-green-100 text-green-700';
    case 'ripening': return 'bg-purple-100 text-purple-700'; // ← ADD (forward-compat)
    default:         return 'bg-gray-100 text-gray-500';
  }
}
```

---

## 5. `client/src/components/pantry/PantryTable.jsx` — Modify

### 5a. Imports

```js
import {
  getExpiryStatus, getExpiryRowClass, getExpiryBadgeClass, getExpiryLabel,
  getRipeningState, getRipeningDays,   // ← ADD
} from '../../utils/expiry.js';
```

### 5b. `ExpiryBadge` — accept pre-computed `status` prop

Change `ExpiryBadge` from accepting `isFrozen` to accepting a pre-computed `status`.
This makes it a pure display component with no domain logic inside.

```jsx
// Before:
function ExpiryBadge({ expiryDate, isFrozen }) {
  if (!expiryDate) return <span className="text-gray-400 text-xs">—</span>;
  const status = isFrozen ? 'ok' : getExpiryStatus(expiryDate);
  const cls = getExpiryBadgeClass(status);
  const label = getExpiryLabel(expiryDate);
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// After:
function ExpiryBadge({ expiryDate, status }) {
  if (!expiryDate) return <span className="text-gray-400 text-xs">—</span>;
  const cls = getExpiryBadgeClass(status);
  const label = getExpiryLabel(expiryDate);
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
```

### 5c. Row render — all state derived from two named helpers, no inline logic

```jsx
{items.map((item) => {
  const ripeState    = getRipeningState(item);           // 'frozen' | 'ripening' | 'ready'
  const expiryStatus = getExpiryStatus(item.expiryDate); // always computed; used when ripeState === 'ready'

  // For row coloring: frozen → no tint; ripening → purple; ready → existing expiry tint.
  const rowStatus = ripeState === 'frozen'   ? 'ok'
                  : ripeState === 'ripening' ? 'ripening'
                  : expiryStatus;
  const rowCls = ripeState === 'frozen' ? '' : getExpiryRowClass(rowStatus);

  // For ExpiryBadge: frozen suppresses urgency; ripening does NOT affect badge
  // (badge always shows the expiry date with its own status).
  const badgeStatus = item.isFrozen ? 'ok' : expiryStatus;

  return (
    <tr key={item.id} className={`${rowCls} transition-colors`}>
      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
        {item.name}
        {item.isFrozen && (
          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">
            ❄ Frozen
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.category}</td>
      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.quantity}</td>
      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.unit}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <ExpiryBadge expiryDate={item.expiryDate} status={badgeStatus} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <StatusLabel ripeState={ripeState} expiryStatus={expiryStatus} readyDate={item.readyDate} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <ActionButton onClick={() => onEdit(item)} title="Edit" label="Edit" />
          <ActionButton onClick={() => onMarkUsed(item.id)} title="Mark as used (I cooked this)" label="✓ Used" success />
          <ActionButton onClick={() => onToggleFreeze(item.id)} title={item.isFrozen ? 'Unfreeze' : 'Freeze'} label={item.isFrozen ? '🌡 Thaw' : '❄ Freeze'} />
          <ActionButton onClick={() => onDelete(item.id)} title="Delete (I threw this away)" label="Delete" danger />
        </div>
      </td>
    </tr>
  );
})}
```

### 5d. `StatusLabel` — updated prop signature

```jsx
function StatusLabel({ ripeState, expiryStatus, readyDate }) {
  if (ripeState === 'frozen') {
    return <span className="text-blue-600 text-xs">Frozen</span>;
  }
  if (ripeState === 'ripening') {
    const days = getRipeningDays(readyDate);
    const label = days === 1 ? 'Ready tomorrow' : `Ready in ${days}d`;
    return <span className="text-purple-600 text-xs font-medium">{label}</span>;
  }
  const map = {
    ok:       { cls: 'text-green-600', text: 'Good' },
    warning:  { cls: 'text-amber-600', text: 'Expiring soon' },
    critical: { cls: 'text-red-600',   text: 'Critical' },
    expired:  { cls: 'text-red-700',   text: 'Expired' },
    none:     { cls: 'text-gray-400',  text: 'No date' },
  };
  const { cls, text } = map[expiryStatus] ?? map.none;
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>;
}
```

---

## 6. `client/src/components/pantry/AddItemModal.jsx` — Modify

### 6a. `buildInitialState` — add readyDate

```js
function buildInitialState(item, prefill) {
  if (!item) {
    return {
      name:         prefill?.name     ?? '',
      category:     prefill?.category ?? 'Other',
      quantity:     '1',
      unit:         'item',
      purchaseDate: '',
      readyDate:    '',   // ← ADD
      expiryDate:   '',
      notes:        '',
    };
  }
  return {
    name:         item.name,
    category:     item.category,
    quantity:     String(item.quantity),
    unit:         item.unit,
    purchaseDate: fromISO(item.purchaseDate),
    readyDate:    fromISO(item.readyDate),    // ← ADD
    expiryDate:   fromISO(item.expiryDate),
    notes:        item.notes ?? '',
  };
}
```

### 6b. `handleSubmit` body — explicit guard at every date call site

```js
const body = {
  name:         form.name.trim(),
  category:     form.category,
  quantity:     Number(form.quantity),
  unit:         form.unit.trim() || 'item',
  purchaseDate: form.purchaseDate ? toISO(form.purchaseDate) : null,
  readyDate:    form.readyDate    ? toISO(form.readyDate)    : null,  // ← ADD
  expiryDate:   form.expiryDate   ? toISO(form.expiryDate)   : null,
  notes:        form.notes.trim() || null,
};
```

Note: `purchaseDate` and `expiryDate` are also updated to the explicit guard pattern.
Behavior is unchanged (they were already falsy-null), but intent is now unambiguous.

### 6c. Form field — "Ready date" below purchase/expiry grid, before Notes

```jsx
{/* Existing 2-col date grid — unchanged */}
<div className="grid grid-cols-2 gap-4">
  <Field label="Purchase date" error={fieldErrors.purchaseDate?.[0]}>
    <input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} className={inputCls} />
  </Field>
  <Field label="Expiry date" error={fieldErrors.expiryDate?.[0]}>
    <input type="date" value={form.expiryDate} onChange={set('expiryDate')} className={inputCls} />
  </Field>
</div>

{/* New: secondary opt-in field */}
<Field label="Ready date — when this item will be usable (optional)" error={fieldErrors.readyDate?.[0]}>
  <input type="date" value={form.readyDate} onChange={set('readyDate')} className={inputCls} />
</Field>

{/* Existing Notes field follows */}
```

**Placement rationale:** The purchase/expiry grid is the most-used date pair and should
stay together as-is. Ready date is a secondary, opt-in field — placing it below the grid
avoids restructuring familiar UI. This is a deliberate non-chronological trade-off:
lifecycle order (purchase → ready → expiry) is preserved in `buildInitialState` and
`handleSubmit` but not enforced in visual layout. Strict chronological layout would
require splitting the 2-col grid into three individual rows.

---

# State Flow Summary

```
getRipeningState(item):
  item.isFrozen = true        → 'frozen'
  isRipening(item.readyDate)  → 'ripening'
  else                        → 'ready'

Per-row derived values (PantryTable):
  ripeState    = getRipeningState(item)
  expiryStatus = getExpiryStatus(item.expiryDate)
  rowStatus    = frozen→'ok' | ripening→'ripening' | ready→expiryStatus
  rowCls       = frozen→'' | else→getExpiryRowClass(rowStatus)
  badgeStatus  = frozen→'ok' | else→expiryStatus   (ripening does NOT affect badge)

ExpiryBadge receives:
  { expiryDate, status: badgeStatus }
  → pure display, no domain logic

StatusLabel receives:
  { ripeState, expiryStatus, readyDate }
  → frozen→"Frozen", ripening→"Ready in Xd", ready→existing expiry label
```

All UTC midnight-normalized. TASK-009 server cron must use the same basis.

---

# Acceptance Criteria

1. **Migration applied:** `pantry_items` has `ready_date text` nullable. Existing rows
   unaffected (NULL).

2. **Add form:** "Ready date" field visible below the purchase/expiry grid, before Notes.
   Optional — submitting without it is unchanged behavior.

3. **Edit form:** "Ready date" pre-fills from stored value. Blank when item has none.

4. **Ripening row:** Item with `readyDate > today` shows purple row tint + "Ready in Xd"
   (or "Ready tomorrow") in purple in the Status column. ExpiryBadge unchanged.

5. **readyDate ≤ today:** Normal expiry status resumes. No purple.

6. **No readyDate:** Behavior identical to pre-task for all existing items.

7. **Frozen priority:** Frozen item with future `readyDate` → Status "Frozen" (blue),
   no purple tint. `getRipeningState` returns `'frozen'` before checking `isRipening`.

8. **ExpiryBadge is pure display:** ExpiryBadge receives a pre-computed `status` prop.
   It no longer accepts `isFrozen`. Frozen suppression is computed at call site
   (`badgeStatus = item.isFrozen ? 'ok' : expiryStatus`).

9. **Save round-trips correctly:**
   - Add with future `readyDate` → persisted → purple on reload.
   - Clear `readyDate` (blank input) → `form.readyDate ? toISO(...) : null` → `null`
     → saves NULL → normal expiry state on reload.

10. **Route validation:**
    - `PATCH` with `{ readyDate: "2026-06-10T00:00:00.000Z" }` → 200.
    - `PATCH` with `{ readyDate: null }` → 200, clears field.
    - `PATCH` without `readyDate` key → 200 (partial, field unchanged).
    - `PATCH` with `{ readyDate: "not-a-date" }` → 422 (rejected by `z.string().datetime()`).

11. **No changes to:** freeze flow, mark-used flow, delete, receipt upload, barcode scan,
    recipe pages, shopping list pages.

---

# Verification Steps

```
1.  Run in Neon SQL Editor:
      ALTER TABLE "pantry_items" ADD COLUMN "ready_date" text;
    Confirm column appears in Neon table inspector.

2.  npm run build — no errors.

3.  Open "+ Add item":
    → "Ready date" field visible below purchase/expiry grid, before Notes
    → Submit without ready date → item added (no regression)

4.  Add item with readyDate = 3 days from now:
    → Row: bg-purple-50 tint
    → Status column: "Ready in 3d" (purple)
    → ExpiryBadge: shows expiry date as before

5.  Add item with readyDate = 1 day from now:
    → Status: "Ready tomorrow" (purple)

6.  Edit that item → readyDate field pre-filled.
    Clear it → save → row reverts to normal expiry status.

7.  Set readyDate = today → row shows normal expiry status (not purple).

8.  Freeze a ripening item (readyDate in future):
    → Status: "Frozen" (blue), no purple tint

9.  Unfreeze → Status reverts to "Ready in Xd" (purple) if readyDate still future.

10. API validation (curl or DevTools):
    → PATCH { readyDate: null } → 200
    → PATCH { readyDate: "not-a-date" } → 422

11. Spot-check all existing flows: add/edit/freeze/thaw/used/delete/scan/receipt.
```

---

# Known Risks / Open Questions

1. **Migration:** Simple one-liner ALTER TABLE — low risk on Neon serverless.
   Confirm column exists before deploying code change.

2. **UTC midnight semantics:** All comparisons use `setUTCHours(0,0,0,0)`.
   TASK-009 push notification cron must use the same UTC midnight basis to avoid
   timezone drift between client display and server trigger.

3. **Open question (carry-forward):** Should strict chronological layout
   (Purchase → Ready → Expiry as three individual rows) replace the current placement?
   Current spec preserves the familiar 2-col date grid and places Ready date below it.
   Architect to confirm or close.

4. **Forward compatibility — TASK-009:** `ready_date` column will be the trigger
   source for "item is now ready" push notifications. No action in this task.

5. **Forward compatibility — TASK-008:** `readyDate` will be available on the item
   object for recipe suggestion filtering. No action in this task.

---

# Out of Scope (Deferred)

- Sorting/filtering pantry by ready date
- "Ready today" celebration badge
- Excluding ripening items from recipe suggestions (TASK-008)
- Push notification when item becomes ready (TASK-009)
- Bulk-setting ready dates
- `getItemState()` unified domain struct (rejected as overengineering for this task scope)
