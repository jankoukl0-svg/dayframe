import { test, expect } from "@playwright/test";

test("overview keeps categories and history above reading", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();

  const bottomGrid = history.locator(".df2-overview-bottom-grid");
  const readingHost = history.locator("[data-reading-overview-host]");
  await expect(bottomGrid).toBeVisible();
  await expect(readingHost).toBeVisible();
  await expect.poll(() => readingHost.evaluate((element) => element.previousElementSibling?.classList.contains("df2-overview-bottom-grid"))).toBe(true);
});
