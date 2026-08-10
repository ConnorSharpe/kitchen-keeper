import { useState, useRef, useEffect } from 'react';

// Icon + label is the primary distinguishing mechanism for these 5 source badges (TASK-057
// Section 7) — hand-authored inline SVG, required by the source-badge decision itself regardless
// of Section 6's separate, optional, app-wide icon phase.
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

export default function RecipeCard({
  recipe,
  onOpen,
  onToggleFavorite,
  isFavoriteLoading,
  onBlock,
  onAddToList,
}) {
  const badge = SOURCE_BADGE[recipe.source] ?? SOURCE_BADGE.manual;
  const totalMins = (recipe.prepMins ?? 0) + (recipe.cookMins ?? 0);

  // TASK-050 D-6/D-9/D-10: DOM measurement (not a character-count heuristic), useEffect
  // (not useLayoutEffect — no flicker risk), ResizeObserver (not a window listener).
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const descRef = useRef(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setIsTruncated(el.scrollHeight > el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [recipe.description]);

  return (
    <div
      className="card overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onOpen(recipe)}
    >
      {/* Image or placeholder */}
      {recipe.imageUrl ? (
        <img
          src={recipe.imageUrl}
          alt={recipe.name}
          className="h-36 w-full object-cover"
        />
      ) : (
        <div className="h-36 bg-gradient-to-br from-page to-highlight flex items-center justify-center">
          <span className="text-4xl" aria-hidden>
            🍽️
          </span>
        </div>
      )}

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Name + favorite */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink leading-snug line-clamp-2">
            {recipe.name}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onBlock && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBlock(recipe);
                }}
                className="text-sm leading-none text-ink-subtle hover:text-status-critical-text transition-colors"
                aria-label="Don't suggest again"
                title="Don't suggest again"
              >
                🚫
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToList(recipe);
              }}
              className="text-sm leading-none text-ink-subtle hover:text-primary transition-colors"
              aria-label="Add to shopping list"
              title="Add to shopping list"
            >
              🛒
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(recipe.id);
              }}
              disabled={isFavoriteLoading}
              className="text-lg leading-none transition-opacity disabled:opacity-40"
              aria-label={
                recipe.isFavorite ? 'Remove from favorites' : 'Add to favorites'
              }
            >
              {recipe.isFavorite ? '★' : '☆'}
            </button>
          </div>
        </div>

        {/* Description */}
        {recipe.description && (
          <div>
            <p
              ref={descRef}
              className={`text-xs text-ink-subtle ${expanded ? '' : 'line-clamp-2'}`}
            >
              {recipe.description}
            </p>
            {(isTruncated || expanded) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="text-xs text-primary hover:underline mt-0.5"
              >
                {expanded ? 'Read less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {/* Tags */}
        {recipe.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="badge-tag">
                {tag}
              </span>
            ))}
            {recipe.tags.length > 3 && (
              <span className="text-xs text-ink-subtle">
                +{recipe.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Footer: time + source badge */}
        <div className="mt-auto flex items-center justify-between pt-1">
          {totalMins > 0 ? (
            <span className="text-xs text-ink-subtle">⏱ {totalMins} min</span>
          ) : (
            <span />
          )}
          <span className={badge.cls}>
            {badge.icon}
            {badge.label}
          </span>
        </div>
      </div>
    </div>
  );
}
