// @refresh reset
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { api } from '../api/index.js';

const AuthContext = createContext(null);
const ONBOARDING_RETRY_DELAY_MS = 2000;

export function AuthProvider({ children }) {
  const { user: clerkUser, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [onboarding, setOnboarding] = useState(null); // { complete, flow } | null while loading

  useEffect(() => {
    if (!isLoaded || !clerkUser) return;
    let cancelled = false;
    let retryTimer = null;

    function load(isRetry) {
      api
        .get('/api/onboarding')
        .then((status) => {
          if (!cancelled) setOnboarding(status);
        })
        .catch(() => {
          if (cancelled) return;
          // A single transient failure (network blip, cold start) shouldn't
          // permanently suppress onboarding for the whole session — retry
          // once before falling back. The fallback still fails open
          // (never lets an onboarding-status outage lock a user out of their
          // own pantry) — it just takes two consecutive failures to reach it
          // now, not one.
          if (!isRetry) {
            retryTimer = setTimeout(() => load(true), ONBOARDING_RETRY_DELAY_MS);
          } else {
            setOnboarding({ complete: true, flow: null });
          }
        });
    }

    load(false);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isLoaded, clerkUser]);

  const user = clerkUser
    ? {
        id: clerkUser.id,
        name:
          clerkUser.fullName ??
          clerkUser.firstName ??
          clerkUser.username ??
          'User',
        email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
      }
    : null;

  async function logout() {
    await signOut();
  }

  const completeOnboarding = useCallback(async () => {
    await api.patch('/api/onboarding', { complete: true });
    setOnboarding((prev) => ({ ...prev, complete: true }));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading: !isLoaded, onboarding, logout, completeOnboarding }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
