import { useState, useRef } from 'react';
import { api } from '../../api/index.js';

export default function WelcomeStep({ flow, onContinue, onDismiss }) {
  const joined = flow === 'joined';
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Guards double-clicking Continue. A plain `submitting` check isn't enough
  // on its own: the blank-name/joined-flow branch below returns before
  // `setSubmitting(true)` is ever reached, so `disabled={submitting}` was
  // never actually engaged on that path. A ref updates synchronously (no
  // render needed), so it guards both branches uniformly.
  const startedRef = useRef(false);

  async function handleContinue() {
    if (startedRef.current) return;
    startedRef.current = true;

    const trimmed = name.trim();
    if (joined || !trimmed) {
      onContinue(); // joined flow, or the name field was left blank — keep the default household name
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.patch('/api/household', { name: trimmed });
      onContinue();
    } catch (err) {
      // Matches StaplesChecklist's own save-failure pattern: show the error
      // inline and do NOT advance automatically — the user can retry, edit
      // the name, or clear the field and press Continue again to skip naming
      // and proceed with the default.
      startedRef.current = false; // recoverable — allow the user to retry
      setError(err.message || 'Could not save that name — you can rename it later in Household settings.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center space-y-4">
        <span className="text-4xl">{joined ? '🎉' : '🍳'}</span>
        <h2 className="text-xl font-semibold text-gray-900">
          {joined ? "You're in!" : 'Welcome to Kitchen Keeper'}
        </h2>
        <p className="text-sm text-gray-500">
          {joined
            ? "You've joined a household — its pantry, recipes, and shopping list are now shared with you."
            : 'Track your pantry, save recipes, and get AI meal suggestions from what you already have.'}
        </p>

        {!joined && (
          <div className="text-left">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Name your household (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Household"
              maxLength={100}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-sm"
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <button onClick={onDismiss} className="text-sm text-gray-400 hover:text-gray-600">
            Skip
          </button>
          <button
            onClick={handleContinue}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : joined ? "Let's go" : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}
