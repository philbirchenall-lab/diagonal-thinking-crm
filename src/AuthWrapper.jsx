/**
 * AuthWrapper.jsx
 *
 * Wraps the app in Supabase authentication. Only active when VITE_SUPABASE_URL
 * is set (i.e. the hosted Vercel version). The local fallback bypasses auth.
 *
 * Login screen rebuilt Phase 1 brand audit (Rex, 18 Apr 2026) to the AI-Intel
 * dark-first pattern per Tes scope §2.3 + Pix §10.3. Tokens sourced from
 * packages/brand (@dt/brand-tokens) — single source of truth.
 */

import { useState, useEffect } from "react";
import { getSupabaseClient, isSupabaseMode } from "./db.js";
import { CTA_COPY, LOGO_ALT } from "../packages/brand/src/index.js";

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
      const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
      if (signInError) setError(CTA_COPY.loginFailedGeneric);
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
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--brand-navy)",
        color: "var(--paper)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--dt-space-section) 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "440px" }}>
        {/* Centred DT white-out logo (Pix PIX-LOGO-WHITE-001).
            Responsive swap at Format Standards §5.5 200px threshold. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "var(--dt-space-hero)",
          }}
        >
          <picture>
            <source
              media="(max-width: 479px)"
              srcSet="/brand/logo-icon-white.png"
            />
            <img
              src="/brand/logo-full-white.png"
              alt={LOGO_ALT}
              style={{ height: "54px", width: "auto", display: "block" }}
            />
          </picture>
        </div>

        <h1
          style={{
            fontFamily: "var(--dt-display-stack)",
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            fontSize: "var(--dt-h1-hero-desktop)",
            lineHeight: 1.05,
            textAlign: "center",
            marginBottom: "10px",
            color: "var(--paper)",
          }}
        >
          CRM
        </h1>
        <p
          style={{
            textAlign: "center",
            fontSize: "var(--dt-body)",
            color: "rgba(255,255,255,0.8)",
            marginBottom: "var(--dt-space-section)",
          }}
        >
          {CTA_COPY.signInSubline}
        </p>

        {/* White card with 3px DT Navy top border (Pix §10.3 identity beat). */}
        <div
          style={{
            background: "var(--paper)",
            color: "var(--ink)",
            borderRadius: "var(--dt-radius-lg)",
            borderTop: "var(--dt-border-accent) solid var(--brand-navy)",
            padding: "var(--dt-space-generous) 24px",
            boxShadow: "var(--dt-shadow-lifted)",
          }}
        >
          {resetSent ? (
            <div
              style={{
                borderRadius: "var(--dt-radius-md)",
                background: "#F0FFF4",
                color: "#276749",
                fontSize: "var(--dt-small)",
                padding: "12px 14px",
              }}
            >
              Password reset email sent. Check your inbox.
            </div>
          ) : (
            <form onSubmit={handleLogin} noValidate>
              <label
                htmlFor="login-email"
                style={{
                  display: "block",
                  fontSize: "var(--dt-small)",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@diagonalthinking.co"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--dt-radius-md)",
                  fontSize: "var(--dt-body)",
                  color: "var(--ink)",
                  background: "var(--paper)",
                  outline: "none",
                  marginBottom: "var(--dt-space-comfortable)",
                  minHeight: "var(--dt-touch-min)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--brand-navy)";
                  e.currentTarget.style.boxShadow = "var(--dt-focus-ring-soft)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />

              <label
                htmlFor="login-password"
                style={{
                  display: "block",
                  fontSize: "var(--dt-small)",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--dt-radius-md)",
                  fontSize: "var(--dt-body)",
                  color: "var(--ink)",
                  background: "var(--paper)",
                  outline: "none",
                  marginBottom: "8px",
                  minHeight: "var(--dt-touch-min)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--brand-navy)";
                  e.currentTarget.style.boxShadow = "var(--dt-focus-ring-soft)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />

              {/* Left-aligned forgot-password link (Pix §10.3 P1). */}
              <div style={{ marginBottom: "var(--dt-space-comfortable)" }}>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--muted)",
                    fontSize: "var(--dt-small)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.color = "var(--ink)")}
                  onMouseOut={(e) => (e.currentTarget.style.color = "var(--muted)")}
                >
                  {CTA_COPY.forgotPassword}
                </button>
              </div>

              {error && (
                <div
                  role="alert"
                  style={{
                    background: "#FFF5F5",
                    border: "1px solid #FED7D7",
                    borderLeft: "var(--dt-border-accent) solid var(--high)",
                    borderRadius: "var(--dt-radius-md)",
                    color: "#9B2C2C",
                    fontSize: "var(--dt-small)",
                    padding: "10px 12px",
                    marginBottom: "var(--dt-space-comfortable)",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "14px",
                  background: loading ? "var(--stone)" : "var(--brand-navy)",
                  color: "var(--paper)",
                  border: "none",
                  borderRadius: "var(--dt-radius-md)",
                  fontSize: "var(--dt-body)",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background var(--dt-transition-fast)",
                  minHeight: "var(--dt-touch-min)",
                }}
                onMouseOver={(e) => {
                  if (!loading) e.currentTarget.style.background = "var(--brand-navy-hover)";
                }}
                onMouseOut={(e) => {
                  if (!loading) e.currentTarget.style.background = "var(--brand-navy)";
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = "var(--dt-focus-ring)";
                  e.currentTarget.style.outline = "none";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {loading ? CTA_COPY.signingIn : CTA_COPY.signIn}
              </button>
            </form>
          )}
        </div>
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
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--muted)",
          fontSize: "var(--dt-small)",
        }}
      >
        Loading.
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
