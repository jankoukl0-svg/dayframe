import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function resetAndOpenCalendar(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Kalendář" }).click();
}

test("closing the Google OAuth popup re-enables the connect button", async ({ page }) => {
  await page.addInitScript(() => {
    window.__DAYFRAME_GOOGLE_CLIENT_ID__ = "dayframe-test-client.apps.googleusercontent.com";
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config) => ({
            requestAccessToken: () => config.error_callback?.({ type: "popup_closed" }),
          }),
        },
      },
    };
  });

  await resetAndOpenCalendar(page);
  const connect = page.getByRole("button", { name: "Google Kalendář" });
  await connect.click();
  await expect(connect).toBeEnabled();
  await expect(connect).toHaveText(/Google Kalendář/);
  await expect(page.getByRole("status")).toContainText("bylo zavřeno");
});

test("timed Google events crossing midnight render on both calendar dates", async ({ page }) => {
  await page.addInitScript(() => {
    window.__DAYFRAME_GOOGLE_CLIENT_ID__ = "dayframe-test-client.apps.googleusercontent.com";
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: "cross-midnight-token", expires_in: 3600 }),
          }),
        },
      },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes("www.googleapis.com/calendar/v3/calendars/primary/events")) return realFetch(input, init);
      const start = new Date();
      start.setHours(23, 30, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      end.setHours(1, 15, 0, 0);
      return new Response(JSON.stringify({
        items: [{
          id: "overnight-google-event",
          summary: "Noční Google událost",
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });

  await resetAndOpenCalendar(page);
  await page.getByRole("button", { name: "Google Kalendář" }).click();

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayCell = page.locator(`.df2-month-day[data-date="${dateKey(today)}"]`);
  const tomorrowCell = page.locator(`.df2-month-day[data-date="${dateKey(tomorrow)}"]`);
  await expect(todayCell.locator(".df2-google-calendar-month-event").filter({ hasText: "Noční Google událost" })).toContainText("23:30–24:00");
  await expect(tomorrowCell.locator(".df2-google-calendar-month-event").filter({ hasText: "Noční Google událost" })).toContainText("00:00–01:15");
});

test("a failed Google Calendar range can be retried without reconnecting", async ({ page }) => {
  await page.addInitScript(() => {
    window.__DAYFRAME_GOOGLE_CLIENT_ID__ = "dayframe-test-client.apps.googleusercontent.com";
    window.__googleRetryRequests = 0;
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: "retry-token", expires_in: 3600 }),
          }),
        },
      },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes("www.googleapis.com/calendar/v3/calendars/primary/events")) return realFetch(input, init);
      window.__googleRetryRequests += 1;
      if (window.__googleRetryRequests === 1) return new Response("temporary error", { status: 500 });
      const now = new Date();
      const start = new Date(now);
      start.setHours(11, 0, 0, 0);
      const end = new Date(now);
      end.setHours(11, 30, 0, 0);
      return new Response(JSON.stringify({
        items: [{
          id: "retry-google-event",
          summary: "Google po retry",
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });

  await resetAndOpenCalendar(page);
  await page.getByRole("button", { name: "Google Kalendář" }).click();
  await expect(page.getByRole("status")).toContainText("500");
  await page.getByRole("button", { name: "Zkusit znovu" }).click();

  const todayCell = page.locator(`.df2-month-day[data-date="${dateKey(new Date())}"]`);
  await expect(todayCell.locator(".df2-google-calendar-month-event").filter({ hasText: "Google po retry" })).toContainText("11:00–11:30");
  await expect.poll(() => page.evaluate(() => window.__googleRetryRequests)).toBe(2);
  await expect(page.getByRole("button", { name: "Google připojen" })).toBeVisible();
});
