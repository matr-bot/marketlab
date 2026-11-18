import { expect, test, type Page } from "@playwright/test";

// D-074: fixed grid + bottom drawer (STRATEGY | DESK NEWS). Nothing on screen is an empty box.

async function command(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByTestId("command-input").press("Enter");
}

test("free play opens with the drawer collapsed to its tab row", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const drawer = page.getByTestId("drawer");
  await expect(drawer).not.toHaveAttribute("data-open", /.*/);
  expect((await drawer.boundingBox())!.height).toBeLessThan(30);
  for (const id of ["strat", "chat", "news-panel"]) await expect(page.getByTestId(id)).toHaveCount(0);
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
  await expect(drawer).toHaveAttribute("data-mode", "compact");
  await expect(drawer.locator("[data-pane=DESK]")).toBeVisible();
  // Compact (D-077): DESK alone, full width, about five lines, newest on top; no STRATEGY pane.
  await expect(drawer.locator("[data-pane=STRAT]")).toHaveCount(0);
  const desk = (await drawer.locator("[data-pane=DESK]").boundingBox())!;
  expect(desk.height).toBeLessThanOrEqual(115);
  expect(desk.width).toBeGreaterThan(0.95 * (await drawer.boundingBox())!.width);
  await expect(page.getByTestId("chat").locator("[data-kind=headline]")).toContainText("RATES"); // FED is the default RATES release
  const times = await page.getByTestId("chat").locator("> div span:first-child").allTextContents();
  expect(times.length).toBeGreaterThan(1);
  expect([...times].sort().reverse()).toEqual(times); // newest first
  // During the shock the chart keeps at least 60% of the left column.
  await page.waitForTimeout(3_000);
  const share = await page.evaluate(() => {
    const gp = document.querySelector("[data-panel=GP]")!.getBoundingClientRect().height;
    return gp / document.querySelector("[data-panel=GP]")!.parentElement!.getBoundingClientRect().height;
  });
  expect(share).toBeGreaterThanOrEqual(0.6);
  // The STRATEGY tab, opened by hand, gives the two-pane drawer.
  await page.getByTestId("drawer-tab-STRAT").click();
  await expect(drawer).toHaveAttribute("data-mode", "full");
  await expect(drawer.locator("[data-pane=STRAT]")).toBeVisible();
  await expect(drawer.locator("[data-pane=DESK]")).toBeVisible();

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

test("a scenario opens the drawer on NEWS; a fill shows on the ticket's FILLS tab", async ({ page }) => {
  await page.goto("/?scn=rate-shock&seed=4101");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect(page.getByTestId("drawer").locator("[data-pane=NEWS]")).toBeVisible();
  await expect(page.getByTestId("scenario-title")).toBeVisible();
  await command(page, "BUY 100");
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveText("FILLS1", { timeout: 8_000 });
  await command(page, "EXR");
  await expect(page.locator("[data-panel=TKT]")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("exr-row")).toHaveCount(1);
});

test("TKT tabs: ORDER, FILLS (EXR) and OPEN, with resting orders and CANCEL ALL on OPEN (D-075)", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  await command(page, "BUY 100 @ 150.00"); // far below the market: rests
  await command(page, "RUN");
  await expect(page.getByTestId("ticket-tab-OPEN")).toHaveText("OPEN1");
  await page.getByTestId("ticket-tab-OPEN").click();
  await expect(page.getByTestId("open-row")).toHaveText(/B\s*100\s*150\.00/);
  await page.getByTestId("ticket-cancel").click();
  await expect(page.getByTestId("open-row")).toHaveCount(0);
  await expect(page.getByTestId("ticket-tab-OPEN")).toHaveText("OPEN");
  await command(page, "EXR");
  await expect(page.getByTestId("ticket-tab-FILLS")).toHaveAttribute("aria-selected", "true");
  await command(page, "TKT");
  await expect(page.getByTestId("ticket-tab-ORDER")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("ticket-send")).toBeVisible();
});

test("WHO keeps its five rows at all times, zero rows gray, with NET colored by direction (D-076)", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const who = page.getByTestId("who");
  await expect(who.locator("tbody tr")).toHaveCount(5);
  await expect(who.locator("tbody tr td:first-child")).toHaveText(["MM", "NOISE", "VALUE", "PANIC", "YOU"]);
  // YOU has not traded: a zero row, in label gray.
  const you = who.locator("tr[data-type=user]");
  await expect(you).toHaveAttribute("data-zero", "true");
  expect(await you.locator("td").first().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(122, 122, 122)");
  const box = await who.locator("table").boundingBox();
  await page.waitForTimeout(1_500);
  expect(await who.locator("table").boundingBox()).toEqual(box); // no layout shift as the window rolls
  // NET: green when buying exceeds selling, red when selling does.
  const netCell = page.getByTestId("who-net").locator("td").nth(1);
  const text = (await netCell.textContent())!;
  const color = await netCell.evaluate((el) => getComputedStyle(el).color);
  if (text.startsWith("+")) expect(color).toBe("rgb(38, 166, 91)");
  else if (text.startsWith("-")) expect(color).toBe("rgb(229, 72, 77)");
});
