import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("editing only a task title preserves a renamed/custom category", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [{
        id: "preserve-edit-category",
        title: "Lineární funkce",
        date,
        duration: 100,
        start: "14:15",
        end: "15:55",
        requestedStart: "14:15",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Matematika",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-labels-v1", JSON.stringify(["Studium", "Matematika", "Finance"]));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-task").filter({ hasText: "Lineární funkce" }).click();

  const modal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  const category = modal.locator('select[name="category"]');
  await expect(category).toHaveValue("Matematika");

  await modal.locator('input[name="title"]').fill("Lineární funkce upraveno");
  await modal.getByRole("button", { name: "Uložit změny" }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = Object.values(state.plans || {}).flat().find((item) => item.id === "preserve-edit-category");
    return task ? { title: task.title, category: task.category } : null;
  })).toEqual({ title: "Lineární funkce upraveno", category: "Matematika" });

  await page.locator(".df2-week-task").filter({ hasText: "Lineární funkce upraveno" }).click();
  const reopened = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  const reopenedCategory = reopened.locator('select[name="category"]');
  await expect(reopenedCategory).toHaveValue("Matematika");
  await reopenedCategory.selectOption("Finance");
  await reopened.getByRole("button", { name: "Uložit změny" }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return Object.values(state.plans || {}).flat().find((item) => item.id === "preserve-edit-category")?.category;
  })).toBe("Finance");
});

test("duplicate unscheduled tasks preserve the category of the exact clicked task", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const baseTask = {
      title: "Stejný úkol",
      date,
      duration: 45,
      deadlineTime: "22:30",
      priority: "normal",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: true,
      createdAt: now.toISOString(),
    };
    state.routines = [];
    state.plans = {
      [date]: [
        { ...baseTask, id: "duplicate-first", category: "Matematika" },
        { ...baseTask, id: "duplicate-second", category: "Finance" },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-labels-v1", JSON.stringify(["Studium", "Matematika", "Finance"]));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  const duplicates = page.locator(".df2-unscheduled button").filter({ hasText: "Stejný úkol" });
  await expect(duplicates).toHaveCount(2);
  await duplicates.nth(1).click();

  const modal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit" }) });
  await expect(modal.locator('select[name="category"]')).toHaveValue("Finance");
  await modal.locator('input[name="title"]').fill("Druhý stejný úkol");
  await modal.getByRole("button", { name: "Uložit změny" }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const tasks = Object.values(state.plans || {}).flat();
    const first = tasks.find((item) => item.id === "duplicate-first");
    const second = tasks.find((item) => item.id === "duplicate-second");
    return {
      firstCategory: first?.category,
      secondCategory: second?.category,
      secondTitle: second?.title,
    };
  })).toEqual({
    firstCategory: "Matematika",
    secondCategory: "Finance",
    secondTitle: "Druhý stejný úkol",
  });
});
