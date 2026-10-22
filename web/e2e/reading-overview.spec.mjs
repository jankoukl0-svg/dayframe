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
    // This test measures reading duration from the task plan, not page logging.
    // Mark the synthetic completed task as handled so the page-log dialog
    // cannot intercept the Overview navigation after hydration.
    window.localStorage.setItem("dayframe-reading-sessions-v1", JSON.stringify({
      version: 1, entries: [], skippedTaskIds: ["reading-done"],
    }));
    window.localStorage.removeItem("dayframe-reading-pending-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  // A completion prompt may hydrate after a short delay when all suites run.
  // This test measures Overview, not the separate session-entry workflow.
  const pendingReading = page.getByRole("dialog", { name: "Zapsat čtení" });
  await page.waitForTimeout(500);
  if (await pendingReading.isVisible()) {
    await pendingReading.getByRole("button", { name: "Nezapisovat" }).click();
  }

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
  await expect(readingHost.evaluate((element) => element.previousElementSibling?.classList.contains("df2-overview-bottom-grid"))).resolves.toBe(true);

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
  await expect(lookup).toContainText("Vybrat tuto knihu");
  await lookup.getByRole("button", { name: "Vybrat nalezenou knihu Security Analysis" }).click();
  await expect(lookup.getByRole("button")).toHaveAttribute("aria-pressed", "true");
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


test("multiple books can be started, edited, finished independently and survive reload", async ({ page }) => {
  await page.route("https://openlibrary.org/search.json**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) }));
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    localStorage.removeItem("dayframe-reading-library-v1");
    localStorage.removeItem("dayframe-reading-book-metadata-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  const addBook = async (title, currentPage, totalPages, button) => {
    await reading.getByRole("button", { name: button, exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Co právě čteš?" });
    await modal.getByLabel("Název knihy").fill(title);
    await modal.getByLabel("Aktuální strana").fill(String(currentPage));
    await modal.getByLabel("Počet stran").fill(String(totalPages));
    await modal.getByRole("button", { name: "Začít číst" }).click();
    await expect(modal).toHaveCount(0);
  };

  await addBook("Book Alpha", 30, 100, "Přidat knihu");
  await addBook("Book Beta", 150, 300, "Přidat další knihu");
  await expect(reading.locator(".df2-reading-current-book")).toContainText("Book Alpha");
  await expect(reading.locator('[data-reading-active-book]')).toHaveCount(1);
  await expect(reading.locator('[data-reading-active-book]')).toContainText("Book Beta");
  await expect(reading.locator('[data-reading-active-book]')).toContainText("Strana 150 z 300");

  await reading.getByRole("button", { name: "Upravit Book Beta" }).click();
  let modal = page.getByRole("dialog", { name: "Upravit čtení" });
  await expect(modal.getByLabel("Aktuální strana")).toHaveValue("150");
  await modal.getByLabel("Aktuální strana").fill("185");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(reading.locator('[data-reading-active-book]')).toContainText("Strana 185 z 300");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  await expect(reading.locator('[data-reading-active-book]')).toContainText("Strana 185 z 300");
  await reading.getByRole("button", { name: "Upravit Book Beta" }).click();
  modal = page.getByRole("dialog", { name: "Upravit čtení" });
  await modal.getByRole("button", { name: "Dočteno" }).click();
  await expect(reading.locator('[data-reading-active-book]')).toHaveCount(0);
  await expect(reading.locator(".df2-reading-current-book")).toContainText("Book Alpha");
  await expect(reading.locator(".df2-reading-year-summary")).toContainText("1 kniha");

  await addBook("Book Gamma", 20, 200, "Přidat další knihu");
  await reading.getByRole("button", { name: "Upravit knihu", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Upravit čtení" });
  await expect(modal.getByLabel("Název knihy")).toHaveValue("Book Alpha");
  await modal.getByRole("button", { name: "Dočteno" }).click();
  await expect(reading.locator(".df2-reading-current-book")).toContainText("Book Gamma");
  await expect(reading.locator(".df2-reading-current-book")).toContainText("Strana 20 z 200");

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-library-v1")));
  expect(saved.version).toBe(1);
  expect(saved.current.title).toBe("Book Gamma");
  expect(saved.reading).toHaveLength(0);
  expect(saved.completed.map((book) => book.title)).toEqual(["Book Beta", "Book Alpha"]);
});


test("found Psychology of Money is selectable in edit mode without replacing existing pages", async ({ page }) => {
  await page.route("https://openlibrary.org/search.json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: [{
        key: "/works/OLPSYCH123W", title: "The Psychology of Money",
        author_name: ["Morgan Housel"], cover_i: 21212,
        publisher: ["Harriman House"], subject: ["Consumption (Economics)"],
        number_of_pages_median: 200,
      }] }),
    });
  });
  await page.route("https://covers.openlibrary.org/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"/>' });
  });
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1, current: {
        id: "psych-book", title: "psychology of money", currentPage: 0,
        totalPages: 253, startedAt: new Date().toISOString(),
      }, reading: [], completed: [],
    }));
    localStorage.removeItem("dayframe-reading-book-metadata-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await reading.getByRole("button", { name: "Upravit knihu" }).click();
  const dialog = page.getByRole("dialog", { name: "Upravit čtení" });
  const lookup = dialog.locator(".df2-reading-lookup-preview");
  const choose = lookup.getByRole("button", { name: "Vybrat nalezenou knihu The Psychology of Money" });
  await expect(choose).toBeVisible();
  // The whole result must occupy the modal width, with its metadata visible
  // beside the cover rather than clipped into the old 36px preview column.
  const dimensions = await lookup.evaluate((root) => {
    const button = root.querySelector(".df2-reading-lookup-select");
    const cover = root.querySelector(".df2-reading-lookup-cover");
    const details = root.querySelector(".df2-reading-lookup-details");
    const title = root.querySelector(".df2-reading-lookup-title");
    return {
      previewWidth: root.getBoundingClientRect().width,
      buttonWidth: button.getBoundingClientRect().width,
      coverWidth: cover.getBoundingClientRect().width,
      detailsWidth: details.getBoundingClientRect().width,
      detailsDisplay: getComputedStyle(details).display,
      titleWidth: title.getBoundingClientRect().width,
      titleHeight: title.getBoundingClientRect().height,
    };
  });
  expect(dimensions.previewWidth).toBeGreaterThan(250);
  expect(dimensions.buttonWidth).toBeGreaterThan(250);
  expect(dimensions.detailsWidth).toBeGreaterThan(180);
  expect(dimensions.detailsDisplay).toBe("flex");
  expect(dimensions.titleWidth).toBeGreaterThan(180);
  expect(dimensions.titleHeight).toBeGreaterThan(10);
  expect(dimensions.coverWidth).toBeGreaterThan(40);
  await expect(lookup).toContainText("The Psychology of Money");
  await expect(lookup).toContainText("Morgan Housel");
  await expect(dialog.getByLabel("Název knihy")).toHaveValue("psychology of money");
  await expect(dialog.getByLabel("Počet stran")).toHaveValue("253");

  await choose.click();
  await expect(choose).toHaveAttribute("aria-pressed", "true");
  await expect(lookup).toContainText("Kniha vybrána");
  await expect(dialog.getByLabel("Název knihy")).toHaveValue("The Psychology of Money");
  await expect(dialog.getByLabel("Počet stran")).toHaveValue("253");
  await dialog.getByRole("button", { name: "Uložit", exact: true }).click();
  const saved = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem("dayframe-reading-library-v1")),
    metadata: JSON.parse(localStorage.getItem("dayframe-reading-book-metadata-v1")),
  }));
  expect(saved.library.current).toMatchObject({
    id: "psych-book", title: "The Psychology of Money", currentPage: 0, totalPages: 253,
  });
  expect(saved.metadata["psych-book"]).toMatchObject({
    titleKey: "the psychology of money", author: "Morgan Housel",
    publisher: "Harriman House", openLibraryKey: "/works/OLPSYCH123W",
  });
  await expect(reading.locator(".df2-reading-current-meta")).toContainText("Morgan Housel");

  // Selecting the known book in add mode should fill only a genuinely blank page count.
  await reading.getByRole("button", { name: "Přidat další knihu" }).click();
  const add = page.getByRole("dialog", { name: "Co právě čteš?" });
  await add.getByLabel("Název knihy").fill("psychology of money");
  await expect(add.getByLabel("Počet stran")).toHaveValue("");
  await add.getByRole("button", { name: "Vybrat nalezenou knihu The Psychology of Money" }).click();
  await expect(add.getByLabel("Počet stran")).toHaveValue("200");
  await add.getByRole("button", { name: "Začít číst" }).click();
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-library-v1")).reading);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ title: "The Psychology of Money", totalPages: 200 });
});
