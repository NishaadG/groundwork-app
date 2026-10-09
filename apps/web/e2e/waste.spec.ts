import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

async function onboarded(page: Page) {
  const store = await installFakeApi(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`k${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Priya", city: "Pune", household_size: 4, onboarding_step: 3, onboarding_done: true });
}

const photo = { name: "pile.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };

test("photo of a pile: sort, adjust, log, request a pickup, delete", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/waste");
  await expect(page.getByRole("heading", { name: "Waste", level: 1 })).toBeVisible();
  await expect(page.getByText("Nothing logged this week yet.").first()).toBeVisible();

  await page.getByTestId("waste-file").setInputFiles(photo);
  const items = page.getByRole("form", { name: "What's in it" });
  await expect(items.getByRole("listitem")).toHaveCount(2);
  // The model was unsure about the chips packets, so they're flagged for a check
  await expect(items.getByRole("listitem").nth(1).getByText("We weren't sure about this one")).toBeVisible();
  await expect(items.getByRole("listitem").nth(1).getByText("Not bought by kabadiwalas")).toBeVisible();

  await items.getByRole("listitem").nth(0).getByRole("button", { name: "Sack" }).click();
  await items.getByRole("listitem").nth(1).getByLabel("Weight (kg)").fill("0.5");
  await items.getByRole("button", { name: "Log this waste" }).click();

  const result = page.getByRole("status").filter({ hasText: "Logged" });
  await expect(result.getByText("₹120")).toBeVisible(); // 6 kg PET × ₹20
  await expect(result.getByRole("definition").filter({ hasText: /^6\.0\s?kg$/ })).toBeVisible(); // only the PET is diverted

  await expect(page.getByText("6.5 kg logged").first()).toBeVisible();
  await expect(page.getByText("92% kept out of landfill").first()).toBeVisible();
  await expect(page.getByText("Chips and biscuit wrappers are multilayer")).toBeVisible();

  await result.getByRole("button", { name: "Request a pickup" }).click();
  await page.getByLabel("Recycler", { exact: true }).click();
  await page.getByRole("option", { name: /Aundh Scrap Traders/ }).click();
  await expect(page.getByText("Demo partners are examples for trying the app.")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request saved. Call Aundh Scrap Traders on +91 90000 00001 to confirm a time.")).toBeVisible();

  const history = page.locator("section", { has: page.getByRole("heading", { name: "Your logs" }) });
  await expect(history.getByText("PET water bottles, Chips packets")).toBeVisible();
  await history.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Log deleted")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your logs" })).toHaveCount(0);
});

test("add items by hand, with weight validation", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/waste");
  await page.getByRole("button", { name: "Add items by hand" }).click();
  const items = page.getByRole("form", { name: "What's in it" });
  await items.getByLabel("Weight (kg)").fill("abc");
  await items.getByRole("button", { name: "Log this waste" }).click();
  await expect(items.getByRole("alert")).toHaveText("We couldn't save that. Add a weight or size for each item.");
  await items.getByLabel("Weight (kg)").fill("5");
  await items.getByRole("button", { name: "Log this waste" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged" }).getByText("₹55–₹60")).toBeVisible(); // 5 kg newspaper × ₹11–12
});

test("waste is in the nav and the scan sheet", async ({ page }) => {
  await onboarded(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByRole("link", { name: /Sort it and see what it's worth/ }).click();
  await expect(page).toHaveURL(/\/app\/waste$/);
});

test("recyclers can apply to be listed", async ({ page }) => {
  await installFakeApi(page);
  await page.goto("/recyclers");
  await expect(page.getByRole("heading", { name: "For recyclers and kabadiwalas", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Apply to be listed" }).click();
  await expect(page.getByText("Enter your business name.")).toBeVisible();
  await expect(page.getByText("Choose at least one.")).toBeVisible();

  await page.getByLabel("Business name").fill("Shree Scrap");
  await page.getByLabel("Area").fill("Aundh");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("Newspaper").check();
  await page.getByLabel("PET bottles").check();
  await page.getByLabel("Phone number").fill("+91 98765 43210");
  await page.getByRole("button", { name: "Apply to be listed" }).click();
  await expect(page.getByText("Thanks. We'll check your details and list you within a few days.")).toBeVisible();
});
