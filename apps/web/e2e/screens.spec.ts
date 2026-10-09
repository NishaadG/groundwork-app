import { expect, searchPlace, test } from "./fixtures";

import { installFakeApi } from "./fake-api";

/**
 * Design-review screenshots of signed-in screens. Opt-in:
 *   SCREENSHOTS=<dir> pnpm exec playwright test e2e/screens.spec.ts
 */
const DIR = process.env.SCREENSHOTS;

test.skip(!DIR, "set SCREENSHOTS=<dir> to capture review screenshots");
// One long journey per colour scheme, with full-page screenshots along the way
test.setTimeout(300_000);

for (const scheme of ["light", "dark"] as const) {
  test(`signed-in screens (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await installFakeApi(page);
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${DIR}/${name}-${info.project.name}-${scheme}.png`, fullPage: true });
    };

    await page.goto("/login");
    await shot("login");
    await page.goto("/signup");
    await page.getByLabel("Email").fill("review@example.com");
    await page.getByLabel("Password").fill("terrace-2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await shot("verify");
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "First, about you" })).toBeVisible();
    await shot("onboarding-1");
    await page.getByLabel("Your name").fill("Priya");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Your home" })).toBeVisible();
    await page.getByLabel("City or area").fill("Pune");
    await searchPlace(page, /^Pune, Pune District, Maharashtra, India$/);
    await page.getByLabel("Usable roof area").fill("350");
    await shot("onboarding-2");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Your electricity" })).toBeVisible();
    await shot("onboarding-3");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Your water" })).toBeVisible();
    await shot("onboarding-4");
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Hello, Priya." })).toBeVisible();
    await shot("app-home");
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await shot("app-settings");
    await page.goto("/app/solar/new");
    await page.getByTestId("bill-file").setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByRole("heading", { name: "Check what we read" })).toBeVisible();
    await shot("solar-confirm");
    await page.getByLabel("Total amount (₹)").fill("3385");
    await page.getByRole("button", { name: "Looks right, continue" }).click();
    await page.getByRole("button", { name: "See my report" }).click();
    await expect(page.getByRole("heading", { name: "Rooftop solar for your home" })).toBeVisible();
    await page.waitForTimeout(500);
    await shot("solar-report");
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Your ledger" })).toBeVisible();
    await shot("app-home-after");
    await page.goto("/app/water");
    const check = page.locator("section", { has: page.getByRole("heading", { name: "Overnight leak check" }) });
    await check.getByLabel("Meter reading (litres)").fill("482100");
    await check.getByRole("button", { name: "Start the check" }).click();
    await check.getByLabel("Meter reading (litres)").fill("482140");
    await check.getByLabel("When").fill(new Date(Date.now() + 8 * 3600_000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    await check.getByRole("button", { name: "Finish the check" }).click();
    await expect(page.getByText(/Something is leaking/)).toBeVisible();
    await shot("water");
    await page.goto("/app/waste");
    await page.getByTestId("waste-file").setInputFiles({ name: "w.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByRole("heading", { name: "What's in it" })).toBeVisible();
    await shot("waste-items");
    await page.getByRole("button", { name: "Log this waste" }).click();
    await page.getByRole("button", { name: "Request a pickup" }).click();
    await page.getByLabel("Recycler", { exact: true }).click();
    await page.getByRole("option", { name: /Aundh/ }).click();
    await shot("waste-logged");
    await page.goto("/app/copilot");
    await expect(page.getByRole("heading", { name: "Copilot", level: 1 })).toBeVisible();
    await shot("copilot-empty");
    await page.getByRole("button", { name: "How much have I saved so far?" }).click();
    await page.getByLabel("Ask about your bills, water or waste").fill("Is my water leaking?");
    await page.getByLabel("Ask about your bills, water or waste").press("Enter");
    await expect(page.getByText("Possible leak")).toBeVisible();
    await shot("copilot");
    await page.goto("/app/reports");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await shot("reports");
    await page.goto("/app/reports/impact");
    await expect(page.getByRole("heading", { name: "Impact report", level: 1 })).toBeVisible();
    await shot("impact");
    await page.emulateMedia({ media: "print" });
    await shot("impact-print");
    await page.emulateMedia({ media: "screen" });
    await page.goto("/app/society");
    await expect(page.getByRole("heading", { name: "Start a society" })).toBeVisible();
    await shot("society-start");
    await page.getByLabel("Society name").fill("Green Acres CHS");
    await page.getByLabel("Number of flats").fill("40");
    await page.getByRole("switch").first().click();
    await page.getByRole("button", { name: "Create society" }).click();
    await page.getByPlaceholder("Write an announcement for every member").fill("Water off on Sunday 10–12.");
    await page.getByRole("button", { name: "Post" }).click();
    await page.getByLabel("Tank", { exact: true }).fill("Main");
    await page.getByLabel("Level (%)").fill("65");
    await page.getByRole("button", { name: "Log level" }).click();
    await expect(page.getByText("65%", { exact: true })).toBeVisible();
    await shot("society");
    await page.goto("/recyclers");
    await shot("recyclers");
  });
}
