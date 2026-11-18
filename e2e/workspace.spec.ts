import { expect, test, type Page } from "@playwright/test";

// D-086: TRADE · STRATEGY workspaces; the equity curve is the engine's per-sim-second record, so the
// same seed and spec give the same curve.

async function command(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByTestId("command-input").press("Enter");
}

async function startStrategy(page: Page) {
  await command(page, "STRAT buy 500 after a 0.3% drop within 60 seconds, stop 1%");
  await page.getByTestId("strat-start").click();
  await expect(page.getByTestId("strat-status")).toContainText("RUNNING", { timeout: 10_000 }); // the engine has it
}

/** The first `n` equity points, once there are that many. */
async function firstPoints(page: Page, n: number): Promise<string[]> {
  const curve = page.getByTestId("equity");
  await expect.poll(async () => ((await curve.getAttribute("data-equity")) ?? "").split(",").filter(Boolean).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  return (await curve.getAttribute("data-equity"))!.split(",").slice(0, n);
}

test("tabs and ⌥1 / ⌥2 switch workspaces; STRATEGY has the builder, the glass box, results and the price", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("workspace-TRADE")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("workspace-STRATEGY").click();
  const ws = page.getByTestId("strategy-workspace");
  await expect(ws).toBeVisible();
  for (const pane of ["builder", "glass", "results"]) await expect(ws.locator(`[data-pane=${pane}]`)).toBeVisible();
  await expect(ws.getByTestId("ws-price")).toContainText("MLAB");
  await expect(page.locator("[data-panel=GP]")).toHaveCount(0);
  await page.keyboard.press("Alt+Digit1");
  await expect(page.locator("[data-panel=GP]")).toBeVisible();
  await page.keyboard.press("Alt+Digit2");
  await expect(ws).toBeVisible();
});

test("the glass box follows the preview as it is edited, before START", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.keyboard.press("Alt+Digit2");
  await command(page, "STRAT buy 500 after a 3% drop within 60 seconds");
  await expect(page.getByTestId("glass-code")).toContainText("ENTRY_PCT = 0.03");
  const pct = page.locator("[data-field=pct]");
  await pct.fill("2");
  await expect(page.getByTestId("glass-code")).toContainText("ENTRY_PCT = 0.02");
});

test("the equity curve fills in TRADE too, and BACKTEST opens STRATEGY", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await startStrategy(page);
  await command(page, "SPEED 8");
  await page.waitForTimeout(2_000); // sampled while TRADE is showing
  await page.getByTestId("strat-reveal").click();
  await expect(page.getByTestId("strategy-workspace")).toBeVisible();
  expect((await firstPoints(page, 5)).every((v) => /^-?\d+(\.\d+)?$/.test(v))).toBe(true);
  await expect(page.getByTestId("ws-stats")).toContainText("SHARPE");
});

test("RERUN with the same seed gives an identical equity curve", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await startStrategy(page);
  await page.keyboard.press("Alt+Digit2");
  await command(page, "RERUN"); // the strategy starts again at the open
  await command(page, "SPEED 8");
  const first = await firstPoints(page, 40);
  await command(page, "RERUN");
  await command(page, "SPEED 8");
  const second = await firstPoints(page, 40);
  expect(second).toEqual(first);
});

test("the strip stays one row with the workspace tabs, paused included: its last control is inside it (D-086)", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  await expect(page.getByTestId("paused-tag")).toBeVisible();
  const fit = await page.getByTestId("status-bar").evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const last = [...bar.querySelectorAll("button")].at(-1)!.getBoundingClientRect();
    return { inside: last.right <= box.right && last.top >= box.top && last.bottom <= box.bottom, height: box.height };
  });
  expect(fit.inside).toBe(true);
  expect(fit.height).toBeLessThan(44);
});

