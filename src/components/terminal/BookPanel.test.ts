import { describe, expect, it } from "vitest";
import { levelsPerSide } from "./BookPanel";

describe("levelsPerSide: BOOK shows the same number of levels on both sides", () => {
  it("fills the height: header and spread take a row each, the rest splits evenly", () => {
    expect(levelsPerSide(16 * 42, 40, 40)).toBe(20); // 42 rows: 2 fixed + 20 + 20
    expect(levelsPerSide(16 * 43 - 1, 40, 40)).toBe(20); // a partial row is absorbed by stretching
    expect(levelsPerSide(16 * 44, 40, 40)).toBe(21);
  });

  it("is capped by the thinner side, so both sides always match", () => {
    expect(levelsPerSide(2_000, 40, 12)).toBe(12);
    expect(levelsPerSide(2_000, 7, 40)).toBe(7);
    expect(levelsPerSide(2_000, 0, 40)).toBe(0); // an empty side shows no levels, never a lopsided book
  });

  it("shows at least one level per side in a tiny panel", () => {
    expect(levelsPerSide(10, 40, 40)).toBe(1);
  });
});
