import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useShopping } from '../hooks/useShopping.js';
import BuildListModal from '../components/shopping/BuildListModal.jsx';
import AddRecipesModal from '../components/shopping/AddRecipesModal.jsx';
import ShoppingList from '../components/shopping/ShoppingList.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';

export default function ShoppingPage() {
  const { lists, loading, fetchLists, buildList, removeList, addRecipesToList } =
    useShopping();
  const [selectedId, setSelectedId] = useState(null);
  const [showBuildModal, setShowModal] = useState(false);
  const [showAddRecipesModal, setShowAddRecipesModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  // Auto-select first list when the list loads or changes
  useEffect(() => {
    if (
      lists.length > 0 &&
      (selectedId === null || !lists.find((l) => l.id === selectedId))
    ) {
      setSelectedId(lists[0].id);
    } else if (lists.length === 0) {
      setSelectedId(null);
    }
  }, [lists, selectedId]);

  async function handleBuild(name, recipeIds) {
    const data = await buildList(name, recipeIds);
    setSelectedId(data.list.id);
    return data;
  }

  async function handleAddRecipes(recipeIds) {
    const data = await addRecipesToList(selectedId, recipeIds);
    setRefreshKey((k) => k + 1);
    return data;
  }

  async function handleDelete(listId) {
    if (!window.confirm('Delete this shopping list? This cannot be undone.'))
      return;
    try {
      await removeList(listId);
      toast.success('List deleted.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const selectedList = lists.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <PageHeader
        title="Shopping Lists"
        subtitle="Start from scratch or from your saved recipes, cross-referenced with your pantry."
        className="mb-6"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 shadow-sm"
          >
            <span aria-hidden>+</span> New List
          </button>
        }
      />

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <span className="text-5xl mb-4" aria-hidden>
            🛒
          </span>
          <p className="text-lg font-medium text-gray-700">No lists yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Start a blank list, or build one from your saved recipes.
          </p>
        </div>
      ) : (
        /* Two-panel layout */
        <div className="flex gap-6 flex-1 min-h-0">
          {/* Left: list of shopping lists */}
          <aside className="w-56 flex-shrink-0 flex flex-col gap-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">
              Your Lists
            </p>
            {lists.map((list) => (
              <div
                key={list.id}
                className={`group flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                  list.id === selectedId
                    ? 'bg-orange-50 border border-orange-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
                onClick={() => setSelectedId(list.id)}
              >
                <span
                  className={`text-sm font-medium truncate ${
                    list.id === selectedId ? 'text-orange-700' : 'text-gray-700'
                  }`}
                >
                  {list.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(list.id);
                  }}
                  title="Delete list"
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-colors text-xs ml-1 flex-shrink-0"
                  aria-label={`Delete list "${list.name}"`}
                >
                  ✕
                </button>
              </div>
            ))}
          </aside>

          {/* Right: items for the selected list */}
          <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 p-5 overflow-y-auto">
            {selectedList ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-900 text-lg">
                    {selectedList.name}
                  </h2>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowAddRecipesModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-50"
                    >
                      <span aria-hidden>+</span> Add Recipe
                    </button>
                    <span className="text-xs text-gray-400">
                      Created{' '}
                      {new Date(selectedList.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <ShoppingList
                  key={`${selectedId}-${refreshKey}`}
                  listId={selectedId}
                />
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                Select a list to view its items.
              </p>
            )}
          </div>
        </div>
      )}

      {showBuildModal && (
        <BuildListModal
          onClose={() => setShowModal(false)}
          onBuild={handleBuild}
        />
      )}

      {showAddRecipesModal && (
        <AddRecipesModal
          onClose={() => setShowAddRecipesModal(false)}
          onAdd={handleAddRecipes}
        />
      )}
    </div>
  );
}
