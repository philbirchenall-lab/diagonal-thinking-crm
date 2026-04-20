import tsParser from "@typescript-eslint/parser";
import noEmdash from "./eslint-rules/no-emdash.js";

const commonConfig = {
  plugins: {
    dt: {
      rules: {
        "no-emdash": noEmdash,
      },
    },
  },
  rules: {
    "dt/no-emdash": "error",
  },
};

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "build/**",
      ".claude/worktrees/**",
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    ...commonConfig,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "commonjs",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    ...commonConfig,
  },
];
