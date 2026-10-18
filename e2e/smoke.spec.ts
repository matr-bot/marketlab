import { expect, test } from "@playwright/test";

// The live-site promise (CLAUDE.md): the market is already running when the page loads, prices
// move on their own, and nothing is broken. Runs in CI on every push.

test("the market is alive on load: prices change within 5 seconds, with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  const last = page.getByTestId("last-price");
  await expect(last).toBeVisible({ timeout: 5_000 });
  const opening = await last.textContent();
  await expect.poll(() => last.textContent(), { timeout: 5_000, intervals: [100] }).not.toBe(opening);

  // The panels that have shipped are on screen, with engine data in them.
  await expect(page.getByTestId("sim-clock")).toHaveText(/^09:4\d:\d\d\.\d00$/); // warmed up 10 minutes from 09:30
  await expect(page.locator("[data-panel=GP] canvas")).toBeVisible();
  await expect(page.getByTestId("tape").locator("tbody tr").first()).toBeVisible();
  // Every TAPE print's color agrees with its AGGRESSOR label.
  const sides = await page.getByTestId("tape").locator("tbody tr").evaluateAll((rows) =>
    (rows as HTMLTableRowElement[]).map((r) => [r.getAttribute("data-aggressor"), getComputedStyle(r.cells[1]).color, getComputedStyle(r.cells[3]).color, r.cells[3].textContent]),
  );
  for (const [aggressor, priceColor, labelColor, label] of sides) {
    expect(label).toBe(aggressor === "buy" ? "BUYER" : "SELLER");
    expect(priceColor).toBe(labelColor);
  }
  expect(new Set(sides.map((s) => s[1])).size).toBe(2); // both sides appear, in two colors
  await expect(page.getByTestId("book").getByText("SPREAD")).toBeVisible();
  await expect(page.getByTestId("book").getByText(/^(BID|ASK)$/).first()).toBeVisible();
  // The same number of levels on each side, centered on the spread.
  const book = page.getByTestId("book");
  const levels = Number(await book.getAttribute("data-levels"));
  expect(levels).toBeGreaterThan(5);
  await expect(book.locator("[data-side=ASK]")).toHaveCount(levels);
  await expect(book.locator("[data-side=BID]")).toHaveCount(levels);
  // Depth bars: one per level, the largest level's bar is full width.
  const bars = await page.locator("[data-testid=book] [data-side] > [aria-hidden]").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
  expect(bars.length).toBeGreaterThan(0);
  expect(bars).toContain("100%");
  await expect(page.getByTestId("ticker").locator("span").first()).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("MLAB");
  await expect(page.getByTestId("status-bar").getByText("SIMULATED", { exact: true })).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("Simulated market · every trade from 77 agents");
  await expect(page.locator("[data-panel=GP]")).toContainText("MLAB PRICE · 10S CANDLES");
  await expect(page.getByText(/not running/i)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("the offline headline FED, typed into the command bar, moves the market with no network call", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  const requests: string[] = [];
  await page.goto("/");
  const last = page.getByTestId("last-price");
  await expect(last).toBeVisible({ timeout: 5_000 });
  page.on("request", (r) => requests.push(r.url()));

  const price = async () => Number((await last.textContent())!.replace(/,/g, ""));
  const before = await price();
  await page.keyboard.type("FED"); // keyboard first: typing anywhere goes to the command bar
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("command-reply")).toHaveText("FED · Fed surprise hike 75bps");
  await expect(page.getByTestId("ticker").locator("[data-headline=FED]")).toHaveCount(1);
  await expect(page.getByTestId("chart")).toHaveAttribute("data-markers", "FED");
  await expect.poll(price, { timeout: 10_000, intervals: [250] }).toBeLessThanOrEqual(before * 0.99);
  // In the crash, BOOK is never blank: levels on at least one side (an empty side says NO BIDS / NO ASKS).
  for (let i = 0; i < 10; i++) {
    expect(await page.getByTestId("book").locator("[data-side]").count()).toBeGreaterThan(0);
    await page.waitForTimeout(200);
  }

  await page.keyboard.type("MOON");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-reply")).toContainText('Unknown command "MOON"');
  await expect(last).toBeVisible(); // a bad command never stops the market

  expect(requests.filter((u) => !u.startsWith("data:") && !u.includes("/_next/"))).toEqual([]);
  expect(errors).toEqual([]);
});
