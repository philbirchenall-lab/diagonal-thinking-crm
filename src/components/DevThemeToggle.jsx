/**
 * DevThemeToggle
 * --------------
 * CRM-DM-001 scaffold (23 Apr 2026, Rex).
 *
 * DEV-ONLY floating toggle. Appears only when `import.meta.env.DEV`
 * is true, so it is never present in the production bundle. Three
 * states (Auto / Light / Dark) cycled on click.
 *
 * The permanent, user-facing toggle lands after Phil signs off the
 * v1.6.8 palette (see Pix Q12). This dev toggle exists so Rex / Pix /
 * Tes can exercise the dark palette during build and QA without
 * exposing a half-done feature to Phil, clients, or logged-in users.
 *
 * Placeholder visual only: uses inline styles and a neutral monospace
 * pill so it's obviously a dev affordance, not production chrome.
 */

import { useTheme } from "../hooks/useTheme";

const LABELS = {
  auto: "AUTO",
  light: "LIGHT",
  dark: "DARK",
};

export function DevThemeToggle() {
  const { mode, resolved, cycleMode } = useTheme();
  if (!import.meta.env || !import.meta.env.DEV) return null;
  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={`Cycle colour mode (currently ${mode}, resolved ${resolved})`}
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        padding: "6px 10px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        background: "rgba(17, 17, 17, 0.82)",
        color: "#FFFFFF",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        borderRadius: 4,
        cursor: "pointer",
      }}
      title="Dev-only theme toggle. Not shipped to production."
    >
      {`DEV ${LABELS[mode]} (${resolved})`}
    </button>
  );
}

export default DevThemeToggle;
