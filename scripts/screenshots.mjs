// Full-page screenshots at the four review widths, light and dark.
// Usage: node scripts/screenshots.mjs <baseUrl> <outDir> <path> [<path>...]
import { chromium } from "../apps/web/node_modules/@playwright/test/index.mjs";

const [base, outDir, ...paths] = process.argv.slice(2);
const widths = [360, 768, 1280, 1536];
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const width of widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: scheme,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const name = `${(p.replace(/\//g, "_") || "_home").replace(/^_/, "") || "home"}-${width}-${scheme}.png`;
      await page.screenshot({ path: `${outDir}/${name}`, fullPage: true });
      console.log(name, overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : "ok");
    }
    await ctx.close();
  }
}
await browser.close();
