"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Login — dark-first treatment per brand guidelines v1 §2.6
 * and Tes scope v2 Ambiguity B (navy full-bleed, centred logo,
 * Oswald H1, single sign-in card).
 *
 * UI copy follows Register A per brand v1 §4.2 and Tes scope.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("That did not work. Check your details and try again.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
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
        padding: "24px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "420px" }}>
        {/* Centred logo — full lockup >= 480px, icon below */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "32px",
          }}
        >
          {/* Dedicated white-out assets from Pix (PIX-LOGO-WHITE-001).
              Responsive swap at Format Standards §5.5 200px threshold.
              Full-colour fallback paths remain for any consumer that
              renders the logo on a non-navy surface. */}
          <picture>
            <source
              media="(max-width: 479px)"
              srcSet="/brand/logo-icon-white.png"
            />
            <img
              src="/brand/logo-full-white.png"
              alt="Diagonal Thinking"
              style={{
                height: "54px",
                width: "auto",
                display: "block",
              }}
            />
          </picture>
        </div>

        <h1
          style={{
            fontSize: "40px",
            lineHeight: 1.05,
            textAlign: "center",
            marginBottom: "10px",
            color: "var(--paper)",
          }}
        >
          AI Intelligence
        </h1>
        <p
          style={{
            textAlign: "center",
            fontSize: "16px",
            color: "rgba(255,255,255,0.8)",
            marginBottom: "32px",
          }}
        >
          Diagonal Thinking internal wiki. Sign in to continue.
        </p>

        <div
          style={{
            background: "var(--paper)",
            color: "var(--ink)",
            borderRadius: "8px",
            padding: "28px 24px",
            borderTop: "3px solid #305DAB",
            boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
          }}
        >
          <form onSubmit={handleSubmit} noValidate>
            <label
              htmlFor="login-email"
              style={{
                display: "block",
                fontSize: "14px",
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
                borderRadius: "6px",
                fontSize: "16px",
                color: "var(--ink)",
                background: "var(--paper)",
                outline: "none",
                marginBottom: "16px",
                minHeight: "44px",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--brand-navy)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(48, 93, 171, 0.18)";
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
                fontSize: "14px",
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
                borderRadius: "6px",
                fontSize: "16px",
                color: "var(--ink)",
                background: "var(--paper)",
                outline: "none",
                marginBottom: "20px",
                minHeight: "44px",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--brand-navy)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(48, 93, 171, 0.18)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />

            {error && (
              <div
                role="alert"
                style={{
                  background: "#FFF5F5",
                  border: "1px solid #FED7D7",
                  borderRadius: "6px",
                  color: "#9B2C2C",
                  fontSize: "14px",
                  padding: "10px 12px",
                  marginBottom: "16px",
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
                borderRadius: "6px",
                fontSize: "16px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.15s",
                minHeight: "44px",
              }}
            >
              {loading ? "Signing in." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
