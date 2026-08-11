import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useAuth,
} from '@clerk/clerk-react';
import {
  cameFromOAuthCallback,
  isStandalonePwa,
  OAUTH_RELOAD_MARKER_KEY,
} from './lib/oauthReturn.js';
import { logEvent } from './lib/debugLog.js';
import { AuthProvider } from './context/AuthContext.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ErrorBoundary from './components/layout/ErrorBoundary.jsx';
import DebugPanel from './components/DebugPanel.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PantryPage from './pages/PantryPage.jsx';
import RecipesPage from './pages/RecipesPage.jsx';
import ShoppingPage from './pages/ShoppingPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import HouseholdPage from './pages/HouseholdPage.jsx';
import JoinPage from './pages/JoinPage.jsx';

function PrivateRoute({ children, publicHomeElement }) {
  const location = useLocation();
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        {publicHomeElement && location.pathname === '/'
          ? publicHomeElement
          : <RedirectToSignIn />}
      </SignedOut>
    </>
  );
}

function PublicRoute({ children }) {
  return (
    <>
      <SignedIn>
        <Navigate to="/" replace />
      </SignedIn>
      <SignedOut>{children}</SignedOut>
    </>
  );
}

// TASK-062: on the installed iOS standalone PWA, the first render after a Google OAuth
// redirect round-trip sometimes lands signed-out even though Clerk's session was actually
// created (see ai/tasks/TASK-062-spec.md). Detect that specific case and force exactly one
// reload so the webview re-evaluates current cookies/storage from scratch, rather than
// trusting a possibly-stale restored render. Never fires outside standalone PWA + `/`.
function OAuthReturnGuard() {
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;

    const marker = sessionStorage.getItem(OAUTH_RELOAD_MARKER_KEY);
    const standalone = isStandalonePwa();
    const fromCallback = cameFromOAuthCallback();

    const shouldReload =
      !marker &&
      location.pathname === '/' &&
      !isSignedIn &&
      standalone &&
      fromCallback;

    logEvent('oauth-return-guard', {
      pathname: location.pathname,
      isSignedIn,
      standalone,
      referrer: document.referrer,
      fromCallback,
      marker: !!marker,
      decision: shouldReload
        ? 'reload'
        : marker
          ? 'marker-cleared'
          : 'noop',
    });

    if (shouldReload) {
      sessionStorage.setItem(OAUTH_RELOAD_MARKER_KEY, '1');
      window.location.reload();
      return;
    }

    // isLoaded has conclusively resolved (signed in or genuinely signed out) without firing
    // a reload — end this OAuth return's lifecycle so a later, unrelated attempt isn't
    // silently blocked (spec Section 3.3, step 3).
    if (marker) {
      sessionStorage.removeItem(OAUTH_RELOAD_MARKER_KEY);
    }
  }, [isLoaded, isSignedIn, location.pathname]);

  return null;
}

// TASK-063: logs every Clerk isLoaded/isSignedIn transition Clerk itself reports, independent
// of the reload-guard's own decision above — distinguishes "Clerk flip-flopped" from
// "the guard's heuristic misfired" when reading the captured sequence back.
function AuthStateLogger() {
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    logEvent('clerk-auth-state', {
      pathname: location.pathname,
      isLoaded,
      isSignedIn,
    });
  }, [isLoaded, isSignedIn, location.pathname]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <OAuthReturnGuard />
          <AuthStateLogger />
          <DebugPanel />
          <Toaster position="top-right" />
          <Routes>
            <Route
              path="/sign-in/*"
              element={
                <PublicRoute>
                  <SignIn routing="path" path="/sign-in" />
                </PublicRoute>
              }
            />
            <Route
              path="/sign-up/*"
              element={
                <PublicRoute>
                  <SignUp routing="path" path="/sign-up" />
                </PublicRoute>
              }
            />
            <Route path="/join" element={<JoinPage />} />

            <Route
              element={
                <PrivateRoute publicHomeElement={<LandingPage />}>
                  <AppLayout />
                </PrivateRoute>
              }
            >
              <Route index element={<ChatPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/chat" element={<Navigate to="/" replace />} />
              <Route path="/pantry" element={<PantryPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/shopping" element={<ShoppingPage />} />
              <Route path="/household" element={<HouseholdPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
