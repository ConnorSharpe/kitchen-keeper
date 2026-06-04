import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/index.js';

export default function HouseholdPage() {
  const [household, setHousehold] = useState(null);
  const [members, setMembers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [copied, setCopied]       = useState(false);

  const [inviteEmail, setInviteEmail]       = useState('');
  const [inviting, setInviting]             = useState(false);
  const [inviteStatus, setInviteStatus]     = useState(null); // 'sent' | 'error'
  const [inviteError, setInviteError]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [h, m] = await Promise.all([
        api.get('/api/household'),
        api.get('/api/household/members'),
      ]);
      setHousehold(h.household);
      setMembers(m.members);
    } catch (err) {
      setLoadError(err.message || 'Failed to load household');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function copyCode() {
    await navigator.clipboard.writeText(household.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-red-600">{loadError}</p>
        <button onClick={load} className="text-sm text-orange-600 hover:underline">Retry</button>
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
          Anyone who registers with this code will share your pantry, recipes, and shopping lists.
        </p>
      </section>

      {/* Invite by email */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Invite someone by email</h2>
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
            Invite sent! They'll receive the join code by email.
          </p>
        )}
        {inviteStatus === 'error' && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {inviteError}
          </p>
        )}
      </section>

      {/* Members list */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Household members <span className="text-gray-400 font-normal text-sm">({members.length})</span>
        </h2>
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-semibold text-sm flex-shrink-0">
                {m.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                <p className="text-xs text-gray-400 truncate">{m.email}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
