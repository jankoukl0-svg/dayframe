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

  const bodyBox = await body.boundingBox();
  if (!bodyBox) throw new Error("Week body has no bounding box");

  await task.dragTo(body, {
    sourcePosition: { x: 24, y: 8 },
    targetPosition: { x: Math.min(80, Math.max(20, bodyBox.width / 2)), y: bodyBox.height - 30 },
  });

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = Object.values(state.plans || {}).flat().find((item) => item.id === "late-drag-test");
    return task ? `${task.start}-${task.end}` : "missing";
  })).toBe("22:40-23:00");
});
