/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        inkSoft: "#2a2a2a",
        brand: "#3B5CB5",
        brandSoft: "#eef2ff",
        mist: "#f7f8fb",
        line: "#d8dce5",
      },
      boxShadow: {
        panel: "0 12px 40px rgba(17, 17, 17, 0.04)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        editorial: ["Newsreader", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
