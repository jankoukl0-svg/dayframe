import { test, expect } from "@playwright/test";

test("completed books are searchable, filterable and can be added retroactively", async ({ page }) => {
  await page.route("https://covers.openlibrary.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#ddd"/></svg>',
    });
  });

  await page.route("https://openlibrary.org/search.json**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: null,
      completed: [
        {
          id: "security-analysis",
          title: "Security Analysis",
          currentPage: 700,
          totalPages: 700,
          startedAt: "2026-01-05T12:00:00.000Z",
          finishedAt: "2026-02-10T12:00:00.000Z",
        },
        {
          id: "thinking-fast-slow",
          title: "Thinking, Fast and Slow",
          currentPage: 499,
          totalPages: 499,
          startedAt: "2025-09-01T12:00:00.000Z",
          finishedAt: "2025-10-04T12:00:00.000Z",
        },
      ],
    }));
    window.localStorage.setItem("dayframe-reading-book-metadata-v1", JSON.stringify({
      "security-analysis": {
        titleKey: "security analysis",
        author: "Benjamin Graham",
        publisher: "McGraw-Hill",
        genre: "Finance",
        coverUrl: "https://covers.openlibrary.org/b/id/101-M.jpg?default=false",
        fetchedAt: new Date().toISOString(),
      },
      "thinking-fast-slow": {
        titleKey: "thinking fast and slow",
        author: "Daniel Kahneman",
        publisher: "Farrar, Straus and Giroux",
        genre: "Psychology",
        coverUrl: "https://covers.openlibrary.org/b/id/102-M.jpg?default=false",
        fetchedAt: new Date().toISOString(),
      },
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await reading.getByRole("button", { name: /Knihovna/ }).click();

  const library = page.getByRole("dialog", { name: "Moje knihovna" });
  await expect(library).toBeVisible();
  await expect(library).toContainText("Security Analysis");
  await expect(library).toContainText("Thinking, Fast and Slow");
  await expect(library).toContainText("Benjamin Graham");
  await expect(library).toContainText("Daniel Kahneman");
  await expect(library.locator(".df2-reading-library-summary")).toContainText("1 199");

  await library.getByPlaceholder("Hledat knihu, autora…").fill("Kahneman");
  await expect(library.locator(".df2-reading-library-book")).toHaveCount(1);
  await expect(library).toContainText("Thinking, Fast and Slow");

  await library.getByPlaceholder("Hledat knihu, autora…").fill("");
  await library.getByLabel("Filtrovat podle roku").selectOption("2026");
  await expect(library.locator(".df2-reading-library-book")).toHaveCount(1);
  await expect(library).toContainText("Security Analysis");

  await library.getByLabel("Filtrovat podle roku").selectOption("all");
  await library.getByLabel("Filtrovat podle žánru").selectOption({ label: "Finance" });
  await expect(library.locator(".df2-reading-library-book")).toHaveCount(1);
  await expect(library).toContainText("Security Analysis");

  await library.getByLabel("Filtrovat podle žánru").selectOption("all");
  await library.getByRole("button", { name: "+ Přidat přečtenou" }).click();
  await library.getByLabel("Název knihy").fill("The Most Important Thing");
  await library.getByLabel("Počet stran").fill("200");
  await library.getByLabel("Začátek čtení").fill("2026-03-01");
  await library.getByLabel("Dočteno").fill("2026-03-12");
  await library.getByRole("button", { name: "Uložit do knihovny" }).click();

  await expect(library).toContainText("The Most Important Thing");
  await expect(library.locator(".df2-reading-library-book")).toHaveCount(3);

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-library-v1") || "{}"));
  expect(stored.completed).toHaveLength(3);
  expect(stored.completed.some((book) => book.title === "The Most Important Thing" && book.totalPages === 200)).toBe(true);
});
