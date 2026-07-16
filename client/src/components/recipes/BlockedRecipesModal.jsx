import { useState } from 'react';
import toast from 'react-hot-toast';

const SOURCE_LABEL = {
  saved: 'Saved',
  spoonacular: 'Spoonacular',
  mealdb: 'TheMealDB',
};

export default function BlockedRecipesModal({
  blocklist,
  loading,
  onClose,
  onUnblock,
}) {
  const [removingId, setRemovingId] = useState(null);

  async function handleUnblock(id) {
    setRemovingId(id);
    try {
      await onUnblock(id);
    } catch (err) {
      toast.error(err.message || 'Failed to unblock recipe');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            🚫 Blocked Recipes
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : blocklist.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              No blocked recipes yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {blocklist.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-gray-800 truncate">{entry.name}</p>
                    <span className="text-xs text-gray-400">
                      {SOURCE_LABEL[entry.source] ?? entry.source}
                    </span>
                  </div>
                  <button
                    onClick={() => handleUnblock(entry.id)}
                    disabled={removingId === entry.id}
                    className="flex-shrink-0 text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {removingId === entry.id ? 'Unblocking…' : 'Unblock'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-3 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
