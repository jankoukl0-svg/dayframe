import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("completed history duration correction resizes the Week block", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const historyDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12);
    const date = `${historyDate.getFullYear()}-${String(historyDate.getMonth() + 1).padStart(2, "0")}-${String(historyDate.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans[date] = [{
      id: "history-reading-test",
      title: "Čtení knihy historie",
      date,
      duration: 20,
      start: "22:40",
      end: "23:00",
      requestedStart: "22:40",
      dueDate: date,
      deadlineTime: "23:00",
      priority: "normal",
      category: "Rutina",
      mode: "flexible",
      completed: true,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: historyDate.toISOString(),
      plannedStart: "22:40",
      plannedEnd: "23:00",
      plannedDuration: 20,
      actualMinutes: 20,
      actualStartedAt: historyDate.toISOString(),
      actualEndedAt: historyDate.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Týden" }).click();
  await page.locator(".df2-week-controls button").first().click();

  const block = page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy historie" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("22:40–23:00");
  await expect.poll(async () => block.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(14.4, 0);
  await block.click();

  const modal = page.locator(".df2-history-edit-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator('input[name="actualMinutes"]')).toHaveValue("20");
  await expect(modal.locator('input[name="end"]')).toHaveValue("23:00");
  await modal.locator('input[name="actualMinutes"]').fill("40");
  await modal.getByRole("button", { name: "Uložit opravu" }).click();
  await expect(modal).toBeHidden();

  await expect.poll(() => page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[date]?.find((item) => item.id === "history-reading-test");
    return task ? {
      actualMinutes: task.actualMinutes,
      duration: task.duration,
      start: task.start,
      end: task.end,
      completed: task.completed,
    } : null;
  }, seeded)).toEqual({ actualMinutes: 40, duration: 40, start: "22:40", end: "23:20", completed: true });

  const resized = page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy historie" });
  await expect(resized).toBeVisible();
  await expect(resized).toContainText("22:40–23:20");
  await expect.poll(async () => resized.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(28.8, 0);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Týden" }).click();
  await page.locator(".df2-week-controls button").first().click();

  const persisted = page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy historie" });
  await expect(persisted).toBeVisible();
  await expect(persisted).toContainText("22:40–23:20");
  await expect.poll(async () => persisted.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(28.8, 0);
});
