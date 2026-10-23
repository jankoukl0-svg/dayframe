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
  await page.getByRole("button", { name: "Týden", exact: true }).click();
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
  await page.getByRole("button", { name: "Týden", exact: true }).click();
  await page.locator(".df2-week-controls button").first().click();

  const persisted = page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy historie" });
  await expect(persisted).toBeVisible();
  await expect(persisted).toContainText("22:40–23:20");
  await expect.poll(async () => persisted.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(28.8, 0);
});


test("completed Week reading block shows historical book and actual page count, not current progress", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);

  const date = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12);
    const date = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans[date] = [
      {
        id: "historic-book-block", title: "Čtení knihy", date, duration: 65,
        start: "00:25", end: "01:30", completed: true, actualMinutes: 65,
        category: "Rutina", routineId: "read", source: "user", priority: "normal",
      },
      {
        id: "historic-non-reading", title: "Matematika", date, duration: 30,
        start: "11:00", end: "11:30", completed: true,
        category: "Studium", source: "user", priority: "normal",
      },
    ];
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    localStorage.setItem("dayframe-reading-sessions-v1", JSON.stringify({
      version: 1, entries: [
        { id: "session-old", taskId: "historic-book-block", date,
          bookId: "undercover", bookTitle: "The Undercover Economist",
          pages: 37, durationMinutes: 65, loggedAt: new Date().toISOString() },
      ], skippedTaskIds: [],
    }));
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1, current: { id: "psych", title: "The Psychology of Money",
        currentPage: 80, totalPages: 253, startedAt: new Date().toISOString() },
      reading: [], completed: [{ id: "undercover", title: "The Undercover Economist",
        currentPage: 300, totalPages: 300,
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }],
    }));
    return date;
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Týden", exact: true }).click();
  await page.locator(".df2-week-controls button").first().click();
  const block = page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy" });
  await expect(block).toBeVisible();
  await block.click();
  const modal = page.locator(".df2-history-edit-modal");
  const details = modal.getByRole("region", { name: "Záznam čtení" });
  await expect(details).toContainText("The Undercover Economist");
  await expect(details).toContainText("37 stran");
  await expect(details).not.toContainText("The Psychology of Money");
  await expect(modal.locator('input[name="actualMinutes"]')).toHaveValue("65");

  // Editing this completed task must not alter its historical reading record.
  await modal.locator('input[name="actualMinutes"]').fill("60");
  await modal.getByRole("button", { name: "Uložit opravu" }).click();
  await expect(modal).toBeHidden();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Týden", exact: true }).click();
  await page.locator(".df2-week-controls button").first().click();
  await page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy" }).click();
  await expect(page.getByRole("region", { name: "Záznam čtení" })).toContainText("37 stran");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("dayframe-reading-sessions-v1") || "{}"));
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({ taskId: "historic-book-block", date, pages: 37,
    bookTitle: "The Undercover Economist" });
  await page.locator(".df2-history-edit-modal header button").click();

  await page.locator(".df2-week-task.done").filter({ hasText: "Matematika" }).click();
  await expect(page.locator(".df2-history-edit-modal")).toBeVisible();
  await expect(page.getByRole("region", { name: "Záznam čtení" })).toHaveCount(0);
});

test("completed reading block with no page log explains that historical details are not recorded", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12);
    const date = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans[date] = [{
      id: "unlogged-book", title: "Čtení knihy", date, duration: 30,
      start: "18:00", end: "18:30", completed: true,
      category: "Čtení", source: "user", priority: "normal",
    }];
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    localStorage.removeItem("dayframe-reading-sessions-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Týden", exact: true }).click();
  await page.locator(".df2-week-controls button").first().click();
  await page.locator(".df2-week-task.done").filter({ hasText: "Čtení knihy" }).click();
  const details = page.getByRole("region", { name: "Záznam čtení" });
  await expect(details).toContainText("U tohoto bloku není uložen název knihy ani počet přečtených stran");
});
