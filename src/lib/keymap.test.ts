import { describe, expect, it } from "vitest";
import { globalAction, isTyping, KEYMAP, ticketAction, workspaceKey } from "./keymap";

const none = { ctrl: false, meta: false, alt: false };
const input = { tagName: "INPUT" } as unknown as EventTarget;
const button = { tagName: "BUTTON" } as unknown as EventTarget;

describe("keymap (D-080)", () => {
  it("Space pauses unless typing in a field; F1-F4 work everywhere", () => {
    expect(globalAction(" ", button, none)).toBe("pause");
    expect(globalAction(" ", null, none)).toBe("pause");
    expect(globalAction(" ", input, none)).toBeNull();
    expect(["F1", "F2", "F3", "F4"].map((k) => globalAction(k, input, none))).toEqual(["help", "session", "drawer", "backtest"]);
  });

  it("never claims a letter or a modified key globally", () => {
    for (const k of ["b", "s", "B", "1", "Enter"]) expect(globalAction(k, null, none)).toBeNull();
    expect(globalAction("F1", null, { ...none, meta: true })).toBeNull();
  });

  it("maps the ticket letters, either case", () => {
    expect(["b", "S", "m", "L", "x"].map((k) => ticketAction(k, none))).toEqual(["buy", "sell", "market", "limit", null]);
    expect(ticketAction("b", { ...none, ctrl: true })).toBeNull();
  });

  it("knows what a field is", () => {
    expect([input, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, button, null].map((t) => isTyping(t as EventTarget | null))).toEqual([true, true, true, false, false]);
  });

  it("lists every global key in the table HELP shows", () => {
    const keys = KEYMAP.map((k) => k.keys);
    for (const k of ["␣", "F1", "F2", "F3", "F4", "B · S", "M · L"]) expect(keys).toContain(k);
  });

  it("switches workspaces with Alt/Option + 1 or 2, by physical key (D-086)", () => {
    const alt = { ...none, alt: true };
    expect([workspaceKey("Digit1", alt), workspaceKey("Digit2", alt), workspaceKey("Digit3", alt)]).toEqual(["TRADE", "STRATEGY", null]);
    expect(workspaceKey("Digit1", none)).toBeNull();
    expect(workspaceKey("Digit2", { ...alt, meta: true })).toBeNull();
    expect(KEYMAP.map((k) => k.keys)).toContain("⌥1 · ⌥2");
  });
});
