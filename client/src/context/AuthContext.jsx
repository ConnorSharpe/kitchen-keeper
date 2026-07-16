// @refresh reset
import { createContext, useContext } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { user: clerkUser, isLoaded } = useUser();
  const { signOut } = useClerk();

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

  // Stubs — Clerk handles login/register via its own components
  async function login() {}
  async function register() {}
  async function completeOnboarding() {}

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: !isLoaded,
        login,
        register,
        logout,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
