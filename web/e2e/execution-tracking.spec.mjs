import { test, expect } from "@playwright/test";

function toTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

test("focus preserves the original plan and records actual work", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minute = now.getHours() * 60 + now.getMinutes();
    const startMinute = Math.max(0, minute - 5);
    const endMinute = Math.min(23 * 60 + 40, minute + 25);
    const time = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const task = {
      id: "tracked-focus",
      title: "Měřený focus",
      date,
      duration: endMinute - startMinute,
      start: time(startMinute),
      end: time(endMinute),
      requestedStart: time(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Finance",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    };
    state.routines = [];
    state.plans = { [date]: [task] };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, duration: task.duration };
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const focus = page.locator(".df2-focus-view");
  await expect(focus).toBeVisible();
  const controls = page.locator(".df2-time-adjust-focus-controls");
  await expect(controls).toBeVisible();

  await controls.getByRole("button", { name: "+15 min", exact: true }).click();
  await controls.getByRole("button", { name: "Hotovo" }).click();
  await expect(page.locator(".df2-time-adjust-focus-completion")).toBeVisible();
  await page.locator(".df2-time-adjust-focus-completion").getByRole("button", { name: "Volno" }).click();
  await page.waitForLoadState("networkidle");

  const stored = await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans[date].find((task) => task.id === "tracked-focus");
  }, seeded);

  expect(stored.completed).toBe(true);
  expect(stored.plannedDuration).toBe(seeded.duration);
  expect(stored.plannedStart).toMatch(/^\d{2}:\d{2}$/);
  expect(stored.plannedEnd).toMatch(/^\d{2}:\d{2}$/);
  expect(stored.actualStartedAt).toBeTruthy();
  expect(stored.actualEndedAt).toBeTruthy();
  expect(stored.actualMinutes).toBeGreaterThanOrEqual(1);
});
