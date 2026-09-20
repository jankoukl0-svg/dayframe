import { test, expect } from "@playwright/test";

test("label colors can be edited and persist in the week calendar", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "colored-math",
          title: "Barevná matematika",
          date,
          duration: 60,
          start: "10:00",
          end: "11:00",
          requestedStart: "10:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-label-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();
  const row = page.locator('[data-label-color-row="Matika"]');
  await expect(row).toBeVisible();
  const picker = row.getByLabel("Barva štítku Matika");
  await picker.fill("#3366cc");

  await expect.poll(() => page.evaluate(() => {
    const colors = JSON.parse(window.localStorage.getItem("dayframe-label-colors-v1") || "{}");
    return colors.Matika;
  })).toBe("#3366cc");

  await page.getByRole("button", { name: /Týden/ }).click();
  const task = page.locator(".df2-week-task").filter({ hasText: "Barevná matematika" });
  await expect(task).toBeVisible();
  await expect(task).toHaveCSS("border-left-color", "rgb(51, 102, 204)");
  await expect(task).toHaveAttribute("data-label-category", "Matika");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  const persisted = page.locator(".df2-week-task").filter({ hasText: "Barevná matematika" });
  await expect(persisted).toBeVisible();
  await expect(persisted).toHaveCSS("border-left-color", "rgb(51, 102, 204)");
});
