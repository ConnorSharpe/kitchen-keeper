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
    <div className={`card p-4 flex flex-col gap-2 ${className}`}>

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink leading-snug">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
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
              className="text-sm leading-none text-ink-subtle hover:text-status-critical-text transition-colors"
              aria-label="Don't suggest again"
              title="Don't suggest again"
            >
              🚫
            </button>
          )}
          {badge && (
            <span className={`flex-shrink-0 ${badge.className}`}>
              {badge.label}
            </span>
          )}
        </div>
      </div>

      {description && (
        <p className="text-sm text-ink-muted">{description}</p>
      )}

      {usesExpiring?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {usesExpiring.map((ing) => (
            <span key={ing} className="badge-tag">
              {ing}
            </span>
          ))}
        </div>
      )}

      {tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {children}

      <div className="flex items-center justify-between mt-auto pt-1">
        {footerNote ? (
          <span className="text-xs text-ink-subtle">{footerNote}</span>
        ) : (
          <span />
        )}
        {onSave && (
          <button
            onClick={() => onSave(item)}
            disabled={isSaving || isSaved}
            className="ml-auto btn-primary text-xs px-3 py-1.5"
          >
            {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save Recipe'}
          </button>
        )}
      </div>
    </div>
  );
}
