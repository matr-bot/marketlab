import { expect, test } from "@playwright/test";
import { firstDivergence, type DeterminismResult } from "../src/lib/determinism";
import pinsJson from "../src/lib/determinismPins.json";

const pins = pinsJson as unknown as DeterminismResult;

// D-091: in Chromium, Firefox and WebKit, the browser's own worker runs seed 187 (free play for 10
// sim-minutes, the Fed hike for 90 sim-seconds) and detMath, and every hash must equal the pins that
// Node reproduces on Linux and macOS. A difference fails with the first diverging tick; never re-pin.
test("the engine is bit-identical in this browser: fills, book and detMath equal the pins", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.goto("/determinism");
  const status = page.getByTestId("determinism-status");
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 110_000 });
  const result = JSON.parse((await page.getByTestId("determinism-full").textContent())!) as DeterminismResult;
  const divergence = firstDivergence(pins, result);
  expect(divergence, `${browserName}: ${divergence}`).toBeNull();
  expect(result.runs.map((r) => r.final)).toEqual(pins.runs.map((r) => r.final));
  expect(result.detMath).toEqual(pins.detMath);
  expect(result.nonFinite, `${browserName}: the market held ${result.nonFinite}`).toBeNull(); // the NaN guard
  await expect(status).toHaveAttribute("data-state", "identical");
});
