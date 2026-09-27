import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("add task is not shown in the sidebar", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await expect(page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" })).toHaveCount(0);
  await page.keyboard.press("2");
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
});
