import js from "@eslint/js";
import globals from "globals";

// Minimal, intentionally light-touch (Section 17.5 — CI's job is
// catching obviously broken PRs, not enforcing a style guide).
export default [
  js.configs.recommended,
  {
    // args: "none" — base/interface files (providers/base.js,
    // storage/base.js, slide-splitters/base.js) document parameter
    // shapes on methods that intentionally throw "Not implemented" in
    // the base class, so the params are unused there by design.
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
  {
    files: ["server/**/*.js", "providers/**/*.js", "storage/**/*.js", "slide-splitters/**/*.js", "modules/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, lucide: "readonly" },
    },
  },
  {
    ignores: ["node_modules/", "cache/", "staging/", "data/"],
  },
];
