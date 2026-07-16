import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';
import { usePantryContext } from '../../context/PantryContext.jsx';
import {
  getExpiryLabel,
  getExpiryBadgeClass,
  getExpiryStatus,
} from '../../utils/expiry.js';

export default function ExpiryStrip() {
  const { expiringItems, loading, refresh } = usePantryContext();
  const [freezingId, setFreezingId] = useState(null);

  const handleFreeze = async (item) => {
    setFreezingId(item.id);
    try {
      await api.patch(`/api/pantry/${item.id}/freeze`);
      const action = item.isFrozen ? 'unfrozen' : 'frozen';
      toast.success(`${item.name} ${action}`);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to update freeze status');
    } finally {
      setFreezingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4 text-gray-400 text-sm">
        Loading expiring items…
      </div>
    );
  }

  if (expiringItems.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
        <span aria-hidden>✅</span>
        <span>Nothing expiring this week — great job!</span>
      </div>
    );
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-2"
      role="list"
      aria-label="Items expiring soon"
    >
      {expiringItems.map((item) => {
        const status = getExpiryStatus(item.expiryDate);
        const badgeCls = getExpiryBadgeClass(status);
        const label = getExpiryLabel(item.expiryDate);
        const isFreezing = freezingId === item.id;

        return (
          <div
            key={item.id}
            role="listitem"
            className="flex-shrink-0 w-40 rounded-lg border border-gray-200 bg-white p-3 shadow-sm flex flex-col gap-2"
          >
            <p
              className="text-sm font-semibold text-gray-900 truncate"
              title={item.name}
            >
              {item.name}
            </p>

            <span
              className={`self-start inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badgeCls}`}
            >
              {item.isFrozen ? '❄️ Frozen' : label}
            </span>

            <button
              onClick={() => handleFreeze(item)}
              disabled={isFreezing}
              className="mt-auto text-xs text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50 text-left"
              title={item.isFrozen ? 'Unfreeze' : 'Freeze to extend shelf life'}
            >
              {isFreezing ? '…' : item.isFrozen ? '🔥 Unfreeze' : '❄️ Freeze'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
