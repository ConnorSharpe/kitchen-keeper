import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

// RecipeUpload: drag-drop or click to select a recipe image.
// Calls POST /api/ai/parse-recipe-image — the server parses the image with AI
// and saves the recipe immediately, returning the new recipe object.
// Uses raw fetch (not api.*) because file uploads require multipart, not JSON.

export default function RecipeUpload({ onRecipeAdded, onClose }) {
  const [phase, setPhase] = useState('upload'); // 'upload' | 'parsing' | 'done' | 'error'
  const [savedRecipe, setSavedRecipe] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  async function uploadFile(file) {
    setPhase('parsing');

    const formData = new FormData();
    formData.append('recipe', file);

    try {
      const res = await fetch('/api/ai/parse-recipe-image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      setSavedRecipe(data.recipe);
      setPhase('done');
      onRecipeAdded(data.recipe);
      toast.success(`"${data.recipe.name}" saved to your recipes!`);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to parse recipe image');
      setPhase('error');
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleRetry() {
    setPhase('upload');
    setErrorMsg('');
    setSavedRecipe(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload a Recipe Image</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Photo of a recipe card, cookbook page, or hand-written recipe
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Phase: upload */}
        {phase === 'upload' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-orange-400 bg-orange-50'
                : 'border-gray-300 hover:border-orange-300 hover:bg-gray-50'
            }`}
          >
            <p className="text-5xl mb-4">📸</p>
            <p className="text-sm font-medium text-gray-700">
              Drop a recipe image here, or click to upload
            </p>
            <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP or HEIC — max 10 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Phase: parsing */}
        {phase === 'parsing' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-5" />
            <p className="text-sm font-medium text-gray-700">Reading recipe with AI…</p>
            <p className="text-xs text-gray-400 mt-1">This takes about 10 seconds</p>
          </div>
        )}

        {/* Phase: done */}
        {phase === 'done' && savedRecipe && (
          <div className="text-center py-8">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-sm font-semibold text-gray-900">{savedRecipe.name}</p>
            <p className="text-xs text-gray-500 mt-1">Recipe saved to your library</p>
            <button
              onClick={onClose}
              className="mt-5 px-5 py-2 bg-orange-500 text-white text-sm rounded-md hover:bg-orange-600 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* Phase: error */}
        {phase === 'error' && (
          <div className="text-center py-8">
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-sm text-red-600 font-medium">{errorMsg}</p>
            <p className="text-xs text-gray-400 mt-1">
              Try a clearer photo with better lighting
            </p>
            <div className="flex gap-3 justify-center mt-5">
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-orange-500 text-white text-sm rounded-md hover:bg-orange-600 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
