import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

async function onboarded(page: Page) {
  const store = await installFakeApi(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`w${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Priya", household_size: 4, onboarding_step: 3, onboarding_done: true, water_inr_per_kl: 40 });
}

test("overnight check finds a leak, hunt list, mark fixed", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/water");
  await expect(page.getByRole("heading", { name: "Water", level: 1 })).toBeVisible();
  await expect(page.getByText("No readings yet.")).toBeVisible();

  // Tank level needs a tank size first
  await expect(page.getByText("Add your tank size in Settings to use tank levels.").first()).toBeVisible();

  const check = page.locator("section", { has: page.getByRole("heading", { name: "Overnight leak check" }) });
  await check.getByLabel("Meter reading (litres)").fill("482100");
  const night = new Date(Date.now() - 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await check.getByLabel("When").fill(local(night));
  await check.getByRole("button", { name: "Start the check" }).click();
  await expect(check.getByText(/Started at/)).toBeVisible();

  await check.getByLabel("Meter reading (litres)").fill("482140");
  await check.getByLabel("When").fill(local(new Date(night.getTime() + 8 * 3600_000)));
  await check.getByRole("button", { name: "Finish the check" }).click();
  await expect(page.getByText("Something is leaking: about 120 litres a day.")).toBeVisible();
  await expect(page.getByText("At your water rate, about ₹144 a month.")).toBeVisible(); // 3,600 L × ₹40/kL

  const leak = page.locator("article", { hasText: "Leak found on" });
  await expect(leak.getByText("Toilet: put a few drops of food colouring")).toBeVisible();
  await leak.getByRole("button", { name: "I've fixed it" }).click();
  await expect(page.getByText(/Marked fixed on/)).toBeVisible();
  await expect(page.getByText("We'll count savings once a few days of readings show your use has dropped.")).toBeVisible();
});

test("smart meter device key is shown once with a copy button", async ({ page }) => {
  await onboarded(page);
  await page.goto("/app/water");
  await page.getByRole("button", { name: "Add a device" }).click();
  await expect(page.getByText("gwd_testkey123")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy key" })).toBeVisible();
});
