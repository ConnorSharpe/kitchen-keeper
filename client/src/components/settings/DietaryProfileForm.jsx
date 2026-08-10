import { useState, useEffect } from 'react';
import { useDietaryProfile } from '../../hooks/useDietaryProfile.js';

function TagInput({ label, tags, onChange, isWarning }) {
  const [input, setInput] = useState('');
  const chipCls = isWarning ? 'chip-allergy' : 'badge-tag';

  function add(val) {
    const trimmed = val.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
  }

  function remove(idx) {
    onChange(tags.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(input);
    }
    if (e.key === 'Backspace' && !input && tags.length > 0)
      remove(tags.length - 1);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-ink-muted mb-1">
        {label}
        {isWarning && (
          <span className="ml-1 text-xs text-status-critical-text font-semibold">
            (safety-critical)
          </span>
        )}
      </label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-2 min-h-[42px] focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40">
        {tags.map((tag, i) => (
          <span key={i} className={chipCls}>
            {tag}
            <button
              type="button"
              onClick={() => remove(i)}
              className="hover:opacity-70 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) add(input);
          }}
          placeholder={tags.length === 0 ? 'Type and press Enter…' : ''}
          className="flex-1 outline-none min-w-24 text-sm bg-transparent text-ink placeholder:text-ink-subtle"
        />
      </div>
    </div>
  );
}

export default function DietaryProfileForm() {
  const { profile, loading, saving, save } = useDietaryProfile();
  const [conditions, setConditions] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [foodPreferences, setFoodPreferences] = useState([]);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (profile) {
      setConditions(profile.conditions ?? []);
      setAllergies(profile.allergies ?? []);
      setFoodPreferences(profile.foodPreferences ?? []);
    }
  }, [profile]);

  async function handleSubmit(e) {
    e.preventDefault();
    await save({ conditions, allergies, foodPreferences });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  if (loading) {
    return <p className="text-sm text-ink-subtle">Loading dietary profile…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TagInput
        label="Health conditions (e.g. gout, diabetes, hypertension)"
        tags={conditions}
        onChange={setConditions}
      />
      <TagInput
        label="Allergies"
        tags={allergies}
        onChange={setAllergies}
        isWarning
      />
      <TagInput
        label="Food preferences (e.g. vegetarian, low-carb, halal)"
        tags={foodPreferences}
        onChange={setFoodPreferences}
      />
      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? 'Saving…' : savedFlash ? 'Saved!' : 'Save dietary profile'}
      </button>
    </form>
  );
}
