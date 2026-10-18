import { describe, expect, it } from "vitest";
import { parseCommand } from "./command";

describe("parseCommand: offline headlines from the command bar (D-048)", () => {
  it.each(["FED", "fed", " Fed ", "SHOCK FED", "shock fed", "MLAB FED"])("%j → the FED preset", (input) => {
    expect(parseCommand(input)).toEqual({ kind: "shock", code: "FED", headline: "Fed surprise hike 75bps" });
  });

  it("knows all four presets", () => {
    expect(["FED", "CEO", "BEAT", "DOWNGRADE"].map((c) => parseCommand(c).kind)).toEqual(["shock", "shock", "shock", "shock"]);
  });

  it("refuses anything over 200 characters without echoing it", () => {
    expect(parseCommand("F".repeat(201))).toEqual({ kind: "error", message: "Commands are at most 200 characters." });
    expect(parseCommand(" ".repeat(197) + "FED").kind).toBe("shock"); // exactly 200 is fine
  });

  it("treats blank input as nothing", () => {
    expect(parseCommand("   ")).toEqual({ kind: "empty" });
  });

  it("answers anything else with a friendly error listing the presets, never a crash", () => {
    for (const input of ["MOON", "SHOCK", "FED FED", "Fed raises rates", "SHOCK MOON", "<script>"]) {
      const c = parseCommand(input);
      expect(c.kind).toBe("error");
      if (c.kind === "error") expect(c.message).toBe(`Unknown command "${input}". Headlines available offline: FED, CEO, BEAT, DOWNGRADE.`);
    }
  });
});
