import { expect, test } from "@playwright/test";

// The student's side of the lab: open an assigned scenario from a link, trade against the crowd,
// read the execution report. No network call, no console error.

function watchErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("a scenario link opens the assigned scenario and seed", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?scn=rate-shock&seed=4101");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("status-scenario")).toContainText(/rate/i);
  await expect(page.getByTestId("scenario-title")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("4101");
  expect(errors).toEqual([]);
});

test("a market order fills and the execution report splits its cost", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("exr-empty")).toBeVisible();

  await page.keyboard.type("BUY 500");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exr-row").first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("exr-total")).toContainText("TOTAL COST");
  await expect(page.getByTestId("exr-total")).toContainText("IMPACT");
  await expect(page.getByTestId("ticket-position")).toContainText("500");
  expect(errors).toEqual([]);
});

test("PAUSE freezes the clock and RUN resumes it; the ticket shows the pause", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  await page.keyboard.type("PAUSE");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("paused-tag")).toBeVisible();
  const clock = page.getByTestId("sim-clock");
  const frozen = await clock.textContent();
  await page.waitForTimeout(800);
  expect(await clock.textContent()).toBe(frozen);
  await page.keyboard.type("RUN");
  await page.keyboard.press("Enter");
  await expect.poll(() => clock.textContent(), { timeout: 3_000 }).not.toBe(frozen);
});

test("HELP opens the command list and Close dismisses it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  await page.keyboard.type("HELP");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("help")).toBeVisible();
  await page.getByTestId("help").getByRole("button").click();
  await expect(page.getByTestId("help")).toHaveCount(0);
});

test("a headline that starts with a command word goes to the AI preview, and NEWS lists it once applied", async ({ page }) => {
  const errors = watchErrors(page);
  // CI has no API key: answer as the AI would (the route's own logic is unit-tested).
  await page.route("**/api/interpret", (route) =>
    route.fulfill({
      json: {
        ok: true,
        source: "ai",
        headline: "Buy now, pay later lender collapses",
        scenario: { shock: { fairValuePct: -0.02, panicSensitivity: 1.4, durationSec: 240, volatilityMultiplier: 1.3, liquidityMultiplier: 0.8 }, reason: "Credit stress hits consumer spending" },
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });

  await page.keyboard.type("Buy now, pay later lender collapses");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("news")).toHaveAttribute("data-phase", "preview"); // not parsed as an order
  await expect(page.getByTestId("exr-empty")).toBeVisible();

  await page.keyboard.press("Enter"); // the empty bar applies the preview
  await expect(page.getByTestId("news")).toHaveAttribute("data-phase", "applied");
  await expect(page.getByTestId("news-panel").getByTestId("headline-row")).toContainText("Buy now, pay later lender collapses");
  await expect(page.getByTestId("news-panel").getByTestId("headline-row")).toContainText("FV -2.0%");
  expect(errors).toEqual([]);
});
