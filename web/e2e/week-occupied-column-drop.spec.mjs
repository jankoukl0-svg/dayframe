import { test, expect } from "@playwright/test";

test("dropping into an occupied day finds another free slot instead of losing the task", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const planning = new Date();
    if (planning.getHours() < 2) planning.setDate(planning.getDate() - 1);
    planning.setHours(12, 0, 0, 0);
    const todayIndex = (planning.getDay() + 6) % 7;
    const monday = new Date(planning);
    monday.setDate(monday.getDate() - todayIndex);
    const targetIndex = todayIndex === 6 ? 5 : todayIndex + 1;
    const targetDate = new Date(monday);
    targetDate.setDate(targetDate.getDate() + targetIndex);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const fromDate = key(planning);
    const toDate = key(targetDate);
    const now = new Date().toISOString();

    state.routines = [];
    state.plans = {
      [fromDate]: [{
        id: "cross-day-source",
        title: "Přesouvaný blok",
        date: fromDate,
        duration: 30,
        start: "09:00",
        end: "09:30",
        requestedStart: "09:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now,
      }],
      [toDate]: [{
        id: "occupied-target",
        title: "Dlouhý blok v cíli",
        date: toDate,
        duration: 180,
        start: "10:00",
        end: "13:00",
        requestedStart: "10:00",
        deadlineTime: "22:30",
        priority: "normal",
        category: "Matika",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now,
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { fromDate, toDate, targetIndex };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  const sourceDay = page.locator(".df2-week-day.today");
  const targetDay = page.locator(".df2-week-day").nth(seeded.targetIndex);
  const source = sourceDay.locator(".df2-week-task").filter({ hasText: "Přesouvaný blok" });
  const targetBody = targetDay.locator(".df2-time-body");
  await expect(source).toBeVisible();
  await expect(targetDay.locator(".df2-week-task").filter({ hasText: "Dlouhý blok v cíli" })).toBeVisible();

  await page.evaluate(() => {
    const source = document.querySelector(".df2-week-day.today .df2-week-task");
    if (!(source instanceof HTMLElement)) throw new Error("Source task not found");
    const rect = source.getBoundingClientRect();
    const transfer = new DataTransfer();
    window.__occupiedColumnTransfer = transfer;
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + 20,
      clientY: rect.top + 2,
    }));
  });

  await page.evaluate(({ targetIndex }) => {
    const target = [...document.querySelectorAll(".df2-week-day")][targetIndex]?.querySelector(".df2-time-body");
    const transfer = window.__occupiedColumnTransfer;
    if (!(target instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("Target day not ready");
    const rect = target.getBoundingClientRect();
    const pointerMinute = 11 * 60 + 30;
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.max(20, rect.width / 2),
      clientY: rect.top + (pointerMinute - 8 * 60) * 0.72,
    };
    target.dispatchEvent(new DragEvent("dragover", options));
  }, seeded);

  await expect(targetBody.locator(".df2-cross-day-drop-preview")).toBeVisible();

  await page.evaluate(({ targetIndex }) => {
    const target = [...document.querySelectorAll(".df2-week-day")][targetIndex]?.querySelector(".df2-time-body");
    const transfer = window.__occupiedColumnTransfer;
    if (!(target instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("Target day not ready");
    const rect = target.getBoundingClientRect();
    const pointerMinute = 11 * 60 + 30;
    target.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.max(20, rect.width / 2),
      clientY: rect.top + (pointerMinute - 8 * 60) * 0.72,
    }));
  }, seeded);

  await expect.poll(() => page.evaluate(({ fromDate, toDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const source = Object.values(state.plans || {}).flat().find((task) => task.id === "cross-day-source");
    const targetIds = (state.plans?.[toDate] || []).map((task) => task.id).sort();
    const sourceStillAtOrigin = (state.plans?.[fromDate] || []).some((task) => task.id === "cross-day-source");
    return {
      date: source?.date || "missing",
      targetIds,
      sourceStillAtOrigin,
    };
  }, seeded)).toEqual({
    date: seeded.toDate,
    targetIds: ["cross-day-source", "occupied-target"],
    sourceStillAtOrigin: false,
  });

  await expect(targetDay.locator(".df2-week-task").filter({ hasText: "Přesouvaný blok" })).toBeVisible();
  await expect(targetDay.locator(".df2-week-task").filter({ hasText: "Dlouhý blok v cíli" })).toBeVisible();
});
