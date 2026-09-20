import { test, expect } from "@playwright/test";

test("overview shows a compact weekly review", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;
    const make = (id, title, date, duration, actualMinutes, category) => ({ id, title, date, duration, start: "10:00", end: "11:00", requestedStart: "10:00", deadlineTime: "22:30", priority: "normal", category, mode: "flexible", completed: true, source: "user", dateLocked: true, autoScheduled: false, createdAt: now.toISOString(), actualMinutes });
    state.routines = [];
    state.plans = {
      [yesterday]: [make("review-old", "Včerejší blok", yesterday, 45, 25, "Matika")],
      [today]: [make("review-a", "Finance A", today, 60, 50, "Finance"), make("review-b", "Finance B", today, 30, 30, "Finance")],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const review = page.locator(".df2-weekly-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("Týdenní review");
  await expect(review).toContainText("3 / 3");
  await expect(review).toContainText("1 h 45 min");
  await expect(review).toContainText("Finance");
});
