import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function clockToSeconds(text) {
  const [minutes, seconds] = text.trim().split(":").map(Number);
  return minutes * 60 + seconds;
}

async function seedActiveTask(page) {
  return page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minute = now.getHours() * 60 + now.getMinutes();
    const startMinute = Math.max(0, minute - 5);
    const endMinute = Math.min(23 * 60 + 58, minute + 20);
    const toTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

    state.routines = [];
    state.plans[date] = [{
      id: "manual-focus-start",
      title: "Lineární funkce",
      date,
      duration: endMinute - startMinute,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matematika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date };
  });
}

async function setup(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  const seeded = await seedActiveTask(page);
  await page.reload({ waitUntil: "networkidle" });
  return seeded;
}

test("focus waits for Start before counting down or recording execution", async ({ page }) => {
  const seeded = await setup(page);

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const focus = page.locator(".df2-focus-view");
  await expect(focus).toBeVisible();

  const controls = page.locator(".df2-time-adjust-focus-controls");
  const start = controls.getByRole("button", { name: "Start", exact: true });
  await expect(start).toBeVisible();

  const clock = page.locator(".df2-controller-focus-clock");
  await expect(clock).toBeVisible();
  const before = clockToSeconds(await clock.innerText());
  await page.waitForTimeout(1300);
  const stillBeforeStart = clockToSeconds(await clock.innerText());
  expect(stillBeforeStart).toBe(before);

  const beforeTracking = await page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "manual-focus-start");
    return { started: task?.actualStartedAt, running: task?.actualRunningSince };
  }, seeded);
  expect(beforeTracking.started).toBeUndefined();
  expect(beforeTracking.running).toBeUndefined();

  await start.click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  const afterStart = clockToSeconds(await clock.innerText());
  expect(afterStart).toBeLessThan(stillBeforeStart);

  await expect.poll(() => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "manual-focus-start");
    return Boolean(task?.actualStartedAt && task?.actualRunningSince);
  }, seeded)).toBe(true);

  await controls.getByRole("button", { name: "Pauza", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pokračovat", exact: true })).toBeVisible();
});

test("reopening focus pauses persisted execution until Start is clicked again", async ({ page }) => {
  const seeded = await setup(page);

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const controls = page.locator(".df2-time-adjust-focus-controls");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await page.waitForTimeout(1100);

  await page.keyboard.press("1");
  await expect(page.locator(".df2-today-view")).toBeVisible();
  await page.getByRole("button", { name: "Zahájit blok" }).click();
  await expect(page.locator(".df2-focus-view")).toBeVisible();
  await expect(controls.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const paused = await expect.poll(() => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "manual-focus-start");
    return {
      accumulated: task?.actualAccumulatedSeconds ?? 0,
      running: task?.actualRunningSince,
    };
  }, seeded)).toMatchObject({ running: undefined });

  const beforeWait = await page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "manual-focus-start");
    return task?.actualAccumulatedSeconds ?? 0;
  }, seeded);
  await page.waitForTimeout(1300);
  const afterWait = await page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "manual-focus-start");
    return {
      accumulated: task?.actualAccumulatedSeconds ?? 0,
      running: task?.actualRunningSince,
    };
  }, seeded);

  expect(afterWait.accumulated).toBe(beforeWait);
  expect(afterWait.running).toBeUndefined();
});
