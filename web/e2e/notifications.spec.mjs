import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function installNotificationMock(page, initialPermission = "default") {
  await page.addInitScript(({ permission }) => {
    window.__dayframeNotifications = [];
    class MockNotification {
      static permission = permission;
      static async requestPermission() {
        MockNotification.permission = "granted";
        return "granted";
      }
      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        this.onclick = null;
        window.__dayframeNotifications.push({ title, body: options.body || "", tag: options.tag || "" });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: MockNotification });
  }, { permission: initialPermission });
}

function taskDateKey(date) {
  const adjusted = new Date(date);
  if (adjusted.getHours() < 8) adjusted.setDate(adjusted.getDate() - 1);
  return `${adjusted.getFullYear()}-${String(adjusted.getMonth() + 1).padStart(2, "0")}-${String(adjusted.getDate()).padStart(2, "0")}`;
}

function clock(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function makeTask(id, title, startDate, endDate) {
  return {
    id,
    title,
    date: taskDateKey(startDate),
    duration: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000)),
    start: clock(startDate),
    end: clock(endDate),
    requestedStart: clock(startDate),
    deadlineTime: "22:30",
    priority: "normal",
    category: "Studium",
    mode: "flexible",
    completed: false,
    source: "user",
    dateLocked: true,
    autoScheduled: false,
    createdAt: new Date().toISOString(),
  };
}

test("notification settings request permission and persist a 5 minute lead", async ({ page }) => {
  await installNotificationMock(page, "default");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();
  const row = page.locator("[data-notification-settings-host]");
  await expect(row).toContainText("Notifikace bloků");
  await page.getByRole("button", { name: "Povolit" }).click();
  await expect(page.getByRole("button", { name: "Vypnout" })).toBeVisible();
  await page.getByLabel("Předstih notifikace").selectOption("5");

  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("dayframe-notification-settings-v1"))).toContain('"enabled":true');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("dayframe-notification-settings-v1"))).toContain('"leadMinutes":5');
});

test("notifications fire before a block, at start, and after an unfinished block ends", async ({ page }) => {
  await installNotificationMock(page, "granted");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const localKey = (date) => {
      const adjusted = new Date(date);
      if (adjusted.getHours() < 8) adjusted.setDate(adjusted.getDate() - 1);
      return `${adjusted.getFullYear()}-${String(adjusted.getMonth() + 1).padStart(2, "0")}-${String(adjusted.getDate()).padStart(2, "0")}`;
    };
    const time = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const make = (id, title, startDate, endDate, dateBasis = startDate) => ({
      id,
      title,
      date: localKey(dateBasis),
      duration: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000)),
      start: time(startDate),
      end: time(endDate),
      requestedStart: time(startDate),
      deadlineTime: "22:30",
      priority: "normal",
      category: "Studium",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    });

    const leadStart = new Date(now.getTime() + 10 * 60_000);
    const leadEnd = new Date(leadStart.getTime() + 20 * 60_000);
    const startedAt = new Date(now.getTime() - 60_000);
    const startedEnd = new Date(now.getTime() + 20 * 60_000);
    const overrunEnd = new Date(now.getTime() - 60_000);
    const overrunStart = new Date(overrunEnd.getTime() - 60_000);

    state.routines = [];
    state.plans = {
      lead: [make("notify-lead", "Příprava testu", leadStart, leadEnd)],
      start: [make("notify-start", "Matematika", startedAt, startedEnd)],
      overrun: [make("notify-overrun", "Excel", overrunStart, overrunEnd, overrunEnd)],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-notification-settings-v1", JSON.stringify({ enabled: true, leadMinutes: 10 }));
    window.localStorage.removeItem("dayframe-notification-fired-v1");
  });

  await page.reload({ waitUntil: "networkidle" });

  await expect.poll(() => page.evaluate(() => window.__dayframeNotifications || [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: expect.stringContaining("Příprava testu") }),
    expect.objectContaining({ title: "Začíná: Matematika" }),
    expect.objectContaining({ title: "Blok skončil: Excel" }),
  ]));

  const firstCount = await page.evaluate(() => window.__dayframeNotifications.length);
  await page.evaluate(() => window.dispatchEvent(new Event("dayframe-state-sync")));
  await page.waitForTimeout(50);
  await expect.poll(() => page.evaluate(() => window.__dayframeNotifications.length)).toBe(firstCount);
});
