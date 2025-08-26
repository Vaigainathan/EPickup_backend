import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error"
    }
  }
];
