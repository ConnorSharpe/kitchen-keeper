import { useState, useEffect } from 'react';
import { api } from '../../api/index.js';
import toast from 'react-hot-toast';

export default function BuildListModal({ onClose, onBuild }) {
  const [recipes, setRecipes]         = useState([]);
  const [loadingRecipes, setLoading]  = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [listName, setListName]       = useState('');
  const [building, setBuilding]       = useState(false);
  const [result, setResult]           = useState(null); // { list, items, warnings } after build

  useEffect(() => {
    api.get('/api/recipes')
      .then((data) => setRecipes(data.recipes ?? []))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleRecipe(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBuild() {
    if (!listName.trim()) { toast.error('Give the list a name.'); return; }
    if (selectedIds.size === 0) { toast.error('Select at least one recipe.'); return; }

    setBuilding(true);
    try {
      const data = await onBuild(listName.trim(), [...selectedIds]);
      setResult(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            {result ? 'List Built' : 'Build Shopping List'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Result view */}
        {result ? (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-700">
              <span className="font-medium">"{result.list.name}"</span> created with{' '}
              <span className="font-medium">{result.items.length}</span> item
              {result.items.length !== 1 ? 's' : ''}.
            </p>

            {result.warnings.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  Unit mismatch — review these items
                </p>
                <ul className="text-sm text-amber-800 space-y-0.5">
                  {result.warnings.map((w) => (
                    <li key={w} className="flex items-center gap-1.5">
                      <span aria-hidden>⚠️</span> {w}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-1">
                  The same ingredient appeared in multiple recipes with different units.
                  Quantities could not be combined — check the list and adjust manually.
                </p>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
            >
              Done
            </button>
          </div>
        ) : (
          /* Builder view */
          <>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  List name
                </label>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g. This week's meals"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Select recipes{' '}
                  {selectedIds.size > 0 && (
                    <span className="text-orange-600">({selectedIds.size} selected)</span>
                  )}
                </p>

                {loadingRecipes ? (
                  <p className="text-sm text-gray-400">Loading recipes…</p>
                ) : recipes.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No saved recipes yet. Save some recipes first.
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-60 overflow-y-auto">
                    {recipes.map((r) => (
                      <li key={r.id}>
                        <label className="flex items-start gap-2.5 cursor-pointer rounded-lg p-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleRecipe(r.id)}
                            className="mt-0.5 accent-orange-600"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
                            {r.tags?.length > 0 && (
                              <p className="text-xs text-gray-400 truncate">{r.tags.join(', ')}</p>
                            )}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBuild}
                disabled={building || selectedIds.size === 0 || !listName.trim()}
                className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {building ? 'Building…' : 'Build List'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
