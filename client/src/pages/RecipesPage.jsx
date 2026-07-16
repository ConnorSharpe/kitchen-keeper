import { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useRecipes } from '../hooks/useRecipes.js';
import { useRecipeBlocklist } from '../hooks/useRecipeBlocklist.js';
import { api } from '../api/index.js';
import RecipeCard from '../components/recipes/RecipeCard.jsx';
import RecipeModal from '../components/recipes/RecipeModal.jsx';
import RecipeUpload from '../components/recipes/RecipeUpload.jsx';
import RecipeReviewModal from '../components/recipes/RecipeReviewModal.jsx';
import BlockedRecipesModal from '../components/recipes/BlockedRecipesModal.jsx';

// Web suggestion card — ephemeral until saved by user
function WebSuggestionCard({ suggestion, onSave, isSaving, onBlock }) {
  return (
    <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {suggestion.name}
        </h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onBlock && (
            <button
              onClick={() => onBlock(suggestion)}
              className="text-sm leading-none text-gray-300 hover:text-red-500 transition-colors"
              aria-label="Don't suggest again"
              title="Don't suggest again"
            >
              🚫
            </button>
          )}
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
            From Web
          </span>
        </div>
      </div>

      {suggestion.description && (
        <p className="text-xs text-gray-500 line-clamp-2">
          {suggestion.description}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {suggestion.tags?.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between mt-auto pt-1">
        {suggestion.sourceUrl ? (
          <a
            href={suggestion.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline truncate max-w-[60%]"
            onClick={(e) => e.stopPropagation()}
          >
            View source
          </a>
        ) : (
          <span />
        )}
        <button
          onClick={() => onSave(suggestion)}
          disabled={isSaving}
          className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Saving…' : 'Save Recipe'}
        </button>
      </div>
    </div>
  );
}

export default function RecipesPage() {
  const {
    recipes,
    loading,
    error,
    refresh,
    addRecipe,
    removeRecipe,
    toggleFavorite,
  } = useRecipes();
  const {
    blocklist,
    loading: blocklistLoading,
    refresh: refreshBlocklist,
    addBlock,
    removeBlock,
  } = useRecipeBlocklist();

  const [openRecipe, setOpenRecipe] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [reviewRecipe, setReviewRecipe] = useState(null);
  const [reviewImage, setReviewImage] = useState(null); // Blob | null
  const [favLoadingId, setFavLoadingId] = useState(null);
  const [showBlocklist, setShowBlocklist] = useState(false);

  // Web suggestion state
  const [webSuggestions, setWebSuggestions] = useState([]);
  const [webLoading, setWebLoading] = useState(false);
  const [savingName, setSavingName] = useState(null);

  // Filter state — all client-side
  const [filterSource, setFilterSource] = useState('all');
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterTag, setFilterTag] = useState('');

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      if (filterSource !== 'all' && r.source !== filterSource) return false;
      if (filterFavorites && !r.isFavorite) return false;
      if (
        filterTag &&
        !r.tags?.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))
      )
        return false;
      return true;
    });
  }, [recipes, filterSource, filterFavorites, filterTag]);

  async function handleFindOnline() {
    setWebLoading(true);
    setWebSuggestions([]);
    try {
      const data = await api.post('/api/ai/suggest-recipes');
      if (data.suggestions?.length > 0) {
        setWebSuggestions(data.suggestions);
      } else {
        toast(
          'No web suggestions found for your expiring items. Try again later.',
          { icon: 'ℹ️' }
        );
      }
    } catch (err) {
      toast.error(err.message || 'Failed to find recipes online');
    } finally {
      setWebLoading(false);
    }
  }

  async function handleSaveWebSuggestion(suggestion) {
    setSavingName(suggestion.name);
    try {
      const saved = await addRecipe({
        ...suggestion,
        source: 'web_suggested',
      });
      setWebSuggestions((prev) =>
        prev.filter((s) => s.name !== suggestion.name)
      );
      toast.success(`"${saved.name}" saved to your recipes!`);
    } catch (err) {
      toast.error(err.message || 'Failed to save recipe');
    } finally {
      setSavingName(null);
    }
  }

  async function handleBlockRecipe(source, sourceId, name) {
    try {
      await addBlock({ source, sourceId, name });
      toast.success(`"${name}" won't be suggested again`);
    } catch (err) {
      toast.error(err.message || 'Failed to block recipe');
    }
  }

  function handleBlockSaved(recipe) {
    handleBlockRecipe('saved', String(recipe.id), recipe.name);
  }

  async function handleBlockWebSuggestion(suggestion) {
    await handleBlockRecipe(
      suggestion.source,
      suggestion.sourceId,
      suggestion.name
    );
    setWebSuggestions((prev) => prev.filter((s) => s.name !== suggestion.name));
  }

  function handleOpenBlocklist() {
    setShowBlocklist(true);
    refreshBlocklist();
  }

  async function handleToggleFavorite(id) {
    setFavLoadingId(id);
    try {
      await toggleFavorite(id);
      // If modal is open for this recipe, update it
      if (openRecipe?.id === id) {
        setOpenRecipe(
          (prev) => prev && { ...prev, isFavorite: !prev.isFavorite }
        );
      }
    } catch (err) {
      toast.error(err.message || 'Failed to update favorite');
    } finally {
      setFavLoadingId(null);
    }
  }

  async function handleDelete(id) {
    await removeRecipe(id);
    toast.success('Recipe deleted');
  }

  function handleExtracted(recipe, imageBlob) {
    setShowUpload(false);
    setReviewRecipe(recipe);
    setReviewImage(imageBlob ?? null);
  }

  async function handleReviewSave(recipe) {
    try {
      let payload = recipe;
      if (reviewImage) {
        if (reviewImage.size > 3 * 1024 * 1024) {
          console.warn(
            `[RecipesPage] Skipping oversized image (${reviewImage.size} bytes) on save`
          );
          toast.error('Photo too large to save — recipe saved without it');
        } else {
          const imageBase64 = await blobToDataUrl(reviewImage);
          payload = { ...recipe, imageBase64 };
        }
      }
      await api.post('/api/recipes', payload);
      setReviewRecipe(null);
      setReviewImage(null);
      refresh();
      toast.success(`"${recipe.name}" saved to your recipes!`);
    } catch (err) {
      toast.error(err.message || 'Failed to save recipe');
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {recipes.length} saved recipe{recipes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleOpenBlocklist}
            className="text-sm px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            🚫 Blocked Recipes
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="text-sm px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            📸 Upload Recipe Image
          </button>
          <button
            onClick={handleFindOnline}
            disabled={webLoading}
            className="text-sm px-3 py-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {webLoading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Searching…
              </>
            ) : (
              '🔍 Find Recipes Online'
            )}
          </button>
        </div>
      </div>

      {/* Web suggestions panel */}
      {webSuggestions.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">
              Recipes Found Online
              <span className="ml-2 text-sm font-normal text-gray-500">
                using your expiring ingredients
              </span>
            </h2>
            <button
              onClick={() => setWebSuggestions([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {webSuggestions.map((s) => (
              <WebSuggestionCard
                key={s.name}
                suggestion={s}
                onSave={handleSaveWebSuggestion}
                isSaving={savingName === s.name}
                onBlock={handleBlockWebSuggestion}
              />
            ))}
          </div>
        </section>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400"
        >
          <option value="all">All sources</option>
          <option value="upload">Uploaded</option>
          <option value="ai_suggested">AI Suggested</option>
          <option value="web_suggested">From Web</option>
          <option value="manual">Manual</option>
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterFavorites}
            onChange={(e) => setFilterFavorites(e.target.checked)}
            className="rounded border-gray-300 text-orange-500 focus:ring-orange-400"
          />
          Favorites only
        </label>

        <input
          type="text"
          placeholder="Filter by tag…"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400 w-36"
        />

        {(filterSource !== 'all' || filterFavorites || filterTag) && (
          <button
            onClick={() => {
              setFilterSource('all');
              setFilterFavorites(false);
              setFilterTag('');
            }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Recipe grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-gray-100 rounded-xl h-56 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-sm text-orange-600 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {recipes.length === 0 ? (
            <>
              <p className="text-4xl mb-3">📖</p>
              <p className="text-sm font-medium text-gray-600">
                No saved recipes yet.
              </p>
              <p className="text-xs mt-1">
                Scan a recipe card or find recipes online.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-600">
                No recipes match your filters.
              </p>
              <button
                onClick={() => {
                  setFilterSource('all');
                  setFilterFavorites(false);
                  setFilterTag('');
                }}
                className="mt-2 text-xs text-orange-600 hover:underline"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onOpen={setOpenRecipe}
              onToggleFavorite={handleToggleFavorite}
              isFavoriteLoading={favLoadingId === recipe.id}
              onBlock={handleBlockSaved}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {openRecipe && (
        <RecipeModal
          recipe={openRecipe}
          onClose={() => setOpenRecipe(null)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {showUpload && (
        <RecipeUpload
          onExtracted={handleExtracted}
          onClose={() => setShowUpload(false)}
        />
      )}

      {reviewRecipe && (
        <RecipeReviewModal
          recipe={reviewRecipe}
          onSave={handleReviewSave}
          onClose={() => {
            setReviewRecipe(null);
            setReviewImage(null);
          }}
        />
      )}

      {showBlocklist && (
        <BlockedRecipesModal
          blocklist={blocklist}
          loading={blocklistLoading}
          onClose={() => setShowBlocklist(false)}
          onUnblock={removeBlock}
        />
      )}
    </div>
  );
}
