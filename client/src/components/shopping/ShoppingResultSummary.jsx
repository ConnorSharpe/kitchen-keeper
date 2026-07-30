// TASK-050 Design 5: extracted from BuildListModal/AddRecipesModal/AddToListModal's
// near-identical result views. Callers compose their own bodyText (JSX, not just a string —
// e.g. bolded item counts) since the exact wording differs per caller.
export default function ShoppingResultSummary({ bodyText, warnings, onDone }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-gray-700">{bodyText}</p>

      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            Unit mismatch — review these items
          </p>
          <ul className="text-sm text-amber-800 space-y-0.5">
            {warnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5">
                <span aria-hidden>⚠️</span> {w}
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-600 mt-1">
            The same ingredient appeared in multiple recipes with
            different units. Quantities could not be combined — check the
            list and adjust manually.
          </p>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
      >
        Done
      </button>
    </div>
  );
}
