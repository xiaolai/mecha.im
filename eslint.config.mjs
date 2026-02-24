import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["packages/*/src/**/*.ts"],
    ignores: ["**/dist/**", "**/node_modules/**", "**/__tests__/**"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }],
    },
  },
];
