import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function openAtNoon(page) {
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00"));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

async function seedSingleTask(page, completed) {
  await page.evaluate((done) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const date = "2026-10-06";
    state.routines = [];
    state.plans = {
      ...state.plans,
      [date]: [{
        id: "completion-ux-task",
        title: "Dokončit UX návrh",
        date,
        duration: 45,
        start: "14:00",
        end: "14:45",
        requestedStart: "14:00",
        dueDate: date,
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: done,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: "2026-10-06T10:00:00.000Z",
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, completed);
}

test("task completion confirms, holds briefly and can be undone", async ({ page }) => {
  await openAtNoon(page);
  await seedSingleTask(page, false);
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.locator(".df2-now-card")).toContainText("Dokončit UX návrh");
  await page.locator(".df2-now-card").getByRole("button", { name: "Upravit", exact: true }).click();
  const modal = page.locator(".df2-modal").filter({ hasText: "Dokončit UX návrh" });
  await modal.getByRole("button", { name: "Označit hotovo", exact: true }).click();

  const toast = page.locator(".df2-completion-toast");
  await expect(toast).toContainText("Úkol dokončen");
  await expect(toast).toContainText("Dokončit UX návrh");

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans["2026-10-06"].find((task) => task.id === "completion-ux-task")?.completed;
  })).toBe(true);

  await toast.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans["2026-10-06"].find((task) => task.id === "completion-ux-task")?.completed;
  })).toBe(false);
});

test("task progress and checklist progress stay separate and unlock a quiet day-complete state", async ({ page }) => {
  await openAtNoon(page);
  await seedSingleTask(page, true);
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-daily-checklist-v1", JSON.stringify({
      version: 1,
      items: [{ id: "vitamins", title: "Vitamíny", days: [1, 2, 3, 4, 5, 6, 0] }],
      completedByDate: {},
    }));
  });
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.locator(".df2-today-plan .df2-section-head")).toContainText("1/1 úkolů");
  const checklist = page.locator("[data-daily-checklist]");
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/1");
  await expect(page.locator(".df2-day-complete")).toHaveCount(0);

  await checklist.getByRole("button", { name: "Označit Vitamíny jako hotovo" }).click();

  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/1");
  await expect(checklist.getByText("Dnešní checklist hotový")).toBeVisible();
  const dayComplete = page.locator(".df2-day-complete");
  await expect(dayComplete).toBeVisible();
  await expect(dayComplete).toContainText("Dnešek hotový");
  await expect(dayComplete).toContainText("1 úkolů · checklist 1/1");
});
