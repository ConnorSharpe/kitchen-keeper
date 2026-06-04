import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/layout/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ErrorBoundary from './components/layout/ErrorBoundary.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import PantryPage from './pages/PantryPage.jsx';
import RecipesPage from './pages/RecipesPage.jsx';
import ShoppingPage from './pages/ShoppingPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import HouseholdPage from './pages/HouseholdPage.jsx';

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* All authenticated routes live under ProtectedRoute → AppLayout */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/pantry" element={<PantryPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/shopping" element={<ShoppingPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/household" element={<HouseholdPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
