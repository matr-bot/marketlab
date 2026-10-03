import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// In flat config, a later block that sets the same rule REPLACES it for the files it matches,
// so the engine rules are built from these shared lists and repeated where blocks overlap.

/** Engine boundary (D-003): no React, Next.js or UI imports. */
const BOUNDARY_IMPORTS = [
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
];

/** Engine boundary (D-003): no DOM. */
const BOUNDARY_GLOBALS = [
  { name: "window", message: "src/engine must not touch the DOM." },
  { name: "document", message: "src/engine must not touch the DOM." },
];

/**
 * Determinism (D-019): globals engine source may not reference at all. Banning the name catches
 * every way of reaching it: direct use, aliases (`const D = Date`), destructuring and arguments.
 */
const DETERMINISM_GLOBALS = [
  { name: "Date", message: "The engine never reads the real clock; use SimClock (D-021)." },
  { name: "performance", message: "The engine never reads the real clock; use SimClock (D-021)." },
  { name: "crypto", message: "crypto randomness cannot be seeded; use Rng (D-017)." },
  { name: "globalThis", message: "globalThis is a way around the determinism rule; reference only what the rule allows (D-019)." },
  { name: "self", message: "self is a way around the determinism rule (D-019)." },
  { name: "global", message: "global is a way around the determinism rule (D-019)." },
];

/**
 * The only Math members engine source may use: the spec requires these to be exact. Everything
 * else (log, exp, pow, trig, random, …) is "implementation-approximated" or unseeded.
 */
const EXACT_MATH = ["sqrt", "abs", "floor", "ceil", "trunc", "round", "min", "max", "imul", "sign", "fround", "clz32"];

const DETERMINISM_SYNTAX = [
  {
    // Any reference to Math except `Math.<exact member>` written out directly. This blocks
    // Math.log(x), Math["log"](x), `const m = Math`, `const { log } = Math`, f(Math), (0, Math).log …
    selector: `Identifier[name='Math']:not(MemberExpression[computed=false][property.name=/^(${EXACT_MATH.join("|")})$/] > Identifier.object)`,
    message: `Only exact Math members may be used in src/engine (${EXACT_MATH.join(", ")}). For ln, exp and pow use detMath; for randomness use Rng (D-019).`,
  },
  { selector: "BinaryExpression[operator='**']", message: "** can differ between browsers; use detMath.pow (D-019)." },
  { selector: "AssignmentExpression[operator='**=']", message: "**= can differ between browsers; use detMath.pow (D-019)." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Engine boundary: src/engine is pure TypeScript that runs in a Web Worker and in Vitest. It
  // must never depend on React, Next.js, the DOM or UI code. Applies to tests too.
  {
    files: ["src/engine/**/*.ts", "src/engine/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: BOUNDARY_IMPORTS }],
      "no-restricted-globals": ["error", ...BOUNDARY_GLOBALS],
    },
  },
  // Determinism (D-019): engine source must compute identical bits in every browser and never
  // read the real clock or an unseeded random source. Tests and benchmarks are exempt (they
  // compare against Math.log, time things, etc.). A runtime backstop test (determinism.test.ts)
  // catches anything that slips past these static checks.
  {
    files: ["src/engine/**/*.ts"],
    ignores: ["src/engine/**/*.test.ts", "src/engine/**/*.bench.ts"],
    rules: {
      "no-restricted-globals": ["error", ...BOUNDARY_GLOBALS, ...DETERMINISM_GLOBALS],
      "no-restricted-syntax": ["error", ...DETERMINISM_SYNTAX],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  // Integer money (D-001, D-019): the files that handle prices, quantities and cash may not import
  // detMath, whose ln/exp/pow return non-integers. Floats become prices only through an explicit
  // round-to-tick step in agent code, and the order book rejects any non-integer price.
  {
    files: ["src/engine/orderBook.ts", "src/engine/matchingEngine.ts", "src/engine/validation.ts", "src/engine/marketRegistry.ts", "src/engine/types.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...BOUNDARY_IMPORTS,
            {
              group: ["./detMath", "**/detMath"],
              message: "Price and cash code must stay integer-only; detMath returns non-integers (D-001, D-019).",
            },
          ],
        },
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
