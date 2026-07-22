import { useState } from 'react';
import toast from 'react-hot-toast';

const SOURCE_BADGE = {
  upload: { label: 'Uploaded', cls: 'bg-blue-100 text-blue-700' },
  ai_suggested: { label: 'AI Suggested', cls: 'bg-purple-100 text-purple-700' },
  web_suggested: { label: 'From Web', cls: 'bg-orange-100 text-orange-700' },
  manual: { label: 'Manual', cls: 'bg-gray-100 text-gray-600' },
  url_import: { label: 'Imported from URL', cls: 'bg-teal-100 text-teal-700' },
};

export default function RecipeModal({
  recipe,
  onClose,
  onDelete,
  onToggleFavorite,
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const badge = SOURCE_BADGE[recipe.source] ?? SOURCE_BADGE.manual;
  const totalMins = (recipe.prepMins ?? 0) + (recipe.cookMins ?? 0);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(recipe.id);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to delete recipe');
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header image */}
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.name}
            className="h-44 w-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="h-24 bg-gradient-to-br from-orange-50 to-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-5xl" aria-hidden>
              🍽️
            </span>
          </div>
        )}

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold text-gray-900">{recipe.name}</h2>
            <button
              onClick={() => onToggleFavorite(recipe.id)}
              className="text-2xl leading-none flex-shrink-0"
              aria-label={
                recipe.isFavorite ? 'Remove from favorites' : 'Add to favorites'
              }
            >
              {recipe.isFavorite ? '★' : '☆'}
            </button>
          </div>

          {/* Source badge + URL */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}
            >
              {badge.label}
            </span>
            {recipe.sourceUrl && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {recipe.sourceUrl}
              </a>
            )}
          </div>

          {/* Description */}
          {recipe.description && (
            <p className="text-sm text-gray-600 mb-4">{recipe.description}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-5">
            {recipe.servings && <span>🍽 {recipe.servings} servings</span>}
            {recipe.prepMins && <span>🥄 {recipe.prepMins} min prep</span>}
            {recipe.cookMins && <span>🔥 {recipe.cookMins} min cook</span>}
            {totalMins > 0 && <span>⏱ {totalMins} min total</span>}
          </div>

          {/* Tags */}
          {recipe.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-5">
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Ingredients */}
          {recipe.ingredients?.length > 0 && (
            <section className="mb-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">
                Ingredients
              </h3>
              <ul className="space-y-1">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-gray-400 select-none">•</span>
                    <span>
                      {ing.quantity != null && `${ing.quantity} `}
                      {ing.unit && `${ing.unit} `}
                      {ing.name}
                      {typeof ing.substitute === 'string' &&
                        ing.substitute.trim() !== '' && (
                          <span className="text-amber-600 text-xs ml-1.5 font-medium">
                            → pantry sub: {ing.substitute}
                          </span>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Steps */}
          {recipe.steps?.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-2">
                Instructions
              </h3>
              <ol className="space-y-3">
                {recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 flex-shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
              confirming
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-red-500 hover:bg-red-50'
            } disabled:opacity-50`}
          >
            {deleting ? 'Deleting…' : confirming ? 'Confirm delete?' : 'Delete'}
          </button>
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
