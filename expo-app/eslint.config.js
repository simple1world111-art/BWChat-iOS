const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");

module.exports = defineConfig([
  {
    // Generated bundles and visual-acceptance evidence can contain vendored
    // JavaScript (for example Xcode's Swift Package checkouts). They are build
    // inputs/outputs, not application source, and must not change lint results.
    ignores: [".expo/**", "artifacts/**", "coverage/**", "dist*/**"],
  },
  expoConfig,
  {
    plugins: { "@typescript-eslint": typescriptEslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);
