import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/index.js';
import toast from 'react-hot-toast';

export default function ShoppingList({ listId }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toggling, setToggling] = useState(null); // itemId currently being toggled

  // Manual-add form state
  const [addName, setAddName]   = useState('');
  const [addQty, setAddQty]     = useState('');
  const [addUnit, setAddUnit]   = useState('');
  const [adding, setAdding]     = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/shopping/${listId}/items`);
      setItems(data.items ?? []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function handleToggle(itemId) {
    setToggling(itemId);
    try {
      const data = await api.patch(`/api/shopping/${listId}/items/${itemId}/check`);
      setItems((prev) => prev.map((i) => (i.id === itemId ? data.item : i)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setToggling(null);
    }
  }

  async function handleAddItem(e) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const body = {
        ingredientName: addName.trim(),
        quantity: addQty ? Number(addQty) : null,
        unit: addUnit.trim() || null,
      };
      const data = await api.post(`/api/shopping/${listId}/items`, body);
      setItems((prev) => [...prev, data.item]);
      setAddName('');
      setAddQty('');
      setAddUnit('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  const checked   = items.filter((i) => i.isChecked);
  const unchecked = items.filter((i) => !i.isChecked);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          This list has no items yet. Add one below.
        </p>
      ) : (
        <ul className="space-y-1">
          {/* Unchecked items first */}
          {unchecked.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              toggling={toggling === item.id}
              onToggle={() => handleToggle(item.id)}
            />
          ))}

          {/* Divider when both buckets have items */}
          {unchecked.length > 0 && checked.length > 0 && (
            <li className="border-t border-gray-100 my-2" />
          )}

          {/* Checked items dimmed at bottom */}
          {checked.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              toggling={toggling === item.id}
              onToggle={() => handleToggle(item.id)}
            />
          ))}
        </ul>
      )}

      {/* Manual-add form */}
      <form
        onSubmit={handleAddItem}
        className="border-t border-gray-100 pt-4 flex flex-wrap gap-2 items-end"
      >
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs text-gray-500 mb-1">Item</label>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="e.g. Garlic"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="w-20">
          <label className="block text-xs text-gray-500 mb-1">Qty</label>
          <input
            type="number"
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            min="0"
            step="any"
            placeholder="—"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="w-24">
          <label className="block text-xs text-gray-500 mb-1">Unit</label>
          <input
            type="text"
            value={addUnit}
            onChange={(e) => setAddUnit(e.target.value)}
            placeholder="e.g. cloves"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <button
          type="submit"
          disabled={adding || !addName.trim()}
          className="py-1.5 px-4 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
        >
          {adding ? '…' : 'Add'}
        </button>
      </form>

      {items.length > 0 && (
        <p className="text-xs text-gray-400">
          {checked.length} / {items.length} checked
        </p>
      )}
    </div>
  );
}

function ItemRow({ item, toggling, onToggle }) {
  const checked = item.isChecked;
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
        checked ? 'opacity-50' : 'hover:bg-gray-50'
      }`}
    >
      <button
        onClick={onToggle}
        disabled={toggling}
        aria-label={checked ? 'Uncheck item' : 'Check item'}
        className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          checked
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 hover:border-orange-400'
        } disabled:opacity-50`}
      >
        {checked && <span className="text-xs leading-none">✓</span>}
      </button>

      <span className={`flex-1 text-sm ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
        {item.ingredientName}
        {(item.quantity != null || item.unit) && (
          <span className="text-gray-400 ml-1.5 font-normal">
            {item.quantity != null ? item.quantity : ''}
            {item.unit ? ` ${item.unit}` : ''}
          </span>
        )}
      </span>

      {item.hasUnitMismatch && (
        <span
          title="Unit mismatch: this ingredient appeared with different units across recipes. Verify the quantity."
          className="text-amber-500 text-sm flex-shrink-0 cursor-help"
          aria-label="Unit mismatch warning"
        >
          ⚠️
        </span>
      )}
    </li>
  );
}
