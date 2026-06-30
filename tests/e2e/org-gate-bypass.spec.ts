import { test, expect } from "@playwright/test";

// In QA-bypass mode there is no Clerk session, so the org gate must NOT redirect
// to /onboarding/select-organization — the app shell renders directly.
test("QA-bypass: protected route renders without the org gate", async ({ page }) => {
  await page.goto("/bridge");
  await expect(page).not.toHaveURL(/\/onboarding\/select-organization/);
  await expect(page).toHaveURL(/\/bridge/);
});
