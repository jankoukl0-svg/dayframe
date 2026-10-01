import { test, expect } from "@playwright/test";

test("overview tracks completed reading separately across period modes", async ({ page }) => {
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
          id: "reading-done",
          title: "Čtení knihy",
          date,
          duration: 35,
          start: "20:00",
          end: "20:35",
          requestedStart: "20:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Rutina",
          mode: "flexible",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
        {
          id: "reading-open",
          title: "Čtení knihy",
          date,
          duration: 25,
          start: "21:00",
          end: "21:25",
          requestedStart: "21:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Rutina",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
        {
          id: "study-done",
          title: "Matematika",
          date,
          duration: 45,
          start: "10:00",
          end: "10:45",
          requestedStart: "10:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matematika",
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
  await expect(history).toBeVisible();

  const reading = history.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await expect(reading.getByRole("heading", { name: "Čtení" })).toBeVisible();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");
  await expect(reading).toContainText("1");
  await expect(reading).toContainText("dní čtení");
  await expect(reading).toContainText("průměr / den");
  await expect(reading).toContainText("dní nejdelší série");
  await expect(reading.locator(".df2-reading-stat").nth(1)).toContainText("35 min");

  const trend = history.locator(".df2-history-trend");
  const readingHost = history.locator("[data-reading-overview-host]");
  await expect(readingHost.evaluate((element) => element.previousElementSibling?.classList.contains("df2-history-trend"))).resolves.toBe(true);

  await history.getByRole("button", { name: "Měsíc" }).click();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");

  await history.getByRole("button", { name: "Rok" }).click();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");
});
