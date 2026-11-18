import { expect, test, type Page } from "@playwright/test";

// D-079: GP's crosshair and OHLCV readout, headline markers with their full text on hover, and the
// double-click zoom of the price axis to the last two minutes.

async function command(page: Page, text: string) {
  await page.getByTestId("command-input").fill(text);
  await page.getByTestId("command-input").press("Enter");
}

test("hovering a candle shows its OHLCV; a click still picks it for WHO", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "PAUSE");
  const chart = page.getByTestId("chart");
  const ohlcv = page.getByTestId("chart-ohlcv");
  await expect(ohlcv).toHaveText(/^09:\d\d:\d\d\s*O [\d,.]+\s*H [\d,.]+\s*L [\d,.]+\s*C [\d,.]+\s*V [\d,]+$/);
  const latest = await ohlcv.getAttribute("data-start");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await expect(ohlcv).not.toHaveAttribute("data-start", latest!); // an older candle
  const hovered = await ohlcv.getAttribute("data-start");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await expect(chart).toHaveAttribute("data-selected", hovered!);
  await expect(page.locator("[data-panel=WHO] header")).toContainText("ESC");
});

test("a headline marker shows its full headline on hover; double-click zooms the price axis, again resets", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await command(page, "CEO");
  await expect(page.getByTestId("chart")).toHaveAttribute("data-markers", "CEO");
  await page.waitForTimeout(1_500);
  await command(page, "PAUSE");
  const chart = page.getByTestId("chart");
  const box = (await chart.boundingBox())!;
  // The marker is at the newest candles, near the right edge of the plot: sweep for it.
  const tip = page.getByTestId("chart-marker-tip");
  for (let x = box.x + box.width - 70; x > box.x + box.width - 160 && (await tip.count()) === 0; x -= 2) await page.mouse.move(x, box.y + 60);
  await expect(tip).toContainText(/CEO|chief executive/i);

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(chart).toHaveAttribute("data-zoom", "2m");
  await expect(page.getByTestId("chart-ohlcv")).toContainText("Y 2M");
  await page.waitForTimeout(400);
  await expect(chart).toHaveAttribute("data-selected", ""); // a double-click is not a candle pick
  await page.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(chart).not.toHaveAttribute("data-zoom", /.*/);
  await expect(chart).toHaveAttribute("data-selected", ""); // a double-click is not a candle pick
});
