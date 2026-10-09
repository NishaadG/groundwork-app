import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

async function onboarded(page: Page) {
  const store = await installFakeApi(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`r${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Priya", city: "Pune", onboarding_step: 3, onboarding_done: true });
}

test("reports list and an impact report with its working and sources", async ({ page }) => {
  await onboarded(page);
  // Log some waste so the report has something realised
  await page.goto("/app/waste");
  await page.getByRole("button", { name: "Add items by hand" }).click();
  await page.getByRole("form", { name: "What's in it" }).getByLabel("Weight (kg)").fill("5");
  await page.getByRole("button", { name: "Log this waste" }).click();
  await expect(page.getByText("Logged", { exact: true })).toBeVisible();

  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await expect(page.getByText("Add two bills with billing dates to get your first report card.")).toBeVisible();
  await expect(page.getByText("No solar reports yet.")).toBeVisible();
  await page.getByRole("link", { name: "Open impact report" }).click();

  await expect(page.getByRole("heading", { name: "Impact report", level: 1 })).toBeVisible();
  await expect(page.getByText("For Priya, Pune")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Waste kept out of landfill/ })).toContainText("5.0 kg");
  await expect(page.getByText("1 waste log: 5.0 kg, of which 5.0 kg kept out of landfill")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How each number was worked out" })).toBeVisible();
  await expect(page.getByText("CEA CO2 Baseline Database v21")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeVisible();

  // Printing hides the app chrome and the buttons
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "App" })).toBeHidden();
});
