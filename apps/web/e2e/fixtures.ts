import { expect, type Page, test as base } from "@playwright/test";

/**
 * Every e2e test fails if the page logs a missing translation (raw keys on screen)
 * or an uncaught error. Map tiles are blocked in tests, so their errors are ignored.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() !== "error") return;
        if (/openfreemap|maplibre|Failed to load resource|tiles|AJAXError|net::ERR_FAILED/i.test(text)) return;
        problems.push(text);
      });
      page.on("pageerror", (err) => {
        if (!/maplibre|AJAXError/i.test(err.message)) problems.push(err.message);
      });
      await use();
      expect(problems, "console errors / missing translations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Search for a place in onboarding. Retries the click, which can land before hydration under load. */
export async function searchPlace(page: Page, result: RegExp) {
  await expect(async () => {
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("button", { name: result })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: result }).click();
}
