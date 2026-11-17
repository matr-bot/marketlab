import { expect, test, type Page } from "@playwright/test";

// D-074: fixed grid + bottom drawer (STRATEGY | DESK NEWS). Nothing on screen is an empty box.

async function command(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByTestId("command-input").press("Enter");
}

test("free play opens with the drawer collapsed to its tab row, and no empty EXR", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const drawer = page.getByTestId("drawer");
  await expect(drawer).not.toHaveAttribute("data-open", /.*/);
  expect((await drawer.boundingBox())!.height).toBeLessThan(30);
  for (const id of ["strat", "chat", "news-panel"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.locator("[data-panel=EXR]")).toHaveCount(0);
  await command(page, "EXR");
  await expect(page.getByTestId("command-reply")).toHaveText("EXR · NO FILLS YET");
  // Grid panels: chart, tape, WHO, book, ticket. GP is active (amber border).
  for (const code of ["GP", "TAPE", "WHO", "BOOK", "TKT"]) await expect(page.locator(`[data-panel=${code}]`)).toBeVisible();
  await expect(page.locator("[data-panel=GP]")).toHaveAttribute("data-active", "true");
});

test("a headline opens the drawer on DESK; collapsed, it stays shut until the next headline", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const drawer = page.getByTestId("drawer");
  await command(page, "SPEED 8");
  await command(page, "FED");
  await expect(drawer).toHaveAttribute("data-open", "true");
  await expect(drawer.locator("[data-pane=DESK]")).toBeVisible();
  await expect(page.getByTestId("chat").locator("[data-kind=headline]")).toContainText("RATES"); // FED is the default RATES release
  await expect(drawer.locator("[data-pane=STRAT]")).toBeVisible(); // the strategy pane sits beside it

  // Collapse: panic and vacuum messages during the crash do not reopen it.
  await page.getByTestId("drawer-toggle").click();
  await expect(drawer).not.toHaveAttribute("data-open", /.*/);
  await page.waitForTimeout(2_500);
  await expect(drawer).not.toHaveAttribute("data-open", /.*/);
  // The next headline does (once the market has digested FED).
  await expect
    .poll(
      async () => {
        await command(page, "BEAT");
        return drawer.getAttribute("data-open");
      },
      { timeout: 15_000, intervals: [1_000] },
    )
    .toBe("true");
});

test("STRATEGY, DESK and NEWS tabs, and the function codes route to them", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const drawer = page.getByTestId("drawer");
  await page.getByTestId("drawer-tab-STRAT").click();
  await expect(page.getByTestId("strat")).toBeVisible();
  await page.getByTestId("drawer-tab-NEWS").click();
  await expect(drawer.locator("[data-pane=NEWS]")).toBeVisible();
  await command(page, "CHAT");
  await expect(drawer.locator("[data-pane=DESK]")).toBeVisible();
  await expect(drawer).toHaveAttribute("data-active", "true");
  await command(page, "WHO");
  await expect(page.locator("[data-panel=WHO]")).toHaveAttribute("data-active", "true");
  await expect(page.locator("[data-panel=GP]")).not.toHaveAttribute("data-active", /.*/);
});

test("a scenario opens the drawer on NEWS; the first fill brings EXR", async ({ page }) => {
  await page.goto("/?scn=rate-shock&seed=4101");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("drawer").locator("[data-pane=NEWS]")).toBeVisible();
  await expect(page.getByTestId("scenario-title")).toBeVisible();
  await command(page, "BUY 100");
  await expect(page.locator("[data-panel=EXR]")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("exr-row")).toHaveCount(1);
});
