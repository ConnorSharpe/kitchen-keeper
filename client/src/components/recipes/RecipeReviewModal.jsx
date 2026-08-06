import { useState } from 'react';
import { RECIPE_TAGS as TAGS } from '@shared/recipeTags.js';

export default function RecipeReviewModal({
  recipe,
  source = 'upload',
  sourceUrl = null,
  onSave,
  onClose,
}) {
  const [name, setName] = useState(recipe.name ?? '');
  const [description, setDescription] = useState(recipe.description ?? '');
  const [ingredients, setIngredients] = useState(
    (recipe.ingredients ?? []).map((ing, i) => ({ ...ing, _key: i }))
  );
  const [steps, setSteps] = useState(
    (recipe.steps ?? []).map((s, i) => ({ text: s, _key: i }))
  );
  const [servings, setServings] = useState(recipe.servings ?? '');
  const [prepMins, setPrepMins] = useState(recipe.prepMins ?? '');
  const [cookMins, setCookMins] = useState(recipe.cookMins ?? '');
  const [tags, setTags] = useState(recipe.tags ?? []);
  const [saving, setSaving] = useState(false);

  // --- Ingredient helpers ---
  function updateIngredient(key, field, value) {
    setIngredients((prev) =>
      prev.map((ing) => (ing._key === key ? { ...ing, [field]: value } : ing))
    );
  }
  function addIngredient() {
    setIngredients((prev) => [
      ...prev,
      { name: '', quantity: '', unit: '', _key: Date.now() },
    ]);
  }
  function removeIngredient(key) {
    setIngredients((prev) => prev.filter((ing) => ing._key !== key));
  }

  // --- Step helpers ---
  function updateStep(key, value) {
    setSteps((prev) =>
      prev.map((s) => (s._key === key ? { ...s, text: value } : s))
    );
  }
  function addStep() {
    setSteps((prev) => [...prev, { text: '', _key: Date.now() }]);
  }
  function insertStepAfter(index) {
    setSteps((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { text: '', _key: crypto.randomUUID() });
      return next;
    });
  }
  function removeStep(key) {
    setSteps((prev) => prev.filter((s) => s._key !== key));
  }

  // --- Tag helpers ---
  function toggleTag(tag) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function handleSave() {
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map(({ name: n, quantity, unit }) => ({
          name: n.trim(),
          quantity:
            quantity === '' || quantity == null ? null : Number(quantity),
          unit: unit?.trim() || null,
        })),
      steps: steps.map((s) => s.text.trim()).filter(Boolean),
      servings: servings === '' ? null : Number(servings),
      prepMins: prepMins === '' ? null : Number(prepMins),
      cookMins: cookMins === '' ? null : Number(cookMins),
      tags,
      source,
      sourceUrl,
    };
    onSave(payload);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Review Extracted Recipe
            </h2>
            <p className="text-xs text-orange-600 mt-0.5">
              {sourceUrl
                ? `Imported from ${sourceUrl} — please review before saving`
                : 'AI extracted this — please review before saving'}
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

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recipe Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Recipe name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              placeholder="Brief description (optional)"
            />
          </div>

          {/* Time + Servings */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Servings
              </label>
              <input
                type="number"
                min="1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Prep (mins)
              </label>
              <input
                type="number"
                min="0"
                value={prepMins}
                onChange={(e) => setPrepMins(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Cook (mins)
              </label>
              <input
                type="number"
                min="0"
                value={cookMins}
                onChange={(e) => setCookMins(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="—"
              />
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Ingredients
            </label>
            <div className="space-y-2">
              {ingredients.map((ing) => (
                <div key={ing._key} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) =>
                      updateIngredient(ing._key, 'name', e.target.value)
                    }
                    placeholder="Ingredient"
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <input
                    type="text"
                    value={ing.quantity ?? ''}
                    onChange={(e) =>
                      updateIngredient(ing._key, 'quantity', e.target.value)
                    }
                    placeholder="Qty"
                    className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <input
                    type="text"
                    value={ing.unit ?? ''}
                    onChange={(e) =>
                      updateIngredient(ing._key, 'unit', e.target.value)
                    }
                    placeholder="Unit"
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <button
                    onClick={() => removeIngredient(ing._key)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none flex-shrink-0"
                    aria-label="Remove ingredient"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addIngredient}
              className="mt-2 text-xs text-orange-600 hover:text-orange-700 font-medium"
            >
              + Add ingredient
            </button>
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Steps
            </label>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={s._key}>
                  <div className="flex gap-2 items-start">
                    <span className="text-xs text-gray-400 mt-2.5 w-5 flex-shrink-0">
                      {idx + 1}.
                    </span>
                    <textarea
                      value={s.text}
                      onChange={(e) => updateStep(s._key, e.target.value)}
                      rows={2}
                      placeholder={`Step ${idx + 1}`}
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                    />
                    <button
                      onClick={() => removeStep(s._key)}
                      className="text-gray-400 hover:text-red-500 text-lg leading-none mt-1.5 flex-shrink-0"
                      aria-label="Remove step"
                    >
                      ×
                    </button>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => insertStepAfter(idx)}
                        className="text-gray-300 hover:text-orange-500 text-xs leading-none px-2 py-1"
                        aria-label={`Insert step after step ${idx + 1}`}
                        title="Insert step here"
                      >
                        + insert step
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addStep}
              className="mt-2 text-xs text-orange-600 hover:text-orange-700 font-medium"
            >
              + Add step
            </button>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    tags.includes(tag)
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-5 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Recipe'}
          </button>
        </div>
      </div>
    </div>
  );
}
