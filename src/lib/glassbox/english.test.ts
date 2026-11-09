import { describe, expect, it } from "vitest";
import { describeRules, pct } from "./english";

describe("describeRules: the rules in plain English", () => {
  it("the demo strategy, in the order the engine checks the rules", () => {
    expect(describeRules({ entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 }).map((l) => l.text)).toEqual([
      "Buy 500 shares when the mid is 3% below its highest point of the last 60 s.",
      "Stop loss: sell if the mid moves 2% below the mid when you entered.",
      "Take profit: sell if the mid moves 2% above the mid when you entered.",
      "Time exit: sell 300 s after the entry, whatever the price.",
      "After an exit, wait 30 s before entering again.",
    ]);
  });

  it("a short buys back, its stop is above and its target below; exits that are off are left out", () => {
    expect(describeRules({ entry: { rule: "sellAfterRise", pct: 0.025, windowSec: 30 }, stopLossPct: 0.01, takeProfitPct: null, timeExitSec: null, qty: 1, cooldownSec: 0 }).map((l) => l.text)).toEqual([
      "Sell short 1 share when the mid is 2.5% above its lowest point of the last 30 s.",
      "Stop loss: buy back if the mid moves 1% above the mid when you entered.",
      "After an exit, it may enter again the next second.",
    ]);
  });

  it("percent text has no float noise", () => {
    expect([pct(0.07), pct(0.001), pct(0.2)]).toEqual(["7%", "0.1%", "20%"]);
  });
});
