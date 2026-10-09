import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

/**
 * The roof map with real OpenFreeMap tiles: catches MapLibre worker/bundling
 * problems that a blocked-tile test can't (the console guard fails on worker errors).
 */
test("roof map loads tiles and its worker", async ({ page }) => {
  test.skip(process.env.OFFLINE === "1", "needs network for map tiles");
  await installFakeApi(page, new Map(), { allowTiles: true });
  await page.goto("/signup");
  await page.getByLabel("Email").fill("map@example.com");
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByLabel("Your name").fill("Map");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("City or area").fill("Pune");
  // Enter in the field searches too; avoids tapping while the map shifts layout as it loads
  // (retried: under load the key press can land before hydration)
  await expect(async () => {
    await page.getByLabel("City or area").press("Enter");
    await expect(page.getByRole("button", { name: /Pune, Pune District/ })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: /Pune, Pune District/ }).click();
  const tile = page.waitForResponse((r) => r.url().includes("tiles.openfreemap.org") && r.url().endsWith(".pbf") && r.ok(), { timeout: 30_000 });
  await expect(page.getByRole("application", { name: "Map to place your roof pin" }).locator("canvas")).toBeVisible();
  await tile;
  // give the worker time to parse the tile; any worker error fails the console guard
  await page.waitForTimeout(2000);
});
