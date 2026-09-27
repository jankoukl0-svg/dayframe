import { test, expect } from "@playwright/test";

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function installGoogleMock(page) {
  await page.addInitScript(() => {
    window.__DAYFRAME_GOOGLE_CLIENT_ID__ = "dayframe-test-client.apps.googleusercontent.com";
    window.__googleCalendarRequests = [];
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: "test-google-token", expires_in: 3600 }),
          }),
          revoke: (_token, done) => done?.(),
        },
      },
    };

    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes("www.googleapis.com/calendar/v3/calendars/primary/events")) return realFetch(input, init);
      window.__googleCalendarRequests.push({
        url,
        authorization: init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : init?.headers?.Authorization ?? init?.headers?.authorization ?? "",
      });
      const now = new Date();
      const timedStart = new Date(now);
      timedStart.setHours(9, 15, 0, 0);
      const timedEnd = new Date(now);
      timedEnd.setHours(10, 0, 0, 0);
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
      return new Response(JSON.stringify({
        items: [
          {
            id: "google-timed-test",
            summary: "Google schůzka",
            htmlLink: "https://calendar.google.com/calendar/event?eid=test",
            start: { dateTime: timedStart.toISOString() },
            end: { dateTime: timedEnd.toISOString() },
          },
          {
            id: "google-all-day-test",
            summary: "Google celý den",
            htmlLink: "https://calendar.google.com/calendar/event?eid=all-day",
            start: { date: today },
            end: { date: tomorrowKey },
          },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
}

test("Google Calendar connects read-only and renders events in month and week views", async ({ page }) => {
  await installGoogleMock(page);
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Kalendář" }).click();
  const connect = page.getByRole("button", { name: "Google Kalendář" });
  await expect(connect).toBeVisible();
  await connect.click();
  await expect(page.getByRole("button", { name: "Google připojen" })).toBeVisible();

  const today = localDateKey();
  const todayCell = page.locator(`.df2-month-day[data-date="${today}"]`);
  const monthTimedEvent = todayCell.locator(".df2-google-calendar-month-event").filter({ hasText: "Google schůzka" });
  await expect(monthTimedEvent).toContainText("09:15–10:00");
  await expect(todayCell.locator(".df2-google-calendar-month-event").filter({ hasText: "Google celý den" })).toContainText("Celý den");

  const monthDesign = await monthTimedEvent.evaluate((element) => {
    const style = getComputedStyle(element);
    const meta = element.querySelector("small");
    return {
      borderLeftWidth: style.borderLeftWidth,
      backgroundColor: style.backgroundColor,
      sourceLabel: meta ? getComputedStyle(meta, "::after").content : "",
    };
  });
  expect(monthDesign.borderLeftWidth).toBe("2px");
  expect(monthDesign.backgroundColor).toBe("rgba(255, 255, 255, 0.68)");
  expect(monthDesign.sourceLabel).toContain("Google");

  const request = await page.evaluate(() => window.__googleCalendarRequests.at(-1));
  expect(request.authorization).toBe("Bearer test-google-token");
  expect(request.url).toContain("singleEvents=true");
  expect(request.url).toContain("orderBy=startTime");
  await expect.poll(() => page.evaluate(() => Boolean(window.sessionStorage.getItem("dayframe-google-calendar-token-v1")))).toBe(true);

  await page.getByRole("button", { name: "Týden" }).click();
  await expect(page.locator(".df2-week-controls > button").first()).toHaveText("←");
  const todayWeek = page.locator(".df2-week-day.today");
  const weekTimedEvent = todayWeek.locator(".df2-google-week-event").filter({ hasText: "Google schůzka" });
  await expect(weekTimedEvent).toContainText("09:15–10:00");
  await expect(todayWeek.locator(".df2-google-week-all-day-event").filter({ hasText: "Google celý den" })).toBeVisible();

  const weekDesign = await weekTimedEvent.evaluate((element) => {
    const style = getComputedStyle(element);
    const meta = element.querySelector("span");
    return {
      borderLeftWidth: style.borderLeftWidth,
      backgroundColor: style.backgroundColor,
      sourceLabel: meta ? getComputedStyle(meta, "::after").content : "",
    };
  });
  expect(weekDesign.borderLeftWidth).toBe("2px");
  expect(weekDesign.backgroundColor).toBe("rgba(255, 255, 255, 0.82)");
  expect(weekDesign.sourceLabel).toContain("Google");

  await page.getByRole("button", { name: "Google připojen" }).click();
  await expect(page.getByRole("button", { name: "Google Kalendář" })).toBeVisible();
  await expect(todayWeek.locator(".df2-google-week-event")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("dayframe-google-calendar-token-v1"))).toBe(null);
});

test("Google Calendar explains missing OAuth configuration without breaking the calendar", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Kalendář" }).click();
  await page.getByRole("button", { name: "Google Kalendář" }).click();
  await expect(page.getByRole("status")).toContainText("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
  await expect(page.locator(".df2-month-grid")).toBeVisible();
});
