import { expect, test, type Page } from "@playwright/test";

async function command(page: Page, value: string) {
  const input = page.getByTestId("command-input");
  await input.fill(value);
  await input.press("Enter");
}

test("RATES uses the FED calibration, shares its digest gate, and reports the executed 30 s overshoot", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "NEWS");
  await command(page, "RATES +0.75");
  await expect(page.getByTestId("command-reply")).toContainText("RATES +0.75 vs +0.25 expected → fair value -3.0%");
  await command(page, "JOBS 150K");
  await expect(page.getByTestId("command-reply")).toContainText("still digesting");
  const card = page.getByTestId("release-card");
  await expect(card).toContainText("FAIR VALUE -3.0% · 30 s price reaction pending");
  await expect(card).toContainText("PANIC 1.50× · VOLATILITY 1.00× · LIQUIDITY 1.00×");
  await expect(page.getByTestId("chat")).toContainText("RATES +0.75 vs +0.25 expected → fair value -3.0%");
  await command(page, "SPEED 8");
  await expect(card).toContainText(/FAIR VALUE -3\.0% · PRICE -\d+\.\d{2}% IN 30 S \(OVERSHOOT\)/, { timeout: 15_000 });
  const move = (await card.innerText()).match(/PRICE (-\d+\.\d{2})% IN 30 S/);
  expect(move).not.toBeNull();
  expect(Number(move![1])).toBeLessThan(-3);
  const color = await card.locator("p").first().evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(31, 214, 96)");
  expect(color).not.toBe("rgb(255, 64, 64)");
});

test("macro-day hides actuals before release, then reveals a card and its 30 s price move", async ({ page }) => {
  await page.goto("/?scn=macro-day&seed=4106");
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
  await expect(card).toContainText(/FAIR VALUE -1\.2% · PRICE -\d+\.\d{2}% IN 30 S/, { timeout: 12_000 });
});

test("HELP and invalid release values give a concrete command example", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "HELP");
  await expect(page.getByTestId("help")).toContainText("CPI 3.4 · JOBS 150K · GDP 2.3 · RATES +0.75");
  await page.getByTestId("help").getByRole("button", { name: /CLOSE/ }).click();
  await command(page, "JOBS 150X");
  await expect(page.getByTestId("command-reply")).toContainText("e.g. JOBS 150K");
  await command(page, "RATES +0.75 extra");
  await expect(page.getByTestId("command-reply")).toContainText("e.g. RATES +0.75");
});
