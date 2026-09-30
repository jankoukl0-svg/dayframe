import { test, expect } from "@playwright/test";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("dragging a task between week days keeps the same user task instead of losing it", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const planning = new Date();
    if (planning.getHours() < 2) planning.setDate(planning.getDate() - 1);
    planning.setHours(12, 0, 0, 0);
    const todayIndex = (planning.getDay() + 6) % 7;
    const targetIndex = todayIndex === 6 ? 5 : todayIndex + 1;
    const monday = new Date(planning);
    monday.setDate(monday.getDate() - todayIndex);
    const target = new Date(monday);
    target.setDate(target.getDate() + targetIndex);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const fromDate = key(planning);
    const toDate = key(target);
    const createdAt = new Date().toISOString();

    state.routines = [];
    state.plans = {
      [fromDate]: [{
        id: "direct-cross-day-task",
        title: "Přesun mezi dny",
        date: fromDate,
        duration: 30,
        start: "10:00",
        end: "10:30",
        requestedStart: "10:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt,
      }],
      [toDate]: [],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { fromDate, toDate, todayIndex, targetIndex };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  const sourceDay = page.locator(".df2-week-day").nth(seeded.todayIndex);
  const targetDay = page.locator(".df2-week-day").nth(seeded.targetIndex);
  const source = sourceDay.locator(".df2-week-task").filter({ hasText: "Přesun mezi dny" });
  await expect(source).toBeVisible();

  await page.evaluate(({ todayIndex }) => {
    const source = [...document.querySelectorAll(".df2-week-day")][todayIndex]?.querySelector(".df2-week-task");
    if (!(source instanceof HTMLElement)) throw new Error("Source task not found");
    const rect = source.getBoundingClientRect();
    const transfer = new DataTransfer();
    window.__directCrossDayTransfer = transfer;
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + 20,
      clientY: rect.top + 2,
    }));
  }, seeded);

  await page.evaluate(({ targetIndex }) => {
    const body = [...document.querySelectorAll(".df2-week-day")][targetIndex]?.querySelector(".df2-time-body");
    const transfer = window.__directCrossDayTransfer;
    if (!(body instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("Target day not ready");
    const rect = body.getBoundingClientRect();
    const pointerMinute = 11 * 60;
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.max(20, rect.width / 2),
      clientY: rect.top + (pointerMinute - 8 * 60) * 0.72,
    };
    body.dispatchEvent(new DragEvent("dragover", options));
    body.dispatchEvent(new DragEvent("drop", options));
  }, seeded);

  await expect.poll(() => page.evaluate(({ fromDate, toDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const moved = Object.values(state.plans || {}).flat().find((task) => task.id === "direct-cross-day-task");
    return {
      date: moved?.date || "missing",
      originHasTask: (state.plans?.[fromDate] || []).some((task) => task.id === "direct-cross-day-task"),
      targetHasTask: (state.plans?.[toDate] || []).some((task) => task.id === "direct-cross-day-task"),
    };
  }, seeded)).toEqual({ date: seeded.toDate, originHasTask: false, targetHasTask: true });

  await expect(targetDay.locator(".df2-week-task").filter({ hasText: "Přesun mezi dny" })).toBeVisible();
});

test("Na zítra keeps a missed task saved even when tomorrow has no free slot", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  const currentHour = await page.evaluate(() => new Date().getHours());
  test.skip(currentHour >= 2 && currentHour < 9, "There is no guaranteed overdue 08:00 block before the planning morning starts.");
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const planning = new Date(now);
    if (planning.getHours() < 2) planning.setDate(planning.getDate() - 1);
    const today = `${planning.getFullYear()}-${String(planning.getMonth() + 1).padStart(2, "0")}-${String(planning.getDate()).padStart(2, "0")}`;
    const tomorrowDate = new Date(`${today}T12:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, "0")}-${String(tomorrowDate.getDate()).padStart(2, "0")}`;
    const createdAt = now.toISOString();
    const todayIndex = (planning.getDay() + 6) % 7;

    state.routines = [];
    state.plans = {
      [today]: [{
        id: "postpone-safety-task",
        title: "Dodělat zítra",
        date: today,
        duration: 30,
        start: "08:00",
        end: "08:30",
        requestedStart: "08:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt,
      }],
      [tomorrow]: [{
        id: "tomorrow-full",
        title: "Obsazený zítřek",
        date: tomorrow,
        duration: 870,
        start: "08:00",
        end: "22:30",
        requestedStart: "08:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Osobní",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt,
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { today, tomorrow, todayIndex };
  });

  await page.reload({ waitUntil: "networkidle" });
  const missed = page.locator(".df2-missed article").filter({ hasText: "Dodělat zítra" });
  await expect(missed).toBeVisible();
  await missed.getByRole("button", { name: "Na zítra" }).click();

  await expect.poll(() => page.evaluate(({ today, tomorrow }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const moved = (state.plans?.[tomorrow] || []).find((task) => task.id === "postpone-safety-task");
    return {
      originHasTask: (state.plans?.[today] || []).some((task) => task.id === "postpone-safety-task"),
      targetHasTask: Boolean(moved),
      start: moved?.start || "",
    };
  }, seeded)).toEqual({ originHasTask: false, targetHasTask: true, start: "" });

  await page.getByRole("button", { name: /Týden/ }).click();
  let tomorrowIndex = seeded.todayIndex + 1;
  if (tomorrowIndex > 6) {
    await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
    tomorrowIndex = 0;
  }
  const tomorrowDay = page.locator(".df2-week-day").nth(tomorrowIndex);
  await expect(tomorrowDay.locator(".df2-unscheduled").filter({ hasText: "Dodělat zítra" })).toBeVisible();
});
