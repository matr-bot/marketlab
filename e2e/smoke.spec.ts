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
  await expect(page.getByTestId("book").getByText("SPREAD")).toBeVisible();
  await expect(page.getByTestId("book").getByText(/^(BID|ASK)$/).first()).toBeVisible();
  await expect(page.getByTestId("ticker").locator("span").first()).toBeVisible();
  await expect(page.getByText(/not running/i)).toHaveCount(0);

  expect(errors).toEqual([]);
});
