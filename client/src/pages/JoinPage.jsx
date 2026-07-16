import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SignIn, useAuth } from '@clerk/clerk-react';
import { api } from '../api/index.js';

export default function JoinPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  // Once authenticated and code is present, attempt join automatically
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !code) return;

    async function attemptJoin() {
      setJoining(true);
      setError('');
      try {
        await api.post('/api/household/join', { code });
        navigate('/', { replace: true });
      } catch (err) {
        const msg = err.message || 'Something went wrong. Please try again.';
        setError(msg);
        setJoining(false);
      }
    }

    attemptJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Join a household
          </h1>
          <p className="text-sm text-gray-500">
            Sign in or create an account to accept your invitation.
          </p>
        </div>
        <SignIn
          routing="hash"
          afterSignInUrl={`/join?code=${code}`}
          afterSignUpUrl={`/join?code=${code}`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Join a household</h1>

        {joining && <p className="text-sm text-gray-500">Joining household…</p>}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {!joining && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setJoining(true);
              setError('');
              api
                .post('/api/household/join', { code })
                .then(() => navigate('/', { replace: true }))
                .catch((err) => {
                  setError(
                    err.message || 'Something went wrong. Please try again.'
                  );
                  setJoining(false);
                });
            }}
            className="space-y-3"
          >
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter join code"
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-orange-400 focus:ring-orange-400 text-center text-xl font-mono font-bold tracking-widest text-orange-600"
              maxLength={8}
              required
            />
            <button
              type="submit"
              disabled={!code}
              className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              Join household
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
