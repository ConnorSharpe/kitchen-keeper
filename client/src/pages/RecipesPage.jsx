import { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useRecipes } from '../hooks/useRecipes.js';
import { useRecipeBlocklist } from '../hooks/useRecipeBlocklist.js';
import { api } from '../api/index.js';
import RecipeCard from '../components/recipes/RecipeCard.jsx';
import RecipeSuggestionCard from '../components/recipes/RecipeSuggestionCard.jsx';
import RecipeModal from '../components/recipes/RecipeModal.jsx';
import AddToListModal from '../components/shopping/AddToListModal.jsx';
import RecipeUpload from '../components/recipes/RecipeUpload.jsx';
import RecipeUrlImport from '../components/recipes/RecipeUrlImport.jsx';
import RecipeReviewModal from '../components/recipes/RecipeReviewModal.jsx';
import BlockedRecipesModal from '../components/recipes/BlockedRecipesModal.jsx';
import AddRecipeMenu from '../components/recipes/AddRecipeMenu.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';

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
  const [addToListRecipe, setAddToListRecipe] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [reviewRecipe, setReviewRecipe] = useState(null);
  const [reviewImage, setReviewImage] = useState(null); // Blob | null
  const [reviewSourceUrl, setReviewSourceUrl] = useState(null);
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
  const [filterName, setFilterName] = useState('');

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
      if (
        filterName &&
        !r.name.toLowerCase().includes(filterName.toLowerCase())
      )
        return false;
      return true;
    });
  }, [recipes, filterSource, filterFavorites, filterTag, filterName]);

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

  function handleUrlExtracted(recipe, url) {
    setShowUrlImport(false);
    setReviewRecipe(recipe);
    setReviewImage(null);
    setReviewSourceUrl(url);
  }

  function handleNeedsManualEntry(titleGuess, url) {
    setShowUrlImport(false);
    setReviewRecipe({
      name: titleGuess ?? '',
      description: null,
      ingredients: [],
      steps: [],
      servings: null,
      prepMins: null,
      cookMins: null,
      tags: [],
    });
    setReviewImage(null);
    setReviewSourceUrl(url);
    toast(
      "Couldn't auto-extract that recipe — add the details below.",
      { icon: 'ℹ️' }
    );
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
      <PageHeader
        title="Recipes"
        subtitle={`${recipes.length} saved recipe${recipes.length !== 1 ? 's' : ''}`}
        actions={
          <AddRecipeMenu
            onUpload={() => setShowUpload(true)}
            onImportUrl={() => setShowUrlImport(true)}
            onFindOnline={handleFindOnline}
            findOnlineLoading={webLoading}
          />
        }
      />

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
              <RecipeSuggestionCard
                key={s.name}
                item={s}
                name={s.name}
                sourceUrl={s.sourceUrl}
                description={s.description}
                tags={s.tags}
                badge={{
                  label: 'From Web',
                  className: 'bg-orange-100 text-orange-700',
                }}
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
        <input
          type="text"
          placeholder="Search by name…"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400 w-40"
        />

        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400"
        >
          <option value="all">All sources</option>
          <option value="upload">Uploaded</option>
          <option value="ai_suggested">AI Suggested</option>
          <option value="web_suggested">From Web</option>
          <option value="url_import">Imported from URL</option>
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

        {(filterSource !== 'all' || filterFavorites || filterTag || filterName) && (
          <button
            onClick={() => {
              setFilterSource('all');
              setFilterFavorites(false);
              setFilterTag('');
              setFilterName('');
            }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filters
          </button>
        )}

        <button
          onClick={handleOpenBlocklist}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          🚫 Blocked Recipes
        </button>
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
                  setFilterName('');
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
              onAddToList={setAddToListRecipe}
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
          onAddToList={setAddToListRecipe}
        />
      )}

      {addToListRecipe && (
        <AddToListModal
          recipeId={addToListRecipe.id}
          recipeName={addToListRecipe.name}
          onClose={() => setAddToListRecipe(null)}
        />
      )}

      {showUpload && (
        <RecipeUpload
          onExtracted={handleExtracted}
          onClose={() => setShowUpload(false)}
        />
      )}

      {showUrlImport && (
        <RecipeUrlImport
          onExtracted={handleUrlExtracted}
          onNeedsManualEntry={handleNeedsManualEntry}
          onClose={() => setShowUrlImport(false)}
        />
      )}

      {reviewRecipe && (
        <RecipeReviewModal
          recipe={reviewRecipe}
          source={reviewSourceUrl ? 'url_import' : 'upload'}
          sourceUrl={reviewSourceUrl}
          onSave={handleReviewSave}
          onClose={() => {
            setReviewRecipe(null);
            setReviewImage(null);
            setReviewSourceUrl(null);
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
