import { test, expect } from "@playwright/test";

test("overview statistics use completed Week block duration instead of Focus actual minutes", async ({ page }) => {
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
          id: "history-week-duration",
          title: "Dvouhodinový blok",
          date,
          duration: 120,
          actualMinutes: 7,
          actualStartedAt: now.toISOString(),
          actualEndedAt: now.toISOString(),
          start: "10:00",
          end: "12:00",
          requestedStart: "10:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Finance",
          mode: "flexible",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();

  const history = page.locator(".df2-history-view");
  await expect(history.locator(".df2-overview-summary")).toContainText("2 h");
  await expect(history.locator(".df2-overview-summary")).toContainText("1 z 1 bloků");

  const financeCategory = history.locator('.df2-overview-list-row[data-category="Finance"]');
  await expect(financeCategory).toContainText("2 h");

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const todayBucket = history.locator(".df2-history-bars article").nth(todayIndex);
  await expect(todayBucket).toHaveAttribute("aria-label", /2 h/);
});
