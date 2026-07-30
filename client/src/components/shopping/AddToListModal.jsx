import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useShopping } from '../../hooks/useShopping.js';
import ShoppingResultSummary from './ShoppingResultSummary.jsx';

// TASK-050 Design 2 / D-1: its own useShopping() instance — no shared state with
// ShoppingPage, just a fresh fetchLists() on open plus one of buildList/addRecipesToList.
export default function AddToListModal({ recipeId, recipeName, onClose }) {
  const { lists, loading, fetchLists, buildList, addRecipesToList } = useShopping();
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [selectedListId, setSelectedListId] = useState(null);
  const [newListName, setNewListName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { listName, items, warnings, created }

  useEffect(() => {
    fetchLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zero lists: skip the tab control entirely (Design 2). Otherwise default to the
  // first list once loaded.
  useEffect(() => {
    if (!loading && lists.length === 0) {
      setMode('new');
    } else if (lists.length > 0 && selectedListId === null) {
      setSelectedListId(lists[0].id);
    }
  }, [loading, lists, selectedListId]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (mode === 'existing') {
        if (selectedListId === null) {
          toast.error('Select a list.');
          return;
        }
        const data = await addRecipesToList(selectedListId, [recipeId]);
        const listName = lists.find((l) => l.id === selectedListId)?.name ?? '';
        setResult({
          listName,
          items: data.items,
          warnings: data.warnings,
          created: false,
        });
      } else {
        if (!newListName.trim()) {
          toast.error('Give the list a name.');
          return;
        }
        const data = await buildList(newListName.trim(), [recipeId]);
        setResult({
          listName: data.list.name,
          items: data.items,
          warnings: data.warnings,
          created: true,
        });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            {result ? 'Recipe Added' : 'Add to Shopping List'}
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
                `Every ingredient from "${recipeName}" is already in your pantry or on this list.`
              ) : result.created ? (
                <>
                  <span className="font-medium">
                    &quot;{result.listName}&quot;
                  </span>{' '}
                  created with{' '}
                  <span className="font-medium">{result.items.length}</span> item
                  {result.items.length !== 1 ? 's' : ''}.
                </>
              ) : (
                <>
                  Added{' '}
                  <span className="font-medium">{result.items.length}</span>{' '}
                  item{result.items.length !== 1 ? 's' : ''} to{' '}
                  <span className="font-medium">
                    &quot;{result.listName}&quot;
                  </span>
                  .
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
              <p className="text-sm text-gray-500">
                Adding{' '}
                <span className="font-medium text-gray-700">{recipeName}</span> to
                your shopping list.
              </p>

              {loading ? (
                <p className="text-sm text-gray-400">Loading your lists…</p>
              ) : (
                <>
                  {lists.length > 0 && (
                    <div className="flex rounded-lg border border-gray-200 p-0.5 text-sm">
                      <button
                        type="button"
                        onClick={() => setMode('existing')}
                        className={`flex-1 py-1.5 rounded-md transition-colors ${
                          mode === 'existing'
                            ? 'bg-orange-600 text-white'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Add to existing list
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('new')}
                        className={`flex-1 py-1.5 rounded-md transition-colors ${
                          mode === 'new'
                            ? 'bg-orange-600 text-white'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Start a new list
                      </button>
                    </div>
                  )}

                  {mode === 'existing' && lists.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        List
                      </label>
                      <select
                        value={selectedListId ?? ''}
                        onChange={(e) =>
                          setSelectedListId(Number(e.target.value))
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      >
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        List name
                      </label>
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="e.g. This week's meals"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  loading ||
                  (mode === 'new' && !newListName.trim()) ||
                  (mode === 'existing' && selectedListId === null)
                }
                className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting
                  ? 'Adding…'
                  : mode === 'new'
                    ? 'Create List'
                    : 'Add to List'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
