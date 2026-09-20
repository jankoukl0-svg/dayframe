import { test, expect } from "@playwright/test";

async function seedActiveTask(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("dayframe-v1");
    const state = raw ? JSON.parse(raw) : null;
    if (!state?.plans) throw new Error("Dayframe state was not initialized before seeding the activity test.");

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minute = now.getHours() * 60 + now.getMinutes();
    const startMinute = Math.max(0, minute - 10);
    const endMinute = Math.min(23 * 60 + 58, minute + 20);
    const toTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const task = {
      id: "activity-test",
      title: "Testovací aktivita",
      date,
      duration: endMinute - startMinute,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Studium",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    };

    state.routines = [];
    state.plans[date] = [task];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, originalDuration: task.duration };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
});

test("finishing early shows saved time and records the real end", async ({ page }) => {
  const seeded = await seedActiveTask(page);
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();

  const finishChoice = page.locator(".df2-time-adjust-finish");
  await expect(finishChoice).toContainText(/\+\d+ min volných/);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    finishChoice.getByRole("button", { name: "Volno" }).click(),
  ]);

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date][0], seeded);
  expect(stored.completed).toBe(true);
  expect(stored.duration).toBeLessThan(seeded.originalDuration);
});

test("continuing an activity adds fifteen minutes", async ({ page }) => {
  const seeded = await seedActiveTask(page);
  await page.reload({ waitUntil: "networkidle" });

  const continueButton = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Pokračovat +15 min" });
  await expect(continueButton).toBeVisible();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    continueButton.click(),
  ]);

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date][0], seeded);
  expect(stored.completed).toBe(false);
  expect(stored.duration).toBe(seeded.originalDuration + 15);
});

test("focus mode lets the user keep working on the same activity", async ({ page }) => {
  const seeded = await seedActiveTask(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  await expect(page.locator(".df2-focus-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Testovací aktivita" })).toBeVisible();

  const focusControls = page.locator(".df2-time-adjust-focus-controls");
  const continueButton = focusControls.getByRole("button", { name: "Pokračovat +15 min" });
  await expect(focusControls.getByRole("button", { name: "Hotovo" })).toBeVisible();
  await expect(continueButton).toBeVisible();

  await continueButton.click();
  await expect(focusControls).toContainText("+15 min k aktivitě");
  await continueButton.click();
  await expect(focusControls).toContainText("+30 min k aktivitě");

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date][0], seeded);
  expect(stored.completed).toBe(false);
  expect(stored.duration).toBe(seeded.originalDuration + 30);
});
