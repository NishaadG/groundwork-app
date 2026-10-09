import { expect, test } from "./fixtures";

const PAGES = ["/", "/how-it-works", "/methodology", "/about", "/privacy", "/terms"];

for (const path of PAGES) {
  test(`${path} renders without horizontal scroll`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
}

test("unknown pages return a localized 404", async ({ page }) => {
  const res = await page.goto("/this-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page isn't here." })).toBeVisible();
});

test("hero slider recalculates the sample household", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "System size" });
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  const payback = page.getByText("Pays back in").locator("..");
  const before = await payback.innerText();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "2.5");
  await expect(page.getByText("₹69,000")).toBeVisible(); // subsidy for 2.5 kW
  await expect(payback).not.toHaveText(before);
});

test("show-the-working lists every calc step with sources", async ({ page }) => {
  await page.goto("/");
  const steps = page.locator("#working ol > li");
  await expect(steps).toHaveCount(11);
  await expect(page.locator("#working").getByRole("link", { name: /pib\.gov\.in/ })).toBeVisible();
});

test("keyboard users can skip to content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow checked on desktop");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
});

test("FAQ answers expand", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Is my bill data safe?" }).click();
  await expect(page.getByText("the photo itself is deleted within 7 days")).toBeVisible();
});
