import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      // Build output
      "dist/**",
      "build/**",
      // Node modules
      "node_modules/**",
      // Generated files
      "*.generated.ts",
      "*.min.js",
      // Third party code
      "**/third_party/**",
      "**/vendor/**",
      // Coverage directory
      "coverage/**"
    ]
  },
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
