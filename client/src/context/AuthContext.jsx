import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on page load — if the cookie is still valid, /me returns the user.
  useEffect(() => {
    api.get('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await api.post('/api/auth/login', { email, password });
    setUser(data.user);
  }

  async function register(email, password, name) {
    const data = await api.post('/api/auth/register', { email, password, name });
    setUser(data.user);
  }

  async function logout() {
    await api.post('/api/auth/logout');
    setUser(null);
    // ProtectedRoute detects user === null and redirects to /login automatically
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
