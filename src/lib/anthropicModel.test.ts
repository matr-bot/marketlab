import { describe, expect, it } from "vitest";
import { usageLine } from "./anthropicModel";

describe("usage logging (D-092)", () => {
  it("logs token counts and the stop reason only: no text, no answer, no key", () => {
    const line = usageLine("strategy", { input_tokens: 1210, output_tokens: 347 }, "end_turn");
    expect(JSON.parse(line)).toEqual({ event: "interpret_usage", tag: "strategy", input_tokens: 1210, output_tokens: 347, stop_reason: "end_turn" });
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(["event", "input_tokens", "output_tokens", "stop_reason", "tag"]);
  });
});
