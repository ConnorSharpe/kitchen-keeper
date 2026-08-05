import { useState, useEffect } from 'react';
import { api } from '../../api/index.js';
import toast from 'react-hot-toast';
import RecipeSelectList from './RecipeSelectList.jsx';
import ShoppingResultSummary from './ShoppingResultSummary.jsx';

export default function BuildListModal({ onClose, onBuild }) {
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [listName, setListName] = useState('');
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null); // { list, items, warnings } after build

  useEffect(() => {
    api
      .get('/api/recipes')
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
    if (!listName.trim()) {
      toast.error('Give the list a name.');
      return;
    }

    setBuilding(true);
    try {
      const data = await onBuild(listName.trim(), [...selectedIds]);
      if (selectedIds.size === 0) {
        // No result screen is meaningful for a 0-recipe list (always 0 items,
        // 0 warnings) — land the user straight on their new empty list.
        onClose();
      } else {
        setResult(data);
      }
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
            {result ? 'List Built' : 'New Shopping List'}
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
          <ShoppingResultSummary
            bodyText={
              <>
                <span className="font-medium">
                  &quot;{result.list.name}&quot;
                </span>{' '}
                created with{' '}
                <span className="font-medium">{result.items.length}</span> item
                {result.items.length !== 1 ? 's' : ''}.
              </>
            }
            warnings={result.warnings}
            onDone={onClose}
          />
        ) : (
          /* Builder view */
          <>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  List name{' '}
                  <span className="text-red-500" aria-hidden="true" title="Required">
                    *
                  </span>
                </label>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g. This week's meals"
                  aria-required="true"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Select recipes{' '}
                  {selectedIds.size > 0 && (
                    <span className="text-orange-600">
                      ({selectedIds.size} selected)
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400 mb-2">
                  Optional — leave unselected to start with a blank list.
                </p>

                <RecipeSelectList
                  recipes={recipes}
                  loading={loadingRecipes}
                  selectedIds={selectedIds}
                  onToggle={toggleRecipe}
                />
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
                disabled={building || !listName.trim()}
                className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {building
                  ? 'Building…'
                  : selectedIds.size > 0
                    ? 'Build List'
                    : 'Create List'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
