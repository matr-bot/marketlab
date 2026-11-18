import { expect, test, type Page } from "@playwright/test";

// Learn mode (D-072): the default view shows data; ?learn=1 brings back the sentences that left it.

async function command(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByTestId("command-input").press("Enter");
}

test("default view: no explanations, no panel descriptions", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("tape").locator("tbody tr").first()).toBeVisible();
  await expect(page.locator("[data-explain]")).toHaveCount(0);
  await expect(page.getByText("every trade from 77 agents")).toHaveCount(0);
  await expect(page.locator("[data-panel=WHO] header")).toHaveText(/^WHO\s*60S$/);
});

test("Learn mode shows the explanations removed from the default view, and keeps them across a rerun", async ({ page }) => {
  await page.goto("/terminal?seed=187&learn=1");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("every trade from 77 agents");
  await expect(page.locator("[data-panel=WHO] header")).toContainText("WHO MOVED THE PRICE");
  await expect(page.locator("[data-panel=TKT] header")).toContainText("ORDER TICKET");
  await page.getByTestId("drawer-tab-STRAT").click(); // STRAT lives in the drawer (D-074)
  for (const id of ["who.window", "tkt.simulated", "tkt.messages", "strat.intro"]) {
    await expect(page.locator(`[data-explain="${id}"]`).first()).toBeVisible();
  }
  await expect(page.locator('[data-explain="strat.intro"]')).toContainText("rules from a fixed menu");
  await expect(page.getByTestId("who-summary")).toHaveText(/^\d+% of (selling|buying) came from [a-z ]+\.$/);

  // The ticket estimate: bps by default, plus cents per share in Learn mode.
  await expect(page.getByTestId("ticket-preview")).toContainText(/EST AVG [\d,.]+ · SLIP -?\d+\.\d BPS/);
  await expect(page.locator('[data-explain="tkt.estimate"]')).toContainText("¢ per share versus the mid");

  // A rerun keeps the address (and Learn mode).
  await command(page, "RERUN");
  await expect(page).toHaveURL(/learn=1/);
  await expect(page.locator('[data-explain="tkt.simulated"]')).toBeVisible();
});

test("HELP lists the abbreviation dictionary and Learn mode", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await command(page, "HELP");
  const help = page.getByTestId("help");
  await expect(help.getByTestId("help-abbrev")).toContainText("Basis points");
  await expect(help).toContainText("?learn=1");
});
