import { useState } from 'react';
import { usePushNotifications } from '../../hooks/usePushNotifications.js';

export default function PushNotificationBanner() {
  const { isSupported, permission, subscription, loading, error, subscribe } =
    usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  if (!isSupported || permission === 'denied' || subscription || dismissed)
    return null;

  return (
    <div
      className="mb-4 flex items-start justify-between rounded-lg bg-blue-50 border
                    border-blue-200 px-4 py-3 text-sm gap-3"
    >
      <span className="text-blue-800 flex-1">
        🔔 Get notified when items are expiring or ready to use.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={subscribe}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold
                     hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Enabling…' : 'Enable'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          disabled={loading}
          className="text-blue-400 hover:text-blue-600 text-base leading-none disabled:opacity-50"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
