import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("elapsed milestone disappears from Milníky but remains in calendar with days-ago badge", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 12);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [
      { id: "history-past", title: "Minulý milník", date: key(yesterday), note: "Historie" },
      { id: "history-today", title: "Dnešní milník", date: key(today), note: "Dnes" },
      { id: "history-future", title: "Budoucí milník", date: key(future), note: "Budoucnost" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-milestone-hidden-colors-v1", JSON.stringify({ preset: [], custom: false }));
    return { past: key(yesterday), today: key(today), future: key(future) };
  });

  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /^Milníky/ }).click();
  const milestones = page.locator(".df2-milestones");
  const pastRow = milestones.locator("article", { hasText: "Minulý milník" });
  await expect(pastRow).toBeHidden();
  await expect(milestones.locator("article", { hasText: "Dnešní milník" })).toBeVisible();
  await expect(milestones.locator("article", { hasText: "Budoucí milník" })).toBeVisible();

  const storedPastStillExists = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.milestones.some((milestone) => milestone.id === "history-past");
  });
  expect(storedPastStillExists).toBe(true);

  await page.locator(".df2-month-calendar-nav-button").click();
  let pastCalendarMilestone = page.locator('.df2-month-milestone[data-milestone-id="history-past"]');
  if (await pastCalendarMilestone.count() === 0) {
    await page.getByRole("button", { name: "Předchozí měsíc" }).click();
    pastCalendarMilestone = page.locator('.df2-month-milestone[data-milestone-id="history-past"]');
  }

  await expect(pastCalendarMilestone).toBeVisible();
  const pastCountdown = pastCalendarMilestone.locator(".df2-month-countdown");
  await expect(pastCountdown).toHaveText("před 1 dnem");
  await expect(pastCountdown).toHaveClass(/is-past/);
  await expect(pastCalendarMilestone).toContainText("Minulý milník");

  if (seeded.today.slice(0, 7) === seeded.past.slice(0, 7)) {
    const todayMilestone = page.locator('.df2-month-milestone[data-milestone-id="history-today"]');
    await expect(todayMilestone.locator(".df2-month-countdown")).toHaveText("dnes");
    await expect(todayMilestone.locator(".df2-month-countdown")).not.toHaveClass(/is-past/);
  }
});
