import { test, expect } from "@playwright/test";

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function openFreshToday(page) {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.route("https://api.open-meteo.com/**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      current: { temperature_2m: 18, apparent_temperature: 18, weather_code: 1, wind_speed_10m: 8 },
      daily: {
        temperature_2m_max: [20], temperature_2m_min: [10], precipitation_probability_max: [10],
        sunrise: ["2026-10-05T07:00"], sunset: ["2026-10-05T18:30"],
      },
    }),
  }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

async function mountAdvisorHost(page) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-today-briefing]").forEach((node) => node.remove());
    const host = document.createElement("div");
    host.dataset.todayBriefing = "true";
    document.body.appendChild(host);
    window.dispatchEvent(new Event("dayframe-state-sync"));
  });
  const host = page.locator("[data-today-briefing]");
  await expect(host).toBeAttached();
  return host;
}

test("Jarvis respects move deadlines, persists constraint changes and tries another movable block", async ({ page }) => {
  await openFreshToday(page);
  const today = await page.evaluate(planningDateKeyInBrowser);
  const dates = await page.evaluate(({ key }) => {
    const make = (offset) => {
      const date = new Date(`${key}T12:00:00`);
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    return { one: make(1), crowded: make(2), light: make(3) };
  }, { key: today });

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const createdAt = new Date().toISOString();
    const task = (id, title, date, duration, start, end, extra = {}) => ({
      id, title, date, duration, start, end, requestedStart: start,
      deadlineTime: "22:30", priority: "normal", category: "Finance", mode: "flexible",
      completed: false, source: "user", dateLocked: true, autoScheduled: false, createdAt, ...extra,
    });
    state.routines = [];
    state.backlog = [];
    state.milestones = [];
    state.plans = {
      [dates.one]: [task("filled-before", "Filled before deadline", dates.one, 240, "10:00", "14:00")],
      [dates.crowded]: [
        task("move-me", "Valuation model", dates.crowded, 150, "09:00", "11:30", { dueDate: dates.crowded }),
        task("other-a", "CFI Excel", dates.crowded, 100, "12:00", "13:40"),
        task("other-b", "Ekonomie", dates.crowded, 80, "14:00", "15:20"),
      ],
      [dates.light]: [],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", "[]");
  }, { dates });

  const briefing = await mountAdvisorHost(page);
  await expect(briefing.locator('[data-jarvis-advice="better-day-move-me"]')).toHaveCount(0);
  await expect(briefing.locator('[data-jarvis-advice="better-day-other-a"]')).toBeVisible();

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[dates.crowded].find((item) => item.id === "move-me");
    task.dueDate = dates.light;
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { dates });
  await page.reload({ waitUntil: "networkidle" });

  const refreshedBriefing = await mountAdvisorHost(page);
  await expect(refreshedBriefing.locator('[data-jarvis-advice="better-day-move-me"]')).toBeVisible();
});

test("Jarvis warns when milestone preparation exists only beyond the seven-day horizon", async ({ page }) => {
  await openFreshToday(page);
  const today = await page.evaluate(planningDateKeyInBrowser);
  const dates = await page.evaluate(({ key }) => {
    const make = (offset) => {
      const date = new Date(`${key}T12:00:00`);
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    return { latePrep: make(9), milestone: make(10) };
  }, { key: today });

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const createdAt = new Date().toISOString();
    state.routines = [];
    state.backlog = [];
    state.milestones = [{ id: "late-c1", title: "Cambridge C1 test", date: dates.milestone, note: "" }];
    state.plans = {
      [dates.latePrep]: [{
        id: "late-prep", title: "Angličtina C1", date: dates.latePrep, duration: 30,
        start: "18:00", end: "18:30", requestedStart: "18:00", deadlineTime: "22:30",
        priority: "normal", category: "Angličtina", mode: "flexible", completed: false,
        source: "user", dateLocked: true, autoScheduled: false, createdAt,
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", "[]");
  }, { dates });

  const briefing = await mountAdvisorHost(page);
  const advice = briefing.locator('[data-jarvis-advice="underprepared-late-c1"]');
  await expect(advice).toBeVisible();
  await expect(advice).toContainText("0 min související přípravy");
  await expect(advice).toContainText("Zvaž ještě jeden soustředěný blok");
});