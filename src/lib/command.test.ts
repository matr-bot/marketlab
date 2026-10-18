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

  it("sends any other text to the AI as a NEWS headline (D-052), spacing tidied", () => {
    expect(parseCommand("  Fed   raises rates ")).toEqual({ kind: "news", headline: "Fed raises rates" });
    expect(parseCommand("FED FED")).toEqual({ kind: "news", headline: "FED FED" });
    expect(parseCommand("<script>")).toEqual({ kind: "news", headline: "<script>" });
  });

  it("asks for a headline after a bare SHOCK", () => {
    expect(parseCommand("SHOCK")).toEqual({ kind: "error", message: "Type a headline after SHOCK, or one of FED, CEO, BEAT, DOWNGRADE." });
  });
});
