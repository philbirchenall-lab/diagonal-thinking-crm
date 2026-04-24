/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // CRM-DM-001 scaffold (23 Apr 2026, Rex).
  // Class-based dark mode: html.dark is toggled by the useTheme hook
  // at src/hooks/useTheme.js. Final colour tokens land in v1.6.8
  // after Phil sign-off of Pix's brand-guidelines patch.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ---- DT brand canon (Brand v1.2, Phil-approved 17 Apr 2026) ----
        ink: "#111111",
        inkSoft: "#2a2a2a",
        brand: "#305DAB",
        brandHover: "#2A528E",
        brandSoft: "#E7EEF8",
        paper: "#FFFFFF",
        stone: "#A7A59F",
        mist: "#f7f8fb",
        line: "#E5E7EB",
      },
      boxShadow: {
        panel: "0 12px 40px rgba(17, 17, 17, 0.04)",
        lifted: "0 8px 28px rgba(0, 0, 0, 0.22)",
      },
      fontFamily: {
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
        display: [
          "Oswald",
          "Bebas Neue",
          "Impact",
          "Arial Narrow",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
