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

  const taskRow = page.locator(".df2-today-plan > button", { hasText: "Dokončit UX návrh" });
  await expect(page.locator(".df2-now-card")).toContainText("Volno");
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  const modal = page.locator(".df2-modal").first();
  await expect(modal.locator('input[name="title"]')).toHaveValue("Dokončit UX návrh");
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


test("completion is persisted before the visual hold can be interrupted", async ({ page }) => {
  await openAtNoon(page);
  await seedSingleTask(page, false);
  await page.reload({ waitUntil: "networkidle" });

  await page.locator(".df2-today-plan > button", { hasText: "Dokončit UX návrh" }).click();
  const modal = page.locator(".df2-modal").first();
  await modal.getByRole("button", { name: "Označit hotovo", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans["2026-10-06"].find((task) => task.id === "completion-ux-task")?.completed;
  })).toBe(true);

  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans["2026-10-06"].find((task) => task.id === "completion-ux-task")?.completed;
  })).toBe(true);
});


test("rapid completions keep an independent undo action for each task", async ({ page }) => {
  await openAtNoon(page);
  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const date = "2026-10-06";
    state.routines = [];
    state.plans = {
      ...state.plans,
      [date]: [
        {
          id: "first-completion",
          title: "První dokončení",
          date,
          duration: 30,
          start: "14:00",
          end: "14:30",
          requestedStart: "14:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: "2026-10-06T10:00:00.000Z",
        },
        {
          id: "second-completion",
          title: "Druhé dokončení",
          date,
          duration: 30,
          start: "15:00",
          end: "15:30",
          requestedStart: "15:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: "2026-10-06T10:01:00.000Z",
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.locator(".df2-today-plan > button", { hasText: "První dokončení" }).click();
  await page.locator(".df2-modal").first().getByRole("button", { name: "Označit hotovo", exact: true }).click();
  await expect(page.locator(".df2-completion-toast", { hasText: "První dokončení" })).toBeVisible();

  await page.waitForTimeout(750);
  await page.locator(".df2-today-plan > button", { hasText: "Druhé dokončení" }).click();
  await page.locator(".df2-modal").first().getByRole("button", { name: "Označit hotovo", exact: true }).click();

  const firstToast = page.locator(".df2-completion-toast", { hasText: "První dokončení" });
  const secondToast = page.locator(".df2-completion-toast", { hasText: "Druhé dokončení" });
  await expect(firstToast).toBeVisible();
  await expect(secondToast).toBeVisible();

  await firstToast.getByRole("button", { name: "Vrátit", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans["2026-10-06"];
    return tasks.map((task) => [task.id, task.completed]);
  })).toEqual([
    ["first-completion", false],
    ["second-completion", true],
  ]);
});


test("ordinary Today tasks stay visible during the completion hold", async ({ page }) => {
  await openAtNoon(page);
  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const date = "2026-10-06";
    state.routines = [];
    state.plans = {
      ...state.plans,
      [date]: [
        {
          id: "now-task",
          title: "Teď dokončit",
          date,
          duration: 30,
          start: "14:00",
          end: "14:30",
          requestedStart: "14:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: "2026-10-06T10:00:00.000Z",
        },
        {
          id: "later-task",
          title: "Později dokončit",
          date,
          duration: 30,
          start: "15:00",
          end: "15:30",
          requestedStart: "15:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: "2026-10-06T10:01:00.000Z",
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  const laterRow = page.locator(".df2-today-plan > button", { hasText: "Později dokončit" });
  await laterRow.click();
  const modal = page.locator(".df2-modal").first();
  await modal.getByRole("button", { name: "Označit hotovo", exact: true }).click();

  await expect(laterRow).toBeVisible();
  await expect(laterRow).toHaveClass(/is-completing/);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans["2026-10-06"].find((task) => task.id === "later-task")?.completed;
  })).toBe(true);

  await expect(laterRow).toBeHidden({ timeout: 2000 });
});


test("blocked checklist storage never announces the whole day as complete", async ({ page }) => {
  await openAtNoon(page);
  await seedSingleTask(page, true);
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-daily-checklist-v1", "{broken-json");
  });
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.locator("[data-daily-checklist]")).toContainText("Checklist data nelze bezpečně načíst");
  await expect(page.locator(".df2-day-complete")).toHaveCount(0);
});


test("planning-day rollover updates checklist immediately with the parent day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T01:59:59"));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = {
      ...state.plans,
      "2026-10-06": [{
        id: "old-day-done",
        title: "Starý den",
        date: "2026-10-06",
        duration: 30,
        start: "20:00",
        end: "20:30",
        requestedStart: "20:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: true,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: "2026-10-06T10:00:00.000Z",
      }],
      "2026-10-07": [{
        id: "new-day-done",
        title: "Nový den",
        date: "2026-10-07",
        duration: 30,
        start: "08:00",
        end: "08:30",
        requestedStart: "08:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: true,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: "2026-10-07T00:00:00.000Z",
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-daily-checklist-v1", JSON.stringify({
      version: 1,
      items: [{ id: "daily", title: "Denní položka", days: [1, 2, 3, 4, 5, 6, 0] }],
      completedByDate: { "2026-10-06": ["daily"] },
    }));
  });
  await page.reload({ waitUntil: "networkidle" });

  const checklist = page.locator("[data-daily-checklist]");
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/1");
  await expect(page.locator(".df2-day-complete")).toBeVisible();

  await page.clock.setFixedTime(new Date("2026-10-07T02:00:01"));
  await page.waitForTimeout(1300);

  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/1");
  await expect(page.locator(".df2-day-complete")).toHaveCount(0);
});
