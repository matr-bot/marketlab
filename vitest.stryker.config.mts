import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest settings for mutation runs only (D-028). Keep in step with vitest.config.mts.
// Mutation testing reruns every test that touches a mutant, for each of ~1,000 mutants, so tests
// that replay whole markets dominate its time. They still run in the normal suite (`npm test`)
// on every commit; here they are left out:
// - determinism.test.ts reruns every workload twice with banned globals stubbed;
// - one-hour whole-market tests in simulation.test.ts skip themselves when MARKETLAB_MUTATION=1.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/engine/determinism.test.ts"],
    environment: "node",
    env: { MARKETLAB_MUTATION: "1" },
  },
});
