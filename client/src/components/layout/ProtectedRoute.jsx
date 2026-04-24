import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

// Renders null while the initial auth check is in flight to avoid a flash
// of the /login redirect for users who are actually logged in.
export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
