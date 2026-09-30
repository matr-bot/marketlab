import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Engine boundary: src/engine is pure TypeScript that runs in a Web Worker and
  // in Vitest. It must never depend on React, Next.js, the DOM, or UI code.
  {
    files: ["src/engine/**/*.ts", "src/engine/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message: "src/engine must not import React (engine rule: zero React/DOM imports).",
            },
            {
              group: ["next", "next/*"],
              message: "src/engine must not import Next.js (engine rule: zero React/DOM imports).",
            },
            {
              group: ["@/app", "@/app/*", "@/components", "@/components/*"],
              message: "src/engine must not import UI code.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "src/engine must not touch the DOM." },
        { name: "document", message: "src/engine must not touch the DOM." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stryker mutation-testing output
    "reports/**",
    ".stryker-tmp/**",
  ]),
]);

export default eslintConfig;
