import { expect, test } from "@playwright/test";

// D-078: sharp and flat on screen, not only in the stylesheets: every element inside the terminal's
// panels, strip and drawer has border-radius 0 and no shadow, as the browser actually computes them.

test("panels, status strip and drawer: border-radius 0 and no box-shadow anywhere", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("drawer-tab-STRAT").click();
  await page.getByTestId("playback-session").click();
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll("[data-panel], [data-panel] *, [data-testid=status-bar] *, [data-testid=session], [data-testid=session] *, [data-testid=command-input]")]
      .map((el) => {
        const cs = getComputedStyle(el);
        const radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
        return { el: `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className.toString().slice(0, 40)}]`, radius, shadow: cs.boxShadow, text: cs.textShadow };
      })
      .filter((r) => r.radius.some((x) => x !== "0px") || r.shadow !== "none" || r.text !== "none"),
  );
  expect(bad).toEqual([]);
});

test("numbers use tabular figures with a slashed zero in the self-hosted mono font", async ({ page }) => {
  await page.goto("/?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const style = await page.getByTestId("last-price").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric };
  });
  expect(style.family).toMatch(/JetBrains Mono/i);
  expect(style.numeric).toContain("tabular-nums");
  expect(style.numeric).toContain("slashed-zero");
});
