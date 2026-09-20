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
    return { date, originalDuration: task.duration, remainingMinutes: endMinute - minute };
  });
}

function clockToSeconds(text) {
  const [minutes, seconds] = text.trim().split(":").map(Number);
  return minutes * 60 + seconds;
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
  await finishChoice.getByRole("button", { name: "Volno" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(({ date }) => {
    const tasks = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans?.[date] ?? [];
    return Boolean(tasks.find((task) => task.id === "activity-test")?.completed);
  }, seeded)).toBe(true);

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date].find((task) => task.id === "activity-test"), seeded);
  expect(stored.completed).toBe(true);
  expect(stored.duration).toBeLessThan(seeded.originalDuration);
});

test("saved time can be used for a short flexible task", async ({ page }) => {
  const seeded = await seedActiveTask(page);
  const prepared = await page.evaluate(({ date, remainingMinutes }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const active = state.plans[date].find((task) => task.id === "activity-test");
    const toMinutes = (time) => {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
    };
    const toTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const activeEnd = toMinutes(active.end);
    if (remainingMinutes < 10 || activeEnd + 40 > 22 * 60 + 30) return false;

    state.plans[date].push(
      {
        id: "next-task",
        title: "Delší další blok",
        date,
        duration: 30,
        start: toTime(activeEnd),
        end: toTime(activeEnd + 30),
        requestedStart: toTime(activeEnd),
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "short-task",
        title: "Krátké opakování",
        date,
        duration: 10,
        deadlineTime: "22:30",
        priority: "high",
        category: "Opakování",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: true,
        createdAt: new Date().toISOString(),
      },
    );
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return true;
  }, seeded);

  if (!prepared) return;
  await page.reload({ waitUntil: "networkidle" });

  await page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" }).click();
  const finishChoice = page.locator(".df2-time-adjust-finish");
  await expect(finishChoice.getByRole("button", { name: "Začít další" })).toBeVisible();
  const shortButton = finishChoice.getByRole("button", { name: /Krátký úkol/ });
  await expect(shortButton).toContainText("Krátké opakování");
  await shortButton.dispatchEvent("click");

  await expect.poll(() => page.evaluate(({ date }) => {
    const tasks = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans?.[date] ?? [];
    const task = tasks.find((item) => item.id === "short-task");
    return Boolean(task?.start && task?.end);
  }, seeded)).toBe(true);

  const shortStored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date].find((task) => task.id === "short-task"), seeded);
  expect(shortStored.start).toMatch(/^\d{2}:\d{2}$/);
  expect(shortStored.end).toMatch(/^\d{2}:\d{2}$/);
  expect(shortStored.completed).toBe(false);
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

test("focus mode uses the real block time and keeps only execution controls", async ({ page }) => {
  const seeded = await seedActiveTask(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  await expect(page.locator(".df2-focus-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Testovací aktivita" })).toBeVisible();

  const focusClock = page.locator(".df2-controller-focus-clock");
  await expect(focusClock).toBeVisible();
  const beforeSeconds = clockToSeconds(await focusClock.innerText());
  expect(beforeSeconds).toBeGreaterThan(0);
  expect(beforeSeconds).toBeLessThanOrEqual(Math.max(1, seeded.remainingMinutes) * 60);
  expect(beforeSeconds).toBeLessThan(21 * 60);

  const focusControls = page.locator(".df2-time-adjust-focus-controls");
  const continueButton = focusControls.getByRole("button", { name: "+15 min", exact: true });
  await expect(focusControls.getByRole("button", { name: "Pauza" })).toBeVisible();
  await expect(focusControls.getByRole("button", { name: "Hotovo" })).toBeVisible();
  await expect(continueButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Začít znovu" })).not.toBeVisible();
  await expect(continueButton).toHaveCSS("color", "rgb(247, 245, 241)");
  await expect(continueButton).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await focusControls.getByRole("button", { name: "Pauza" }).click();
  await expect(focusControls.getByRole("button", { name: "Pokračovat" })).toBeVisible();
  await focusControls.getByRole("button", { name: "Pokračovat" }).click();

  await continueButton.click();
  await expect(focusControls).toContainText("+15 min k aktivitě");
  const afterFirstExtension = clockToSeconds(await focusClock.innerText());
  expect(afterFirstExtension).toBeGreaterThanOrEqual(beforeSeconds + 14 * 60);

  await continueButton.click();
  await expect(focusControls).toContainText("+30 min k aktivitě");

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date][0], seeded);
  expect(stored.completed).toBe(false);
  expect(stored.duration).toBe(seeded.originalDuration + 30);
});

test("today can replan only the flexible remainder of the day", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minute = now.getHours() * 60 + now.getMinutes();
    const floor = Math.max(10 * 60, Math.ceil(minute / 15) * 15);
    const canMove = floor + 120 <= 22 * 60 + 30;
    const base = canMove ? floor : 19 * 60;
    const toTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const fixedStart = base + 45;
    const autoStart = base + 90;
    state.routines = [];
    state.plans[date] = [
      {
        id: "fixed-future",
        title: "Fixní schůzka",
        date,
        duration: 30,
        start: toTime(fixedStart),
        end: toTime(fixedStart + 30),
        requestedStart: toTime(fixedStart),
        deadlineTime: "22:30",
        priority: "normal",
        category: "Osobní",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      },
      {
        id: "auto-future",
        title: "Flexibilní blok",
        date,
        duration: 30,
        start: toTime(autoStart),
        end: toTime(autoStart + 30),
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: true,
        createdAt: now.toISOString(),
      },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, fixedStart: toTime(fixedStart), autoStart: toTime(autoStart), canMove };
  });
  await page.reload({ waitUntil: "networkidle" });

  const replanButton = page.getByRole("button", { name: "Přeplánovat zbytek dne" });
  await expect(replanButton).toBeVisible();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    replanButton.click(),
  ]);

  const result = await page.evaluate(({ date }) => {
    const tasks = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date];
    return {
      fixed: tasks.find((task) => task.id === "fixed-future"),
      auto: tasks.find((task) => task.id === "auto-future"),
    };
  }, seeded);
  expect(result.fixed.start).toBe(seeded.fixedStart);
  if (seeded.canMove) expect(result.auto.start).not.toBe(seeded.autoStart);
});

test("week view shows the current-time line on today", async ({ page }) => {
  await page.getByRole("button", { name: "Týden" }).click();
  const line = page.locator(".df2-current-time-line");
  await expect(line).toHaveCount(1);
  const minute = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  if (minute >= 10 * 60 && minute <= 23 * 60) await expect(line).toBeVisible();
  else await expect(line).toBeHidden();
});
