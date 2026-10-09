import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

/** WCAG 2.1 A and AA checks with axe on every page, in light and dark mode. */
async function scan(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  const res = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".maplibregl-canvas")
    .analyze();
  const problems = res.violations.map(
    (v) => `${label}: ${v.id} (${v.impact}) ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`,
  );
  expect(problems, problems.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`public pages (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await installFakeApi(page);
    for (const path of ["/", "/how-it-works", "/methodology", "/about", "/privacy", "/terms", "/recyclers", "/login", "/signup", "/no-such-page"]) {
      await page.goto(path);
      await scan(page, path);
    }
  });

  test(`signed-in pages (${scheme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const store = await installFakeApi(page);
    await page.goto("/signup");
    await page.getByLabel("Email").fill(`a${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("terrace-2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await scan(page, "/onboarding");
    const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
    store.set(sub, {
      name: "Priya", city: "Pune", state: "Maharashtra", lat: 18.52, lng: 73.86, roof_area_sqft: 350, household_size: 4,
      discom: "msedcl", supply: "single", sanctioned_load_kw: 3, water_source: "municipal", onboarding_step: 3, onboarding_done: true,
    });

    // A solar report, so the report page and home have content
    await page.goto("/app/solar/new");
    await page.getByTestId("bill-file").setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByRole("heading", { name: "Check what we read" })).toBeVisible();
    await scan(page, "/app/solar/new (confirm)");
    await page.getByLabel("Total amount (₹)").fill("3385");
    await page.getByRole("button", { name: "Looks right, continue" }).click();
    await page.getByRole("button", { name: "See my report" }).click();
    await expect(page.getByRole("heading", { name: "Rooftop solar for your home" })).toBeVisible();
    await scan(page, "solar report");

    // Waste with items on screen, then logged
    await page.goto("/app/waste");
    await page.getByTestId("waste-file").setInputFiles({ name: "w.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByRole("heading", { name: "What's in it" })).toBeVisible();
    await scan(page, "/app/waste (items)");
    await page.getByRole("button", { name: "Log this waste" }).click();
    await page.getByRole("button", { name: "Request a pickup" }).click();
    await scan(page, "/app/waste (logged)");

    await page.goto("/app/copilot");
    await scan(page, "/app/copilot (empty)");
    await page.getByRole("button", { name: "How much have I saved so far?" }).click();
    await expect(page.getByText("Your ledger").first()).toBeVisible();
    await scan(page, "/app/copilot (answer)");

    await page.goto("/app/society");
    await expect(page.getByRole("heading", { name: "Start a society" })).toBeVisible();
    await scan(page, "/app/society (start)");
    await page.getByLabel("Society name").fill("Green Acres CHS");
    await page.getByLabel("Number of flats").fill("40");
    await page.getByRole("button", { name: "Create society" }).click();
    await expect(page.getByRole("heading", { name: "Green Acres CHS", level: 1 })).toBeVisible();
    await scan(page, "/app/society");

    for (const [path, heading] of [
      ["/app", "Hello, Priya."],
      ["/app/solar", "Solar"],
      ["/app/water", "Water"],
      ["/app/reports", "Reports"],
      ["/app/reports/impact", "Impact report"],
      ["/app/society/report", "Society impact report"],
      ["/app/settings", "Settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await scan(page, path);
    }
  });
}
