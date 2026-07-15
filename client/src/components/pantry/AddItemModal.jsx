import { useEffect, useRef, useState } from 'react';
import { getDefaultStorageLocation, STORAGE_LOCATIONS, STORAGE_LOCATION_LABELS } from '../../utils/pantryDefaults.js';

const CATEGORIES = [
  'Produce', 'Dairy', 'Meat', 'Seafood', 'Bakery',
  'Frozen', 'Pantry', 'Beverages', 'Condiments', 'Other',
];

// HTML date inputs give "YYYY-MM-DD". Server's z.string().datetime() requires full ISO.
// Treating all user-entered dates as UTC midnight avoids timezone drift.
function toISO(dateStr) {
  return dateStr ? `${dateStr}T00:00:00.000Z` : null;
}

// ISO string from the server → "YYYY-MM-DD" for the date input value.
function fromISO(isoStr) {
  return isoStr ? isoStr.split('T')[0] : '';
}

function buildInitialState(item, prefill) {
  if (!item) {
    const category = prefill?.category ?? 'Other';
    return {
      name:            prefill?.name ?? '',
      category,
      quantity:        '1',
      unit:            'item',
      purchaseDate:    '',
      readyDate:       '',
      expiryDate:      '',
      storageLocation: getDefaultStorageLocation(category),
      servingsPerPurchaseUnit: '',
      notes:           '',
    };
  }
  return {
    name:            item.name,
    category:        item.category,
    quantity:        String(item.quantity),
    unit:            item.unit,
    purchaseDate:    fromISO(item.purchaseDate),
    readyDate:       fromISO(item.readyDate),
    expiryDate:      fromISO(item.expiryDate),
    storageLocation: item.storageLocation ?? getDefaultStorageLocation(item.category),
    servingsPerPurchaseUnit: item.servingsPerPurchaseUnit != null ? String(item.servingsPerPurchaseUnit) : '',
    notes:           item.notes ?? '',
  };
}

export default function AddItemModal({ item, prefill, onClose, onSave }) {
  const [form, setForm] = useState(() => buildInitialState(item, prefill));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const firstInputRef = useRef(null);
  const isEdit = Boolean(item);
  // Captured once at mount — lets handleSubmit tell "field re-sent unchanged" from "user retyped it".
  const initialExpiryDate = useRef(isEdit ? fromISO(item.expiryDate) : null).current;

  // Focus the first field on open
  useEffect(() => { firstInputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const body = {
        name:            form.name.trim(),
        category:        form.category,
        quantity:        Number(form.quantity),
        unit:            form.unit.trim() || 'item',
        purchaseDate:    form.purchaseDate ? toISO(form.purchaseDate) : null,
        readyDate:       form.readyDate    ? toISO(form.readyDate)    : null,
        storageLocation: form.storageLocation,
        servingsPerPurchaseUnit: form.servingsPerPurchaseUnit ? Number(form.servingsPerPurchaseUnit) : null,
        notes:           form.notes.trim() || null,
      };
      // Only include expiryDate if the user actually typed it (create), or changed it from what was
      // loaded (edit) — an edit that leaves it untouched must not read as a fresh manual entry, or a
      // storageLocation-only edit would wrongly protect the stale value from FoodKeeper recompute
      // (TASK-031 Decision 1/4's manual-vs-ai_estimate presence check).
      if (!isEdit || form.expiryDate !== initialExpiryDate) {
        body.expiryDate = form.expiryDate ? toISO(form.expiryDate) : null;
      }
      await onSave(body);
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong');
      if (err.fieldErrors) setFieldErrors(err.fieldErrors);
    } finally {
      setSaving(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit item' : 'Add item'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}

          <Field label="Name" required error={fieldErrors.name?.[0]}>
            <input
              ref={firstInputRef}
              type="text"
              value={form.name}
              onChange={set('name')}
              required
              maxLength={200}
              placeholder="e.g. Chicken breast"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" error={fieldErrors.category?.[0]}>
              <select value={form.category} onChange={set('category')} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            <Field label="Quantity" error={fieldErrors.quantity?.[0]}>
              <input
                type="number"
                value={form.quantity}
                onChange={set('quantity')}
                min="0.01"
                step="any"
                required
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit" error={fieldErrors.unit?.[0]}>
              <input
                type="text"
                value={form.unit}
                onChange={set('unit')}
                maxLength={50}
                placeholder="item, g, kg, L…"
                className={inputCls}
              />
            </Field>

            <Field label="Storage" error={fieldErrors.storageLocation?.[0]}>
              <select value={form.storageLocation} onChange={set('storageLocation')} className={inputCls}>
                {STORAGE_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>{STORAGE_LOCATION_LABELS[loc]}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchase date" error={fieldErrors.purchaseDate?.[0]}>
              <input
                type="date"
                value={form.purchaseDate}
                onChange={set('purchaseDate')}
                className={inputCls}
              />
            </Field>

            <Field label="Expiry date" error={fieldErrors.expiryDate?.[0]}>
              <input
                type="date"
                value={form.expiryDate}
                onChange={set('expiryDate')}
                className={inputCls}
              />
            </Field>
          </div>

          <Field
            label="Servings per unit (optional)"
            error={fieldErrors.servingsPerPurchaseUnit?.[0]}
          >
            <input
              type="number"
              value={form.servingsPerPurchaseUnit}
              onChange={set('servingsPerPurchaseUnit')}
              min="0.1"
              max="1000"
              step="any"
              placeholder="e.g. 2 servings per pouch"
              className={inputCls}
            />
          </Field>

          <Field label="Ready date — when this item will be usable (optional)" error={fieldErrors.readyDate?.[0]}>
            <input
              type="date"
              value={form.readyDate}
              onChange={set('readyDate')}
              className={inputCls}
            />
          </Field>

          <Field label="Notes" error={fieldErrors.notes?.[0]}>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              maxLength={500}
              rows={2}
              placeholder="Optional notes…"
              className={`${inputCls} resize-none`}
            />
          </Field>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400';

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
