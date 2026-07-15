import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { usePantry } from '../hooks/usePantry.js';
import { useAuth } from '../context/AuthContext.jsx';
import PantryTable from '../components/pantry/PantryTable.jsx';
import AddItemModal from '../components/pantry/AddItemModal.jsx';
import SplitItemModal from '../components/pantry/SplitItemModal.jsx';
import ReceiptUpload from '../components/pantry/ReceiptUpload.jsx';
import StaplesChecklist from '../components/onboarding/StaplesChecklist.jsx';
import { fetchProductByBarcode } from '../utils/openFoodFacts.js';
import PushNotificationBanner from '../components/push/PushNotificationBanner.jsx';

const BarcodeScanner = lazy(() => import('../components/pantry/BarcodeScanner.jsx'));

export default function PantryPage() {
  const { items, loading: pantryLoading, addItem, updateItem, removeItem, markUsed, toggleFreeze, splitItem, refresh } = usePantry();
  const { user, loading: authLoading } = useAuth();

  // Plain boolean. useEffect resets it on user identity change (System Invariant #11).
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    setOnboardingDismissed(false);
  }, [user?.id]);

  // isEligible: pure server truth (System Invariant #10).
  const isEligible = !authLoading && user?.onboardingComplete === false;
  // showOnboarding: render gate = server eligibility + session-scoped UI suppression.
  const showOnboarding = isEligible && !onboardingDismissed;
  const [modalItem, setModalItem] = useState(undefined); // undefined = closed, null = add, item = edit
  const [splitModalItem, setSplitModalItem] = useState(null); // null = closed, item = open
  const [showReceiptUpload, setShowReceiptUpload] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodePrefill, setBarcodePrefill] = useState(null);
  const fetchAbortRef = useRef(null);

  useEffect(() => {
    return () => fetchAbortRef.current?.abort();
  }, []);

  const handleBarcodeDetected = async (barcode) => {
    setShowBarcodeScanner(false);

    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      const product = await fetchProductByBarcode(barcode, { signal: controller.signal });
      if (!product) {
        toast('Product not found — enter details manually', { icon: '⚠️' });
        setBarcodePrefill(null);
      } else {
        setBarcodePrefill({ name: product.name, category: product.category });
      }
      setModalItem(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast.error('Could not look up product — enter details manually');
      setBarcodePrefill(null);
      setModalItem(null);
    } finally {
      fetchAbortRef.current = null;
    }
  };

  const handleScannerError = () => {
    setShowBarcodeScanner(false);
    toast.error('Camera access denied — check browser permissions');
  };

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
      toast.success(updated.storageLocation === 'freezer' ? '❄ Item frozen — expiry extended' : 'Item thawed');
    } catch (err) {
      toast.error(err.message || 'Failed to update freeze status');
    }
  };

  const handleSplit = async (id, body) => {
    const data = await splitItem(id, body);
    toast.success(data.created ? 'Item split across storage locations' : 'Storage location updated');
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

  // Server-confirmed completion (Persistence Rule): refresh pantry list.
  function handleOnboardingComplete() {
    refresh();
  }

  // UI-only dismissal (UI Dismissal Rule): close modal for this session only.
  // MUST NOT call completeOnboarding() or update auth state.
  function handleOnboardingDismiss() {
    setOnboardingDismissed(true);
  }

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
            onClick={() => setShowBarcodeScanner(true)}
            className="px-4 py-2 bg-white text-orange-600 text-sm font-medium rounded-md border border-orange-300 hover:bg-orange-50 transition-colors shadow-sm"
          >
            Scan barcode
          </button>
          <button
            onClick={() => setModalItem(null)}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 transition-colors shadow-sm"
          >
            + Add item
          </button>
        </div>
      </div>

      <PushNotificationBanner />

      {showOnboarding && (
        <StaplesChecklist
          onComplete={handleOnboardingComplete}
          onDismiss={handleOnboardingDismiss}
        />
      )}

      {pantryLoading ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Category', 'Qty', 'Unit', 'Storage', 'Expires', 'Status', ''].map((h) => (
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
                  <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-14" /></td>
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
          prefill={modalItem === null ? barcodePrefill : undefined}
          onClose={() => { setModalItem(undefined); setBarcodePrefill(null); }}
          onSave={handleSave}
        />
      )}

      {showBarcodeScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onDetected={handleBarcodeDetected}
            onClose={() => setShowBarcodeScanner(false)}
            onError={handleScannerError}
          />
        </Suspense>
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
