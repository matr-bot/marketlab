// @ts-check
/** Mutation testing for the simulation engine. Run with `npm run test:mutation`. */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  mutate: ["src/engine/**/*.ts", "!src/engine/**/*.test.ts", "!src/engine/**/*.bench.ts"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: ".stryker-tmp",
};

export default config;
