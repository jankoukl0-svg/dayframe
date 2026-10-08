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

async function seedNotificationTasks(page) {
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
    const seededTasks = [
      make("notify-lead", "Příprava testu", leadStart, leadEnd),
      make("notify-start", "Matematika", startedAt, startedEnd),
      make("notify-overrun", "Excel", overrunStart, overrunEnd, overrunEnd),
    ];
    state.plans = {};
    for (const task of seededTasks) {
      state.plans[task.date] = [...(state.plans[task.date] || []), task];
    }
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-notification-settings-v1", JSON.stringify({ enabled: true, leadMinutes: 10 }));
    window.localStorage.removeItem("dayframe-notification-fired-v1");
  });
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

test("notifications fire once before, at start, and after an unfinished block ends", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-08T18:00:00"));
  await installNotificationMock(page, "granted");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  await seedNotificationTasks(page);
  await page.reload({ waitUntil: "networkidle" });

  await expect.poll(() => page.evaluate(() => window.__dayframeNotifications || [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: expect.stringContaining("Příprava testu") }),
    expect.objectContaining({ title: "Začíná: Matematika" }),
    expect.objectContaining({ title: "Blok skončil: Excel" }),
  ]));

  const firstCount = await page.evaluate(() => window.__dayframeNotifications.length);

  await page.getByRole("button", { name: /Nastavení/ }).click();
  await page.getByLabel("Předstih notifikace").selectOption("5");
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.__dayframeNotifications.length)).toBe(firstCount);

  await page.evaluate(() => window.dispatchEvent(new Event("dayframe-state-sync")));
  await page.waitForTimeout(50);
  await expect.poll(() => page.evaluate(() => window.__dayframeNotifications.length)).toBe(firstCount);
});

test("mobile-style Notification constructor failure falls back to service worker delivery", async ({ page }) => {
  await page.addInitScript(() => {
    window.__dayframeServiceWorkerNotifications = [];
    class ThrowingNotification {
      static permission = "granted";
      static async requestPermission() { return "granted"; }
      constructor() { throw new TypeError("Illegal constructor"); }
    }
    const registration = {
      showNotification: async (title, options = {}) => {
        window.__dayframeServiceWorkerNotifications.push({ title, body: options.body || "", tag: options.tag || "" });
      },
    };
    Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: ThrowingNotification });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const started = new Date(now.getTime() - 60_000);
    const ends = new Date(now.getTime() + 20 * 60_000);
    const keyDate = new Date(started);
    if (keyDate.getHours() < 8) keyDate.setDate(keyDate.getDate() - 1);
    const date = `${keyDate.getFullYear()}-${String(keyDate.getMonth() + 1).padStart(2, "0")}-${String(keyDate.getDate()).padStart(2, "0")}`;
    const clock = (value) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [{
        id: "mobile-start",
        title: "Mobilní blok",
        date,
        duration: 20,
        start: clock(started),
        end: clock(ends),
        requestedStart: clock(started),
        deadlineTime: "22:30",
        priority: "normal",
        category: "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-notification-settings-v1", JSON.stringify({ enabled: true, leadMinutes: 10 }));
    window.localStorage.removeItem("dayframe-notification-fired-v1");
  });

  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => window.__dayframeServiceWorkerNotifications || [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: "Začíná: Mobilní blok" }),
  ]));
});

test("disabling notifications in one tab disables them in another tab", async ({ page, context }) => {
  await installNotificationMock(page, "default");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Nastavení/ }).click();
  await page.getByRole("button", { name: "Povolit" }).click();
  await expect(page.getByRole("button", { name: "Vypnout" })).toBeVisible();

  const second = await context.newPage();
  await installNotificationMock(second, "granted");
  await second.goto(baseUrl, { waitUntil: "networkidle" });
  await second.getByRole("button", { name: /Nastavení/ }).click();
  await expect(second.getByRole("button", { name: "Vypnout" })).toBeVisible();

  await page.getByRole("button", { name: "Vypnout" }).click();
  await expect(second.getByRole("button", { name: "Povolit" })).toBeVisible();
  await second.close();
});
