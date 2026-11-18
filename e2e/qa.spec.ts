import { expect, test, type Page } from "@playwright/test";

async function command(page: Page, text: string) {
  const input = page.getByTestId("command-input");
  await input.fill(text);
  await input.press("Enter");
}

async function quote(page: Page) {
  return page.getByTestId("ticket-quote").evaluate((row) => {
    const spans = [...row.children];
    return { bid: spans[1].textContent!.trim(), ask: spans[4].textContent!.trim(), mid: spans[7].textContent!.trim() };
  });
}

test("QA #1: status and NEWS use the same scenario-open price", async ({ page }) => {
  await page.goto("/?scn=quiet-buy&seed=4105");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  const title = await page.getByTestId("status-change").getAttribute("title");
  const open = title?.match(/at ([\d,.]+):/)?.[1];
  expect(open).toBeTruthy();
  const stats = await page.getByTestId("scenario-stats").innerText();
  expect(stats).toContain(`OPEN ${open}`);
  const last = (await page.getByTestId("last-price").innerText()).trim();
  expect(stats).toContain(`LAST ${last}`);
  const delta = Math.round((Number(last.replaceAll(",", "")) - Number(open!.replaceAll(",", ""))) * 100);
  const change = (await page.getByTestId("status-change").innerText()).trim();
  expect(change).toContain(`${delta > 0 ? "+" : delta < 0 ? "-" : ""}${(Math.abs(delta) / 100).toFixed(2)}`);
  expect(stats).toContain(`CHG ${change.match(/\(([^)]+)\)/)![1]}`); // "+0.01 (+0.01%)" (D-073)
});

test("QA #2 and #8: a student's resting order is marked in BOOK and its later fill is announced", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  const { ask } = await quote(page);
  await command(page, `SELL 100 @ ${ask}`);
  await command(page, "RUN");
  await expect(page.getByTestId("ticket-message")).toContainText(" resting");
  // No SIDE column (D-071): the student's level is outlined, data-side says which side, and the tooltip says it is theirs.
  const mine = page.getByTestId("book").locator("[data-mine=true]");
  await expect(mine).toHaveAttribute("data-side", "ASK");
  await expect(mine).toHaveAttribute("title", /^Your order: 100 of these/);
  await command(page, "SPEED 8");
  await expect(page.getByTestId("ticket-message")).toContainText(`SELL 100 @ ${ask} filled`, { timeout: 15_000 });
});

test("QA #8: BOOK lists a student's order beyond the visible levels", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const { bid } = await quote(page);
  const farBid = (Number(bid.replaceAll(",", "")) - 1).toFixed(2);
  await command(page, `BUY 100 @ ${farBid}`);
  await expect(page.getByTestId("book-beyond")).toContainText(`BUY 100 @ ${farBid}`);
});

test("QA #3: CHAT does not invent a quiet-market rate at the open", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect.poll(async () => page.getByTestId("sim-clock").innerText()).not.toBe("09:40:00");
  await command(page, "CHAT"); // the desk chat is in the drawer (D-074)
  await expect(page.getByTestId("chat").locator("[data-kind=quiet]")).toHaveCount(0);
  await expect(page.getByTestId("chat")).not.toContainText("0.0 trades a second");
});

test("QA #4: HELP explains offline scope; a CEO mention alone does not become fraud", async ({ page }) => {
  await page.route("**/api/interpret", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "HELP");
  await expect(page.getByTestId("help")).toContainText("only a clear event");
  await expect(page.getByTestId("help")).toContainText("reply says which words matched");
  await page.getByTestId("help").getByRole("button", { name: /CLOSE/ }).click();
  await command(page, "CEO tweets about the company");
  await expect(page.getByTestId("command-reply")).toContainText("only clear events work");
  await expect(page.getByTestId("chart")).toHaveAttribute("data-markers", "");
});

test("QA #7: a half-cent mid is identical in BOOK, TKT and an executed order's EXR", async ({ page }) => {
  await page.goto("/?seed=187&learn=1"); // ARR MID is a Learn-mode column (D-072)
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "SPEED 8");
  await expect.poll(async () => (await quote(page)).mid, { timeout: 8_000 }).toMatch(/\.\d{3}$/);
  await command(page, "PAUSE");
  const { bid, ask, mid } = await quote(page);
  expect(mid).toMatch(/\.\d{3}$/);
  const twiceMidCents = Math.round(Number(bid.replaceAll(",", "")) * 100) + Math.round(Number(ask.replaceAll(",", "")) * 100);
  expect(twiceMidCents % 2).toBe(1);
  expect(mid).toBe(`${(Math.floor(twiceMidCents / 2) / 100).toFixed(2)}5`);
  await expect(page.getByTestId("book")).toContainText(`MID ${mid}`);
  await command(page, "BUY 100");
  await command(page, "RUN");
  await command(page, "EXR"); // the ticket's FILLS tab (D-075)
  const arrivalMid = page.getByTestId("exr-row").first().locator("td").nth(5);
  await expect(arrivalMid).toHaveText(mid);
});

test("QA #9: an oversized positive SHOCK reports the engine's actual cap", async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      if (typeof message === "object" && message !== null && (message as { type?: string }).type === "customShock") {
        (window as Window & { __qaShock?: unknown }).__qaShock = message;
      }
      Reflect.apply(post, this, [message, options]);
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "SHOCK 999");
  expect(await page.evaluate(() => (window as Window & { __qaShock?: unknown }).__qaShock)).toMatchObject({ fairValuePct: 9.99, panicSensitivity: 1 });
  await expect(page.getByTestId("command-reply")).toContainText("capped to the engine's limits");
  await expect(page.getByTestId("command-reply")).toContainText("fair value +999.0% → +20.0%");
});

test("QA #10: the ticket explains blocked SEND, and SCN explains its seed change", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("ticket-qty").fill("abc");
  await expect(page.getByTestId("ticket-send")).toBeDisabled();
  // A short label on screen, the full reason as the tooltip (D-072).
  await expect(page.getByTestId("ticket-preview")).toHaveText("INVALID QTY");
  await expect(page.getByTestId("ticket-preview")).toHaveAttribute("title", /"abc" is not a number of shares/);
  await command(page, "SCN quiet-buy");
  await expect(page.getByTestId("command-reply")).toContainText("It runs on its own seed, 4105 (yours was 187");
  await command(page, "");
  await expect(page.getByTestId("command-reply")).toBeEmpty();
});

for (const height of [720, 600]) {
  test(`QA #6: 1280x${height} keeps the quiet-buy tracker and SEND visible; clipped rows cut hard, no scrollbars`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height });
    await page.goto("/?scn=quiet-buy&seed=4105");
    await expect(page.getByTestId("last-price")).toBeVisible();
    await expect(page.getByTestId("scenario-target")).toBeInViewport();
    await expect(page.getByTestId("ticket-send")).toBeInViewport();
    const book = page.getByTestId("book");
    const rowBounds = await book.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll("[data-side]")].map((row) => {
        const r = row.getBoundingClientRect();
        return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      });
    });
    expect(rowBounds.length).toBeGreaterThan(0);
    expect(rowBounds.every(Boolean)).toBe(true);
    // D-071: a hard cut (no fade mask) and no visible scrollbar inside panels; they still scroll.
    const tape = page.getByTestId("tape").locator("..");
    expect(await tape.evaluate((el) => getComputedStyle(el).maskImage)).toBe("none");
    const newsScroll = page.getByTestId("news-panel").locator(":scope > div").nth(1);
    expect(await newsScroll.evaluate((el) => [getComputedStyle(el).maskImage, getComputedStyle(el).scrollbarWidth, getComputedStyle(el).overflowY])).toEqual(["none", "none", "auto"]);
  });
}
