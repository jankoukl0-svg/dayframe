import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function planningKey() {
  const now = new Date();
  if (now.getHours() < 2) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

test("personal blocks occupy the Week but stay out of Přehled", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = {};
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Týden/ }).click();
  const today = page.locator(".df2-week-day.today");
  await expect(today).toBeVisible();
  await today.locator(".df2-week-day-head > button").click();

  const personalToggle = page.locator("[data-personal-block-toggle]");
  await expect(personalToggle).toBeVisible();
  await expect(personalToggle).toContainText("Osobní");
  await page.locator(".df2-title-input input").fill("Posilovna");
  await personalToggle.click();
  await expect(personalToggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Naplánovat", exact: true }).click();

  await expect(today).toContainText("Posilovna");
  await expect.poll(() => page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    const task = (state.plans?.[date] || []).find((item) => item.title === "Posilovna");
    return task?.category || null;
  }, planningKey())).toBe("Osobní");

  const seededDate = planningKey();
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date().toISOString();
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "study-counted",
          title: "Matematika",
          date,
          duration: 60,
          start: "10:00",
          end: "11:00",
          requestedStart: "10:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now,
        },
        {
          id: "personal-excluded",
          title: "Posilovna",
          date,
          duration: 120,
          start: "18:00",
          end: "20:00",
          requestedStart: "18:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Osobní",
          mode: "flexible",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now,
        },
      ],
    };
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, seededDate);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Týden/ }).click();
  await expect(page.locator(".df2-week-day").filter({ hasText: "Posilovna" })).toBeVisible();

  await page.getByRole("button", { name: /Přehled/ }).click();
  const summary = page.locator(".df2-overview-summary");
  await expect(summary).toContainText("1 h");
  await expect(summary).toContainText("1 z 1 bloků");
  await expect(page.locator(".df2-history-categories")).toContainText("Matika");
  await expect(page.locator(".df2-history-categories")).not.toContainText("Osobní");
  await expect(page.locator(".df2-history-bars article").filter({ has: page.locator('[data-category="Osobní"]') })).toHaveCount(0);
});
