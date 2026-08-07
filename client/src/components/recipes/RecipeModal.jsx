import { useState } from 'react';
import toast from 'react-hot-toast';

// Matches RecipeCard.jsx's SOURCE_BADGE (TASK-057 Section 7) — same 5 named classes/icons.
const SOURCE_BADGE = {
  upload: {
    label: 'Uploaded',
    cls: 'badge-source-uploaded',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <circle cx="12" cy="13" r="3.5" strokeWidth={2} />
      </svg>
    ),
  },
  ai_suggested: {
    label: 'AI Suggested',
    cls: 'badge-source-ai',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" />
      </svg>
    ),
  },
  web_suggested: {
    label: 'From Web',
    cls: 'badge-source-web',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M3 12h18" />
        <path strokeLinecap="round" strokeWidth={2} d="M12 3a14.5 14.5 0 010 18" />
        <path strokeLinecap="round" strokeWidth={2} d="M12 3a14.5 14.5 0 000 18" />
      </svg>
    ),
  },
  manual: {
    label: 'Manual',
    cls: 'badge-source-manual',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-1.414.94l-3.535 1.178 1.178-3.535a4 4 0 01.943-1.414z" />
      </svg>
    ),
  },
  url_import: {
    label: 'Imported from URL',
    cls: 'badge-source-url',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-2 2a4 4 0 01-5.656-5.656l1-1" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 010-5.656l2-2a4 4 0 015.656 5.656l-1 1" />
      </svg>
    ),
  },
};

export default function RecipeModal({
  recipe,
  onClose,
  onDelete,
  onToggleFavorite,
  onAddToList,
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
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header image */}
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.name}
            className="h-44 w-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="h-24 bg-gradient-to-br from-page to-highlight flex items-center justify-center flex-shrink-0">
            <span className="text-5xl" aria-hidden>
              🍽️
            </span>
          </div>
        )}

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold text-ink">{recipe.name}</h2>
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
            <span className={badge.cls}>
              {badge.icon}
              {badge.label}
            </span>
            {recipe.sourceUrl && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {recipe.sourceUrl}
              </a>
            )}
          </div>

          {/* Description */}
          {recipe.description && (
            <p className="text-sm text-ink-muted mb-4">{recipe.description}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-4 text-sm text-ink-subtle mb-5">
            {recipe.servings && <span>🍽 {recipe.servings} servings</span>}
            {recipe.prepMins && <span>🥄 {recipe.prepMins} min prep</span>}
            {recipe.cookMins && <span>🔥 {recipe.cookMins} min cook</span>}
            {totalMins > 0 && <span>⏱ {totalMins} min total</span>}
          </div>

          {/* Tags */}
          {recipe.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-5">
              {recipe.tags.map((tag) => (
                <span key={tag} className="badge-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Ingredients */}
          {recipe.ingredients?.length > 0 && (
            <section className="mb-5">
              <h3 className="text-sm font-semibold text-ink mb-2">
                Ingredients
              </h3>
              <ul className="space-y-1">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="text-sm text-ink-muted flex gap-2">
                    <span className="text-ink-subtle select-none">•</span>
                    <span>
                      {ing.quantity != null && `${ing.quantity} `}
                      {ing.unit && `${ing.unit} `}
                      {ing.name}
                      {typeof ing.substitute === 'string' &&
                        ing.substitute.trim() !== '' && (
                          <span className="text-status-warning-text text-xs ml-1.5 font-medium">
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
              <h3 className="text-sm font-semibold text-ink mb-2">
                Instructions
              </h3>
              <ol className="space-y-3">
                {recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-ink-muted">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
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
        <div className="flex items-center justify-between border-t border-border px-6 py-4 flex-shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
              confirming
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'btn-text-danger'
            }`}
          >
            {deleting ? 'Deleting…' : confirming ? 'Confirm delete?' : 'Delete'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAddToList(recipe)}
              className="btn-secondary text-sm px-3 py-1.5"
            >
              🛒 Add to Shopping List
            </button>
            <button
              onClick={onClose}
              className="text-sm px-4 py-1.5 rounded-md bg-page text-ink-muted hover:bg-border transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
