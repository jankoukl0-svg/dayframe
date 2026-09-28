import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function setupPlan(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  return page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const planningDate = new Date(now);
    let currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute < 2 * 60) {
      planningDate.setDate(planningDate.getDate() - 1);
      currentMinute += 24 * 60;
    }
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const firstStart = Math.max(8 * 60, Math.min(24 * 60 + 60, currentMinute - 5));
    const firstEnd = Math.min(26 * 60, firstStart + 40);
    const secondStart = Math.min(26 * 60 - 30, firstEnd + 15);
    const toTime = (value) => {
      const clock = value % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };
    const task = (id, title, category, start, end) => ({
      id,
      title,
      date,
      duration: end - start,
      start: toTime(start),
      end: toTime(end),
      requestedStart: toTime(start),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category,
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    });

    state.routines = [];
    state.plans[date] = [
      task("focus-live-a", "Původní blok", "Matematika", firstStart, firstEnd),
      task("focus-live-b", "Další blok", "Angličtina", secondStart, secondStart + 30),
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, currentMinute, firstStart, firstEnd, secondStart };
  });
}

function timeFromMinute(value) {
  const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

test("focus copy follows edits to the current plan instead of keeping a stale task snapshot", async ({ page }) => {
  const seeded = await setupPlan(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const focus = page.locator(".df2-focus-view");
  await expect(focus).toBeVisible();
  await expect(focus.locator("h1")).toHaveText("Původní blok");

  await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans[date] = state.plans[date].map((task) => task.id === "focus-live-a"
      ? { ...task, title: "Aktualizovaný blok", category: "Finance" }
      : task);
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, seeded);

  await expect(focus.locator("h1")).toHaveText("Aktualizovaný blok");
  await expect(focus.locator(":scope > p")).toContainText("Finance");
});

test("focus switches to the block that is current in the updated day plan when no focus session is running", async ({ page }) => {
  const seeded = await setupPlan(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const focus = page.locator(".df2-focus-view");
  await expect(focus.locator("h1")).toHaveText("Původní blok");

  await page.evaluate(({ date, currentMinute }) => {
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans[date] = state.plans[date].map((task) => {
      if (task.id === "focus-live-a") {
        const start = Math.min(26 * 60 - 30, Math.max(8 * 60, currentMinute + 60));
        return { ...task, start: toTime(start), end: toTime(start + 30), duration: 30 };
      }
      if (task.id === "focus-live-b") {
        const start = Math.max(8 * 60, currentMinute - 5);
        return { ...task, start: toTime(start), end: toTime(start + 30), duration: 30, title: "Teď podle plánu", category: "Angličtina" };
      }
      return task;
    });
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, seeded);

  await expect(focus.locator("h1")).toHaveText("Teď podle plánu");
  await expect(focus.locator(":scope > p")).toContainText("Angličtina");
});

test("a running focus session stays attached to its task while plan times change", async ({ page }) => {
  const seeded = await setupPlan(page);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Zahájit blok" }).click();
  const controls = page.locator(".df2-time-adjust-focus-controls");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();

  await page.evaluate(({ date, currentMinute }) => {
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans[date] = state.plans[date].map((task) => {
      if (task.id === "focus-live-a") return { ...task, title: "Běžící upravený blok", category: "Finance" };
      if (task.id === "focus-live-b") {
        const start = Math.max(8 * 60, currentMinute - 5);
        return { ...task, start: toTime(start), end: toTime(start + 30), duration: 30, title: "Jiný aktuální blok" };
      }
      return task;
    });
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, seeded);

  const focus = page.locator(".df2-focus-view");
  await expect(focus.locator("h1")).toHaveText("Běžící upravený blok");
  await expect(focus.locator(":scope > p")).toContainText("Finance");
});
