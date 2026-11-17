import { expect, test, type Page } from "@playwright/test";

// The 90-second demo, end to end (CLAUDE.md, The 90-second demo story): IDEA → MARKET → REALITY
// CHECK → REVEAL. The LLM is mocked (CI has no API key); the route's own logic is unit-tested.

const IDEA = "Buy after a quick 3% drop because panic sellers overshoot";
const SPEC = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 };

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("the demo: a strategy in plain English trades through FED, shows in EXR, and the glass box reveals it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as { kind?: string; text?: string };
    if (body.kind !== "strategy") return route.abort(); // FED is an offline preset: no headline call expected
    await route.fulfill({ json: { ok: true, source: "ai", text: body.text, strategy: { spec: SPEC, reason: "Panic selling overshoots fair value, then the price recovers" } } });
  });
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });

  // 1. IDEA: the drawer is collapsed in free play; its STRATEGY tab opens the strategy pane (D-074).
  await expect(page.getByTestId("strat")).toHaveCount(0);
  await page.getByTestId("drawer-tab-STRAT").click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-open", "true");
  await page.getByTestId("strat-input").click();
  await page.keyboard.type(IDEA);
  await page.keyboard.press("Enter");
  const strat = page.getByTestId("strat");
  await expect(strat).toHaveAttribute("data-phase", "preview");
  await expect(strat).toContainText("AI");
  await expect(strat.locator("[data-field=pct]")).toHaveValue("3");
  await expect(strat.locator("[data-field=windowSec]")).toHaveValue("60");
  await expect(page.getByTestId("strat-rules")).toContainText("Buy 500 shares when the mid is 3% below its highest point of the last 60 s.");
  await page.getByTestId("strat-start").click();
  await expect(strat).toHaveAttribute("data-phase", "live");
  await expect(page.getByTestId("strat-status")).toContainText("RUNNING · FLAT");

  // 2. MARKET: a headline hits; the strategy buys the drop.
  await page.keyboard.type("FED");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-reply")).toHaveText("FED · Fed surprise hike 75bps");
  await expect(page.getByTestId("strat-last")).toContainText("ENTRY: BUY 500", { timeout: 20_000 });
  await expect(page.getByTestId("strat-position")).toHaveText("+500");

  // 3. REALITY CHECK: the strategy's order in EXR, with its cost split.
  await expect(page.getByTestId("exr-src").first()).toHaveText("STRAT");
  await expect(page.getByTestId("exr-total")).toContainText("SPREAD");

  // 4. REVEAL: English → rules → formulas with real numbers → Python.
  await page.getByTestId("strat-reveal").click();
  const glass = page.getByTestId("glass");
  await expect(glass).toBeVisible();
  await expect(page.getByTestId("glass-english")).toContainText(IDEA);
  await expect(page.getByTestId("glass-english")).toContainText("Panic selling overshoots fair value");
  await expect(page.getByTestId("glass-rules")).toContainText("BUY AFTER A DROP");
  await expect(glass.locator("[data-formula=ENTRY]")).toContainText(/\d\d:\d\d:\d\d\.\d{3}: \d+\.\d+ ≤ \d+\.\d+ × 0\.97 = \d+\.\d+ → BUY 500/);
  await expect(glass.locator("[data-formula=SHARPE]")).toContainText("one-second returns");
  await expect(page.getByTestId("glass-code")).toContainText("ENTRY_PCT = 0.03");
  await expect(page.getByTestId("glass-code")).toContainText("not written by an AI");
  await page.keyboard.press("Escape");
  await expect(glass).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("with no network, simple phrasing is understood offline and labelled so, never as the AI", async ({ page }) => {
  await page.route("**/api/interpret", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  await page.keyboard.type(`STRAT ${IDEA}`); // the command bar works too
  await page.keyboard.press("Enter");
  const strat = page.getByTestId("strat");
  await expect(strat).toHaveAttribute("data-phase", "preview");
  await expect(strat).toContainText("UNDERSTOOD OFFLINE · NOT THE AI");
  await expect(strat).not.toContainText("AI's reason");
  await expect(page.getByTestId("command-reply")).toContainText("understood offline");
  await page.keyboard.press("Enter"); // the empty command bar starts the previewed strategy
  await expect(strat).toHaveAttribute("data-phase", "live");
});
