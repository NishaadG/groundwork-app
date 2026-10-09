import type { Page } from "@playwright/test";

import { installFakeApi } from "./fake-api";
import { expect, test } from "./fixtures";

type Store = Awaited<ReturnType<typeof installFakeApi>>;

async function signUpOnboarded(page: Page, store: Store, email: string, name: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("terrace-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem("gw.mock.auth")!).session);
  store.set(sub, { name, city: "Pune", onboarding_step: 3, onboarding_done: true });
}

test("an admin creates a society, a neighbour joins by link and sees only shared things", async ({ page }) => {
  const store = await installFakeApi(page);
  await signUpOnboarded(page, store, `a${Date.now()}@example.com`, "Anika");
  await page.goto("/app/society");

  const create = page.getByRole("region", { name: "Start a society" });
  await create.getByRole("button", { name: "Create society" }).click();
  await expect(create.getByText("Enter the society's name.")).toBeVisible();
  await create.getByLabel("Society name").fill("Green Acres CHS");
  await expect(create.getByLabel("City")).toHaveValue("Pune");
  await create.getByLabel("Number of flats").fill("40");
  await create.getByLabel("Nickname").fill("Sunflower");
  await create.getByRole("switch", { name: "Show me on the leaderboard" }).click();
  await create.getByRole("button", { name: "Create society" }).click();

  await expect(page.getByRole("heading", { name: "Green Acres CHS", level: 1 })).toBeVisible();
  await expect(page.getByText("GRNA-4CRE")).toBeVisible();
  await expect(page.getByText("2.5% taking part")).toBeVisible(); // 1 of 40

  await page.getByPlaceholder("Write an announcement for every member").fill("Water off on Sunday 10–12.");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("Water off on Sunday 10–12.")).toBeVisible();
  const tanks = page.getByRole("region", { name: "Common tanks" });
  await tanks.getByLabel("Tank", { exact: true }).fill("Main");
  await tanks.getByLabel("Level (%)").fill("140");
  await tanks.getByRole("button", { name: "Log level" }).click();
  await expect(tanks.getByText("Enter a level from 0 to 100.")).toBeVisible();
  await tanks.getByLabel("Level (%)").fill("65");
  await tanks.getByRole("button", { name: "Log level" }).click();
  await expect(tanks.getByText("65%", { exact: true })).toBeVisible();

  // Solar for the common meter: needs a location, then shows the estimate and the subsidy
  const solar = page.getByRole("region", { name: "Solar for common areas" });
  await solar.getByLabel("Electricity company").selectOption("msedcl");
  await solar.getByLabel("Common meter: units a month").fill("1500");
  await solar.getByLabel("Sanctioned load (kW)").fill("20");
  await solar.getByLabel("Usable terrace area (sq ft)").fill("abc");
  await solar.getByRole("button", { name: "Estimate" }).click();
  await expect(solar.getByText("Enter the terrace area in square feet.")).toBeVisible();
  await solar.getByLabel("Usable terrace area (sq ft)").fill("3000");
  await solar.getByRole("button", { name: "Estimate" }).click();
  await expect(solar.getByText("Add your home's location first, so we can look up sunlight.")).toBeVisible();
  const anika = [...store.keys()][0]!;
  store.set(anika, { ...store.get(anika)!, lat: 18.52, lng: 73.86 });
  await solar.getByRole("button", { name: "Estimate" }).click();
  await expect(solar.getByText("20 kW")).toBeVisible();
  await expect(solar.getByText("after a ₹3,60,000 subsidy")).toBeVisible();
  await expect(solar.getByText(/Shared across 40 homes/)).toBeVisible();
  await expect(solar.getByRole("button", { name: "Update the estimate" })).toBeVisible();

  // Second account
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await signUpOnboarded(page, store, `b${Date.now()}@example.com`, "Bharat");
  await page.goto("/app/society?code=GRNA4CRE");
  const join = page.getByRole("region", { name: "Join with an invite code" });
  await expect(join.getByLabel("Invite code")).toHaveValue("GRNA4CRE", { timeout: 20_000 });
  await join.getByLabel("Your flat").fill("B-12");
  await join.getByRole("button", { name: "Join society" }).click();

  await expect(page.getByRole("heading", { name: "Green Acres CHS", level: 1 })).toBeVisible();
  await expect(page.getByText("Water off on Sunday 10–12.")).toBeVisible();
  const board = page.getByRole("region", { name: "Leaderboard" });
  await expect(board.getByRole("rowheader")).toHaveText(["Sunflower"]);
  await expect(board.getByText("1 household isn't shown because they haven't opted in.")).toBeVisible();
  // Members can't post or log
  await expect(page.getByPlaceholder("Write an announcement for every member")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log level" })).toHaveCount(0);
  // Members see the society's solar estimate but can't change it
  const memberSolar = page.getByRole("region", { name: "Solar for common areas" });
  await expect(memberSolar.getByText("20 kW")).toBeVisible();
  await expect(memberSolar.getByRole("button", { name: "Update the estimate" })).toHaveCount(0);

  await page.getByRole("button", { name: "Leave society" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(page.getByRole("region", { name: "Join with an invite code" })).toBeVisible();
});

test("a wrong invite code explains what to do", async ({ page }) => {
  const store = await installFakeApi(page);
  await signUpOnboarded(page, store, `c${Date.now()}@example.com`, "Chitra");
  await page.goto("/app/society");
  const join = page.getByRole("region", { name: "Join with an invite code" });
  await join.getByLabel("Invite code").fill("abc");
  await join.getByRole("button", { name: "Join society" }).click();
  await expect(join.getByText("Enter the 8-character code.")).toBeVisible();
  await join.getByLabel("Invite code").fill("zzzz-zzzz");
  await join.getByRole("button", { name: "Join society" }).click();
  await expect(join.getByText("That code doesn't match a society. Check it with your admin.")).toBeVisible();
});

test("a society report to print", async ({ page }) => {
  const store = await installFakeApi(page);
  await signUpOnboarded(page, store, `d${Date.now()}@example.com`, "Dev");
  await page.goto("/app/society");
  const create = page.getByRole("region", { name: "Start a society" });
  await create.getByLabel("Society name").fill("Green Acres CHS");
  await create.getByLabel("Number of flats").fill("40");
  await create.getByRole("button", { name: "Create society" }).click();
  await page.getByRole("link", { name: "Society report" }).click();
  await expect(page.getByRole("heading", { name: "Society impact report", level: 1 })).toBeVisible();
  await expect(page.getByText("1 of 40 flats taking part (2.5%)")).toBeVisible();
  await expect(page.getByText("No leaks found, 0 fixed")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeHidden();
});
