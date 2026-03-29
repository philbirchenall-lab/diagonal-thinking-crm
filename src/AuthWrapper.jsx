/**
 * AuthWrapper.jsx
 *
 * Wraps the app in Supabase authentication. Only active when VITE_SUPABASE_URL
 * is set (i.e. the hosted Vercel version). The local fallback bypasses auth.
 */

import { useState, useEffect } from "react";
import { getSupabaseClient, isSupabaseMode } from "./db.js";

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    const sb = getSupabaseClient();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) setError(error.message);
    else setResetSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist px-4">
      <div className="w-full max-w-sm border border-line bg-white p-8 shadow-panel">
        {/* Logo / wordmark */}
        <div className="mb-8 text-center">
          <span className="font-editorial text-2xl font-semibold text-ink">
            D//T CRM
          </span>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>

        {resetSent ? (
          <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
            Password reset email sent. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="w-full text-center text-xs text-slate-400 hover:text-ink transition"
            >
              Forgot password?
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AuthWrapper({ children }) {
  // If not using Supabase, render children directly (local fallback mode)
  if (!isSupabaseMode()) return children;

  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    const sb = getSupabaseClient();

    // Get current session
    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Still checking session
  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist">
        <div className="text-sm text-slate-400">Loading...</div>
      </div>
    );
  }

  // Not signed in
  if (!session) {
    return <LoginScreen onLogin={() => {}} />;
  }

  // Signed in — render the app with a sign-out function injected via context
  return children;
}

// Hook to sign out from anywhere in the app
export async function signOut() {
  const sb = getSupabaseClient();
  if (sb) await sb.auth.signOut();
}
