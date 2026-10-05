import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("Jarvis omits the redundant daily sequence and note cards", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();

  const briefing = page.locator("[data-today-briefing]");
  await expect(briefing).toBeVisible();
  await expect(briefing.locator(".df2-jarvis-weather")).toBeVisible();
  await expect(briefing.locator(".df2-jarvis-command")).toBeVisible();
  await expect(briefing.locator(".df2-jarvis-sequence")).toBeHidden();
  await expect(briefing.locator(".df2-jarvis-insight")).toBeHidden();
});
