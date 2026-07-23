import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import DietaryProfileForm from '../components/settings/DietaryProfileForm.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';

export default function HouseholdPage() {
  const { user } = useAuth();
  // OnboardingPreview itself is mounted at AppLayout (not here) — the tour it
  // drives navigates across routes, which would unmount a page-rooted
  // instance mid-tour. setPreviewFlow lives there too; this page just
  // triggers it.
  const { setPreviewFlow } = useOutletContext();
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

  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [platformSettings, setPlatformSettings] = useState(null); // { publicAiAccessEnabled, aiRateLimitMax, updatedAt, updatedByClerkId } | null
  const [platformSettingsLoading, setPlatformSettingsLoading] = useState(false);
  const [platformSettingsSaving, setPlatformSettingsSaving] = useState(false);
  const [platformSettingsError, setPlatformSettingsError] = useState('');
  const [rateLimitInput, setRateLimitInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { household, viewerIsOwner } = await api.get('/api/household');
      setHousehold(household);
      setViewerIsOwner(viewerIsOwner);
    } catch (err) {
      setLoadError(err.message || 'Failed to load household');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!viewerIsOwner) return;
    setPlatformSettingsLoading(true);
    api
      .get('/api/admin/platform-settings')
      .then((s) => {
        setPlatformSettings(s);
        setRateLimitInput(String(s.aiRateLimitMax));
      })
      .catch((err) => setPlatformSettingsError(err.message))
      .finally(() => setPlatformSettingsLoading(false));
  }, [viewerIsOwner]);

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

  async function patchPlatformSettings(patch) {
    setPlatformSettingsSaving(true);
    setPlatformSettingsError('');
    try {
      const result = await api.patch('/api/admin/platform-settings', patch);
      setPlatformSettings(result);
      setRateLimitInput(String(result.aiRateLimitMax));
    } catch (err) {
      setPlatformSettingsError(err.message);
    } finally {
      setPlatformSettingsSaving(false);
    }
  }

  function toggleAiAccess() {
    patchPlatformSettings({
      publicAiAccessEnabled: !platformSettings.publicAiAccessEnabled,
    });
  }

  function saveRateLimit(e) {
    e.preventDefault();
    const value = Number(rateLimitInput);
    if (!Number.isInteger(value) || value < 1) return;
    patchPlatformSettings({ aiRateLimitMax: value });
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
      <PageHeader title={household?.name} />

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

      {/* Preview onboarding — side-effect-free replay of the Welcome/Tour/
          Checklist flow, for testing only. Never touches user_onboarding,
          never renames the household for real, never inserts real pantry
          items. Visible to any member, matching this app's fully-shared
          household model. */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">
          Preview onboarding
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Replay the first-run tour without affecting your real household,
          pantry, or onboarding status.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPreviewFlow('new_household')}
            className="flex-1 py-2 px-4 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors text-sm"
          >
            Preview: new household
          </button>
          <button
            onClick={() => setPreviewFlow('joined')}
            className="flex-1 py-2 px-4 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors text-sm"
          >
            Preview: joined household
          </button>
        </div>
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

      {/* Platform AI settings (owner only) */}
      {viewerIsOwner && (
        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">
            Platform AI settings (owner only)
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            When public AI access is enabled, every household without their own
            OpenAI key uses your platform key. Turn this off instantly if usage
            spikes — households without their own key will need to add one to
            keep using AI features.
          </p>
          {platformSettingsLoading && (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
          {platformSettings && (
            <div className="space-y-4">
              <button
                onClick={toggleAiAccess}
                disabled={platformSettingsSaving}
                className={`w-full py-2 px-4 font-medium rounded-lg transition-colors text-sm disabled:opacity-50 ${
                  platformSettings.publicAiAccessEnabled
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {platformSettingsSaving
                  ? 'Saving…'
                  : platformSettings.publicAiAccessEnabled
                    ? 'Disable public AI access (require BYOK)'
                    : 'Enable public AI access (use platform key for all)'}
              </button>

              <form
                onSubmit={saveRateLimit}
                className="flex items-center gap-2"
              >
                <label className="text-xs text-gray-600 flex-1">
                  AI requests per household / 15 min
                </label>
                <input
                  type="number"
                  min="1"
                  value={rateLimitInput}
                  onChange={(e) => setRateLimitInput(e.target.value)}
                  className="w-20 rounded-lg border-gray-300 shadow-sm text-sm"
                />
                <button
                  type="submit"
                  disabled={platformSettingsSaving}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                >
                  Save
                </button>
              </form>

              {platformSettings.updatedAt && (
                <p className="text-xs text-gray-400">
                  Last changed{' '}
                  {new Date(platformSettings.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
          {platformSettingsError && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {platformSettingsError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
