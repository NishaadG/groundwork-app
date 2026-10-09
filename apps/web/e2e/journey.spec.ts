import { installFakeApi } from "./fake-api";
import { expect, searchPlace, test } from "./fixtures";

/** One household, start to finish: sign up → onboard → solar → water → waste → copilot → impact report. */
test("the whole journey", async ({ page }) => {
  test.setTimeout(240_000);
  await installFakeApi(page);

  await page.goto("/signup");
  await page.getByLabel("Email").fill(`j${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await page.getByLabel("Your name").fill("Meera");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Flat").click();
  await page.getByLabel("City or area").fill("Pune");
  await searchPlace(page, /^Pune, Pune District, Maharashtra, India$/);
  await page.getByLabel("Usable roof area").fill("350");
  await page.getByLabel("People in your home").fill("4");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your electricity" })).toBeVisible();
  await page.getByLabel("Sanctioned load (kW)").fill("3");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Municipal supply").click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Meera." })).toBeVisible();

  // Solar
  await page.getByRole("link", { name: "Upload a bill" }).click();
  await page.getByTestId("bill-file").setInputFiles({ name: "bill.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
  await page.getByLabel("Total amount (₹)").fill("3385");
  await page.getByRole("button", { name: "Looks right, continue" }).click();
  await page.getByRole("button", { name: "See my report" }).click();
  await expect(page.getByRole("heading", { name: "Rooftop solar for your home" })).toBeVisible();

  // Water: an overnight check that finds a leak
  await page.goto("/app/water");
  const check = page.locator("section", { has: page.getByRole("heading", { name: "Overnight leak check" }) });
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const night = new Date(Date.now() - 9 * 3600_000);
  await check.getByLabel("Meter reading (litres)").fill("482100");
  await check.getByLabel("When").fill(local(night));
  await check.getByRole("button", { name: "Start the check" }).click();
  await check.getByLabel("Meter reading (litres)").fill("482140");
  await check.getByLabel("When").fill(local(new Date(night.getTime() + 8 * 3600_000)));
  await check.getByRole("button", { name: "Finish the check" }).click();
  await expect(page.getByText("Something is leaking: about 120 litres a day.")).toBeVisible();

  // Waste
  await page.goto("/app/waste");
  await page.getByTestId("waste-file").setInputFiles({ name: "w.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
  await page.getByRole("button", { name: "Log this waste" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged" })).toBeVisible();

  // Copilot
  await page.goto("/app/copilot");
  await page.getByLabel("Ask about your bills, water or waste").fill("Is my water leaking?");
  await page.getByLabel("Ask about your bills, water or waste").press("Enter");
  await expect(page.getByText("Possible leak")).toBeVisible();

  // The impact report brings it together
  await page.goto("/app/reports/impact");
  await expect(page.getByRole("heading", { name: "Impact report", level: 1 })).toBeVisible();
  await expect(page.getByText("For Meera, Pune")).toBeVisible();
  await expect(page.getByText("1 solar report")).toBeVisible();
  await expect(page.getByText("1 leak found, 0 fixed")).toBeVisible();
  await expect(page.getByText(/^1 waste log: 3\.0 kg/)).toBeVisible();
});
