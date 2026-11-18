import { expect, test } from "@playwright/test";

// D-082: the terminal lives at /terminal; a run link from before (/?scn=…&seed=…) still opens its run.

test("an old run link redirects to the terminal with its scenario and seed", async ({ page }) => {
  await page.goto("/?scn=rate-shock&seed=4101");
  await expect(page).toHaveURL(/\/terminal\?scn=rate-shock&seed=4101/);
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("playback-session").click();
  await expect(page.getByTestId("session-seed")).toHaveText("4101");
});

test("a seed-only link redirects too", async ({ page }) => {
  await page.goto("/?seed=42");
  await expect(page).toHaveURL(/\/terminal\?(scn=free&)?seed=42/);
});

test("LINK copies a /terminal link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/terminal?seed=187");
  await expect(page.getByTestId("last-price")).toBeVisible();
  await page.getByTestId("command-input").fill("LINK");
  await page.getByTestId("command-input").press("Enter");
  await expect(page.getByTestId("command-reply")).toContainText("/terminal?scn=free&seed=187");
});
