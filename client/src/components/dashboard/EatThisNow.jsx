import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';
import { usePantryContext } from '../../context/PantryContext.jsx';
import RecipeSuggestionCard from '../recipes/RecipeSuggestionCard.jsx';

const DIFFICULTY_BADGE = {
  easy: 'badge-status-ok',
  medium: 'badge-status-warning',
  hard: 'badge-status-critical',
};

function FallbackRecipeCard({ recipe, expiringNames }) {
  // Highlight which ingredients overlap with expiring items
  const matchingIngredients = (recipe.ingredients || [])
    .map((ing) => ing.name)
    .filter((name) => expiringNames.has(name.toLowerCase()));

  return (
    <div className="card p-4 flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{recipe.name}</h3>
      {recipe.description && (
        <p className="text-sm text-ink-muted">{recipe.description}</p>
      )}
      {matchingIngredients.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matchingIngredients.map((name) => (
            <span key={name} className="badge-tag">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EatThisNow() {
  const { allItems, expiringItems } = usePantryContext();
  const [suggestions, setSuggestions] = useState([]);
  const [fallbackRecipes, setFallbackRecipes] = useState([]);
  const [mode, setMode] = useState('idle'); // 'idle' | 'loading' | 'suggestions' | 'fallback' | 'empty'
  const [savingName, setSavingName] = useState(null);

  const pantryIsEmpty = allItems.length === 0;

  const handleGetSuggestions = async () => {
    setMode('loading');
    setSuggestions([]);
    setFallbackRecipes([]);

    try {
      const data = await api.post('/api/ai/eat-this-now');
      if (data.suggestions?.length > 0) {
        setSuggestions(data.suggestions);
        setMode('suggestions');
      } else {
        setMode('empty');
      }
    } catch {
      // AI unavailable — fall back to saved recipes that use expiring ingredients
      try {
        const data = await api.get('/api/recipes');
        const expiringNames = new Set(
          expiringItems.map((i) => i.name.toLowerCase())
        );
        const matching = (data.recipes || []).filter((r) =>
          (r.ingredients || []).some((ing) =>
            expiringNames.has(ing.name?.toLowerCase())
          )
        );
        if (matching.length > 0) {
          setFallbackRecipes(matching);
          setMode('fallback');
        } else {
          setMode('empty');
        }
      } catch {
        setMode('empty');
        toast.error('Could not reach the AI service. Try again later.');
      }
    }
  };

  const handleSave = async (suggestion) => {
    setSavingName(suggestion.name);
    try {
      await api.post('/api/ai/expand-suggestion', {
        name: suggestion.name,
        description: suggestion.description,
      });
      toast.success(`"${suggestion.name}" saved to your recipes!`);
    } catch (err) {
      toast.error(err.message || 'Failed to save recipe');
    } finally {
      setSavingName(null);
    }
  };

  const expiringNames = new Set(expiringItems.map((i) => i.name.toLowerCase()));

  return (
    <div className="rounded-xl border border-border bg-page p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            What Can I Make?
          </h2>
          <p className="text-xs text-ink-subtle mt-0.5">
            AI suggestions using your expiring ingredients
          </p>
        </div>

        <button
          onClick={handleGetSuggestions}
          disabled={pantryIsEmpty || mode === 'loading'}
          className="btn-primary"
          title={pantryIsEmpty ? 'Add items to your pantry first' : undefined}
        >
          {mode === 'loading' ? (
            <span className="flex items-center gap-2">
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
              Thinking…
            </span>
          ) : (
            '✨ Suggest Meals'
          )}
        </button>
      </div>

      {pantryIsEmpty && mode === 'idle' && (
        <p className="text-sm text-ink-subtle text-center py-4">
          Add items to your pantry first, then get meal suggestions here.
        </p>
      )}

      {!pantryIsEmpty && mode === 'idle' && (
        <div className="text-center py-6 text-ink-subtle select-none">
          <p className="text-4xl mb-3" aria-hidden>
            🍽️
          </p>
          <p className="text-sm text-ink-subtle max-w-xs mx-auto">
            Tap{' '}
            <span className="font-medium text-ink-muted">✨ Suggest Meals</span>{' '}
            to get personalised ideas that use your expiring ingredients first.
          </p>
          <p className="text-xs text-ink-subtle mt-3">
            Prefer to just ask?{' '}
            <a href="/" className="text-primary hover:underline">
              Chat →
            </a>
          </p>
        </div>
      )}

      {mode === 'loading' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-full mb-2" />
              <div className="h-3 bg-gray-100 rounded w-4/5 mb-4" />
              <div className="flex justify-end">
                <div className="h-7 bg-gray-200 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === 'suggestions' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestions.map((s) => (
            <RecipeSuggestionCard
              key={s.name}
              item={s}
              name={s.name}
              description={s.description}
              badge={
                s.difficulty
                  ? {
                      label: s.difficulty,
                      className:
                        DIFFICULTY_BADGE[s.difficulty] ||
                        'bg-page text-ink-muted',
                    }
                  : undefined
              }
              usesExpiring={s.usesExpiring}
              footerNote={
                s.estimatedMinutes != null
                  ? `~${s.estimatedMinutes} min`
                  : undefined
              }
              onSave={handleSave}
              isSaving={savingName === s.name}
            />
          ))}
        </div>
      )}

      {mode === 'fallback' && (
        <>
          <p className="text-xs text-status-warning-text mb-3">
            AI unavailable — showing saved recipes that use your expiring
            ingredients:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fallbackRecipes.map((r) => (
              <FallbackRecipeCard
                key={r.id}
                recipe={r}
                expiringNames={expiringNames}
              />
            ))}
          </div>
        </>
      )}

      {mode === 'empty' && (
        <p className="text-sm text-ink-subtle text-center py-4">
          No suggestions available right now. Try adding more items to your
          pantry.
        </p>
      )}
    </div>
  );
}
