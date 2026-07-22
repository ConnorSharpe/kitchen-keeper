const SOURCE_BADGE = {
  upload: { label: 'Uploaded', cls: 'bg-blue-100 text-blue-700' },
  ai_suggested: { label: 'AI Suggested', cls: 'bg-purple-100 text-purple-700' },
  web_suggested: { label: 'From Web', cls: 'bg-orange-100 text-orange-700' },
  manual: { label: 'Manual', cls: 'bg-gray-100 text-gray-600' },
  url_import: { label: 'Imported from URL', cls: 'bg-teal-100 text-teal-700' },
};

export default function RecipeCard({
  recipe,
  onOpen,
  onToggleFavorite,
  isFavoriteLoading,
  onBlock,
}) {
  const badge = SOURCE_BADGE[recipe.source] ?? SOURCE_BADGE.manual;
  const totalMins = (recipe.prepMins ?? 0) + (recipe.cookMins ?? 0);

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow"
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
        <div className="h-36 bg-gradient-to-br from-orange-50 to-amber-100 flex items-center justify-center">
          <span className="text-4xl" aria-hidden>
            🍽️
          </span>
        </div>
      )}

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Name + favorite */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
            {recipe.name}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onBlock && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBlock(recipe);
                }}
                className="text-sm leading-none text-gray-300 hover:text-red-500 transition-colors"
                aria-label="Don't suggest again"
                title="Don't suggest again"
              >
                🚫
              </button>
            )}
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
          <p className="text-xs text-gray-500 line-clamp-2">
            {recipe.description}
          </p>
        )}

        {/* Tags */}
        {recipe.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5"
              >
                {tag}
              </span>
            ))}
            {recipe.tags.length > 3 && (
              <span className="text-xs text-gray-400">
                +{recipe.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Footer: time + source badge */}
        <div className="mt-auto flex items-center justify-between pt-1">
          {totalMins > 0 ? (
            <span className="text-xs text-gray-400">⏱ {totalMins} min</span>
          ) : (
            <span />
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
      </div>
    </div>
  );
}
