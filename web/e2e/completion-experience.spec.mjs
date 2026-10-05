import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function openFresh(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

test("completing a high-priority task feels rewarding without adding progress or streak mechanics", async ({ page }) => {
  await openFresh(page);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [date]: [{
        id: "completion-priority",
        title: "Cambridge mock test",
        date,
        duration: 100,
        start: "14:15",
        end: "15:55",
        requestedStart: "14:15",
        deadlineTime: "22:30",
        priority: "high",
        category: "Angličtina",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  const task = page.locator(".df2-week-task").filter({ hasText: "Cambridge mock test" });
  await expect(task).toBeVisible();
  await task.click();

  const modal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  const complete = modal.getByRole("button", { name: "Označit hotovo" });
  await expect(complete).toHaveClass(/df2-completion-action/);
  await complete.click();

  const feedback = page.locator('[data-completion-experience="true"]');
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText("Jarvis");
  await expect(feedback).toContainText("Hlavní priorita splněna");
  await expect(feedback).toContainText("Cambridge mock test");

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return Object.values(state.plans || {}).flat().find((item) => item.id === "completion-priority")?.completed;
  })).toBe(true);

  await expect(task).toHaveClass(/done/);
  await expect(page.locator("body")).not.toContainText(/streak/i);
});

test("normal task completion gets a compact Hotovo acknowledgement", async ({ page }) => {
  await openFresh(page);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [date]: [{
        id: "completion-normal",
        title: "Projít poznámky",
        date,
        duration: 45,
        start: "16:00",
        end: "16:45",
        requestedStart: "16:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-task").filter({ hasText: "Projít poznámky" }).click();
  const modal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  await modal.getByRole("button", { name: "Označit hotovo" }).click();

  const feedback = page.locator('[data-completion-experience="true"]');
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText("Hotovo");
  await expect(feedback).toContainText("Projít poznámky");
  await expect(feedback).not.toContainText("Hlavní priorita splněna");
});

test("completion acknowledgement survives an immediate synchronous reload", async ({ page }) => {
  await openFresh(page);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [date]: [{
        id: "reload-completion",
        title: "Dokončit valuation",
        date,
        duration: 60,
        start: "19:00",
        end: "20:00",
        requestedStart: "19:00",
        deadlineTime: "22:30",
        priority: "high",
        category: "Finance",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(350);

  const navigation = page.waitForNavigation({ waitUntil: "networkidle" });
  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = Object.values(state.plans || {}).flat().find((item) => item.id === "reload-completion");
    task.completed = true;
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.setTimeout(() => window.location.reload(), 0);
  });
  await navigation;

  const feedback = page.locator('[data-completion-experience="true"]');
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText("Hlavní priorita splněna");
  await expect(feedback).toContainText("Dokončit valuation");
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("dayframe-completion-pending-v1"))).toBe(null);
});

test("completion pulse targets the exact task when repeated tasks share a title", async ({ page }) => {
  await openFresh(page);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const firstDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const secondDate = new Date(firstDate);
    secondDate.setDate(secondDate.getDate() + 1);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const firstKey = key(firstDate);
    const secondKey = key(secondDate);
    const make = (id, date, completed) => ({
      id,
      title: "Běžná angličtina",
      date,
      duration: 60,
      start: "12:00",
      end: "13:00",
      requestedStart: "12:00",
      deadlineTime: "22:30",
      priority: "normal",
      category: "Angličtina",
      mode: "flexible",
      completed,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    });
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [firstKey]: [make("duplicate-first", firstKey, true)],
      [secondKey]: [make("duplicate-second", secondKey, false)],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  const second = page.locator(".df2-week-task:not(.done)").filter({ hasText: "Běžná angličtina" });
  await expect(second).toHaveCount(1);
  await second.click();
  const modal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  await modal.getByRole("button", { name: "Označit hotovo" }).click();

  const exact = page.locator('[data-completion-task-id="duplicate-second"]');
  await expect(exact).toHaveCount(2);
  await expect(page.locator('.df2-week-task[data-completion-task-id="duplicate-second"]')).toBeVisible();
  await expect(page.locator('.df2-week-task[data-completion-task-id="duplicate-first"]')).toHaveCount(0);
  await expect(page.locator('[data-completion-experience="true"][data-completion-task-id="duplicate-second"]')).toBeVisible();
});
