import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import { SignIn, SignUp, RedirectToSignIn } from '@clerk/clerk-react';
import { resolveRouteDecision } from './lib/routeDecision.js';
import { useSettledAuth } from './hooks/useSettledAuth.js';
import { useAuthRecovery } from './hooks/useAuthRecovery.js';
import { AuthProvider } from './context/AuthContext.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ErrorBoundary from './components/layout/ErrorBoundary.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PantryPage from './pages/PantryPage.jsx';
import RecipesPage from './pages/RecipesPage.jsx';
import ShoppingPage from './pages/ShoppingPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import HouseholdPage from './pages/HouseholdPage.jsx';
import JoinPage from './pages/JoinPage.jsx';

// TASK-064: `recovering` is passed down from App()'s single useAuthRecovery() call site, not
// read here directly — see the Single-owner requirement in the spec's Section 3.4.
function PrivateRoute({ children, publicHomeElement, recovering }) {
  const location = useLocation();
  const { status, isSignedIn } = useSettledAuth();
  const decision = resolveRouteDecision(
    { status, isSignedIn, recovering },
    { hasPublicHome: !!publicHomeElement, pathname: location.pathname }
  );

  switch (decision) {
    case 'render-children':
      return children;
    case 'render-public-home':
      return publicHomeElement;
    case 'redirect-to-sign-in':
      return <RedirectToSignIn />;
    case 'render-nothing':
    default:
      return null;
  }
}

function PublicRoute({ children, recovering }) {
  const location = useLocation();
  const { status, isSignedIn } = useSettledAuth();
  const decision = resolveRouteDecision(
    { status, isSignedIn, recovering },
    { hasPublicHome: false, pathname: location.pathname }
  );

  if (decision === 'render-nothing') return null;
  if (decision === 'render-children') return <Navigate to="/" replace />;
  // 'redirect-to-sign-in' inverted: signed-out (with no public home to consider here) renders
  // the actual public auth form instead of redirecting.
  return children;
}

// TASK-064: single call site for useAuthRecovery() (spec Section 3.4's single-owner
// requirement). It has to live inside <AuthProvider>'s subtree — useSettledAuth(), which the
// hook consumes, is only provided there (AuthProvider renders SettledAuthProvider around its
// children), so the top-level App() function below can't call it directly before AuthProvider
// mounts. AppRoutes plays that structural role instead: exactly one call site, `recovering`
// flows down to PrivateRoute/PublicRoute as a prop, neither of which ever calls the hook itself.
function AppRoutes() {
  const { recovering, recoveryMessage } = useAuthRecovery();

  useEffect(() => {
    if (recoveryMessage) toast(recoveryMessage.text);
  }, [recoveryMessage]);

  return (
    <Routes>
      <Route
        path="/sign-in/*"
        element={
          <PublicRoute recovering={recovering}>
            <SignIn routing="path" path="/sign-in" />
          </PublicRoute>
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <PublicRoute recovering={recovering}>
            <SignUp routing="path" path="/sign-up" />
          </PublicRoute>
        }
      />
      <Route path="/join" element={<JoinPage />} />

      <Route
        element={
          <PrivateRoute publicHomeElement={<LandingPage />} recovering={recovering}>
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
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Toaster position="top-right" />
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
