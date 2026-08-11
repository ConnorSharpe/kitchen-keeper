import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from '@clerk/clerk-react';
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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
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
