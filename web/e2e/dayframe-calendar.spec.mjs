import { test, expect } from "@playwright/test";

test("adds a task from the week without leaking internal scheduling syntax", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });

  await expect(page.getByText("Do konce dne", { exact: true })).toBeVisible();
  await expect(page.getByText("Konec 00:30", { exact: true })).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toContainText("Nejbližší termín");

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  let targetIndex = todayIndex + 1;
  if (targetIndex > 6) {
    await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
    targetIndex = 0;
  }

  const targetDay = page.locator(".df2-week-day").nth(targetIndex);
  await targetDay.locator(".df2-week-day-head > button").click();
  await expect(page.getByRole("heading", { name: "Přidat úkol" })).toBeVisible();

  await page.locator(".df2-title-input input").fill("Zeměpis 20 min");
  await page.getByRole("button", { name: "Naplánovat" }).click();

  const result = page.locator(".df2-result");
  await expect(result).toContainText("Zeměpis");
  await expect(result).not.toContainText("[[");

  await result.getByRole("button", { name: "Ukázat v týdnu" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);
  await expect(targetAfterSave).toContainText("Zeměpis");

  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
});
