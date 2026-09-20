import { test, expect } from "@playwright/test";

test("a short block can be dragged back to 22:40 and end at 23:00", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [{
        id: "late-drag-test",
        title: "Pozdní čtení",
        date,
        duration: 20,
        start: "20:00",
        end: "20:20",
        requestedStart: "20:00",
        deadlineTime: "23:00",
        priority: "normal",
        category: "Rutina",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Týden/ }).click();
  const today = page.locator(".df2-week-day.today");
  const task = today.locator(".df2-week-task").filter({ hasText: "Pozdní čtení" });
  const body = today.locator(".df2-time-body");
  await expect(task).toBeVisible();
  await expect(body).toBeVisible();

  await page.evaluate(() => {
    const source = [...document.querySelectorAll(".df2-week-day.today .df2-week-task")]
      .find((element) => element.textContent?.includes("Pozdní čtení"));
    if (!(source instanceof HTMLElement)) throw new Error("Late task not found");
    const sourceRect = source.getBoundingClientRect();
    const transfer = new DataTransfer();
    window.__dayframeLateDragTransfer = transfer;
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: sourceRect.left + 24,
      clientY: sourceRect.top + 8,
    }));
  });

  await page.waitForTimeout(50);

  await page.evaluate(() => {
    const body = document.querySelector(".df2-week-day.today .df2-time-body");
    const transfer = window.__dayframeLateDragTransfer;
    if (!(body instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("Drag target not ready");
    const rect = body.getBoundingClientRect();
    const pointerMinute = 22 * 60 + 51;
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.min(80, Math.max(20, rect.width / 2)),
      clientY: rect.top + (pointerMinute - 10 * 60) * 0.72,
    };
    body.dispatchEvent(new DragEvent("dragover", options));
    body.dispatchEvent(new DragEvent("drop", options));
  });

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = Object.values(state.plans || {}).flat().find((item) => item.id === "late-drag-test");
    return task ? `${task.start}-${task.end}` : "missing";
  })).toBe("22:40-23:00");
});
