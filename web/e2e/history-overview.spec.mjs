import { test, expect } from "@playwright/test";

test("history overview summarizes completed work and returns to Today", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.plans[date] = [
      {
        id: "history-done",
        title: "Hotový testovací blok",
        date,
        duration: 45,
        start: "10:00",
        end: "10:45",
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
      {
        id: "history-open",
        title: "Nedokončený testovací blok",
        date,
        duration: 30,
        start: "11:00",
        end: "11:30",
        requestedStart: "11:00",
        dueDate: date,
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
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  const overview = page.getByRole("button", { name: /Přehled/ });
  await expect(overview).toBeVisible();
  await overview.click();

  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();
  await expect(history.getByRole("heading", { name: "Přehled" })).toBeVisible();
  await expect(history).toContainText("1 / 2");
  await expect(history).toContainText("50%");
  await expect(history).toContainText("45 min");
  await expect(history).toContainText("Finance");

  await page.getByRole("button", { name: /Dnes/ }).click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("heading", { name: "Dnes" })).toBeVisible();
});
