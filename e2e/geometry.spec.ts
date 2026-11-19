import { expect, test } from "@playwright/test";
import { computed } from "./colors";

// D-078: sharp and flat on screen, not only in the stylesheets: every element inside the terminal's
// panels, strip and drawer has border-radius 0 and no shadow, as the browser actually computes them.

test("panels, status strip and drawer: border-radius 0 and no box-shadow anywhere", async ({ page }) => {
  await page.goto("/terminal?seed=187");
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
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  const style = await page.getByTestId("last-price").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric };
  });
  expect(style.family).toMatch(/IBM Plex Mono/i); // D-094
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check(`13px "IBM Plex Mono"`); })).toBe(true);
  expect(style.numeric).toContain("tabular-nums");
  expect(style.numeric).toContain("slashed-zero");
});

test("BOOK levels flash a 25% tint, the last price the full flash, for 150ms (D-078, D-089)", async ({ page }) => {
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await expect
    .poll(
      () =>
        page.getByTestId("book").evaluate((el) => {
          for (const row of el.querySelectorAll("[data-price]")) {
            const a = row.getAnimations()[0];
            if (a) return { color: (a.effect as KeyframeEffect).getKeyframes()[0].backgroundColor, ms: (a.effect as KeyframeEffect).getTiming().duration };
          }
          return null;
        }),
      { timeout: 10_000, intervals: [20] },
    )
    .toMatchObject({ color: expect.stringMatching(new RegExp(`^(${[computed("upFlashSoft"), computed("downFlashSoft")].map((c) => c.replace(/[().]/g, "\\$&")).join("|")})$`)), ms: 150 });
});
