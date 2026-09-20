import { test, expect } from "@playwright/test";

test("week shows planned capacity for each day", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [
        { id: "cap-60", title: "Hodina", date, duration: 60, start: "10:00", end: "11:00", requestedStart: "10:00", deadlineTime: "22:30", priority: "normal", category: "Studium", mode: "flexible", completed: false, source: "user", dateLocked: true, autoScheduled: false, createdAt: now.toISOString() },
        { id: "cap-30", title: "Půlhodina", date, duration: 30, start: "11:30", end: "12:00", requestedStart: "11:30", deadlineTime: "22:30", priority: "normal", category: "Studium", mode: "flexible", completed: false, source: "user", dateLocked: true, autoScheduled: false, createdAt: now.toISOString() },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Týden/ }).click();
  const today = page.locator(".df2-week-day.today");
  await expect(today).toBeVisible();
  await expect(today.locator(".df2-week-capacity")).toHaveText("1 h 30 min");
});
