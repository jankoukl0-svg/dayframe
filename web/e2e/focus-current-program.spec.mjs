import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function planningDate(page) {
  return page.evaluate(() => {
    const now = new Date();
    const date = new Date(now);
    if (now.getHours() < 2) date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

async function setup(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  const date = await planningDate(page);
  await page.evaluate(({ date: targetDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans[targetDate] = [{
      id: "focus-original",
      title: "Původní blok",
      duration: 45,
      priority: "normal",
      category: "Matematika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: true,
      createdAt: new Date().toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { date });
  await page.reload({ waitUntil: "networkidle" });
  return date;
}

test("Focus follows the current day program after the plan changes", async ({ page }) => {
  const date = await setup(page);

  await page.keyboard.press("3");
  const focus = page.locator(".df2-focus-view");
  await expect(focus).toBeVisible();
  await expect(focus.locator(":scope > h1")).toHaveText("Původní blok");
  await expect(focus.locator(":scope > p")).toContainText("Matematika");

  await page.evaluate(({ date: targetDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans[targetDate] = [{
      id: "focus-updated",
      title: "Aktuální program",
      duration: 30,
      priority: "normal",
      category: "Angličtina",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: true,
      createdAt: new Date().toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { date });

  await expect(focus.locator(":scope > h1")).toHaveText("Aktuální program");
  await expect(focus.locator(":scope > p")).toContainText("Angličtina");
});

test("a running Focus session stays attached to its task while its details update", async ({ page }) => {
  const date = await setup(page);

  await page.keyboard.press("3");
  const focus = page.locator(".df2-focus-view");
  const controls = page.locator(".df2-time-adjust-focus-controls");
  await controls.getByRole("button", { name: "Start", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(({ date: targetDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return Boolean(state.plans[targetDate]?.find((item) => item.id === "focus-original")?.actualRunningSince);
  }, { date })).toBe(true);

  await page.evaluate(({ date: targetDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const running = state.plans[targetDate].find((item) => item.id === "focus-original");
    state.plans[targetDate] = [
      {
        id: "new-plan-item",
        title: "Nový blok v plánu",
        duration: 30,
        priority: "normal",
        category: "Finance",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: true,
        createdAt: new Date().toISOString(),
      },
      { ...running, title: "Původní blok upravený", category: "VŠE AJ" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, { date });

  await expect(focus.locator(":scope > h1")).toHaveText("Původní blok upravený");
  await expect(focus.locator(":scope > p")).toContainText("VŠE AJ");
  await expect(controls.getByRole("button", { name: "Pauza", exact: true })).toBeVisible();
});
