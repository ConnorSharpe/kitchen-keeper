import { useState } from 'react';
import toast from 'react-hot-toast';
import { usePantry } from '../hooks/usePantry.js';
import PantryTable from '../components/pantry/PantryTable.jsx';
import AddItemModal from '../components/pantry/AddItemModal.jsx';

export default function PantryPage() {
  const { items, loading, addItem, updateItem, removeItem, markUsed, toggleFreeze } = usePantry();
  const [modalItem, setModalItem] = useState(undefined); // undefined = closed, null = add, item = edit

  const handleSave = async (body) => {
    if (modalItem) {
      await updateItem(modalItem.id, body);
      toast.success('Item updated');
    } else {
      await addItem(body);
      toast.success('Item added');
    }
  };

  const handleMarkUsed = async (id) => {
    try {
      await markUsed(id);
      toast.success('Marked as used — great job using it up!');
    } catch (err) {
      toast.error(err.message || 'Failed to mark item as used');
    }
  };

  const handleToggleFreeze = async (id) => {
    try {
      const updated = await toggleFreeze(id);
      toast.success(updated.isFrozen ? '❄ Item frozen — expiry extended' : 'Item thawed');
    } catch (err) {
      toast.error(err.message || 'Failed to update freeze status');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this item from your pantry?')) return;
    try {
      await removeItem(id);
      toast.success('Item removed');
    } catch (err) {
      toast.error(err.message || 'Failed to delete item');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pantry</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </p>
        </div>
        <button
          onClick={() => setModalItem(null)}
          className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 transition-colors shadow-sm"
        >
          + Add item
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : (
        <PantryTable
          items={items}
          onEdit={(item) => setModalItem(item)}
          onMarkUsed={handleMarkUsed}
          onToggleFreeze={handleToggleFreeze}
          onDelete={handleDelete}
        />
      )}

      {modalItem !== undefined && (
        <AddItemModal
          item={modalItem || undefined}
          onClose={() => setModalItem(undefined)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
