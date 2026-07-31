import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";

/**
 * WP-02 — assertion helpers that a test block may assert THROUGH.
 *
 * `expect-expect` counts a test with zero direct `expect(...)` calls as vacuous. Several
 * suites here legitimately push their assertions into a named helper, so the helper's own
 * name has to be declared or the rule would be crying wolf on correct tests.
 *
 * These are listed EXPLICITLY rather than matched by an `expect*` glob for two reasons:
 * a glob would not cover `assertWraps` (which does not start with "expect") anyway, and
 * — more importantly — a glob silently blesses every future `expectSomething()` helper,
 * including one that asserts nothing. Adding a name here should cost a line of diff and
 * a reviewer's eye. Each entry below was checked to contain a real `expect(...)`.
 */
const VITEST_ASSERT_HELPERS = [
  "expect",
  // src/app/(marketing)/legalCommitments.test.tsx — asserts the footer residency line links out.
  "expectQualifiedFooter",
  // src/components/bridge/navTitleDedup.h1.test.tsx — asserts exactly one <h1> with the given text.
  "expectSingleH1",
  // src/components/bridge/workshop/__tests__/gateContextHeader.test.tsx — asserts the workshop header.
  "expectGateHeader",
  // src/components/bridge/workshop/MobileTriage.test.tsx — asserts an element is not `white-space: nowrap`.
  "assertWraps",
];

/**
 * The Playwright twin. `visitAndAssertHealthy` (tests/e2e/live-full-e2e.spec.ts) navigates,
 * asserts no error boundary, asserts an h1/landmark, and asserts the console error list is
 * empty — 15 route smoke tests spend their whole body in it.
 */
const PLAYWRIGHT_ASSERT_HELPERS = ["expect", "visitAndAssertHealthy"];

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

  // ───────────────────────────────────────────────────────────────────────────
  // WP-02: a test that asserts nothing is not a passing test, it is an absent one.
  //
  // Before this block there was NO expect-expect rule anywhere in the repo — neither
  // @vitest/eslint-plugin nor eslint-plugin-playwright was installed — so a `test()` or
  // `it()` whose body had lost (or never had) an assertion reported green forever.
  // ───────────────────────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      "vitest/expect-expect": ["error", { assertFunctionNames: VITEST_ASSERT_HELPERS }],
    },
  },
  {
    files: ["tests/e2e/**/*.spec.ts"],
    plugins: { playwright },
    rules: {
      "playwright/expect-expect": ["error", { assertFunctionNames: PLAYWRIGHT_ASSERT_HELPERS }],
      // The repo's only legitimate skip is the DECLARED-condition annotation,
      // `test.skip(<cond>, "reason")` — a live-backend or feature-flag gate stated up front
      // and reported identically on every run. `allowConditional: true` keeps exactly that
      // form legal while banning the bare `test.skip()` / `test.describe.skip(...)` modifier
      // that silently removes a test from the suite forever.
      //
      // `disallowFixme` bans `test.fixme` — a known-broken test that Playwright still counts
      // as a non-failure. Both are green in CI today (there are no `.fixme` and no bare
      // `.skip` modifiers in tests/e2e), so this is a ratchet, not a cleanup.
      "playwright/no-skipped-test": ["error", { allowConditional: true, disallowFixme: true }],
    },
  },
);
