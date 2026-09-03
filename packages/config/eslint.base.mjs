import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared lint rules for the framework-free packages.
 *
 * The boundary rule is the important one: packages/core must never import
 * Next.js. That constraint is what keeps the ledger testable in milliseconds
 * without a server, and it is enforced here rather than by discipline.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "**/*.d.ts", "migrations/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "packages/* must stay framework-free. Next.js belongs in apps/web only — " +
                "this is what keeps the domain layer testable without a server.",
            },
          ],
        },
      ],
      // Money is bigint; a stray float would be a silent correctness bug.
      "no-loss-of-precision": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["**/*.test.ts", "**/scripts/**", "**/test/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
);
