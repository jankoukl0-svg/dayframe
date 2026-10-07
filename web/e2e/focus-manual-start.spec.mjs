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

async function trackedTask(page, date) {
  return page.evaluate(({ date: targetDate }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[targetDate]
      .find((item) => item.id === "manual-focus-start");
    return {
      started: task?.actualStartedAt,
      accumulated: task?.actualAccumulatedSeconds ?? 0,
      running: task?.actualRunningSince,
    };
  }, { date });
}

test("focus waits for Start before counting down or recording execution", async ({ page }) => {
  const seeded = await setup(page);

  await page.keyboard.press("3");
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

  const beforeTracking = await trackedTask(page, seeded.date);
  expect(beforeTracking.started).toBeUndefined();
  expect(beforeTracking.running).toBeUndefined();

  await start.click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  const afterStart = clockToSeconds(await clock.innerText());
  expect(afterStart).toBeLessThan(stillBeforeStart);

  await expect.poll(async () => {
    const task = await trackedTask(page, seeded.date);
    return Boolean(task.started && task.running);
  }).toBe(true);
});

test("running focus derives countdown from persisted time after a background gap", async ({ page }) => {
  const seeded = await setup(page);

  await page.keyboard.press("3");
  const controls = page.locator(".df2-time-adjust-focus-controls");
  const clock = page.locator(".df2-controller-focus-clock");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  const beforeGap = clockToSeconds(await clock.innerText());

  await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[date].find((item) => item.id === "manual-focus-start");
    task.actualRunningSince = new Date(Date.now() - 8_000).toISOString();
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    document.dispatchEvent(new Event("visibilitychange"));
  }, seeded);

  await expect.poll(async () => clockToSeconds(await clock.innerText())).toBeLessThanOrEqual(beforeGap - 7);
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
});

test("started focus keeps running after leaving the focus screen until Pause is clicked", async ({ page }) => {
  const seeded = await setup(page);

  await page.keyboard.press("3");
  const controls = page.locator(".df2-time-adjust-focus-controls");
  const clock = page.locator(".df2-controller-focus-clock");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  const beforeLeaving = clockToSeconds(await clock.innerText());

  await page.keyboard.press("1");
  await expect(page.locator(".df2-today-view")).toBeVisible();
  const whileAway = await trackedTask(page, seeded.date);
  expect(whileAway.running).toBeTruthy();

  await page.waitForTimeout(1400);
  const stillRunningAway = await trackedTask(page, seeded.date);
  expect(stillRunningAway.running).toBeTruthy();

  await page.keyboard.press("3");
  await expect(page.locator(".df2-focus-view")).toBeVisible();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  const afterReturning = clockToSeconds(await clock.innerText());
  expect(afterReturning).toBeLessThan(beforeLeaving);

  await controls.getByRole("button", { name: "Pauza", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pokračovat", exact: true })).toBeVisible();
  await expect.poll(async () => (await trackedTask(page, seeded.date)).running).toBeUndefined();

  const paused = await trackedTask(page, seeded.date);
  await page.waitForTimeout(1300);
  const afterPauseWait = await trackedTask(page, seeded.date);
  expect(afterPauseWait.accumulated).toBe(paused.accumulated);
  expect(afterPauseWait.running).toBeUndefined();
});

test("an explicit pause stays paused after leaving and reopening focus", async ({ page }) => {
  await setup(page);

  await page.keyboard.press("3");
  const controls = page.locator(".df2-time-adjust-focus-controls");
  const clock = page.locator(".df2-controller-focus-clock");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
  await controls.getByRole("button", { name: "Pauza", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pokračovat", exact: true })).toBeVisible();

  await page.keyboard.press("1");
  await expect(page.locator(".df2-today-view")).toBeVisible();
  await page.waitForTimeout(700);
  await page.keyboard.press("3");
  await expect(page.locator(".df2-focus-view")).toBeVisible();
  await expect(controls.getByRole("button", { name: "Pokračovat", exact: true })).toBeVisible();

  const before = clockToSeconds(await clock.innerText());
  await page.waitForTimeout(1300);
  const after = clockToSeconds(await clock.innerText());
  expect(after).toBe(before);
});
