import { useState, useEffect } from 'react';
import { api } from '../../api/index.js';
import toast from 'react-hot-toast';
import RecipeSelectList from './RecipeSelectList.jsx';
import ShoppingResultSummary from './ShoppingResultSummary.jsx';

export default function AddRecipesModal({ onClose, onAdd }) {
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // TASK-050 D-11: tracked separately from selectedIds — replaced wholesale on each
  // "Suggest recipes for me" click, never mutated by checkbox interactions. selectedIds
  // stays the single source of truth for what's checked.
  const [suggestedIds, setSuggestedIds] = useState(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState(null); // { items, warnings } after add

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

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const data = await api.get('/api/recipes/suggested-for-shopping');
      const ids = (data.suggestions ?? []).map((s) => s.id);
      if (ids.length === 0) {
        toast('No strong pantry matches among your saved recipes right now.', {
          icon: 'ℹ️',
        });
        return;
      }
      setSuggestedIds(new Set(ids));
      setSelectedIds((prev) => new Set([...prev, ...ids]));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAdd() {
    if (selectedIds.size === 0) {
      toast.error('Select at least one recipe.');
      return;
    }

    setAdding(true);
    try {
      const data = await onAdd([...selectedIds]);
      setResult(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            {result ? 'Recipe Added' : 'Add Recipe to List'}
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
              result.items.length === 0 ? (
                'Every ingredient from the selected recipe(s) is already in your pantry or on this list.'
              ) : (
                <>
                  Added{' '}
                  <span className="font-medium">{result.items.length}</span>{' '}
                  item{result.items.length !== 1 ? 's' : ''}.
                </>
              )
            }
            warnings={result.warnings}
            onDone={onClose}
          />
        ) : (
          /* Picker view */
          <>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <button
                type="button"
                onClick={handleSuggest}
                disabled={suggesting}
                className="w-full py-2 border border-orange-200 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
              >
                {suggesting ? 'Suggesting…' : '✨ Suggest recipes for me'}
              </button>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Select recipes{' '}
                  {selectedIds.size > 0 && (
                    <span className="text-orange-600">
                      ({selectedIds.size} selected)
                    </span>
                  )}
                </p>
                {[...selectedIds].some((id) => suggestedIds.has(id)) && (
                  <p className="text-xs text-orange-500 mb-2">
                    Suggested based on your pantry
                  </p>
                )}

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
                onClick={handleAdd}
                disabled={adding || selectedIds.size === 0}
                className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? 'Adding…' : 'Add to List'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
