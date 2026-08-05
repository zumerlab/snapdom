const js = require("@eslint/js")
const globals = require("globals")

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", "packages/**/dist/**"]
  },
  js.configs.recommended,
  {
    files: ["__tests__/**/*.js","src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        WebKitCSSMatrix: "readonly"
      }
    },
    rules: {
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
      "eol-last": ["error", "always"],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "arrow-spacing": ["error", { before: true, after: true }],
      "no-trailing-spaces": "error",
      "quotes": ["error", "single", { avoidEscape: true }],
      "semi": ["error", "never"],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // esbuild lowers block-level function declarations to a hoisted `var` of the same
      // name; two same-named ones in one scope then silently clobber each other.
      "no-inner-declarations": ["error", "functions", { blockScopedFunctions: "disallow" }]
    }
  }
]
