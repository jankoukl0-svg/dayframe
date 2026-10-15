import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("add task is not shown in the sidebar", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await expect(page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" })).toHaveCount(0);
  await page.keyboard.press("2");
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
});

test("Hygiena and Zdraví sidebar items have text only and still navigate", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const nav = page.locator(".df2-sidebar nav");
  for (const name of ["Hygiena", "Zdraví"]) {
    const entry = nav.getByRole("button", { name });
    await expect(entry).toBeVisible();
    await expect(entry.locator("svg")).toHaveCount(0);
    await entry.click();
    await expect(entry).toHaveClass(/active/);
  }
});
