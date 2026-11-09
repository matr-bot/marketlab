import { describe, expect, it } from "vitest";
import { MAX_USER_ORDER_QTY } from "@/engine/simulation";
import { DEFAULT_PANIC_SENSITIVITY, DEFAULT_SHOCK_SECONDS, HELP_LINES, parseCommand, SPEEDS } from "./command";

const err = (input: string) => {
  const c = parseCommand(input);
  if (c.kind !== "error") throw new Error(`expected an error for ${JSON.stringify(input)}, got ${JSON.stringify(c)}`);
  return c.message;
};

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

describe("parseCommand: SHOCK with your own numbers", () => {
  it("a percent is a fair-value change; panic sensitivity and duration default sensibly", () => {
    for (const input of ["SHOCK -3", "shock -3%", "SHOCK -3.0", "MLAB SHOCK -3"]) {
      expect(parseCommand(input)).toEqual({ kind: "customShock", fairValuePct: -0.03, panicSensitivity: DEFAULT_PANIC_SENSITIVITY, durationSec: DEFAULT_SHOCK_SECONDS });
    }
    expect(parseCommand("SHOCK +2.5%")).toMatchObject({ kind: "customShock", fairValuePct: 0.025 });
    expect(parseCommand("SHOCK 4")).toMatchObject({ kind: "customShock", fairValuePct: 0.04 });
  });

  it("takes panic sensitivity and seconds as the next two numbers", () => {
    expect(parseCommand("SHOCK -3 2 120")).toEqual({ kind: "customShock", fairValuePct: -0.03, panicSensitivity: 2, durationSec: 120 });
    expect(parseCommand("SHOCK -1 0.5")).toMatchObject({ panicSensitivity: 0.5, durationSec: DEFAULT_SHOCK_SECONDS });
  });

  it("passes huge values through (the engine clamps and reports what it applied)", () => {
    expect(parseCommand("SHOCK -900 99 5")).toMatchObject({ kind: "customShock", fairValuePct: -9, panicSensitivity: 99, durationSec: 5 });
  });

  it("explains itself for a missing or bad argument", () => {
    for (const input of ["SHOCK -3 x", "SHOCK -3 2 x", "SHOCK -3 2 120 9", "SHOCK --3", "SHOCK -3e2", "SHOCK -3 -2"]) {
      expect(err(input), input).toContain("SHOCK needs a headline code");
    }
  });
});

describe("parseCommand: orders", () => {
  it("BUY and SELL are market orders by default, in any case", () => {
    expect(parseCommand("BUY 500")).toEqual({ kind: "order", order: { type: "market", side: "buy", qty: 500 } });
    expect(parseCommand("sell 250")).toEqual({ kind: "order", order: { type: "market", side: "sell", qty: 250 } });
    expect(parseCommand("MLAB BUY 100")).toMatchObject({ kind: "order" });
  });

  it("understands thousands separators and K", () => {
    expect(parseCommand("BUY 1,000")).toMatchObject({ order: { qty: 1_000 } });
    expect(parseCommand("BUY 5K")).toMatchObject({ order: { qty: 5_000 } });
    expect(parseCommand("BUY 1.5k")).toMatchObject({ order: { qty: 1_500 } });
    expect(parseCommand("SELL 50k")).toMatchObject({ order: { qty: 50_000 } });
  });

  it("a limit order has a price in dollars, converted to exact cents", () => {
    expect(parseCommand("BUY 500 @ 187.25")).toEqual({ kind: "order", order: { type: "limit", side: "buy", qty: 500, price: 18_725 } });
    expect(parseCommand("SELL 500 AT 187.5")).toEqual({ kind: "order", order: { type: "limit", side: "sell", qty: 500, price: 18_750 } });
    expect(parseCommand("BUY 500@187")).toMatchObject({ order: { type: "limit", price: 18_700 } });
    expect(parseCommand("BUY 500 @ $187.05")).toMatchObject({ order: { price: 18_705 } });
    expect(parseCommand("BUY 1 @ 0.01")).toMatchObject({ order: { price: 1 } });
    // Floating point would give 18,699.999…; the parser is exact.
    expect(parseCommand("BUY 1 @ 186.99")).toMatchObject({ order: { price: 18_699 } });
  });

  it("refuses sizes outside 1..100,000 and things that are not numbers, with a hint", () => {
    expect(err("BUY 0")).toContain("1 to 100,000 shares");
    expect(err(`BUY ${MAX_USER_ORDER_QTY + 1}`)).toContain("1 to 100,000 shares");
    expect(parseCommand(`BUY ${MAX_USER_ORDER_QTY}`).kind).toBe("order");
    for (const input of ["BUY", "BUY 12.5", "BUY -5", "BUY 1e3"]) expect(err(input), input).toContain("BUY 500");
  });

  it("refuses a bad price or a malformed limit order, with a hint", () => {
    expect(err("BUY 500 @ 187.255")).toContain("at most 2 decimals");
    expect(err("BUY 500 @ abc")).toContain("is not a price");
    expect(err("BUY 500 @ 0")).toContain("is not a price");
    expect(err("BUY 500 @")).toContain("BUY 500");
    expect(err("BUY 500 187.25")).toContain("BUY 500");
    expect(err("BUY 500 @ 187 extra")).toContain("BUY 500");
  });

  it("CANCEL (or CANCEL ALL) cancels resting orders", () => {
    expect(parseCommand("CANCEL")).toEqual({ kind: "cancelOrders" });
    expect(parseCommand("cancel all")).toEqual({ kind: "cancelOrders" });
  });
});

describe("parseCommand: running the market and the scenario", () => {
  it("PAUSE, RUN, SPEED", () => {
    expect(parseCommand("PAUSE")).toEqual({ kind: "pause" });
    for (const w of ["RUN", "play", "RESUME"]) expect(parseCommand(w)).toEqual({ kind: "run" });
    for (const n of SPEEDS) expect(parseCommand(`SPEED ${n}`)).toEqual({ kind: "speed", speed: n });
    for (const bad of ["SPEED", "SPEED 3", "SPEED 0", "SPEED 4 4", "SPEED -1"]) expect(err(bad), bad).toContain("SPEED takes 1, 2, 4, 8");
  });

  it("SCN lists, SCN <id> opens, an unknown id lists the real ones", () => {
    expect(parseCommand("SCN")).toEqual({ kind: "scenario", id: null });
    expect(parseCommand("scenarios")).toEqual({ kind: "scenario", id: null });
    expect(parseCommand("SCN Rate-Shock")).toEqual({ kind: "scenario", id: "rate-shock" });
    expect(parseCommand("SCENARIO quiet-buy")).toEqual({ kind: "scenario", id: "quiet-buy" });
    expect(err("SCN moon")).toBe("Unknown scenario \"moon\". Scenarios: free, rate-shock, earnings-miss, fraud, whipsaw, quiet-buy.");
    expect(err("SCN rate shock")).toContain("Unknown scenario");
  });

  it("SEED, RERUN, LINK, HELP", () => {
    expect(parseCommand("SEED 42")).toEqual({ kind: "seed", seed: 42 });
    for (const bad of ["SEED", "SEED -1", "SEED 4.5", "SEED 99999999999", "SEED 1 2"]) expect(err(bad), bad).toContain("SEED takes a whole number");
    expect(parseCommand("RERUN")).toEqual({ kind: "rerun" });
    expect(parseCommand("restart")).toEqual({ kind: "rerun" });
    expect(parseCommand("LINK")).toEqual({ kind: "link" });
    expect(parseCommand("help")).toEqual({ kind: "help" });
    expect(parseCommand("?")).toEqual({ kind: "help" });
  });

  it("every command in HELP parses to something other than an error (the help never lies)", () => {
    const examples = ["FED", "SHOCK -3", "BUY 500", "BUY 500 @ 187.25", "CANCEL", "PAUSE", "RUN", "SPEED 4", "SCN", "SCN rate-shock", "LINK", "SEED 42", "RERUN"];
    for (const e of examples) expect(parseCommand(e).kind, e).not.toBe("error");
    expect(HELP_LINES.length).toBeGreaterThanOrEqual(examples.length - 4);
  });
});

describe("parseCommand: command words vs headlines (CLAUDE.md, Command bar)", () => {
  it("a command word followed by words is a headline, so real news is never mistaken for a command", () => {
    for (const input of [
      "Buy now, pay later lender collapses",
      "Sell-off deepens in chip stocks",
      "SELL lots",
      "Run on regional banks",
      "Pause in Fed hikes expected",
      "Cancel culture hits retailer",
      "Speed of rate cuts surprises",
      "Seed funding dries up",
      "Scenario planning at the Fed",
      "Help wanted signs vanish",
      "Link between rates and housing",
      "Rerun of 2008 feared",
      "SHOCK MOON",
      "SHOCK FED CEO",
      "Shock jobs report",
    ]) expect(parseCommand(input), input).toEqual({ kind: "news", headline: input });
  });

  it("numbers after a command word always mean a command, so a mistyped one is an error, never a headline", () => {
    for (const input of ["CANCEL 3", "PAUSE 5", "RUN 2", "LINK 2", "RERUN 1", "HELP 1"]) {
      expect(err(input)).toBe(`Unknown command "${input}". Type HELP for the list of commands.`);
    }
    expect(err("BUY 5OO")).toContain("is not a number of shares");
  });

  it("a bare MLAB asks for a code or a headline", () => {
    expect(err("MLAB")).toBe("Type a code or a headline after MLAB, e.g. MLAB FED. Type HELP for the list of commands.");
  });
});
