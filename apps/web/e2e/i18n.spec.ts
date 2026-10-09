import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

// Hindi and Marathi are drafts awaiting native review: they route, but the switcher
// doesn't offer them yet. The console guard fails these tests on any missing message.

test("Hindi marketing pages", async ({ page }) => {
  await page.goto("/hi");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("जानिए आपका घर किस पर चलता है।");
  await page.goto("/hi/how-it-works");
  await expect(page.getByRole("heading", { name: "Groundwork कैसे काम करता है", level: 1 })).toBeVisible();
  await page.goto("/hi/recyclers");
  await expect(page.getByRole("heading", { name: "रीसाइक्लर्स और कबाड़ीवालों के लिए", level: 1 })).toBeVisible();
});

test("Marathi marketing pages", async ({ page }) => {
  await page.goto("/mr");
  await expect(page.locator("html")).toHaveAttribute("lang", "mr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("तुमचे घर कशावर चालते ते जाणून घ्या.");
  await page.goto("/mr/methodology");
  await expect(page.getByRole("heading", { name: "कार्यपद्धती", level: 1 })).toBeVisible();
});

test("the app in Marathi", async ({ page }) => {
  const store = await installFakeApi(page);
  await page.goto("/mr/signup");
  await page.getByLabel("ईमेल").fill(`m${Date.now()}@example.com`);
  await page.getByLabel("पासवर्ड").fill("terrace-2026");
  await page.getByRole("button", { name: "खाते तयार करा" }).click();
  await page.getByLabel("पडताळणी कोड").fill("123456");
  await page.getByRole("button", { name: "पडताळा आणि पुढे चला" }).click();
  await expect(page).toHaveURL(/\/mr\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Asha", city: "Pune", onboarding_step: 3, onboarding_done: true, lang: "mr" });
  for (const [path, heading] of [
    ["/mr/app/waste", "कचरा"],
    ["/mr/app/water", "पाणी"],
    ["/mr/app/society", "सोसायटी"],
    ["/mr/app/reports", "अहवाल"],
    ["/mr/app/copilot", "कोपायलट"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
});

test("the working behind a solar report reads in Marathi", async ({ page }) => {
  const store = await installFakeApi(page);
  await page.goto("/mr/signup");
  await page.getByLabel("ईमेल").fill(`w${Date.now()}@example.com`);
  await page.getByLabel("पासवर्ड").fill("terrace-2026");
  await page.getByRole("button", { name: "खाते तयार करा" }).click();
  await page.getByLabel("पडताळणी कोड").fill("123456");
  await page.getByRole("button", { name: "पडताळा आणि पुढे चला" }).click();
  await expect(page).toHaveURL(/\/mr\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name: "Asha", city: "Pune", lat: 18.52, lng: 73.86, roof_area_sqft: 350, discom: "msedcl", sanctioned_load_kw: 3, onboarding_step: 3, onboarding_done: true, lang: "mr" });
  await page.goto("/mr/app/solar/new");
  await page.getByTestId("bill-file").setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
  await page.getByLabel("एकूण रक्कम (₹)").fill("3385");
  await page.getByRole("button", { name: "बरोबर आहे, पुढे चला" }).click();
  await page.getByRole("button", { name: "माझा अहवाल पाहा" }).click();
  await page.getByRole("button", { name: "आम्ही हे कसे काढले" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "सिस्टमचा आकार" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "तुमच्या छतावरील सूर्यप्रकाश" })).toBeVisible();
  await expect(drawer.getByText("वार्षिक वापर (kWh)").first()).toBeVisible();
});
