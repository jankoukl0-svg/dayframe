import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function toTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

test("focus +15 immediately extends the same block in week view", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const toTime = (value) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute > 23 * 60 + 20) return { supported: false };

    const startMinute = minute < 10 * 60 ? 10 * 60 : Math.max(10 * 60, minute - 5);
    const endMinute = Math.max(startMinute + 30, minute + 20);
    if (endMinute + 15 > 23 * 60 + 59) return { supported: false };
    const extendedEnd = Math.max(endMinute, minute) + 15;

    state.routines = [];
    state.plans[date] = [{
      id: "focus-week-sync-test",
      title: "Focus sync test",
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
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return {
      supported: true,
      date,
      start: toTime(startMinute),
      oldEnd: toTime(endMinute),
      extendedEnd: toTime(extendedEnd),
    };
  });

  if (!seeded.supported) test.skip();
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const focusControls = page.locator(".df2-time-adjust-focus-controls");
  await expect(focusControls).toBeVisible();
  await focusControls.getByRole("button", { name: "+15 min", exact: true }).click();

  await expect.poll(() => page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans[date].find((task) => task.id === "focus-week-sync-test")?.end;
  }, seeded)).toBe(seeded.extendedEnd);

  await page.getByRole("button", { name: "Týden" }).click();
  const weekBlock = page.locator(".df2-week-task").filter({ hasText: "Focus sync test" });
  await expect(weekBlock).toBeVisible();
  await expect(weekBlock).toContainText(`${seeded.start}–${seeded.extendedEnd}`);
  await expect(weekBlock).not.toContainText(`${seeded.start}–${seeded.oldEnd}`);
});
