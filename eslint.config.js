const js = require("@eslint/js");
const globals = require("globals");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefresh = require("eslint-plugin-react-refresh").default;
const jsonc = require("eslint-plugin-jsonc");
const tseslint = require("typescript-eslint");
const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/dist-types/**",
    "**/.vite/**",
    "**/*.tsbuildinfo",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
  ...jsonc.configs["flat/recommended-with-json"],
  ...jsonc.configs["flat/recommended-with-jsonc"],
  {
    files: ["**/tsconfig*.json"],
    rules: {
      "jsonc/no-comments": "off",
    },
  },
]);
