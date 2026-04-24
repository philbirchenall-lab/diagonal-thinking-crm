/**
 * ThemeBootstrapper
 * -----------------
 * CRM-DM-001 scaffold (23 Apr 2026, Rex).
 *
 * Invisible component that simply calls useTheme() once at the app
 * root so the class listener runs for the full session. Renders
 * nothing. Mount inside the <AuthWrapper>/<App> tree in main.jsx.
 */

import { useTheme } from "../hooks/useTheme";

export function ThemeBootstrapper() {
  useTheme();
  return null;
}

export default ThemeBootstrapper;
