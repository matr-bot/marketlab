import { expect, test, type Page } from "@playwright/test";
import { computed } from "./colors";

async function command(page: Page, value: string) {
  const input = page.getByTestId("command-input");
  await input.fill(value);
  await input.press("Enter");
}

test("RATES uses the FED calibration, shares its digest gate, and reports peak plus 30 s move", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "NEWS");
  await command(page, "RATES +0.75");
  await expect(page.getByTestId("command-reply")).toContainText("RATES +0.75 vs +0.25 expected → fair value -3.0%");
  await command(page, "JOBS 150K");
  await expect(page.getByTestId("command-reply")).toContainText("still digesting");
  const card = page.getByTestId("release-card");
  await expect(card).toContainText("FAIR VALUE -3.0% · 30 s reaction pending");
  await expect(card).toContainText("PANIC 1.50× · VOLATILITY 1.00× · LIQUIDITY 1.00×");
  // The drawer shows NEWS, so the desk message waits as an unread count on DESK; CHAT shows it (D-074).
  await expect(page.getByTestId("drawer-unread-DESK")).toBeVisible();
  await command(page, "CHAT");
  await expect(page.getByTestId("chat")).toContainText("RATES +0.75 vs +0.25 expected → fair value -3.0%");
  await expect(page.getByTestId("drawer-unread-DESK")).toHaveCount(0);
  await command(page, "NEWS");
  await command(page, "SPEED 8");
  await expect(card).toContainText(/FAIR VALUE -3\.0% · PEAK -\d+\.\d{2}% · AT 30 S -\d+\.\d{2}% \(OVERSHOOT\)/, { timeout: 15_000 });
  const moves = (await card.innerText()).match(/PEAK (-\d+\.\d{2})% · AT 30 S (-\d+\.\d{2})%/);
  expect(moves).not.toBeNull();
  expect(Number(moves![1])).toBeLessThan(-3.3);
  expect(Number(moves![2])).toBeLessThan(0);
  const color = await card.locator("p").first().evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe(computed("up"));
  expect(color).not.toBe(computed("down"));
});

test("macro-day hides actuals before release, then reveals a card and its 30 s price move", async ({ page }) => {
  await page.goto("/terminal?scn=macro-day&seed=4106");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "NEWS");
  const calendar = page.getByTestId("release-calendar");
  const cpi = calendar.locator('[data-indicator="CPI"]');
  await expect(cpi).toContainText("09:40:30");
  await expect(cpi).toContainText("FORECAST 3.1%");
  await expect(cpi).toContainText(/IN 0:\d\d/);
  await expect(calendar).not.toContainText("3.4%");
  await expect(page.getByTestId("news-panel")).toContainText("compare the forecast with your expectation");
  await command(page, "SPEED 8");
  await expect(cpi).toContainText("RELEASED", { timeout: 12_000 });
  const card = page.getByTestId("release-card");
  await expect(card).toContainText("CPI 3.4% vs 3.1% expected → fair value -1.2%");
  await expect(card).toContainText("PANIC 1.38× · VOLATILITY 1.30× · LIQUIDITY 0.85×");
  await expect(card).toContainText(/FAIR VALUE -1\.2% · PEAK -\d+\.\d{2}% · AT 30 S -\d+\.\d{2}%/, { timeout: 12_000 });
});

test("demo keeps STRAT usable beside a hidden-actual calendar, then reveals both releases", async ({ page }) => {
  test.setTimeout(45_000);
  await page.route("**/api/interpret", (route) => route.abort());
  await page.goto("/terminal?scn=demo&seed=4107");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  await expect(page.getByTestId("strat")).toBeVisible();
  const calendar = page.getByTestId("release-calendar");
  const cpi = calendar.locator('[data-indicator="CPI"]');
  const rates = calendar.locator('[data-indicator="RATES"]');
  await expect(cpi).toContainText("09:40:10");
  await expect(rates).toContainText("09:42:00");
  await expect(cpi).toContainText("FORECAST 3.1%");
  await expect(rates).toContainText("FORECAST +0.25");
  await expect(calendar).not.toContainText("3.4%");
  await expect(calendar).not.toContainText("+0.75");
  await command(page, "STRAT Buy after a quick 3% drop because panic sellers overshoot");
  await expect(page.getByTestId("strat-start")).toBeVisible();
  await page.getByTestId("strat-start").click();
  await command(page, "SPEED 8");
  await command(page, "RUN");
  await expect(cpi).toContainText("RELEASED", { timeout: 10_000 });
  const card = page.getByTestId("release-card");
  await expect(card).toContainText("CPI 3.4% vs 3.1% expected");
  await expect(card).toContainText(/PEAK -\d+\.\d{2}% · AT 30 S -\d+\.\d{2}%/, { timeout: 10_000 });
  await expect(rates).toContainText("RELEASED", { timeout: 24_000 });
  await expect(card).toContainText("RATES +0.75 vs +0.25 expected");
  await expect(card).toContainText(/PEAK -\d+\.\d{2}% · AT 30 S -\d+\.\d{2}%/, { timeout: 10_000 });
});

test("HELP and invalid release values give a concrete command example", async ({ page }) => {
  await page.goto("/terminal");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "HELP");
  await expect(page.getByTestId("help")).toContainText("CPI 3.4 · JOBS 150K · GDP 2.3 · RATES +0.75");
  await page.getByTestId("help").getByRole("button", { name: /CLOSE/ }).click();
  await command(page, "JOBS 150X");
  await expect(page.getByTestId("command-reply")).toContainText("e.g. JOBS 150K");
  await command(page, "RATES +0.75 extra");
  await expect(page.getByTestId("command-reply")).toContainText("e.g. RATES +0.75");
});
