export default function RecipeSelectList({
  recipes,
  loading,
  selectedIds,
  onToggle,
}) {
  if (loading) {
    return <p className="text-sm text-gray-400">Loading recipes…</p>;
  }

  if (recipes.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No saved recipes yet. Save some recipes first.
      </p>
    );
  }

  return (
    <ul className="space-y-1 max-h-60 overflow-y-auto">
      {recipes.map((r) => (
        <li key={r.id}>
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg p-2 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selectedIds.has(r.id)}
              onChange={() => onToggle(r.id)}
              className="mt-0.5 accent-orange-600"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">
                {r.name}
              </p>
              {r.tags?.length > 0 && (
                <p className="text-xs text-gray-400 truncate">
                  {r.tags.join(', ')}
                </p>
              )}
            </div>
          </label>
        </li>
      ))}
    </ul>
  );
}
