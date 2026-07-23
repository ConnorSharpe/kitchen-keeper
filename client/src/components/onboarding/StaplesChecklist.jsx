import { useState } from 'react';

const STAPLES = [
  {
    category: 'Baking',
    items: [
      'Flour',
      'Sugar',
      'Salt',
      'Baking soda',
      'Baking powder',
      'Vanilla extract',
    ],
  },
  {
    category: 'Grains & Pasta',
    items: ['Rice', 'Pasta', 'Oats', 'Breadcrumbs'],
  },
  {
    category: 'Oils & Condiments',
    items: ['Olive oil', 'Vegetable oil', 'Soy sauce', 'Vinegar', 'Hot sauce'],
  },
  {
    category: 'Canned & Jarred',
    items: ['Canned tomatoes', 'Canned beans', 'Chicken broth', 'Tomato paste'],
  },
  {
    category: 'Spices',
    items: [
      'Black pepper',
      'Garlic powder',
      'Onion powder',
      'Paprika',
      'Cumin',
      'Oregano',
      'Cinnamon',
    ],
  },
];

const ALL_STAPLES = STAPLES.flatMap(({ category, items }) =>
  items.map((name) => ({ name, category }))
);

export default function StaplesChecklist({ onComplete, onDismiss, onAddItems }) {
  const [selected, setSelected] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  // 'idle' | 'error' — explicit state machine; session-scoped dismissal lives in PantryPage
  const [onboardingState, setOnboardingState] = useState('idle');
  const [errorMessage, setErrorMessage] = useState(null);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function handleAdd() {
    setSubmitting(true);
    setOnboardingState('idle');
    setErrorMessage(null);
    try {
      if (selected.size > 0) {
        const items = ALL_STAPLES.filter(({ name }) => selected.has(name));
        await onAddItems(items);
      }
      await onComplete(); // OnboardingGate.handleFinish — commits onboarding complete server-side
    } catch {
      setOnboardingState('error');
      setErrorMessage('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    setOnboardingState('idle');
    setErrorMessage(null);
    try {
      await onComplete(); // OnboardingGate.handleFinish — commits onboarding complete server-side
    } catch {
      setOnboardingState('error');
      setErrorMessage('Could not save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">
            Stock your pantry
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Select items you already have. You can add more anytime.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {STAPLES.map(({ category, items }) => (
            <div key={category}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {items.map((name) => {
                  const active = selected.has(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggle(name)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-green-400'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {onboardingState === 'error' && (
          <div className="px-6 py-2 border-t border-gray-100">
            <p className="text-sm text-red-600">{errorMessage}</p>
            {/* UI Dismissal Rule: calls onDismiss, NOT onComplete.
                No completeOnboarding(). No auth state update. No pantry refresh.
                PantryPage sets onboardingDismissed=true; modal closes for this session only. */}
            <button
              onClick={onDismiss}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600"
            >
              Dismiss for now
            </button>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Skip
          </button>
          <button
            onClick={handleAdd}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold
                       hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? 'Saving…'
              : selected.size > 0
                ? `Add ${selected.size} item${selected.size === 1 ? '' : 's'}`
                : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
