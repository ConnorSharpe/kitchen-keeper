import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_LABELS,
} from '../../utils/pantryDefaults.js';

// ReceiptUpload runs through three phases:
//   upload   — drag-drop / click-to-select file
//   scanning — waiting for AI parse-receipt response
//   preview  — checkbox table so user can deselect unwanted items before confirming
//
// File uploads can't use the standard api.* helpers (those force application/json).
// We call fetch directly here with credentials and let the browser set the multipart boundary.

export default function ReceiptUpload({ onClose, onItemsAdded }) {
  const [phase, setPhase] = useState('upload'); // 'upload' | 'scanning' | 'preview' | 'confirming'
  const [candidates, setCandidates] = useState([]);
  const [checked, setChecked] = useState({});
  const [skipped, setSkipped] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  async function scanFile(file) {
    setPhase('scanning');
    const formData = new FormData();
    formData.append('receipt', file);

    try {
      const res = await fetch('/api/ai/parse-receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (res.status === 401) {
        if (!window.location.pathname.startsWith('/sign-in')) {
          window.location.href = '/sign-in';
        }
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Scan failed (${res.status})`);
      }

      const { candidates: items, skipped: sk } = data;

      if (items.length === 0) {
        toast.error(
          'No food items could be found on that receipt. Try a clearer photo.'
        );
        setPhase('upload');
        return;
      }

      setCandidates(items);
      // All items checked by default
      setChecked(Object.fromEntries(items.map((_, i) => [i, true])));
      setSkipped(sk);
      setPhase('preview');
    } catch (err) {
      toast.error(err.message || 'Failed to scan receipt');
      setPhase('upload');
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) scanFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) scanFile(file);
  }

  async function handleConfirm() {
    const selected = candidates.filter((_, i) => checked[i]);
    if (selected.length === 0) {
      toast.error('Select at least one item to add');
      return;
    }

    setPhase('confirming');

    try {
      const res = await fetch('/api/pantry/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selected }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to add items (${res.status})`);
      }

      toast.success(
        `Added ${data.items.length} item${data.items.length !== 1 ? 's' : ''} to your pantry`
      );
      onItemsAdded();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to add items');
      setPhase('preview');
    }
  }

  function toggleAll(value) {
    setChecked(Object.fromEntries(candidates.map((_, i) => [i, value])));
  }

  function setStorageLocation(index, storageLocation) {
    setCandidates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, storageLocation } : c))
    );
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Scan a receipt
            </h2>
            {phase === 'preview' && (
              <p className="text-xs text-gray-400 mt-0.5">
                Uncheck any items you don&apos;t want to add
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Phase: upload */}
        {phase === 'upload' && (
          <div>
            <label
              htmlFor="receipt-upload-library-input"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`block border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-gray-300 hover:border-orange-300 hover:bg-gray-50'
              }`}
            >
              <p className="text-5xl mb-4">📷</p>
              <p className="text-sm font-medium text-gray-700">
                Drop a receipt photo here, or click to upload
              </p>
              <p className="text-xs text-gray-400 mt-1">
                JPEG, PNG, WebP or HEIC — max 10 MB
              </p>
              <input
                id="receipt-upload-library-input"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>
        )}

        {/* Phase: scanning */}
        {phase === 'scanning' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-5" />
            <p className="text-sm font-medium text-gray-700">
              Scanning receipt…
            </p>
            <p className="text-xs text-gray-400 mt-1">Reading items with AI</p>
          </div>
        )}

        {/* Phase: preview or confirming */}
        {(phase === 'preview' || phase === 'confirming') && (
          <>
            {/* Summary row */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="text-sm text-gray-600">
                Found <span className="font-medium">{candidates.length}</span>{' '}
                item
                {candidates.length !== 1 ? 's' : ''}
                {skipped > 0 && (
                  <span className="text-gray-400 ml-1">
                    ({skipped} couldn&apos;t be parsed)
                  </span>
                )}
              </p>
              <div className="flex gap-3 text-xs text-gray-500">
                <button
                  onClick={() => toggleAll(true)}
                  className="hover:text-orange-600 transition-colors"
                >
                  Select all
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => toggleAll(false)}
                  className="hover:text-gray-800 transition-colors"
                >
                  None
                </button>
              </div>
            </div>

            {/* Scrollable item table */}
            <div className="overflow-y-auto flex-1 rounded-lg border border-gray-200 mb-4 min-h-0">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    {[
                      '',
                      'Name',
                      'Category',
                      'Qty',
                      'Unit',
                      'Storage',
                      'Expires',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {candidates.map((item, i) => (
                    <tr
                      key={i}
                      className={`transition-opacity ${checked[i] ? '' : 'opacity-40'}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={!!checked[i]}
                          onChange={(e) =>
                            setChecked((prev) => ({
                              ...prev,
                              [i]: e.target.checked,
                            }))
                          }
                          className="rounded border-gray-300 text-orange-500 focus:ring-orange-400 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                        {item.name}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                        {item.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                        {item.unit}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <select
                          value={item.storageLocation ?? 'pantry'}
                          onChange={(e) =>
                            setStorageLocation(i, e.target.value)
                          }
                          className="rounded border-gray-300 text-xs py-1 pl-2 pr-6 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                        >
                          {STORAGE_LOCATIONS.map((loc) => (
                            <option key={loc} value={loc}>
                              {STORAGE_LOCATION_LABELS[loc]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                        {item.expiryDate ? item.expiryDate.split('T')[0] : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between flex-shrink-0">
              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={phase === 'confirming' || selectedCount === 0}
                className="px-5 py-2 text-sm font-medium bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {phase === 'confirming'
                  ? 'Adding…'
                  : `Add ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
