import { useEffect, useRef, useState } from 'react';
import { STORAGE_LOCATIONS, STORAGE_LOCATION_LABELS } from '../../utils/pantryDefaults.js';

export default function SplitItemModal({ item, onClose, onSplit }) {
  const [splitQuantity, setSplitQuantity] = useState('');
  const [storageLocation, setStorageLocation] = useState(
    STORAGE_LOCATIONS.find((loc) => loc !== item.storageLocation) ?? STORAGE_LOCATIONS[0],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const quantity = Number(splitQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter a quantity greater than 0');
      return;
    }

    setSaving(true);
    try {
      await onSplit(item.id, { splitQuantity: quantity, storageLocation });
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Split "{item.name}"</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Currently {item.quantity} {item.unit}. Move part of this quantity to a different storage
          location — the rest stays here with its current expiry.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Quantity to move<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              ref={firstInputRef}
              type="number"
              value={splitQuantity}
              onChange={(e) => setSplitQuantity(e.target.value)}
              min="0.01"
              max={item.quantity}
              step="any"
              required
              placeholder={`up to ${item.quantity}`}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Move to
            </label>
            <select
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              className={inputCls}
            >
              {STORAGE_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>{STORAGE_LOCATION_LABELS[loc]}</option>
              ))}
            </select>
          </div>

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
              {saving ? 'Splitting…' : 'Split'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400';
