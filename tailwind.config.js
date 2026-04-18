/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ---- DT brand canon (Brand v1.2, Phil-approved 17 Apr 2026) ----
        ink: "#111111",
        inkSoft: "#2a2a2a",
        brand: "#305DAB",        // DT Navy — canonical primary (was #3B5CB5 legacy).
        brandHover: "#2A528E",   // Button hover per Format Standards §13.1.
        brandSoft: "#E7EEF8",    // Tinted navy for non-hover surfaces.
        paper: "#FFFFFF",
        stone: "#A7A59F",
        mist: "#f7f8fb",         // Utility background (non-brand).
        line: "#E5E7EB",
      },
      boxShadow: {
        panel: "0 12px 40px rgba(17, 17, 17, 0.04)",
        lifted: "0 8px 28px rgba(0, 0, 0, 0.22)", // Dark-first card.
      },
      fontFamily: {
        // Source Sans 3 is DT body canon (Brand v1.2 internal apps rule).
        sans: [
          "Source Sans 3",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Oswald is DT display canon (Brand v1.2 §2.3).
        display: [
          "Oswald",
          "Bebas Neue",
          "Impact",
          "Arial Narrow",
          "sans-serif",
        ],
        // `editorial` (Newsreader) retained for legacy callers across App.jsx.
        // TODO (Phase 4 cleanup): migrate every `font-editorial` usage to
        // `font-display` and drop this entry.
        editorial: ["Newsreader", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
