import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKey(key, amount) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function mockWeather(page) {
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { temperature_2m: 14, apparent_temperature: 13, weather_code: 2, wind_speed_10m: 8 },
        daily: {
          temperature_2m_max: [18],
          temperature_2m_min: [9],
          precipitation_probability_max: [15],
          sunrise: ["2026-10-05T07:01"],
          sunset: ["2026-10-05T18:31"],
        },
      }),
    });
  });
}

async function openFresh(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-weather-location-v1", JSON.stringify({
      latitude: 50.4,
      longitude: 14.9,
      acquiredAt: Date.now(),
    }));
  });
}

async function openBriefing(page) {
  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const briefing = page.locator("[data-today-briefing]");
  await expect(briefing).toBeVisible();
  return briefing;
}

function task(id, title, date, duration, start, category = "Studium", completed = false) {
  const endMinute = start ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + duration : null;
  const end = endMinute == null ? undefined : `${String(Math.floor((endMinute % 1440) / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
  return {
    id,
    title,
    date,
    duration,
    start,
    end,
    requestedStart: start,
    deadlineTime: "22:30",
    priority: "normal",
    category,
    mode: "flexible",
    completed,
    source: "user",
    dateLocked: true,
    autoScheduled: false,
    createdAt: new Date().toISOString(),
  };
}

test("Jarvis shows what waits on the next planning day after midnight", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T00:30:00Z"));
  await mockWeather(page);
  await openFresh(page);
  const planningToday = await page.evaluate(planningDateKeyInBrowser);
  const tomorrow = addDaysKey(planningToday, 1);

  await page.evaluate(({ tomorrow }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const makeTask = (id, title, duration, start, end, category) => ({
      id, title, date: tomorrow, duration, start, end, requestedStart: start,
      deadlineTime: "22:30", priority: "normal", category, mode: "flexible",
      completed: false, source: "user", dateLocked: true, autoScheduled: false,
      createdAt: new Date().toISOString(),
    });
    state.routines = [];
    state.backlog = [];
    state.milestones = [];
    state.plans = {
      [tomorrow]: [
        makeTask("tomorrow-english", "Cambridge C1", 60, "09:00", "10:00", "Angličtina"),
        makeTask("tomorrow-math", "Matematika", 90, "11:00", "12:30", "Matika"),
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { tomorrow });
  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  const tomorrowCard = briefing.locator("[data-jarvis-tomorrow]");
  await expect(tomorrowCard).toBeVisible();
  await expect(tomorrowCard).toContainText("Po probuzení");
  await expect(tomorrowCard).toContainText("2 h 30 min · 2 bloky");
  await expect(tomorrowCard).toContainText("První: 09:00 · Cambridge C1");
  await expect(tomorrowCard).toContainText("09:00–10:00");
  await expect(tomorrowCard).toContainText("11:00–12:30");
  await expect(tomorrowCard).toContainText("Matematika");
});

test("Jarvis milestone shows completed and planned preparation", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T15:00:00Z"));
  await mockWeather(page);
  await openFresh(page);
  const today = await page.evaluate(planningDateKeyInBrowser);
  const yesterday = addDaysKey(today, -1);
  const prepDay = addDaysKey(today, 2);
  const milestoneDate = addDaysKey(today, 7);

  await page.evaluate(({ today, yesterday, prepDay, milestoneDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const makeTask = (id, title, date, duration, start, end, category, completed) => ({
      id, title, date, duration, start, end, requestedStart: start,
      deadlineTime: "22:30", priority: "normal", category, mode: "flexible",
      completed, source: "user", dateLocked: true, autoScheduled: false,
      createdAt: new Date().toISOString(),
    });
    state.routines = [];
    state.backlog = [];
    state.milestones = [{ id: "vse-mock", title: "VŠE nanečisto", date: milestoneDate, note: "Přijímačky" }];
    state.plans = {
      [yesterday]: [makeTask("prep-done", "Matematika přijímačky", yesterday, 60, "17:00", "18:00", "Matika", true)],
      [today]: [],
      [prepDay]: [makeTask("prep-planned", "VŠE angličtina", prepDay, 90, "16:00", "17:30", "Angličtina", false)],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { today, yesterday, prepDay, milestoneDate });
  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  await expect(briefing.locator(".df2-jarvis-milestone")).toContainText("VŠE nanečisto");
  const prep = briefing.locator("[data-jarvis-milestone-prep]");
  await expect(prep).toBeVisible();
  await expect(prep).toContainText("Příprava aktivní");
  await expect(prep).toContainText("1 h hotovo");
  await expect(prep).toContainText("1 h 30 min v plánu");
  await expect(prep).toHaveClass(/active/);
});

test("Jarvis does not invent preparation requirements for an administrative milestone", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T15:00:00Z"));
  await mockWeather(page);
  await openFresh(page);
  const today = await page.evaluate(planningDateKeyInBrowser);
  const milestoneDate = addDaysKey(today, 5);

  await page.evaluate(({ today, milestoneDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.backlog = [];
    state.milestones = [{ id: "registration", title: "zápis", date: milestoneDate, note: "Vlastní termín" }];
    state.plans = { [today]: [] };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { today, milestoneDate });
  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  const prep = briefing.locator("[data-jarvis-milestone-prep]");
  await expect(prep).toBeVisible();
  await expect(prep).toContainText("Bez nutné přípravy");
  await expect(prep).toHaveClass(/neutral/);
});
