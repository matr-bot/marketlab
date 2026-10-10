import { describe, expect, it } from "vitest";
import { median } from "./marketReport";

describe("median (Codex review: even-length lists)", () => {
  it.each([
    [[1, 2], 1.5], // the case Codex found: the upper middle (2) was reported before
    [[2, 1], 1.5],
    [[1, 2, 3], 2],
    [[4, 1, 3, 2], 2.5],
    [[7], 7],
    [[1, 1, 1, 9], 1],
  ])("median(%j) = %s", (values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it("is NaN for no values and does not reorder its input", () => {
    expect(median([])).toBeNaN();
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
