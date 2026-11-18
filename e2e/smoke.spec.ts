import { expect, test } from "@playwright/test";

// The live-site promise (CLAUDE.md): the market is already running when the page loads, prices
// move on their own, and nothing is broken. Runs in CI on every push.

test("the market is alive on load: prices change within 5 seconds, with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/terminal");
  const last = page.getByTestId("last-price");
  await expect(last).toBeVisible({ timeout: 5_000 });
  const opening = await last.textContent();
  await expect.poll(() => last.textContent(), { timeout: 5_000, intervals: [100] }).not.toBe(opening);

  // The panels that have shipped are on screen, with engine data in them.
  await expect(page.getByTestId("sim-clock")).toHaveText(/^09:4\d:\d\d$/); // warmed up 10 minutes from 09:30; whole seconds on the strip (D-073)
  await expect(page.locator("[data-panel=GP] canvas")).toBeVisible();
  await expect(page.getByTestId("tape").locator("tbody tr").first()).toBeVisible();
  // TAPE (D-067, refined by D-068): a price is green when it ticked up and red when it ticked down;
  // the side label is neutral label gray, never green or red.
  const GREEN = "rgb(38, 166, 91)";
  const RED = "rgb(229, 72, 77)";
  const LABEL = "rgb(122, 122, 122)";
  const rows = await page.getByTestId("tape").locator("tbody tr").evaluateAll((trs) =>
    (trs as HTMLTableRowElement[]).map((r) => ({ aggressor: r.getAttribute("data-aggressor"), tick: r.getAttribute("data-tick"), price: getComputedStyle(r.cells[1]).color, labelColor: getComputedStyle(r.cells[3]).color, label: r.cells[3].textContent })),
  );
  for (const r of rows) {
    expect(r.label).toBe(r.aggressor === "buy" ? "B" : "S");
    expect(r.price).toBe(r.tick === "up" ? GREEN : RED);
    expect(r.labelColor).toBe(LABEL);
  }
  await expect(page.getByTestId("book").getByText("SPREAD")).toBeVisible();
  // BOOK's depth bars are the side of the book in muted tints: bids green, asks red (D-068).
  const barColors = await page.getByTestId("book").locator("[data-side] [aria-hidden]").evaluateAll((els) => els.map((e) => [e.parentElement!.getAttribute("data-side"), getComputedStyle(e).backgroundColor]));
  expect(barColors.length).toBeGreaterThan(0);
  for (const [side, c] of barColors) expect(c).toBe(side === "BID" ? "rgba(38, 166, 91, 0.18)" : "rgba(229, 72, 77, 0.18)");
  // The same number of levels on each side, centered on the spread.
  const book = page.getByTestId("book");
  const levels = Number(await book.getAttribute("data-levels"));
  expect(levels).toBeGreaterThan(0); // responsive layouts may fit fewer levels
  await expect(book.locator("[data-side=ASK]")).toHaveCount(levels);
  await expect(book.locator("[data-side=BID]")).toHaveCount(levels);
  // Depth bars: one per level; the largest level's bar is the widest, half the row (D-071).
  const bars = await page.locator("[data-testid=book] [data-side] > [aria-hidden]").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
  expect(bars.length).toBeGreaterThan(0);
  expect(bars).toContain("50%");
  await expect(page.getByTestId("status-bar")).toContainText("MLAB");
  await expect(page.getByTestId("status-bar").getByText("SIMULATED", { exact: true })).toBeVisible();
  // Data only by default (D-072): no explanations until Learn mode.
  await expect(page.locator("[data-explain]")).toHaveCount(0);
  await expect(page.locator("[data-panel=GP] header")).toHaveText(/^GP\s*MLAB · 10S$/); // code + right-aligned detail (D-071)
  await expect(page.getByText(/not running/i)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("the offline headline FED, typed into the command bar, moves the market with no network call", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  const requests: string[] = [];
  await page.goto("/terminal");
  const last = page.getByTestId("last-price");
  await expect(last).toBeVisible({ timeout: 5_000 });
  page.on("request", (r) => requests.push(r.url()));

  const price = async () => Number((await last.textContent())!.replace(/,/g, ""));
  const before = await price();
  await page.keyboard.type("FED"); // keyboard first: typing anywhere goes to the command bar
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("command-reply")).toHaveText("FED · Fed surprise hike 75bps");
  await expect(page.getByTestId("chart")).toHaveAttribute("data-markers", "FED");
  await expect.poll(price, { timeout: 10_000, intervals: [250] }).toBeLessThanOrEqual(before * 0.99);
  // In the crash, BOOK is never blank: levels on at least one side (an empty side says NO BIDS / NO ASKS).
  for (let i = 0; i < 10; i++) {
    expect(await page.getByTestId("book").locator("[data-side]").count()).toBeGreaterThan(0);
    await page.waitForTimeout(200);
  }

  // A preset never touches the network (only free-text headlines go to /api/interpret, D-052).
  expect(requests.filter((u) => !u.startsWith("data:") && !u.includes("/_next/"))).toEqual([]);

  await page.keyboard.type("MOON");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-reply")).not.toHaveText("FED · Fed surprise hike 75bps"); // answered, whatever the AI says
  await expect(last).toBeVisible(); // an unknown word never stops the market
  expect(errors).toEqual([]);
});

test("typing FED 30 times quickly never freezes the page (D-051)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/terminal");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 5_000 });

  for (let i = 0; i < 30; i++) {
    await page.keyboard.type("FED");
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("command-reply")).toContainText("still digesting");

  // Still alive: the sim clock keeps moving and so do prices.
  const clock = page.getByTestId("sim-clock");
  const before = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 3_000 }).not.toBe(before);
  const price = await page.getByTestId("last-price").textContent();
  await expect.poll(() => page.getByTestId("last-price").textContent(), { timeout: 5_000 }).not.toBe(price);

  // Bounded work: one marker per accepted headline.
  const markers = (await page.getByTestId("chart").getAttribute("data-markers"))!.split("|").filter(Boolean);
  expect(markers.length).toBeGreaterThanOrEqual(1);
  expect(markers.length).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test("a custom headline: the AI's params preview, Enter applies, the price reacts, CHAT and WHO explain it (D-052)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  // CI has no API key: answer as the AI would (the route's own logic is unit-tested).
  await page.route("**/api/interpret", (route) =>
    route.fulfill({
      json: {
        ok: true,
        source: "ai",
        headline: "Chip supplier halts all deliveries to MLAB",
        scenario: { shock: { fairValuePct: -0.04, panicSensitivity: 1.8, durationSec: 300, volatilityMultiplier: 1.5, liquidityMultiplier: 0.6 }, reason: "Supply loss cuts expected earnings" },
      },
    }),
  );
  await page.goto("/terminal?learn=1"); // Learn mode: WHO says in words who moved the price (D-072)
  const last = page.getByTestId("last-price");
  await expect(last).toBeVisible({ timeout: 5_000 });
  const price = async () => Number((await last.textContent())!.replace(/,/g, ""));

  await page.keyboard.type("Chip supplier halts all deliveries to MLAB");
  await page.keyboard.press("Enter");
  const news = page.getByTestId("news");
  await expect(news).toHaveAttribute("data-phase", "preview");
  await expect(news.locator("[data-field=fairValuePct]")).toHaveValue("-4");
  await expect(news.locator("[data-field=liquidityMultiplier]")).toHaveValue("0.6");
  await expect(news).toContainText("AI's reason: “Supply loss cuts expected earnings”");

  const before = await price();
  await page.keyboard.press("Enter"); // Enter on the empty command bar applies the preview
  await expect(news).toHaveAttribute("data-phase", "applied");
  await expect(page.getByTestId("command-reply")).toHaveText("NEWS · Chip supplier halts all deliveries to MLAB");
  await expect.poll(price, { timeout: 10_000, intervals: [250] }).toBeLessThanOrEqual(before * 0.99);

  await expect(page.getByTestId("chat").locator("[data-kind=headline]")).toContainText("Chip supplier halts all deliveries to MLAB · fair value -4.0%");
  await expect(page.getByTestId("who-summary")).toHaveText(/^\d+% of (selling|buying) came from [a-z ]+\.$/);
  // WHO (D-076): five fixed rows, % of all aggressive volume summing to 100, NET = buying − selling.
  // One snapshot of the table: the live window rolls between separate reads.
  const { rows, net } = await page.getByTestId("who").evaluate((who) => {
    const num = (t: string | null) => Number(t!.replace(/,/g, ""));
    const trs = [...who.querySelectorAll("tbody tr")] as HTMLTableRowElement[];
    return {
      rows: trs.map((r) => ({ label: r.cells[0].textContent, sell: num(r.cells[1].textContent), buy: num(r.cells[2].textContent), pct: num(r.cells[3].textContent) })),
      net: num(who.querySelector("[data-testid=who-net] td:nth-child(2)")!.textContent),
    };
  });
  expect(rows.map((r) => r.label)).toEqual(["MM", "NOISE", "VALUE", "PANIC", "YOU"]);
  expect(rows.reduce((s, r) => s + r.pct, 0)).toBe(100);
  expect(net).toBe(rows.reduce((s, r) => s + r.buy - r.sell, 0));
  expect(errors).toEqual([]);
});

test("with the AI route down, a clear headline falls back to its offline preset and others have no effect (D-052)", async ({ page }) => {
  await page.route("**/api/interpret", (route) => route.abort());
  await page.goto("/terminal");
  await expect(page.getByTestId("last-price")).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type("Aliens land in Ohio");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-reply")).toHaveText("AI unavailable · offline, only clear events work (a rate hike, fraud, a beat, a miss, a downgrade), or type FED, CEO, BEAT or DOWNGRADE on its own.");
  await page.keyboard.type("MLAB earnings miss, cuts guidance");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-reply")).toHaveText("AI unavailable · “miss” matched the offline preset DOWNGRADE.");
  await expect(page.getByTestId("news")).toHaveAttribute("data-phase", "preview");
});
