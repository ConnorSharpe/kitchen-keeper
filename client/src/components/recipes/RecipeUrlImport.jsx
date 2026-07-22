import { useState, useRef, useEffect } from 'react';

export default function RecipeUrlImport({
  onExtracted,
  onNeedsManualEntry,
  onClose,
}) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState('idle'); // 'idle' | 'fetching' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setPhase('fetching');
    setErrorMsg('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/parse-recipe-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: AbortSignal.any
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
          : controller.signal,
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (res.status === 422) {
        onNeedsManualEntry(data.titleGuess ?? '', trimmed);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }

      onExtracted(data.recipe, trimmed);
    } catch (err) {
      if (err.name === 'AbortError') return; // user closed modal
      setErrorMsg(err.message || 'Failed to import recipe from that URL');
      setPhase('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          abortRef.current?.abort();
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Import Recipe from URL
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste a link to a recipe page
            </p>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase !== 'fetching' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/recipe"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoFocus
            />
            {phase === 'error' && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  onClose();
                }}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-orange-500 text-white text-sm rounded-md hover:bg-orange-600 transition-colors"
              >
                Import
              </button>
            </div>
          </form>
        )}

        {phase === 'fetching' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-5" />
            <p className="text-sm font-medium text-gray-700">
              Reading recipe from page…
            </p>
            <p className="text-xs text-gray-400 mt-1">
              This takes a few seconds
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
