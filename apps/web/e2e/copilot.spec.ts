import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

async function onboarded(page: Page) {
  const store = await installFakeApi(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`c${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Priya", city: "Pune", onboarding_step: 3, onboarding_done: true });
}

test("ask from a suggestion, get a streamed answer with a card, then follow up", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/copilot");
  await expect(page.getByRole("heading", { name: "Copilot", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "How much have I saved so far?" }).click();
  const log = page.getByRole("log", { name: "Copilot" });
  await expect(log.getByText("You've kept 5 kg of waste out of landfill so far.")).toBeVisible();
  await expect(log.getByText("Your ledger")).toBeVisible();
  await expect(log.getByText("5.0 kg · 0.01 t CO₂")).toBeVisible();

  const box = page.getByLabel("Ask about your bills, water or waste");
  await box.fill("Is my water leaking?");
  await box.press("Enter");
  await expect(log.getByText("Possible leak")).toBeVisible();
  await expect(log.getByText(/About 120 litres a day, found on/)).toBeVisible();
  await expect(log.getByRole("link", { name: "Go to Water" })).toBeVisible();

  // The conversation survives a reload in the same tab
  await page.reload();
  await expect(log.getByText("Is my water leaking?")).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("button", { name: "How much have I saved so far?" })).toBeVisible();
});

test("attach a waste photo", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/copilot");
  await page.getByRole("button", { name: "Attach a photo" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Waste" }).click();
  await (await chooser).setFiles({ name: "w.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(page.getByText("Waste photo attached")).toBeVisible();
  await page.getByLabel("Ask about your bills, water or waste").fill("What is this?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Copilot" });
  await expect(log.getByText("What's in the photo")).toBeVisible();
  await expect(log.getByRole("listitem").filter({ hasText: "PET water bottles" })).toContainText("Dry");
  await expect(log.getByRole("link", { name: "Log it on the Waste page" })).toBeVisible();
});

test("a failed answer says so", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/copilot");
  const box = page.getByLabel("Ask about your bills, water or waste");
  await box.fill("make it fail");
  await box.press("Enter");
  await expect(page.getByRole("log", { name: "Copilot" }).getByRole("alert")).toHaveText("Something went wrong. Try again.");
});
