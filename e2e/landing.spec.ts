import { expect, test } from "@playwright/test";

// D-083: the landing page at "/": one amber action, layers that open in place, a keyboard launcher.

test("the landing page: hero line from the crowd, layers open in place, no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("hero-line")).toHaveText("77 trading agents, one real order book, every price explainable.");
  await expect(page.getByTestId("open-terminal")).toHaveAttribute("href", "/terminal?scn=free&seed=187");
  // Amber appears once on the page: OPEN TERMINAL.
  const amber = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => { const cs = getComputedStyle(e); return cs.backgroundColor === "rgb(245, 166, 35)" || cs.color === "rgb(245, 166, 35)"; }).length);
  expect(amber).toBe(1);
  // The model behind each trader type, with its citation, opens in place.
  const panic = page.getByTestId("agents").locator("li[data-type=panic] details");
  await expect(panic).not.toHaveAttribute("open", /.*/);
  await panic.locator("summary").click();
  await expect(panic).toContainText("Granovetter, M. (1978)");
  await page.getByTestId("agents").locator("li[data-type=noise] summary").click();
  await expect(page.getByTestId("agents").locator("li[data-type=noise]")).toContainText("Gode, D. K. & Sunder, S. (1993)");
  await expect(page.getByTestId("build")).toHaveText(/^v\d+\.\d+\.\d+ · ([0-9a-f]{7}|dev) · HELP$/);
  expect(errors).toEqual([]);
});

test("the launcher: arrows pick a scenario, Enter starts the session with its seed and Learn mode", async ({ page }) => {
  await page.goto("/");
  const seed = page.getByTestId("launcher-seed");
  await expect(seed).toHaveValue(/^\d+$/);
  await seed.fill("4242");
  await page.getByTestId("launcher-learn").check();
  const list = page.getByTestId("scenario-list");
  await list.focus();
  await page.keyboard.press("ArrowDown"); // Rate shock
  await expect(list.locator("[aria-selected=true]")).toHaveAttribute("data-id", "rate-shock");
  await expect(page.getByTestId("start-session")).toHaveAttribute("href", "/terminal?scn=rate-shock&seed=4242&learn=1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terminal\?scn=rate-shock&seed=4242&learn=1$/);
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("playback-session").click();
  await expect(page.getByTestId("session-seed")).toHaveText("4242");
  await expect(page.getByTestId("session")).toContainText("LEARN");
});

test("an invalid seed cannot start a session; Enter outside the launcher opens the terminal", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("launcher-seed").fill("abc");
  await expect(page.getByTestId("start-session")).toHaveAttribute("aria-disabled", "true");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terminal\?scn=free&seed=187$/);
});

test("the hero replays the Fed hike from the real engine: calm, HIKE, panic in WHO, then loops (D-084)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const replay = page.getByTestId("replay");
  await expect(replay).toContainText("REPLAY · SEED 187");
  const chart = replay.getByTestId("chart");
  await expect(chart).toHaveAttribute("data-markers", "", { timeout: 5_000 }); // calm before the hike
  await expect(chart).toHaveAttribute("data-markers", "HIKE", { timeout: 15_000 });
  // The log beside it is the desk's own lines for this run, and the chart shows about three minutes.
  await expect(page.getByTestId("replay-log")).toContainText("RATES +0.75", { timeout: 5_000 });
  const span = await chart.getAttribute("data-markers");
  expect(span).toBe("HIKE");
  const panic = replay.locator("tr[data-type=panic]");
  await expect(panic).not.toHaveAttribute("data-zero", /.*/, { timeout: 10_000 }); // panic sellers traded
  await expect(replay).toHaveAttribute("data-loop", "1", { timeout: 30_000 }); // a new loop: a RERUN
  await expect(chart).toHaveAttribute("data-markers", "", { timeout: 5_000 });
  await expect(page.getByTestId("replay-log")).not.toContainText("RATES +0.75"); // the log restarts with the loop
});

test("PROOF shows exactly the numbers in proof.json, and its claims with the tests behind them (D-085)", async ({ page, request }) => {
  const proof = await (await request.get("/proof.json")).json();
  await page.goto("/");
  const stats = page.getByTestId("proof-stats");
  await expect(stats.locator("[data-stat=unit]")).toHaveText(`${proof.unit.passed.toLocaleString("en-US")} UNIT TESTS PASSED`);
  await expect(stats.locator("[data-stat=browser]")).toHaveText(`${proof.browser.listed} BROWSER TESTS · CI`);
  if (proof.mutation?.score != null) await expect(stats.locator("[data-stat=mutation]")).toHaveText(`MUTATION ${proof.mutation.score.toFixed(1)}% · ENGINE`);
  else await expect(stats.locator("[data-stat=mutation]")).toHaveCount(0);
  for (const c of proof.claims) {
    const row = page.getByTestId("proof-claims").locator(`[data-claim=${c.id}]`);
    await expect(row).toContainText(c.label);
    for (const t of c.tests) await expect(row).toContainText(`${t.name} ✓`); // named, from proof.json
  }
  expect(proof.unit.failed).toBe(0);
  await page.getByTestId("proof-layer").locator("summary").click();
  await expect(page.getByTestId("proof-layer")).toContainText(proof.claims[0].tests[0].title);
  await expect(page.getByTestId("proof-repo")).toHaveAttribute("href", proof.repo);
});
