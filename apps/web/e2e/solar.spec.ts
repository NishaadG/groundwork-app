import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { installFakeApi } from "./fake-api";

/** Phase 3 flow in the browser: bill photo or manual entry → confirm → roof → report. */

async function onboardedUser(page: Page, opts?: Parameters<typeof installFakeApi>[2]) {
  const store = await installFakeApi(page, new Map(), opts);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`s${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  // Finish onboarding with a pinned Pune roof
  const sub = [...store.keys()][0] ?? (await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session));
  store.set(sub, {
    name: "Priya", city: "Pune", state: "Maharashtra", lat: 18.52, lng: 73.86, roof_area_sqft: 350,
    discom: "msedcl", sanctioned_load_kw: 3, supply: "single", onboarding_step: 3, onboarding_done: true,
  });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Hello, Priya." })).toBeVisible();
  return store;
}

test("photo of a bill → flagged field → confirm → roof → report → ledger", async ({ page }) => {
  await onboardedUser(page);
  await expect(page.getByText("Upload your latest electricity bill")).toBeVisible(); // next step
  await page.getByRole("link", { name: "Upload a bill" }).click();
  await expect(page.getByRole("heading", { name: "Check your bill" })).toBeVisible();

  await page.getByTestId("bill-file").setInputFiles({ name: "bill.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake") });
  await expect(page.getByRole("heading", { name: "Check what we read" })).toBeVisible();
  await expect(page.getByText("1 field needs a look")).toBeVisible();
  await expect(page.getByText(/doesn't match your tariff/)).toBeVisible();
  await expect(page.getByLabel("Units consumed (kWh)")).toHaveValue("280");
  await expect(page.getByLabel("Fuel adjustment charge (FAC) (₹ per unit)")).toHaveValue("0.30"); // 84 / 280
  await page.getByLabel("Total amount (₹)").fill("3385");
  await page.getByRole("button", { name: "Looks right, continue" }).click();

  await expect(page.getByRole("heading", { name: "Your roof" })).toBeVisible();
  await expect(page.getByLabel("Usable roof area (sq ft)")).toHaveValue("350");
  await page.getByRole("button", { name: "See my report" }).click();

  await expect(page.getByRole("heading", { name: "Rooftop solar for your home" })).toBeVisible();
  await expect(page.getByText("₹60,000").first()).toBeVisible(); // subsidy for 2 kW
  await expect(page.getByText("Sized to cover your yearly use.")).toBeVisible();

  // AI tips carry no numbers; the one figure beside them comes from code
  await expect(page.getByRole("heading", { name: "Ways to cut your bill now" })).toBeVisible();
  await expect(page.getByText("saves about ₹14.38")).toBeVisible();

  // "How we calculated this" opens the calc's own working
  await page.getByRole("button", { name: "How we calculated this" }).first().click();
  await expect(page.getByRole("dialog").getByText("System size")).toBeVisible();
  await page.keyboard.press("Escape");

  // Scenario slider recomputes in the browser and offers to save
  const slider = page.getByRole("slider", { name: "System size" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("₹69,000").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as a new report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "How we calculated this" })).toHaveCount(0);

  // Chart has a table view
  await page.getByRole("button", { name: "Show as a table" }).first().click();
  await expect(page.getByRole("rowheader", { name: "January" })).toBeVisible();

  // Home: the next step moves on, and the ledger shows potential (not realised) savings
  await page.goto("/app");
  await expect(page.getByText("Your roof suits a 2.0 kW system.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your ledger" })).toBeVisible();
  await expect(page.getByText("Nothing realised yet. Your latest solar report could save ₹35,606 a year.")).toBeVisible();
  await expect(page.getByText("Solar report: 2.0 kW")).toBeVisible();

  // Mark the system installed: the ledger now shows realised (estimated) savings
  await page.getByRole("link", { name: "Open your report" }).click();
  await page.getByRole("button", { name: "Mark as installed" }).click();
  await page.getByLabel("Date it was switched on").fill("2026-08-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Installed on (1 August|August 1,) 2026/)).toBeVisible();
  await page.goto("/app");
  await expect(page.getByText("Realised so far").or(page.getByText("From your installed system, your readings"))).toBeVisible();
  await expect(page.getByText("₹5,934").first()).toBeVisible();
  await page.getByRole("button", { name: "How we calculated this" }).first().click();
  await expect(page.getByRole("dialog").getByText("realised = estimated entries + measured entries")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Add each new bill as it arrives.")).toBeVisible();
});

test("when reading fails, typing the bill in still gets a report", async ({ page }) => {
  await onboardedUser(page, { extractMode: "fail" });
  await page.goto("/app/solar/new");
  await page.getByTestId("bill-file").setInputFiles({ name: "bill.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake") });
  await expect(page.getByText("We couldn't read this bill. You can type the numbers in instead.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your bill details" })).toBeVisible();
  await page.getByRole("button", { name: "Looks right, continue" }).click();
  await expect(page.getByText("Enter the units consumed, a number above 0.")).toBeVisible();
  await page.getByLabel("Units consumed (kWh)").fill("280");
  await page.getByRole("button", { name: "Looks right, continue" }).click();
  await page.getByRole("button", { name: "See my report" }).click();
  await expect(page.getByRole("heading", { name: "Rooftop solar for your home" })).toBeVisible();
  await page.goto("/app/solar");
  await expect(page.getByRole("link", { name: /2\.0 kW · pays back in/ })).toBeVisible();
});

test("wrong file types are refused before upload", async ({ page }) => {
  await onboardedUser(page);
  await page.goto("/app/solar/new");
  await page.getByTestId("bill-file").setInputFiles({ name: "bill.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByText("That file type won't work. Use a JPG, PNG or PDF.")).toBeVisible();
});
