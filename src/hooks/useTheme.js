/**
 * useTheme
 * --------
 * CRM-DM-001 scaffold (23 Apr 2026, Rex).
 *
 * Class-based light/dark theme controller for the DT CRM. Toggles
 * `document.documentElement.classList.dark` in response to three modes:
 *
 *   "auto"  - follow the OS `prefers-color-scheme` media query live
 *   "light" - force light
 *   "dark"  - force dark
 *
 * Persistence:
 *   - User override is persisted to localStorage under STORAGE_KEY.
 *   - If no override is set, mode defaults to "auto".
 *
 * Wiring:
 *   - Tailwind config must set `darkMode: 'class'` (done in commit 1
 *     of this branch).
 *   - `packages/brand/src/tokens.css` must contain a `.dark { ... }`
 *     block that overrides light-mode CSS variables (done in commit 1).
 *   - Call this hook once at the App root so the listener runs for
 *     the full app lifetime. See `src/components/ThemeBootstrapper.jsx`.
 *
 * Production surface:
 *   - The hook itself is safe to import and call in production.
 *   - The dev-only toggle UI component (`DevThemeToggle`) is the only
 *     thing that currently flips the mode; it is gated behind
 *     `import.meta.env.DEV` so production users never see a toggle.
 *   - When Phil signs off v1.6.8 and the user-facing toggle lands,
 *     the production toggle will use the same setMode API surfaced here.
 *
 * Refs:
 *   outputs/pix-dark-mode-palette-answers-2026-04-23.md, Q12 (toggle UX)
 *   outputs/brand-guidelines-v1.6.8-patch.md, section 2.7.11 (pending)
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dt-theme";
const CLASS_NAME = "dark";
const VALID_MODES = ["auto", "light", "dark"];

function readStoredMode() {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.includes(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

function systemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function computeResolved(mode) {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return systemPrefersDark() ? "dark" : "light";
}

function applyClass(resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add(CLASS_NAME);
  else root.classList.remove(CLASS_NAME);
}

export function useTheme() {
  const [mode, setModeState] = useState(readStoredMode);
  const [resolved, setResolved] = useState(() => computeResolved(readStoredMode()));

  // Apply class whenever resolved changes.
  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  // Listen to OS changes when in auto mode.
  useEffect(() => {
    if (mode !== "auto") return undefined;
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event) => setResolved(event.matches ? "dark" : "light");
    // Initial sync, then subscribe.
    setResolved(mql.matches ? "dark" : "light");
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, [mode]);

  const setMode = useCallback((next) => {
    if (!VALID_MODES.includes(next)) return;
    setModeState(next);
    setResolved(computeResolved(next));
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      /* localStorage unavailable: session-only override is still fine */
    }
  }, []);

  const cycleMode = useCallback(() => {
    setMode(mode === "auto" ? "light" : mode === "light" ? "dark" : "auto");
  }, [mode, setMode]);

  return { mode, resolved, setMode, cycleMode };
}

export default useTheme;
