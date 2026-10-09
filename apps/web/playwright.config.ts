import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Long user journeys (sign-up → onboarding → report) need more than the 30 s default
  timeout: 90_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Serves the e2e build (`pnpm e2e:build`): mock auth + the fake API in e2e/fake-api.ts
        command: `pnpm start -p ${PORT}`,
        env: { NEXT_DIST_DIR: ".next-e2e" },
        port: PORT,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
