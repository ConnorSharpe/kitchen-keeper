import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../api/index.js';
import { usePantryContext } from '../../context/PantryContext.jsx';

const DIFFICULTY_BADGE = {
  easy:   'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  hard:   'bg-red-100 text-red-700',
};

function SuggestionCard({ suggestion, onSave, isSaving }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{suggestion.name}</h3>
        {suggestion.difficulty && (
          <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_BADGE[suggestion.difficulty] || 'bg-gray-100 text-gray-600'}`}>
            {suggestion.difficulty}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-600">{suggestion.description}</p>

      {suggestion.usesExpiring?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestion.usesExpiring.map((ing) => (
            <span key={ing} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
              {ing}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-1">
        {suggestion.estimatedMinutes != null && (
          <span className="text-xs text-gray-400">~{suggestion.estimatedMinutes} min</span>
        )}
        <button
          onClick={() => onSave(suggestion)}
          disabled={isSaving}
          className="ml-auto text-xs px-3 py-1.5 rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Saving…' : 'Save Recipe'}
        </button>
      </div>
    </div>
  );
}

function FallbackRecipeCard({ recipe, expiringNames }) {
  // Highlight which ingredients overlap with expiring items
  const matchingIngredients = (recipe.ingredients || [])
    .map((ing) => ing.name)
    .filter((name) => expiringNames.has(name.toLowerCase()));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-900">{recipe.name}</h3>
      {recipe.description && (
        <p className="text-sm text-gray-600">{recipe.description}</p>
      )}
      {matchingIngredients.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matchingIngredients.map((name) => (
            <span key={name} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
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
        const expiringNames = new Set(expiringItems.map((i) => i.name.toLowerCase()));
        const matching = (data.recipes || []).filter((r) =>
          (r.ingredients || []).some((ing) => expiringNames.has(ing.name?.toLowerCase()))
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
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">What Can I Make?</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            AI suggestions using your expiring ingredients
          </p>
        </div>

        <button
          onClick={handleGetSuggestions}
          disabled={pantryIsEmpty || mode === 'loading'}
          className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={pantryIsEmpty ? 'Add items to your pantry first' : undefined}
        >
          {mode === 'loading' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Thinking…
            </span>
          ) : '✨ Suggest Meals'}
        </button>
      </div>

      {pantryIsEmpty && mode === 'idle' && (
        <p className="text-sm text-gray-400 text-center py-4">
          Add items to your pantry first, then get meal suggestions here.
        </p>
      )}

      {mode === 'suggestions' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.name}
              suggestion={s}
              onSave={handleSave}
              isSaving={savingName === s.name}
            />
          ))}
        </div>
      )}

      {mode === 'fallback' && (
        <>
          <p className="text-xs text-amber-600 mb-3">
            AI unavailable — showing saved recipes that use your expiring ingredients:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fallbackRecipes.map((r) => (
              <FallbackRecipeCard key={r.id} recipe={r} expiringNames={expiringNames} />
            ))}
          </div>
        </>
      )}

      {mode === 'empty' && (
        <p className="text-sm text-gray-400 text-center py-4">
          No suggestions available right now. Try adding more items to your pantry.
        </p>
      )}
    </div>
  );
}
