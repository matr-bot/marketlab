import { expect, test } from "@playwright/test";

const interpretation = {
  summary: "A hypothetical oil disruption raises fuel costs.",
  entities: ["Iran"],
  sectors: ["Energy", "Airlines"],
  mechanisms: ["Fuel costs rise"],
  assumptions: ["Supply falls"],
  uncertainty: "high",
  effects: [{ factor: "oilCosts", direction: 1, strength: 3, mechanism: "Fuel costs rise" }],
};

test("editing a scenario invalidates its interpretation before it can be applied", async ({ page }) => {
  await page.route("**/api/interpret", (route) => route.fulfill({ json: { ok: true, source: "ai", hypothetical: true, interpretation } }));
  await page.goto("/studio");
  const input = page.getByRole("textbox", { name: "Market scenario" });
  await input.fill("Iran blocks the Strait of Hormuz");
  await page.getByRole("button", { name: "INTERPRET SCENARIO" }).click();
  await expect(page.getByTestId("scenario-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "APPLY TO SIMULATED MARKETS" })).toBeEnabled();

  await input.fill("A different hypothetical event");
  await expect(page.getByTestId("scenario-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "APPLY TO SIMULATED MARKETS" })).toHaveCount(0);
  await expect(page.getByTestId("studio-markets")).toHaveCount(0);
});
