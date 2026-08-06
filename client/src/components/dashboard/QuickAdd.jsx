import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';
import { usePantryContext } from '../../context/PantryContext.jsx';
import { PANTRY_CATEGORIES } from '@shared/pantryCategories.js';

// Converts a YYYY-MM-DD string from a date input to a full ISO datetime string.
// The server uses z.string().datetime() which rejects bare YYYY-MM-DD.
function toISO(dateStr) {
  return dateStr ? `${dateStr}T00:00:00.000Z` : null;
}

const LAST_CATEGORY_KEY = 'quickAdd.lastCategory';

export default function QuickAdd() {
  const { refresh } = usePantryContext();
  const [name, setName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  // TASK-056 Design D: defaults to the user's last-used category instead of always "Other" — a
  // silent-miscategorization gap the spec's P1-1 identified — while staying a one-tap override.
  const [category, setCategory] = useState(
    () => localStorage.getItem(LAST_CATEGORY_KEY) || 'Other'
  );
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await api.post('/api/pantry', {
        name: name.trim(),
        expiryDate: toISO(expiryDate),
        category,
        unit: 'item',
      });
      localStorage.setItem(LAST_CATEGORY_KEY, category);
      toast.success(`${name.trim()} added to pantry`);
      setName('');
      setExpiryDate('');
      nameRef.current?.focus();
      refresh(); // update ExpiryStrip and sidebar badge
    } catch (err) {
      toast.error(err.message || 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm ' +
    'focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick Add</h2>
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 items-center flex-wrap sm:flex-nowrap"
      >
        <input
          ref={nameRef}
          type="text"
          placeholder="Item name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputCls} flex-1 min-w-0`}
          required
        />
        <label className="flex flex-col gap-0.5 flex-shrink-0">
          <span className="text-xs text-gray-500 leading-none">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputCls} w-32`}
          >
            {PANTRY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 flex-shrink-0">
          <span className="text-xs text-gray-500 leading-none">Expires</span>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className={`${inputCls} w-36`}
          />
        </label>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="flex-shrink-0 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Adding…' : '+ Add'}
        </button>
      </form>
    </div>
  );
}
