import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".next", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "prefer-const": "warn",
    },
  },
  // The .mjs gates and the module they share. Without this block nothing matches a .mjs, so
  // scripts/lib/sourceScan.mjs would sit under ZERO rules — and that is a coverage
  // REGRESSION, not just a new unlinted file: `stripComments`, `maskLiterals` and
  // `readLiteral` were linted as TypeScript until they moved out of src/test/sourceScan.ts.
  // They are hand-rolled character scanners full of regexes, so the rules that matter here
  // are the ones they just lost — no-useless-escape, no-control-regex,
  // no-empty-character-class, no-misleading-character-class.
  //
  // Node globals, not browser: these run under bare `node`.
  {
    extends: [js.configs.recommended],
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
