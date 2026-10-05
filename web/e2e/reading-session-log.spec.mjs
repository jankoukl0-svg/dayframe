import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function localDateKeyInBrowser() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function openFresh(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    window.localStorage.removeItem("dayframe-reading-sessions-v1");
    window.localStorage.removeItem("dayframe-reading-pending-v1");
  });
}

test("completed reading block asks for pages and advances the current book", async ({ page }) => {
  await openFresh(page);
  const date = await page.evaluate(localDateKeyInBrowser);

  await page.evaluate((date) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "reading-session-today",
          title: "Čtení knihy",
          date,
          duration: 30,
          start: "20:00",
          end: "20:30",
          requestedStart: "20:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Čtení",
          mode: "flexible",
          completed: false,
          source: "routine",
          routineId: "read",
          dateLocked: true,
          autoScheduled: false,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: {
        id: "undercover-economist",
        title: "The Undercover Economist",
        currentPage: 103,
        totalPages: 384,
        startedAt: new Date().toISOString(),
      },
      completed: [],
    }));
    window.localStorage.removeItem("dayframe-reading-sessions-v1");
    window.localStorage.removeItem("dayframe-reading-pending-v1");
  }, date);
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("dialog", { name: "Zapsat čtení" })).toHaveCount(0);

  await page.evaluate((date) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.plans[date][0].completed = true;
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, date);

  const dialog = page.getByRole("dialog", { name: "Zapsat čtení" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Kniha")).toHaveValue("undercover-economist");
  await expect(dialog).toContainText("Teď jsi na straně 103 z 384");
  await dialog.getByLabel("Kolik stran jsi přečetl?").fill("18");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog).toHaveCount(0);

  const stored = await page.evaluate(() => ({
    library: JSON.parse(window.localStorage.getItem("dayframe-reading-library-v1") || "{}"),
    sessions: JSON.parse(window.localStorage.getItem("dayframe-reading-sessions-v1") || "{}"),
  }));
  expect(stored.library.current.currentPage).toBe(121);
  expect(stored.sessions.entries).toHaveLength(1);
  expect(stored.sessions.entries[0].taskId).toBe("reading-session-today");
  expect(stored.sessions.entries[0].bookTitle).toBe("The Undercover Economist");
  expect(stored.sessions.entries[0].pages).toBe(18);

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();
  const pageHistory = history.locator(".df2-reading-page-history");
  await expect(pageHistory).toBeVisible();
  await expect(pageHistory.locator("header")).toContainText("18 stran");
  const today = pageHistory.locator(`[data-reading-page-date="${date}"]`);
  await expect(today).toContainText("18");
  await expect(today).toContainText("The Undercover Economist");
});

test("week overview aggregates page history by day and keeps book names", async ({ page }) => {
  await openFresh(page);
  const dates = await page.evaluate(() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const weekday = monday.getDay() || 7;
    monday.setDate(monday.getDate() - weekday + 1);
    const tuesday = new Date(monday);
    tuesday.setDate(tuesday.getDate() + 1);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { monday: key(monday), tuesday: key(tuesday) };
  });

  await page.evaluate(({ monday, tuesday }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = {};
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-reading-sessions-v1", JSON.stringify({
      version: 1,
      entries: [
        { id: "m1", taskId: "m1", date: monday, bookTitle: "Book A", pages: 12, durationMinutes: 20, loggedAt: new Date().toISOString() },
        { id: "m2", taskId: "m2", date: monday, bookTitle: "Book A", pages: 8, durationMinutes: 15, loggedAt: new Date().toISOString() },
        { id: "t1", taskId: "t1", date: tuesday, bookTitle: "Book B", pages: 25, durationMinutes: 40, loggedAt: new Date().toISOString() },
      ],
      skippedTaskIds: [],
    }));
    window.localStorage.removeItem("dayframe-reading-pending-v1");
  }, dates);
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();
  const pageHistory = history.locator(".df2-reading-page-history");
  await expect(pageHistory.locator("header")).toContainText("45 stran");

  const monday = pageHistory.locator(`[data-reading-page-date="${dates.monday}"]`);
  await expect(monday).toContainText("20");
  await expect(monday).toContainText("Book A");

  const tuesday = pageHistory.locator(`[data-reading-page-date="${dates.tuesday}"]`);
  await expect(tuesday).toContainText("25");
  await expect(tuesday).toContainText("Book B");
});
