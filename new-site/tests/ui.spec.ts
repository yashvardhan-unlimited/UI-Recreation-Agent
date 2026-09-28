import { expect, test } from "@playwright/test";

test("renders critical content and working interaction", async ({ page }) => {
  await page.goto("/");

  // Primary heading present
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // All major sections present
  await expect(page.locator("#platform")).toBeVisible();
  await expect(page.locator("#use-cases")).toBeVisible();
  await expect(page.locator("#architecture")).toBeVisible();
  await expect(page.locator("#customers")).toBeVisible();
  await expect(page.locator("#demo")).toBeVisible();

  // Primary CTA is a working anchor
  const cta = page.getByRole("link", { name: /request a demo/i }).first();
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/#demo/);

  // No horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile menu toggles", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /open menu|close menu/i });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator("#mobile-menu")).toBeVisible();
});
