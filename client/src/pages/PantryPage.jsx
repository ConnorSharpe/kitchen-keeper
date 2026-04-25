import { useState } from 'react';
import toast from 'react-hot-toast';
import { usePantry } from '../hooks/usePantry.js';
import PantryTable from '../components/pantry/PantryTable.jsx';
import AddItemModal from '../components/pantry/AddItemModal.jsx';
import ReceiptUpload from '../components/pantry/ReceiptUpload.jsx';

export default function PantryPage() {
  const { items, loading, addItem, updateItem, removeItem, markUsed, toggleFreeze, refresh } = usePantry();
  const [modalItem, setModalItem] = useState(undefined); // undefined = closed, null = add, item = edit
  const [showReceiptUpload, setShowReceiptUpload] = useState(false);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReceiptUpload(true)}
            className="px-4 py-2 bg-white text-orange-600 text-sm font-medium rounded-md border border-orange-300 hover:bg-orange-50 transition-colors shadow-sm"
          >
            📷 Scan receipt
          </button>
          <button
            onClick={() => setModalItem(null)}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 transition-colors shadow-sm"
          >
            + Add item
          </button>
        </div>
      </div>

      {loading ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Category', 'Qty', 'Unit', 'Expires', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded w-32" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-8" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-10" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-20" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      {showReceiptUpload && (
        <ReceiptUpload
          onClose={() => setShowReceiptUpload(false)}
          onItemsAdded={refresh}
        />
      )}
    </div>
  );
}
