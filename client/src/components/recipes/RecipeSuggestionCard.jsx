// TASK-056 Design A: one shared presentation for "here's a recipe, save it?" across Dashboard's
// pantry-based suggestions, Recipes' web suggestions, and Chat's inline suggestions. The three source
// data shapes differ (pantry have/missing breakdown vs. web tags/source link vs. dashboard's simpler
// name/description/difficulty), so sections are shown based on data presence, not `show*` boolean
// flags — keeps this under the ~4-5-prop smell test the spec's Design A calls out as the stop
// condition. `children` carries Chat's richer ingredients/prep-steps/notes block, which doesn't unify
// with the other two callers' data shapes.
export default function RecipeSuggestionCard({
  item,
  name,
  sourceUrl,
  description,
  badge,
  tags,
  usesExpiring,
  footerNote,
  onSave,
  isSaving,
  isSaved,
  onBlock,
  children,
  className = '',
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-2 ${className}`}
    >

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {name} <span aria-hidden>↗</span>
            </a>
          ) : (
            name
          )}
        </h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onBlock && (
            <button
              onClick={() => onBlock(item)}
              className="text-sm leading-none text-gray-300 hover:text-red-500 transition-colors"
              aria-label="Don't suggest again"
              title="Don't suggest again"
            >
              🚫
            </button>
          )}
          {badge && (
            <span
              className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>

      {description && (
        <p className="text-sm text-gray-600">{description}</p>
      )}

      {usesExpiring?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {usesExpiring.map((ing) => (
            <span
              key={ing}
              className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5"
            >
              {ing}
            </span>
          ))}
        </div>
      )}

      {tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {children}

      <div className="flex items-center justify-between mt-auto pt-1">
        {footerNote ? (
          <span className="text-xs text-gray-400">{footerNote}</span>
        ) : (
          <span />
        )}
        {onSave && (
          <button
            onClick={() => onSave(item)}
            disabled={isSaving || isSaved}
            className="ml-auto text-xs px-3 py-1.5 rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save Recipe'}
          </button>
        )}
      </div>
    </div>
  );
}
