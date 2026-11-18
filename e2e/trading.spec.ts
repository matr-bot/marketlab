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
  await expect(page.getByTestId("scenario-title")).toBeVisible();
  // Scenario and seed live in SESSION, off the status strip (D-073).
  await page.getByTestId("playback-session").click();
  await expect(page.getByTestId("status-scenario")).toContainText(/rate/i);
  await expect(page.getByTestId("session-seed")).toHaveText("4101");
  await expect(page.getByTestId("session")).toContainText("/?scn=rate-shock&seed=4101");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("session")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a market order fills and the execution report splits its cost", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  // EXR is the ticket's FILLS tab (D-075): no count before any fill.
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveText("FILLS");

  await page.keyboard.type("BUY 500");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ticket-position")).toContainText("500", { timeout: 8_000 });
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveText("FILLS1"); // one unseen fill
  await page.keyboard.type("EXR");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exr-row").first()).toBeVisible();
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveText("FILLS");
  await expect(page.getByTestId("exr-total")).toContainText("SLIP");
  await expect(page.getByTestId("exr-total")).toContainText("IMPACT");
  await page.keyboard.type("TKT");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ticket-send")).toBeVisible();
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
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveText("FILLS"); // no fill

  await page.keyboard.press("Enter"); // the empty bar applies the preview
  await expect(page.getByTestId("news")).toHaveAttribute("data-phase", "applied");
  // In free play the drawer opens on DESK for a headline; the NEWS code shows the headline list (D-074).
  await expect(page.getByTestId("news-panel")).toHaveCount(0);
  await page.keyboard.type("NEWS");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("drawer").locator("[data-pane=NEWS]")).toBeVisible();
  await expect(page.getByTestId("news-panel").getByTestId("headline-row")).toContainText("Buy now, pay later lender collapses");
  await expect(page.getByTestId("news-panel").getByTestId("headline-row")).toContainText("FV -2.0%");
  expect(errors).toEqual([]);
});

test("the status strip is one row with playback on it; SESSION and the speed segment work (D-073)", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 8_000 });
  const bar = page.getByTestId("status-bar");
  await expect(bar).toContainText(/^MLAB\s*[\d,.]+\s*[+-]?[\d.]+ \([+-]?[\d.]+%\)/);
  await expect(page.getByTestId("status-quote")).toContainText(/BID\s*[\d,.]+\s*×\s*[\d,]+\s*ASK\s*[\d,.]+\s*×\s*[\d,]+/); // textContent has no spaces between spans
  await expect(page.getByTestId("status-volume")).toHaveText(/^[\d,.]+[KM]?$/);
  await expect(page.getByTestId("status-volume")).toHaveAttribute("title", /^[\d,]+ shares traded$/);
  // One row, nothing cut: the strip fits its width, and its height is one line.
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height < 40)).toBe(true);
  await expect(page.locator("[data-testid=strip]")).toHaveCount(0);

  await page.getByTestId("playback-speed-4").click();
  await expect(page.getByTestId("playback-speed-4")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("playback-pause").click();
  await expect(page.getByTestId("paused-tag")).toHaveText("● PAUSED");
  await expect(page.getByTestId("playback-pause")).toHaveText("RUN");

  await page.keyboard.type("SESSION");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("session")).toContainText("PRO");
  await page.mouse.click(400, 400); // a click outside closes it
  await expect(page.getByTestId("session")).toHaveCount(0);
});
