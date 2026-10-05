import { test, expect } from "@playwright/test";

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKeyInBrowser(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function openFreshToday(page) {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { temperature_2m: 18, apparent_temperature: 18, weather_code: 1, wind_speed_10m: 8 },
        daily: {
          temperature_2m_max: [20],
          temperature_2m_min: [10],
          precipitation_probability_max: [10],
          sunrise: ["2026-10-05T07:00"],
          sunset: ["2026-10-05T18:30"],
        },
      }),
    });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

async function openBriefing(page) {
  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const host = page.locator("[data-today-briefing]");
  await expect(host).toBeVisible();
  return host;
}

test("Jarvis behaves like an advisor: hides activity KPIs, surfaces relevant advice and stays quiet otherwise", async ({ page }) => {
  await openFreshToday(page);
  const today = await page.evaluate(planningDateKeyInBrowser);
  const milestoneDate = await page.evaluate(({ key }) => {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + 7);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, { key: today });
  const tomorrow = await page.evaluate(({ key }) => {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, { key: today });
  const birthdayDate = await page.evaluate(({ key }) => {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + 5);
    return { month: date.getMonth() + 1, day: date.getDate() };
  }, { key: today });

  await page.evaluate(({ todayKey, tomorrowKey, milestoneKey, birthday }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const createdAt = new Date().toISOString();
    state.routines = [];
    state.backlog = [];
    state.milestones = [{ id: "advisor-c1", title: "Cambridge C1 test", date: milestoneKey, note: "" }];
    state.plans = {
      [todayKey]: [
        {
          id: "advisor-today",
          title: "CFI Excel",
          date: todayKey,
          duration: 90,
          start: "18:00",
          end: "19:30",
          requestedStart: "18:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Finance",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt,
        },
      ],
      [tomorrowKey]: [
        {
          id: "advisor-tomorrow-1",
          title: "Ekonomie",
          date: tomorrowKey,
          duration: 180,
          start: "08:00",
          end: "11:00",
          requestedStart: "08:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Ekonomie",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt,
        },
        {
          id: "advisor-tomorrow-2",
          title: "Projekt",
          date: tomorrowKey,
          duration: 180,
          start: "13:00",
          end: "16:00",
          requestedStart: "13:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt,
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", JSON.stringify([
      { id: "advisor-birthday", name: "Tomáš", month: birthday.month, day: birthday.day, note: "koupit dárek" },
    ]));
  }, { todayKey: today, tomorrowKey: tomorrow, milestoneKey: milestoneDate, birthday: birthdayDate });

  await page.reload({ waitUntil: "networkidle" });
  const briefing = await openBriefing(page);

  await expect(briefing.locator(".df2-briefing-signals")).not.toBeVisible();
  const advisor = briefing.locator("[data-jarvis-advisor]");
  await expect(advisor).toBeVisible();
  await expect(advisor).toContainText("Příprava na Cambridge C1 test");
  await expect(advisor).toContainText("v plánu nemáš žádný související blok");
  await expect(advisor).toContainText("Tomáš · za 5 dní");
  await expect(advisor).toContainText("koupit dárek");
  await expect(advisor).toContainText("Zítřek je výrazně plnější");
  await expect(briefing.locator("[data-jarvis-advice]")).toHaveCount(3);

  await page.evaluate(({ todayKey }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const far = new Date(`${todayKey}T12:00:00`);
    far.setDate(far.getDate() + 40);
    const farKey = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, "0")}-${String(far.getDate()).padStart(2, "0")}`;
    state.milestones = [{ id: "far", title: "Vzdálený termín", date: farKey, note: "" }];
    state.plans = { [todayKey]: state.plans[todayKey] || [] };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", "[]");
    window.dispatchEvent(new Event("dayframe-state-sync"));
    window.dispatchEvent(new Event("dayframe-birthdays-sync"));
  }, { todayKey: today });

  await expect(briefing.locator("[data-jarvis-advisor]")).toHaveCount(0);
});
