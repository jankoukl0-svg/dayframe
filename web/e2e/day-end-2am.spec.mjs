import { test, expect } from "@playwright/test";

test("week stays usable through 02:00 and ordinary tasks can move to 01:30", async ({ page }) => {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [{
        id: "ordinary-2am-test",
        title: "Noční úkol",
        date,
        duration: 20,
        start: "20:00",
        end: "20:20",
        requestedStart: "20:00",
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
    return { date };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  const today = page.locator(".df2-week-day.today");
  const body = today.locator(".df2-time-body");
  const labels = await today.locator(".df2-hour-line em").allTextContents();
  expect(labels.slice(-3)).toEqual(["00:00", "01:00", "02:00"]);

  await page.evaluate(() => {
    const source = [...document.querySelectorAll(".df2-week-day.today .df2-week-task")]
      .find((element) => element.textContent?.includes("Noční úkol"));
    if (!(source instanceof HTMLElement)) throw new Error("Night task not found");
    const rect = source.getBoundingClientRect();
    const transfer = new DataTransfer();
    window.__dayframe2amTransfer = transfer;
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + 20,
      clientY: rect.top + 1,
    }));
  });

  await expect(body).toBeVisible();
  await page.evaluate(() => {
    const body = document.querySelector(".df2-week-day.today .df2-time-body");
    const transfer = window.__dayframe2amTransfer;
    if (!(body instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("2am drop target not ready");
    const rect = body.getBoundingClientRect();
    const targetMinute = 25 * 60 + 30;
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.min(80, Math.max(20, rect.width / 2)),
      clientY: rect.top + (targetMinute - 8 * 60) * 0.72 + 1,
    };
    body.dispatchEvent(new DragEvent("dragover", options));
    body.dispatchEvent(new DragEvent("drop", options));
  });

  await expect.poll(() => page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans?.[date]?.find((item) => item.id === "ordinary-2am-test");
    return task ? `${task.start}-${task.end}` : "missing";
  }, seeded)).toBe("01:30-01:50");

  await expect(today.locator(".df2-week-task").filter({ hasText: "Noční úkol" })).toContainText("01:30–01:50");
});
