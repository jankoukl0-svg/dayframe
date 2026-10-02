import { test, expect } from "@playwright/test";

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function openFreshToday(page) {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

async function openBriefing(page) {
  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const modal = page.locator("[data-today-briefing-modal]");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("dialog", { name: "Ranní briefing" })).toBeVisible();
  return modal.locator("[data-today-briefing]");
}

test("Today briefing lives in a separate modal, summarizes the plan, and stays in sync", async ({ page }) => {
  await openFreshToday(page);

  await page.evaluate((date) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date().toISOString();
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "briefing-priority",
          title: "Cambridge essay",
          date,
          duration: 90,
          start: "09:00",
          end: "10:30",
          requestedStart: "09:00",
          deadlineTime: "22:30",
          priority: "high",
          category: "Angličtina",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now,
        },
        {
          id: "briefing-math",
          title: "Matematika",
          date,
          duration: 60,
          start: "11:00",
          end: "12:00",
          requestedStart: "11:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now,
        },
      ],
    };
    state.backlog = [];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, await page.evaluate(planningDateKeyInBrowser));

  await page.reload({ waitUntil: "networkidle" });

  await expect(page.locator("[data-today-briefing]")).toHaveCount(0);
  const briefing = await openBriefing(page);
  await expect(briefing).toContainText("Briefing");
  await expect(briefing).toContainText("Cambridge essay");
  await expect(briefing).toContainText("2 h 30 min");
  await expect(briefing).toContainText("0/2");

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    for (const tasks of Object.values(state.plans || {})) {
      const task = tasks.find((item) => item.id === "briefing-priority");
      if (task) task.completed = true;
    }
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  });

  await expect(briefing).toContainText("1/2");
  await expect(briefing.locator(".df2-briefing-priority")).toContainText("Matematika");

  const closeButton = page.getByRole("button", { name: "Zavřít briefing" });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
  await expect(page.locator("[data-today-briefing-launcher]")).toBeFocused();

  await openBriefing(page);
  await page.keyboard.press("w");
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Týden" })).toBeVisible();
  await expect(page.locator("[data-today-briefing-launcher]")).toHaveCount(0);

  await page.getByRole("button", { name: /Dnes/ }).click();
  await expect(page.locator("[data-today-briefing-launcher]")).toBeVisible();
  await expect(page.locator("[data-today-briefing]")).toHaveCount(0);
});

test("Today briefing treats a manually running Focus session as the source of truth", async ({ page }) => {
  await openFreshToday(page);
  const date = await page.evaluate(planningDateKeyInBrowser);

  await page.evaluate((planningDate) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date().toISOString();
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [planningDate]: [
        {
          id: "running-focus",
          title: "Ruční Focus",
          date: planningDate,
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
          actualRunningSince: now,
          createdAt: now,
        },
        {
          id: "unscheduled-high",
          title: "Pozdější priorita",
          date: planningDate,
          duration: 45,
          deadlineTime: "22:30",
          priority: "high",
          category: "Angličtina",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: true,
          createdAt: now,
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, date);

  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  await expect(briefing.locator(".df2-briefing-priority")).toContainText("Ruční Focus");
  await expect(briefing.locator(".df2-briefing-signals")).toContainText("Právě teď");
  await expect(briefing.locator(".df2-briefing-signals")).toContainText("Ruční Focus");

  await page.getByRole("button", { name: "Zavřít briefing" }).click();
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
});
