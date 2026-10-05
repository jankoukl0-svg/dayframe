import { test, expect } from "@playwright/test";

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function openFresh(page) {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
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
  return page.locator("[data-today-briefing]");
}

async function dateKeys(page, offsets) {
  const today = await page.evaluate(planningDateKeyInBrowser);
  return page.evaluate(({ key, offsets }) => Object.fromEntries(Object.entries(offsets).map(([name, offset]) => {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return [name, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`];
  })), { key: today, offsets });
}

test("better-day advice requires a real destination slot before the task deadline", async ({ page }) => {
  await openFresh(page);
  const dates = await dateKeys(page, { crowded: 1, light: 2 });

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const make = (id, title, date, duration, start, end, extra = {}) => ({
      id, title, date, duration, start, end, requestedStart: start,
      deadlineTime: "22:30", priority: "normal", category: "Finance", mode: "flexible",
      completed: false, source: "user", dateLocked: true, autoScheduled: false,
      createdAt: new Date().toISOString(), ...extra,
    });
    state.routines = [];
    state.backlog = [];
    state.milestones = [];
    state.plans = {
      [dates.crowded]: [
        make("tight-deadline", "Morning valuation", dates.crowded, 90, "10:00", "11:30", { dueDate: dates.light, deadlineTime: "09:30" }),
        make("fill-a", "Fill A", dates.crowded, 80, "12:00", "13:20"),
        make("fill-b", "Fill B", dates.crowded, 70, "14:00", "15:10"),
        make("fill-c", "Fill C", dates.crowded, 60, "16:00", "17:00"),
      ],
      [dates.light]: [make("morning-blocker", "Morning blocker", dates.light, 60, "08:00", "09:00", { completed: true })],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", "[]");
  }, { dates });

  const host = await mountAdvisorHost(page);
  await expect(host.locator('[data-jarvis-advice="better-day-tight-deadline"]')).toHaveCount(0);
});

test("nearer underprepared milestone wins over a later milestone with no preparation", async ({ page }) => {
  await openFresh(page);
  const dates = await dateKeys(page, { near: 1, later: 20 });

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.backlog = [];
    state.milestones = [
      { id: "near-c1", title: "Cambridge C1 test", date: dates.near, note: "" },
      { id: "later-vse", title: "VŠE přijímačky", date: dates.later, note: "" },
    ];
    state.plans = {
      [dates.near]: [{
        id: "small-c1-prep", title: "Angličtina C1", date: dates.near, duration: 30,
        start: "18:00", end: "18:30", requestedStart: "18:00", deadlineTime: "22:30",
        priority: "normal", category: "Angličtina", mode: "flexible", completed: false,
        source: "user", dateLocked: true, autoScheduled: false, createdAt: new Date().toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", "[]");
  }, { dates });

  const host = await mountAdvisorHost(page);
  await expect(host.locator('[data-jarvis-advice="underprepared-near-c1"]')).toBeVisible();
  await expect(host.locator('[data-jarvis-advice="milestone-later-vse"]')).toHaveCount(0);
});

test("tomorrow warning outranks a normal seven-day move hint when advisor is full", async ({ page }) => {
  await openFresh(page);
  const dates = await dateKeys(page, { tomorrow: 1, light: 2, milestone: 5 });

  await page.evaluate(({ dates }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const make = (id, title, date, duration, start, end, extra = {}) => ({
      id, title, date, duration, start, end, requestedStart: start,
      deadlineTime: "22:30", priority: "normal", category: "Finance", mode: "flexible",
      completed: false, source: "user", dateLocked: true, autoScheduled: false,
      createdAt: new Date().toISOString(), ...extra,
    });
    state.routines = [];
    state.backlog = [];
    state.milestones = [{ id: "priority-milestone", title: "Cambridge C1 test", date: dates.milestone, note: "" }];
    state.plans = {
      [dates.tomorrow]: [
        make("move-long", "Valuation model", dates.tomorrow, 150, "09:00", "11:30", { dueDate: dates.light }),
        make("tomorrow-a", "CFI Excel", dates.tomorrow, 100, "12:00", "13:40"),
        make("tomorrow-b", "Ekonomie", dates.tomorrow, 80, "14:00", "15:20"),
      ],
      [dates.light]: [],
    };
    const birthdayDate = new Date(`${dates.tomorrow}T12:00:00`);
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-birthdays-v1", JSON.stringify([{
      id: "birthday-priority", name: "Alex", day: birthdayDate.getDate(), month: birthdayDate.getMonth() + 1,
    }]));
  }, { dates });

  const host = await mountAdvisorHost(page);
  await expect(host.locator('[data-jarvis-advice="milestone-priority-milestone"]')).toBeVisible();
  await expect(host.locator('[data-jarvis-advice="birthday-birthday-priority"]')).toBeVisible();
  await expect(host.locator('[data-jarvis-advice="tomorrow-load"]')).toBeVisible();
  await expect(host.locator('[data-jarvis-advice="better-day-move-long"]')).toHaveCount(0);
  await expect(host.locator("[data-jarvis-advice]")).toHaveCount(3);
});
