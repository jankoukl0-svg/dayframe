import { test, expect } from "@playwright/test";

const FIXED_NOW = new Date("2026-10-02T15:00:00Z");

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function mockWeather(page, overrides = {}) {
  const payload = {
    current: {
      temperature_2m: 18.4,
      apparent_temperature: 17.1,
      weather_code: 2,
      wind_speed_10m: 12.2,
    },
    daily: {
      temperature_2m_max: [21.2],
      temperature_2m_min: [10.8],
      precipitation_probability_max: [20],
      sunrise: ["2026-10-02T06:58"],
      sunset: ["2026-10-02T18:40"],
    },
    ...overrides,
  };
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

async function seedWeatherLocation(page) {
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-weather-location-v1", JSON.stringify({
      latitude: 50.4,
      longitude: 14.9,
      acquiredAt: Date.now(),
    }));
  });
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


test("Jarvis shows the next 24 hours and uses their weather changes for outfit advice", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const start = new Date("2026-10-02T17:00:00Z");
  const times = Array.from({ length: 40 }, (_, i) =>
    new Date(start.getTime() + i * 3_600_000).toISOString().slice(0, 16));
  const temperatures = times.map((_, i) => i <= 12 ? 19 - i : 7 + Math.round((i - 12) * 0.5));
  let requested = false;
  await page.route("https://api.open-meteo.com/**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("hourly")).toContain("temperature_2m");
    expect(url.searchParams.get("hourly")).toContain("precipitation_probability");
    expect(url.searchParams.get("forecast_days")).toBe("2");
    requested = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { time: "2026-10-02T22:15", temperature_2m: 14, apparent_temperature: 12, weather_code: 3, wind_speed_10m: 15 },
        daily: { temperature_2m_max: [19], temperature_2m_min: [7], precipitation_probability_max: [75], sunrise: ["2026-10-02T07:00"], sunset: ["2026-10-02T18:00"] },
        hourly: {
          time: times,
          temperature_2m: temperatures,
          apparent_temperature: temperatures.map((n) => n - 2),
          weather_code: times.map((_, i) => i >= 16 && i <= 19 ? 61 : 3),
          precipitation_probability: times.map((_, i) => i >= 16 && i <= 19 ? 75 : 12),
          wind_speed_10m: times.map((_, i) => i >= 16 && i <= 19 ? 39 : 11),
        },
      }),
    });
  });
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const briefing = await openBriefing(page);
  const weather = briefing.locator(".df2-jarvis-weather");
  const hourly = weather.locator("[data-jarvis-hourly]");
  await expect(hourly).toBeVisible();
  await expect(hourly).toContainText("Dalších 24 hodin");
  const points = hourly.locator("[data-jarvis-hour]");
  await expect(points).toHaveCount(8);
  await expect(points.first()).toHaveAttribute("data-jarvis-hour", "2026-10-02T23:00");
  await expect(points.nth(1)).toHaveAttribute("data-jarvis-hour", "2026-10-03T02:00");
  await expect(hourly).toContainText("zítra");
  await expect(points.nth(5)).toContainText("75 %");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("bunda");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("deštník");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("větrem");
  await expect(hourly).toContainText("Rozmezí");
  expect(requested).toBe(true);
  const overflow = await hourly.locator(".df2-jarvis-hourly-scroll").evaluate((node) =>
    ({ content: node.scrollWidth, viewport: node.clientWidth }));
  expect(overflow.content).toBeGreaterThanOrEqual(overflow.viewport);
});

test("Jarvis handles missing hourly data without inventing an outfit forecast", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const weather = (await openBriefing(page)).locator(".df2-jarvis-weather");
  await expect(weather).toContainText("18°");
  await expect(weather.locator("[data-jarvis-hourly]")).toHaveCount(0);
  await expect(weather.locator("[data-jarvis-outfit]")).toHaveCount(0);
  await expect(weather.locator("[data-jarvis-hourly-unavailable]")).toBeVisible();
});

test("Today Jarvis briefing combines the plan, live weather and useful context in a separate modal", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
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
          start: "23:00",
          end: "00:30",
          requestedStart: "23:00",
          deadlineTime: "01:30",
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
          start: "00:30",
          end: "01:30",
          requestedStart: "00:30",
          deadlineTime: "01:45",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now,
        },
        {
          id: "briefing-overdue",
          title: "Starý rest",
          date,
          duration: 0,
          start: "14:00",
          end: "14:00",
          requestedStart: "14:00",
          deadlineTime: "14:00",
          priority: "normal",
          category: "Studium",
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
  await seedWeatherLocation(page);

  await page.reload({ waitUntil: "networkidle" });

  await expect(page.locator("[data-today-briefing]")).toHaveCount(0);
  await expect(page.locator("[data-today-briefing-launcher]")).toContainText("Jarvis briefing");
  const briefing = await openBriefing(page);
  await expect(briefing).toContainText("JARVIS · LIVE");
  await expect(briefing).toContainText("Z dřívějška zůstává 1 rest.");
  await expect(briefing).not.toContainText("Na dnešek je naplánováno");
  await expect(briefing).not.toContainText("Hlavní blok je");
  await expect(briefing).toContainText("Cambridge essay");
  await expect(briefing).toContainText("2 h 30 min");
  await expect(briefing).toContainText("0/3");

  const weather = briefing.locator(".df2-jarvis-weather");
  await expect(weather).toContainText("Moje poloha");
  await expect(weather).toContainText("18°");
  await expect(weather).toContainText("Polojasno");
  await expect(weather).toContainText("21° / 11°");
  await expect(weather).toContainText("20 %");
  await expect(weather).toContainText("06:58");
  await expect(weather).toContainText("18:40");

  await expect(briefing.locator(".df2-jarvis-sequence")).toContainText("Matematika");
  await expect(briefing.locator(".df2-jarvis-insight")).toContainText("Pozornost: 1 rest");

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    for (const tasks of Object.values(state.plans || {})) {
      const task = tasks.find((item) => item.id === "briefing-priority");
      if (task) task.completed = true;
    }
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  });

  await expect(briefing).toContainText("1/3");
  await expect(briefing.locator(".df2-briefing-priority")).toContainText("Matematika");
  await expect(briefing).toContainText("1 h");

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
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
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
  await seedWeatherLocation(page);

  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  await expect(briefing.locator(".df2-briefing-priority")).toContainText("Ruční Focus");
  await expect(briefing.locator(".df2-jarvis-command")).toContainText("Právě teď");
  await expect(briefing.locator(".df2-jarvis-command")).toContainText("Ruční Focus");

  await page.getByRole("button", { name: "Zavřít briefing" }).click();
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
});

test("Jarvis remaining work includes an unfinished task without a time slot", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
  await openFreshToday(page);
  const date = await page.evaluate(planningDateKeyInBrowser);

  await page.evaluate((planningDate) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const createdAt = new Date().toISOString();
    state.routines = [];
    state.backlog = [];
    state.plans = {
      [planningDate]: [
        {
          id: "occupied-auto-window",
          title: "Obsazený den",
          date: planningDate,
          duration: 870,
          start: "08:00",
          end: "22:30",
          requestedStart: "08:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "fixed",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt,
        },
        {
          id: "unscheduled-work",
          title: "Nezařazený úkol",
          date: planningDate,
          duration: 45,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Studium",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: true,
          createdAt,
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, date);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = Object.values(state.plans || {}).flat().find((item) => item.id === "unscheduled-work");
    return Boolean(task) && !task.start && !task.end;
  })).toBe(true);

  const briefing = await openBriefing(page);
  const signals = briefing.locator(".df2-briefing-signals");
  await expect(signals).toContainText("Zbývá");
  await expect(signals).toContainText("45 min");
  await expect(briefing.locator(".df2-jarvis-command")).toContainText("Bez času");
});

test("Jarvis weather turns strong rain probability into a useful alert", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page, {
    current: {
      temperature_2m: 9,
      apparent_temperature: 7,
      weather_code: 61,
      wind_speed_10m: 18,
    },
    daily: {
      temperature_2m_max: [11],
      temperature_2m_min: [6],
      precipitation_probability_max: [85],
      sunrise: ["2026-10-02T06:58"],
      sunset: ["2026-10-02T18:40"],
    },
  });
  await openFreshToday(page);
  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans = {};
    state.backlog = [];
    state.routines = [];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });

  const briefing = await openBriefing(page);
  await expect(briefing.locator(".df2-jarvis-weather")).toContainText("Déšť");
  await expect(briefing.locator(".df2-jarvis-insight")).toContainText("Deštník se může hodit");
});
