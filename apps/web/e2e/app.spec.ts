import type { Page } from "@playwright/test";

import { expect, searchPlace, test } from "./fixtures";

import { installFakeApi } from "./fake-api";

/**
 * Phase 2 DoD in the browser (mock auth, fake API): sign up, onboard with a
 * refresh mid-way, sign out and back in, see the same profile, export and delete.
 */

async function signUp(page: Page, email: string, password = "terrace-2026") {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("protected pages send visitors to sign in", async ({ page }) => {
  await installFakeApi(page);
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows friendly copy, not a raw error", async ({ page }) => {
  await installFakeApi(page);
  await signUp(page, "wrongpw@example.com");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("gw.mock.auth")!);
    localStorage.setItem("gw.mock.auth", JSON.stringify({ ...s, session: null }));
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("wrongpw@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That email and password don't match. Check them, or reset your password.",
  );
});

test("form validation explains what to fix", async ({ page }) => {
  await installFakeApi(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter an email address, like name@example.com.")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters.", { exact: true })).toBeVisible();
});

test("sign up, onboard across a refresh, sign out and back in, export, delete", async ({ page }) => {
  const store = await installFakeApi(page);
  await signUp(page, "priya@example.com");

  // Step 1: you (required, can't skip)
  await expect(page.getByRole("heading", { name: "First, about you" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await page.getByLabel("Your name").fill("Priya");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: home
  await expect(page.getByRole("heading", { name: "Your home" })).toBeVisible();
  // Controlled radios: click, then assert (check() reads before React re-renders)
  await page.getByLabel("Flat").click();
  await expect(page.getByLabel("Flat")).toBeChecked();
  await page.getByLabel("City or area").fill("Pune");
  await searchPlace(page, /^Pune, Pune District, Maharashtra, India$/);
  await page.getByLabel("Usable roof area").fill("350");
  await page.getByLabel("People in your home").fill("4");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your electricity" })).toBeVisible();

  // Refresh mid-way: progress is kept
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your electricity" })).toBeVisible();
  await expect(page.getByLabel("Electricity company (DISCOM)")).toHaveValue("msedcl"); // suggested from Pune
  await page.getByLabel("Sanctioned load (kW)").fill("3");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: water, then finish
  await page.getByLabel("Municipal supply").click();
  await expect(page.getByLabel("Municipal supply")).toBeChecked();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Hello, Priya." })).toBeVisible();
  await expect(page.getByText("Pune, Maharashtra")).toBeVisible();
  await expect(page.getByText("350 sq ft")).toBeVisible();
  await expect(page.getByText("MSEDCL")).toBeVisible();

  const saved = [...store.values()][0]!;
  expect(saved).toMatchObject({
    name: "Priya", home_type: "flat", city: "Pune", state: "Maharashtra", roof_area_sqft: 350,
    household_size: 4, discom: "msedcl", sanctioned_load_kw: 3, water_source: "municipal", onboarding_done: true,
  });

  // Sign out, then sign back in: same profile
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("priya@example.com");
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Priya." })).toBeVisible();

  // Settings: export, edit, delete
  await page.goto("/app/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/^groundwork-\d{4}-\d{2}-\d{2}\.json$/);

  await page.getByLabel("Your name").fill("Priya K");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  const reminder = page.getByRole("checkbox", { name: /monthly leak-check reminder/ });
  await reminder.check();
  await expect(reminder).toBeChecked();
  await expect.poll(() => [...store.values()][0]!.leak_reminders).toBe(true);

  await page.getByRole("button", { name: "Delete account" }).click();
  const confirm = page.getByRole("button", { name: "Delete everything" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm. Everything is removed straight away.").fill("DELETE");
  await confirm.click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByText("Your account and data have been deleted.")).toBeVisible();
  expect(store.size).toBe(0);
});
