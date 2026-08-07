import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { usePantry } from '../hooks/usePantry.js';
import PantryTable from '../components/pantry/PantryTable.jsx';
import AddItemModal from '../components/pantry/AddItemModal.jsx';
import SplitItemModal from '../components/pantry/SplitItemModal.jsx';
import ReceiptUpload from '../components/pantry/ReceiptUpload.jsx';
import PushNotificationBanner from '../components/push/PushNotificationBanner.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';

export default function PantryPage() {
  const {
    items,
    loading: pantryLoading,
    addItem,
    updateItem,
    removeItem,
    markUsed,
    toggleFreeze,
    splitItem,
    refresh,
  } = usePantry();
  const [modalItem, setModalItem] = useState(undefined); // undefined = closed, null = add, item = edit
  const [splitModalItem, setSplitModalItem] = useState(null); // null = closed, item = open
  const [showReceiptUpload, setShowReceiptUpload] = useState(false);
  const [filterName, setFilterName] = useState('');

  // TASK-056 Design B: same case-insensitive substring match as the Recipes filter bar (Section 8).
  const filteredItems = useMemo(() => {
    if (!filterName) return items;
    const q = filterName.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, filterName]);

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
      toast.success(
        updated.storageLocation === 'freezer'
          ? '❄ Item frozen — expiry extended'
          : 'Item thawed'
      );
    } catch (err) {
      toast.error(err.message || 'Failed to update freeze status');
    }
  };

  const handleSplit = async (id, body) => {
    const data = await splitItem(id, body);
    toast.success(
      data.created
        ? 'Item split across storage locations'
        : 'Storage location updated'
    );
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
      <PageHeader
        title="Pantry"
        subtitle={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        className="mb-6"
        actions={
          <>
            <button
              onClick={() => setShowReceiptUpload(true)}
              data-tour="scan-receipt"
              className="btn-secondary shadow-sm"
            >
              📷 Scan receipt
            </button>
            <button
              onClick={() => setModalItem(null)}
              data-tour="add-item"
              className="btn-primary shadow-sm"
            >
              + Add item
            </button>
          </>
        }
      />

      <PushNotificationBanner />

      {!pantryLoading && items.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name…"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            className="input w-full sm:w-64"
          />
        </div>
      )}

      {pantryLoading ? (
        <>
          {/* Desktop/tablet skeleton */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-page">
                <tr>
                  {[
                    'Name',
                    'Category',
                    'Qty',
                    'Unit',
                    'Storage',
                    'Expires',
                    'Status',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-ink-subtle uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded w-32" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-8" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-10" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-14" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-20" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded w-24" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile skeleton — TASK-056 Design B */}
          <div className="md:hidden space-y-3">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-surface p-3 animate-pulse"
              >
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/4 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-3/4 mb-3" />
                <div className="flex gap-2">
                  <div className="h-8 bg-gray-100 rounded w-14" />
                  <div className="h-8 bg-gray-100 rounded w-14" />
                  <div className="h-8 bg-gray-100 rounded w-14" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : filteredItems.length === 0 && items.length > 0 ? (
        <div className="text-center py-16 text-ink-subtle">
          <p className="text-sm font-medium text-ink-muted">
            No items match your search.
          </p>
          <button
            onClick={() => setFilterName('')}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <PantryTable
          items={filteredItems}
          onEdit={(item) => setModalItem(item)}
          onMarkUsed={handleMarkUsed}
          onToggleFreeze={handleToggleFreeze}
          onSplit={(item) => setSplitModalItem(item)}
          onDelete={handleDelete}
        />
      )}

      {splitModalItem && (
        <SplitItemModal
          item={splitModalItem}
          onClose={() => setSplitModalItem(null)}
          onSplit={handleSplit}
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
