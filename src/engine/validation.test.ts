import { describe, expect, it } from "vitest";
import { MAX_ORDER_QTY, MAX_PRICE_CENTS } from "./validation";

// The shadow models in testing/shadow.ts hard-code these numbers instead of importing them, so
// that a wrong limit can't agree with itself. This test pins the real values to the same numbers.
describe("order limits (D-001)", () => {
  it("caps price at $1,000,000.00 (100,000,000 cents)", () => {
    expect(MAX_PRICE_CENTS).toBe(100_000_000);
  });

  it("caps order size at 10,000,000 shares", () => {
    expect(MAX_ORDER_QTY).toBe(10_000_000);
  });

  it("keeps price × qty an exact integer", () => {
    expect(Number.isSafeInteger(MAX_PRICE_CENTS * MAX_ORDER_QTY)).toBe(true);
  });
});
