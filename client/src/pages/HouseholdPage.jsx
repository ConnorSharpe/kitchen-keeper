import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import DietaryProfileForm from '../components/settings/DietaryProfileForm.jsx';

export default function HouseholdPage() {
  const { user } = useAuth();
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [copied, setCopied] = useState(false);

  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null); // 'sent' | 'error'
  const [inviteError, setInviteError] = useState('');

  const [aiKey, setAiKey] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState(null); // 'saved' | 'removed' | 'error'
  const [aiError, setAiError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const h = await api.get('/api/household');
      setHousehold(h.household);
    } catch (err) {
      setLoadError(err.message || 'Failed to load household');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const { members } = await api.get('/api/household/members');
      setMembers(members);
    } catch (err) {
      setMembersError(err.message || 'Failed to load household members');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function copyCode() {
    await navigator.clipboard.writeText(household.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveAiKey(e) {
    e.preventDefault();
    setAiSaving(true);
    setAiStatus(null);
    setAiError('');
    try {
      const result = await api.patch('/api/household/ai-key', { key: aiKey });
      setHousehold((prev) => ({ ...prev, maskedKey: result.maskedKey }));
      setAiKey('');
      setAiStatus('saved');
    } catch (err) {
      setAiStatus('error');
      setAiError(err.message);
    } finally {
      setAiSaving(false);
    }
  }

  async function handleRemoveAiKey() {
    setAiSaving(true);
    setAiStatus(null);
    setAiError('');
    try {
      await api.patch('/api/household/ai-key', { key: null });
      setHousehold((prev) => ({ ...prev, maskedKey: null }));
      setAiKey('');
      setAiStatus('removed');
    } catch (err) {
      setAiStatus('error');
      setAiError(err.message);
    } finally {
      setAiSaving(false);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    setInviting(true);
    setInviteStatus(null);
    setInviteError('');
    try {
      await api.post('/api/household/invite', { email: inviteEmail });
      setInviteStatus('sent');
      setInviteEmail('');
    } catch (err) {
      setInviteStatus('error');
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-red-600">{loadError}</p>
        <button
          onClick={load}
          className="text-sm text-orange-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{household?.name}</h1>

      {/* Join code card */}
      <section className="bg-orange-50 border border-orange-200 rounded-2xl p-6">
        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">
          Household join code
        </p>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-mono font-bold tracking-widest text-orange-600">
            {household?.joinCode}
          </span>
          <button
            onClick={copyCode}
            className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-orange-300 text-orange-700 hover:bg-orange-100 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-xs text-orange-600">
          Anyone who registers with this code will share your pantry, recipes,
          and shopping lists.
        </p>
      </section>

      {/* Members */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Household members
        </h2>
        {membersLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {membersError && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-600">{membersError}</p>
            <button
              onClick={loadMembers}
              className="text-sm text-orange-600 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        {!membersLoading && !membersError && (
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.clerkUserId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-gray-800">
                  {m.displayName}
                  {m.clerkUserId === user?.id && ' (You)'}
                </span>
                <span className="text-xs text-gray-400">
                  {m.role === 'owner' ? 'Owner' : 'Member'} · joined{' '}
                  {new Date(m.joinedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invite by email */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Invite someone by email
        </h2>
        <form onSubmit={handleInvite} className="space-y-3">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="partner@example.com"
            className="w-full rounded-lg border-gray-300 shadow-sm focus:border-orange-400 focus:ring-orange-400 text-sm"
          />
          <button
            type="submit"
            disabled={inviting}
            className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {inviting ? 'Sending…' : 'Send invite email'}
          </button>
        </form>

        {inviteStatus === 'sent' && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Invite sent! They&apos;ll receive the join code by email.
          </p>
        )}
        {inviteStatus === 'error' && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {inviteError}
          </p>
        )}
      </section>

      {/* Dietary profile */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Dietary profile
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Shared across all household members. Used by the AI assistant to
          personalise meal suggestions.
        </p>
        <DietaryProfileForm />
      </section>

      {/* OpenAI API key */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">
          OpenAI API key
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Required to use AI features. Your key is encrypted at rest and never
          logged. Get one at{' '}
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="text-orange-600 hover:underline"
          >
            platform.openai.com
          </a>
          .
        </p>

        {household?.maskedKey && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-4 font-mono">
            Current key:{' '}
            <span className="font-semibold">{household.maskedKey}</span>
          </p>
        )}

        <form onSubmit={handleSaveAiKey} className="space-y-3">
          <input
            type="password"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder={
              household?.maskedKey
                ? `Current: ${household.maskedKey} — paste to replace`
                : 'sk-...'
            }
            className="w-full rounded-lg border-gray-300 shadow-sm focus:border-orange-400 focus:ring-orange-400 text-sm font-mono"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={aiSaving || !aiKey}
              className="flex-1 py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
            >
              {aiSaving ? 'Saving…' : 'Save key'}
            </button>
            {household?.maskedKey && (
              <button
                type="button"
                onClick={handleRemoveAiKey}
                disabled={aiSaving}
                className="flex-1 py-2 px-4 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg transition-colors text-sm"
              >
                Remove key
              </button>
            )}
          </div>
        </form>

        {aiStatus === 'saved' && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Key saved. AI features are now active.
          </p>
        )}
        {aiStatus === 'removed' && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Key removed.
          </p>
        )}
        {aiStatus === 'error' && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {aiError}
          </p>
        )}
      </section>
    </div>
  );
}
