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

test("completed reading block accepts last page and automatically counts new pages", async ({ page }) => {
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
  const endingPage = dialog.getByLabel("Na které straně jsi skončil?");
  await expect(endingPage).toHaveAttribute("min", "104");
  await expect(endingPage).toHaveAttribute("max", "384");
  await endingPage.fill("121");
  await expect(dialog).toContainText("Zapíše se 18 stran a postup se posune na stranu 121");
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


// A new reading session must use the updated page as its baseline, not the old one.
test("successive sessions use latest progress and reject invalid final pages", async ({ page }) => {
  await openFresh(page);
  const date = await page.evaluate(localDateKeyInBrowser);
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = {
      [date]: ["morning", "evening"].map((id, index) => ({
        id: "reading-" + id, title: "Čtení knihy", date, duration: 30,
        start: index ? "20:00" : "10:00", end: index ? "20:30" : "10:30",
        priority: "normal", category: "Čtení", mode: "flexible",
        completed: false, source: "routine", routineId: "read",
        dateLocked: true, autoScheduled: false, createdAt: new Date().toISOString(),
      })),
    };
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1, current: {
        id: "book-a", title: "Book A", currentPage: 232, totalPages: 384,
        startedAt: new Date().toISOString(),
      },
      completed: [],
    }));
    localStorage.removeItem("dayframe-reading-sessions-v1");
    localStorage.removeItem("dayframe-reading-pending-v1");
  }, date);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1"));
    state.plans[date].forEach((task) => { task.completed = true; });
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, date);

  const dialog = page.getByRole("dialog", { name: "Zapsat čtení" });
  await expect(dialog).toBeVisible();
  let end = dialog.getByLabel("Na které straně jsi skončil?");
  await expect(dialog).toContainText("Teď jsi na straně 232 z 384");

  // HTML numeric bounds and application validation both protect the stored progress.
  await dialog.locator("form").evaluate((form) => { form.noValidate = true; });
  await end.fill("232");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Zadej vyšší číslo strany");
  await end.fill("385");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Kniha má jen 384 stran");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-library-v1")).current.currentPage)).toBe(232);

  await end.fill("250");
  await expect(dialog).toContainText("Zapíše se 18 stran");
  // Another tab can advance the book while the modal remains open.
  await page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem("dayframe-reading-library-v1"));
    library.current.currentPage = 239;
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify(library));
    window.dispatchEvent(new StorageEvent("storage", { key: "dayframe-reading-library-v1" }));
  });
  await expect(dialog).toContainText("Teď jsi na straně 239 z 384");
  await expect(dialog).toContainText("Zapíše se 11 stran");
  await expect(end).toHaveAttribute("min", "240");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Teď jsi na straně 250 z 384");
  end = dialog.getByLabel("Na které straně jsi skončil?");
  await end.fill("259");
  await expect(dialog).toContainText("Zapíše se 9 stran");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog).toHaveCount(0);

  const saved = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem("dayframe-reading-library-v1")),
    sessions: JSON.parse(localStorage.getItem("dayframe-reading-sessions-v1")),
  }));
  expect(saved.library.current.currentPage).toBe(259);
  expect(saved.sessions.entries.map((entry) => entry.pages)).toEqual([11, 9]);
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-library-v1")).current.currentPage)).toBe(259);
});

test("other books retain a page-count entry because no starting page is tracked", async ({ page }) => {
  await openFresh(page);
  const date = await page.evaluate(localDateKeyInBrowser);
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = { [date]: [{
      id: "reading-other-book", title: "Čtení knihy", date,
      duration: 20, start: "18:00", end: "18:20",
      priority: "normal", category: "Čtení", mode: "flexible",
      completed: false, source: "routine", routineId: "read",
      dateLocked: true, autoScheduled: false, createdAt: new Date().toISOString(),
    }] };
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1, current: { id: "book-a", title: "Book A", currentPage: 30, totalPages: 100, startedAt: new Date().toISOString() },
      completed: [{ id: "book-b", title: "Book B", currentPage: 120, totalPages: 120, finishedAt: new Date().toISOString(), startedAt: new Date().toISOString() }],
    }));
  }, date);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1"));
    state.plans[date][0].completed = true;
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, date);
  const dialog = page.getByRole("dialog", { name: "Zapsat čtení" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Kniha").selectOption("book-b");
  await expect(dialog.getByLabel("Kolik stran jsi přečetl?")).toBeVisible();
  await dialog.getByLabel("Kolik stran jsi přečetl?").fill("12");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem("dayframe-reading-library-v1")),
    sessions: JSON.parse(localStorage.getItem("dayframe-reading-sessions-v1")),
  }));
  expect(saved.library.current.currentPage).toBe(30);
  expect(saved.sessions.entries[0]).toMatchObject({ bookId: "book-b", pages: 12 });
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


test("logging another active book advances only that book and keeps its page history", async ({ page }) => {
  await openFresh(page);
  const date = await page.evaluate(localDateKeyInBrowser);
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1") || "{}");
    state.routines = [];
    state.plans = { [date]: [
      { id: "multi-reading", title: "Čtení knihy", date, duration: 35, start: "18:00", end: "18:35",
        priority: "normal", category: "Čtení", mode: "flexible",
        completed: false, source: "routine", routineId: "read",
        dateLocked: true, autoScheduled: false, createdAt: new Date().toISOString() },
    ]};
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: { id: "primary", title: "Primary", currentPage: 10, totalPages: 100, startedAt: new Date().toISOString() },
      reading: [
        { id: "secondary", title: "Secondary", currentPage: 75, totalPages: 200, startedAt: new Date().toISOString() },
        { id: "tertiary", title: "Tertiary", currentPage: 2, totalPages: 90, startedAt: new Date().toISOString() },
      ],
      completed: [],
    }));
    localStorage.removeItem("dayframe-reading-sessions-v1");
    localStorage.removeItem("dayframe-reading-pending-v1");
  }, date);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem("dayframe-v1"));
    state.plans[date][0].completed = true;
    localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  }, date);
  const dialog = page.getByRole("dialog", { name: "Zapsat čtení" });
  await expect(dialog).toBeVisible();
  const options = dialog.getByLabel("Kniha");
  await expect(options.locator("option")).toHaveCount(4);
  await options.selectOption("secondary");
  await expect(dialog.getByLabel("Na které straně jsi skončil?")).toHaveAttribute("min", "76");
  await dialog.getByLabel("Na které straně jsi skončil?").fill("100");
  await expect(dialog).toContainText("Zapíše se 25 stran");
  await dialog.getByRole("button", { name: "Uložit záznam" }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem("dayframe-reading-library-v1")),
    sessions: JSON.parse(localStorage.getItem("dayframe-reading-sessions-v1")),
  }));
  expect(saved.library.current.currentPage).toBe(10);
  expect(saved.library.reading.map((book) => book.currentPage)).toEqual([100, 2]);
  expect(saved.sessions.entries[0]).toMatchObject({ bookId: "secondary", pages: 25 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  await expect(page.locator(".df2-reading-page-history")).toContainText("25 stran");
  await expect(page.locator(".df2-reading-current-book")).toContainText("Primary");
  await expect(page.locator('[data-reading-active-book="secondary"]')).toContainText("Secondary");
});
