import { test, expect } from "@playwright/test";

test("overview tracks completed reading separately across period modes", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "reading-done",
          title: "Večerní kniha",
          date,
          duration: 35,
          start: "20:00",
          end: "20:35",
          requestedStart: "20:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Rutina",
          mode: "flexible",
          completed: true,
          source: "routine",
          routineId: "read",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
        {
          id: "reading-open",
          title: "Čtení knihy",
          date,
          duration: 25,
          start: "21:00",
          end: "21:25",
          requestedStart: "21:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Rutina",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
        {
          id: "study-done",
          title: "Matematika",
          date,
          duration: 45,
          start: "10:00",
          end: "10:45",
          requestedStart: "10:00",
          dueDate: date,
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matematika",
          mode: "flexible",
          completed: true,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-reading-library-v1");
    window.localStorage.removeItem("dayframe-reading-book-metadata-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();

  const reading = history.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await expect(reading.getByRole("heading", { name: "Čtení" })).toBeVisible();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");
  await expect(reading).toContainText("1");
  await expect(reading).toContainText("dní čtení");
  await expect(reading).toContainText("průměr / den");
  await expect(reading).toContainText("dní nejdelší série");
  await expect(reading.locator(".df2-reading-stat").nth(1)).toContainText("35 min");

  const readingHost = history.locator("[data-reading-overview-host]");
  await expect(readingHost.evaluate((element) => element.previousElementSibling?.classList.contains("df2-history-trend"))).resolves.toBe(true);

  await history.getByRole("button", { name: "Měsíc" }).click();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");

  await history.getByRole("button", { name: "Rok" }).click();
  await expect(reading.locator(".df2-reading-primary")).toContainText("35 min");
});

test("reading tracker enriches a title with cover metadata and keeps it in dated book history", async ({ page }) => {
  await page.route("https://openlibrary.org/search.json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [
          {
            key: "/works/OL123W",
            title: "Security Analysis",
            author_name: ["Benjamin Graham", "David Dodd"],
            cover_i: 12345,
            publisher: ["McGraw-Hill"],
            subject: ["Finance", "Investments"],
          },
        ],
      }),
    });
  });
  await page.route("https://covers.openlibrary.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#ddd"/></svg>',
    });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    window.localStorage.removeItem("dayframe-reading-library-v1");
    window.localStorage.removeItem("dayframe-reading-book-metadata-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  const reading = history.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await expect(reading).toContainText("Žádná rozečtená kniha");

  await reading.getByRole("button", { name: "Přidat knihu" }).click();
  let dialog = page.getByRole("dialog", { name: "Co právě čteš?" });
  await dialog.getByLabel("Název knihy").fill("Security Analysis");

  const lookup = dialog.locator(".df2-reading-lookup-preview");
  await expect(lookup).toContainText("Údaje nalezeny");
  await expect(lookup).toContainText("Benjamin Graham");
  await expect(lookup).toContainText("Vydavatel: McGraw-Hill");
  await expect(lookup).toContainText("Žánr: Finance");
  await expect(lookup.locator("img")).toHaveAttribute("src", /covers\.openlibrary\.org\/b\/id\/12345-M\.jpg/);

  await dialog.getByLabel("Aktuální strana").fill("120");
  await dialog.getByLabel("Počet stran").fill("400");
  await dialog.getByRole("button", { name: "Začít číst" }).click();

  await expect(reading).toContainText("Security Analysis");
  await expect(reading).toContainText("Strana 120 z 400");
  await expect(reading).toContainText("30 %");
  await expect(reading.locator(".df2-reading-current-meta-host")).toContainText("Benjamin Graham");
  await expect(reading.locator(".df2-reading-current-meta-host")).toContainText("McGraw-Hill");
  await expect(reading.locator(".df2-reading-current-meta-host")).toContainText("Finance");
  await expect(reading.locator(".df2-reading-book-cover img")).toHaveAttribute("src", /12345-M\.jpg/);

  await reading.getByRole("button", { name: "Upravit knihu" }).click();
  dialog = page.getByRole("dialog", { name: "Upravit čtení" });
  await dialog.getByLabel("Aktuální strana").fill("200");
  await dialog.getByRole("button", { name: "Uložit" }).click();
  await expect(reading).toContainText("Strana 200 z 400");
  await expect(reading).toContainText("50 %");

  await reading.getByRole("button", { name: "Upravit knihu" }).click();
  dialog = page.getByRole("dialog", { name: "Upravit čtení" });
  await dialog.getByRole("button", { name: "Dočteno" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(history).toBeVisible();

  await reading.getByRole("button", { name: "Upravit knihu" }).click();
  dialog = page.getByRole("dialog", { name: "Upravit čtení" });
  await dialog.getByRole("button", { name: "Dočteno" }).click();

  await expect(reading).toContainText("Žádná rozečtená kniha");
  await expect(reading.locator(".df2-reading-year-summary")).toContainText("1 kniha");
  await expect(reading.locator(".df2-reading-year-summary")).toContainText("400 stran");

  const bookHistory = reading.locator(".df2-reading-book-history");
  await expect(bookHistory).toBeVisible();
  await expect(bookHistory).toContainText("Security Analysis");
  await expect(bookHistory).toContainText("Benjamin Graham");
  await expect(bookHistory).toContainText("McGraw-Hill");
  await expect(bookHistory).toContainText("Finance");
  await expect(bookHistory).toContainText("400 stran");
  await expect(bookHistory.locator("img")).toHaveAttribute("src", /12345-M\.jpg/);

  await reading.getByRole("button", { name: "Přidat knihu" }).click();
  dialog = page.getByRole("dialog", { name: "Co právě čteš?" });
  await expect(dialog.locator(".df2-reading-completed")).toContainText("Security Analysis");
  await expect(dialog.locator(".df2-reading-completed")).toContainText("400 stran");

  const library = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-library-v1") || "{}"));
  expect(library.current).toBeNull();
  expect(library.completed).toHaveLength(1);
  expect(library.completed[0].title).toBe("Security Analysis");
  expect(library.completed[0].totalPages).toBe(400);
  expect(library.completed[0].startedAt).toBeTruthy();
  expect(library.completed[0].finishedAt).toBeTruthy();

  const metadata = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-book-metadata-v1") || "{}"));
  const stored = metadata[library.completed[0].id];
  expect(stored.publisher).toBe("McGraw-Hill");
  expect(stored.genre).toBe("Finance");
  expect(stored.coverUrl).toContain("12345-M.jpg");
});
