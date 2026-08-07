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
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Review Extracted Recipe
            </h2>
            <p className="text-xs text-primary mt-0.5">
              {sourceUrl
                ? `Imported from ${sourceUrl} — please review before saving`
                : 'AI extracted this — please review before saving'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-subtle hover:text-ink-muted text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              Recipe Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full"
              placeholder="Recipe name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="Brief description (optional)"
            />
          </div>

          {/* Time + Servings */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Servings
              </label>
              <input
                type="number"
                min="1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="input w-full"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Prep (mins)
              </label>
              <input
                type="number"
                min="0"
                value={prepMins}
                onChange={(e) => setPrepMins(e.target.value)}
                className="input w-full"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Cook (mins)
              </label>
              <input
                type="number"
                min="0"
                value={cookMins}
                onChange={(e) => setCookMins(e.target.value)}
                className="input w-full"
                placeholder="—"
              />
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-2">
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
                    className="input flex-1 px-2 py-1.5"
                  />
                  <input
                    type="text"
                    value={ing.quantity ?? ''}
                    onChange={(e) =>
                      updateIngredient(ing._key, 'quantity', e.target.value)
                    }
                    placeholder="Qty"
                    className="input w-16 px-2 py-1.5"
                  />
                  <input
                    type="text"
                    value={ing.unit ?? ''}
                    onChange={(e) =>
                      updateIngredient(ing._key, 'unit', e.target.value)
                    }
                    placeholder="Unit"
                    className="input w-20 px-2 py-1.5"
                  />
                  <button
                    onClick={() => removeIngredient(ing._key)}
                    className="text-ink-subtle hover:text-status-critical-text text-lg leading-none flex-shrink-0"
                    aria-label="Remove ingredient"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addIngredient}
              className="mt-2 text-xs text-primary hover:text-primary-hover font-medium"
            >
              + Add ingredient
            </button>
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-2">
              Steps
            </label>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={s._key}>
                  <div className="flex gap-2 items-start">
                    <span className="text-xs text-ink-subtle mt-2.5 w-5 flex-shrink-0">
                      {idx + 1}.
                    </span>
                    <textarea
                      value={s.text}
                      onChange={(e) => updateStep(s._key, e.target.value)}
                      rows={2}
                      placeholder={`Step ${idx + 1}`}
                      className="input flex-1 px-2 py-1.5 resize-none"
                    />
                    <button
                      onClick={() => removeStep(s._key)}
                      className="text-ink-subtle hover:text-status-critical-text text-lg leading-none mt-1.5 flex-shrink-0"
                      aria-label="Remove step"
                    >
                      ×
                    </button>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => insertStepAfter(idx)}
                        className="text-ink-subtle hover:text-primary text-xs leading-none px-2 py-1"
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
              className="mt-2 text-xs text-primary hover:text-primary-hover font-medium"
            >
              + Add step
            </button>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-2">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    tags.includes(tag)
                      ? 'bg-primary text-on-primary'
                      : 'bg-page text-ink-muted hover:bg-border'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-ink-subtle hover:text-ink-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Save Recipe'}
          </button>
        </div>
      </div>
    </div>
  );
}
