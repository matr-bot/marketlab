import { expect, test } from "@playwright/test";

// D-080: the keymap. Space and F-keys anywhere (not while typing in a field), the ticket's letters with
// focus inside TKT, and the key shown inside each control.

test("Space pauses and resumes; F1 HELP, F2 SESSION, F3 drawer", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.locator("[data-panel=GP]").click({ position: { x: 5, y: 5 } }); // focus out of any field
  await page.keyboard.press(" ");
  await expect(page.getByTestId("paused-tag")).toBeVisible();
  await page.keyboard.press(" ");
  await expect(page.getByTestId("paused-tag")).toHaveCount(0);

  await page.keyboard.press("F1");
  await expect(page.getByTestId("help")).toBeVisible();
  await expect(page.getByTestId("help-keys")).toContainText("PAUSE / RUN");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help")).toHaveCount(0);

  await page.keyboard.press("F2");
  await expect(page.getByTestId("session")).toBeVisible();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("session")).toHaveCount(0);

  const drawer = page.getByTestId("drawer");
  await page.keyboard.press("F3");
  await expect(drawer).toHaveAttribute("data-mode", "full");
  await page.keyboard.press("F3");
  await expect(drawer).toHaveAttribute("data-mode", "closed");
});

test("Space types a space in the command bar instead of pausing", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("command-input").click();
  await page.keyboard.type("BUY 1");
  await expect(page.getByTestId("command-input")).toHaveValue("BUY 1");
  await expect(page.getByTestId("paused-tag")).toHaveCount(0);
});

test("the ticket's letters: B S M L with focus in TKT, and each control shows its key", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("ticket-buy")).toHaveText("BUYB");
  await expect(page.getByTestId("ticket-send")).toContainText("↵");
  await expect(page.getByTestId("playback-pause")).toContainText("␣");
  await page.getByTestId("ticket-qty").click();
  await page.keyboard.press("s");
  await expect(page.getByTestId("ticket-sell")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ticket-qty")).toHaveValue("500"); // the letter did not type into QTY
  await page.keyboard.press("l");
  await expect(page.getByTestId("ticket-limit")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ticket-price")).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByTestId("ticket-market")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("b");
  await expect(page.getByTestId("ticket-buy")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("command-input")).toHaveValue(""); // nothing leaked to the command bar
});

test("timestamps show milliseconds in gray", async ({ page }) => {
  await page.goto("/?seed=187");
  const cell = page.getByTestId("tape").locator("tbody tr").first().locator("td").first();
  await expect(cell).toHaveText(/^\d\d:\d\d:\d\d\.\d{3}$/);
  expect(await cell.locator("span").evaluate((el) => [el.textContent, getComputedStyle(el).color])).toEqual([expect.stringMatching(/^\.\d{3}$/), "rgb(122, 122, 122)"]);
});
