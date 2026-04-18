"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * WikiShell — Next.js outer shell around the iframe-embedded wiki.
 *
 * Owns:
 *   - Navy topbar (DT brand anchor)
 *   - DT logo (responsive: full lockup >= 480px viewport, icon mark below)
 *   - Hamburger toggle on mobile (<768px), postMessages into the iframe to
 *     open/close the embedded sidebar
 *   - Sign-out button
 *   - Full-height iframe using 100dvh so iOS URL-bar toggle does not clip
 *
 * The iframe sidebar itself is rendered inside wiki.html. That template
 * listens for window messages of shape `{ type: 'dt:toggle-sidebar' }`.
 */
export default function WikiShell({ signOut }: { signOut: ReactNode }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: "dt:set-sidebar", open: next },
      "*",
    );
  }, [sidebarOpen]);

  // Close the outer state when the iframe reports its sidebar closed
  // (e.g. user tapped a nav item or the backdrop).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (data && typeof data === "object" && data.type === "dt:sidebar-state") {
        setSidebarOpen(Boolean(data.open));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: "var(--paper)",
      }}
    >
      {/* Header runs Stone (brand v1 §2.2) rather than Navy: the
          full-colour DT lockup has dark marks and reads poorly on a
          Navy ground. Brand v1 allows the logo on Navy only as a
          white-on-navy treatment; that asset does not exist yet
          (flagged as PROP-LOGO-WHITEOUT-001 for Mae/Pix). Stone ground
          + Ink Black type passes WCAG AAA (~8.6:1). */}
      <header
        style={{
          background: "var(--stone)",
          color: "var(--ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          gap: "12px",
          flexShrink: 0,
          minHeight: "56px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            type="button"
            className="dt-hamburger"
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {/* Full lockup on >=480px viewport, circular icon below.
              Per Tes scope and brand v1 §2.1 rules. */}
          <picture>
            <source media="(max-width: 479px)" srcSet="/brand/logo-icon.png" />
            <img
              src="/brand/logo-full.png"
              alt="Diagonal Thinking"
              style={{ height: "36px", width: "auto", display: "block" }}
            />
          </picture>
        </div>

        {signOut}
      </header>

      <iframe
        ref={iframeRef}
        src="/wiki.html"
        title="AI Intelligence"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          display: "block",
          background: "var(--paper)",
        }}
      />
    </div>
  );
}
