import { test, expect } from "@playwright/test";

test("library prefers an exact Google Books match over a misleading partial Open Library title", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [
          {
            key: "/works/OLWRONGKULICKA1W",
            title: "Miš Kulička v cirkuse",
            author_name: ["Josef Menzel"],
            cover_i: 111111,
            publisher: ["Melantrich"],
            subject: ["Bohemian Fiction"],
            number_of_pages_median: 31,
          },
        ],
      }),
    });
  });

  await page.route("**/www.googleapis.com/books/v1/volumes?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "maupassant-kulicka",
            volumeInfo: {
              title: "Kulička",
              authors: ["Guy de Maupassant"],
              publisher: "Odeon",
              categories: ["Fiction"],
              pageCount: 216,
            },
          },
        ],
      }),
    });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({ version: 1, current: null, completed: [] }));
    window.localStorage.removeItem("dayframe-reading-book-metadata-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await reading.getByRole("button", { name: /Knihovna/ }).click();

  const library = page.getByRole("dialog", { name: "Moje knihovna" });
  await expect(library).toBeVisible();
  await library.getByRole("button", { name: /Přidat přečtenou/ }).click();

  const form = library.locator(".df2-reading-library-add-form");
  const title = form.getByLabel("Název knihy");
  await expect(title).toBeVisible();
  await expect(form.getByLabel("Počet stran")).toBeHidden();
  await expect(form.getByLabel("Začátek čtení")).toBeHidden();
  await expect(form.getByLabel("Dočteno")).toBeHidden();

  const save = form.getByRole("button", { name: "Uložit do knihovny" });
  await expect(save).toBeDisabled();
  await title.fill("kulička");

  const preview = form.locator(".df2-reading-library-auto-preview");
  await expect(preview).toContainText("Nalezeno");
  await expect(preview).toContainText("Kulička");
  await expect(preview).toContainText("Guy de Maupassant");
  await expect(preview).toContainText("216 stran");
  await expect(preview).not.toContainText("Miš Kulička v cirkuse");
  await expect(save).toBeEnabled();

  await save.click();
  await expect(form).toBeHidden();
  await expect(library).toContainText("kulička");
  await expect(library).toContainText("216 stran");

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-library-v1") || "{}"));
  expect(stored.completed).toHaveLength(1);
  expect(stored.completed[0].title).toBe("kulička");
  expect(stored.completed[0].totalPages).toBe(216);
  expect(stored.completed[0].currentPage).toBe(216);
  expect(stored.completed[0].finishedAt).toBeTruthy();
});

test("distinct editions of the same title stay available for selection", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) });
  });
  await page.route("**/www.googleapis.com/books/v1/volumes?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "guest-edition-one",
            volumeInfo: {
              title: "The Guest",
              authors: ["Albert Example"],
              publisher: "Publisher One",
              pageCount: 120,
            },
          },
          {
            id: "guest-edition-two",
            volumeInfo: {
              title: "The Guest",
              authors: ["Albert Example"],
              publisher: "Publisher Two",
              pageCount: 240,
            },
          },
        ],
      }),
    });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await reading.getByRole("button", { name: /Knihovna/ }).click();
  const library = page.getByRole("dialog", { name: "Moje knihovna" });
  await library.getByRole("button", { name: /Přidat přečtenou/ }).click();

  const form = library.locator(".df2-reading-library-add-form");
  await form.getByLabel("Název knihy").fill("The Guest");
  await expect(form).toContainText("Vyber správnou knihu");
  await expect(form.getByRole("button", { name: "Uložit do knihovny" })).toBeDisabled();

  const choices = form.locator(".df2-reading-library-auto-choice");
  await expect(choices).toHaveCount(2);
  await expect(choices.filter({ hasText: "Publisher One" })).toContainText("120 stran");
  await expect(choices.filter({ hasText: "Publisher Two" })).toContainText("240 stran");
  await choices.filter({ hasText: "Publisher Two" }).click();
  await expect(form.locator(".df2-reading-library-auto-preview")).toContainText("240 stran");
  await expect(form.getByRole("button", { name: "Uložit do knihovny" })).toBeEnabled();
});

test("a lone partial match still requires confirmation", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [
          {
            key: "/works/OLPARTIAL1W",
            title: "Miš Kulička v cirkuse",
            author_name: ["Josef Menzel"],
            number_of_pages_median: 31,
          },
        ],
      }),
    });
  });
  await page.route("**/www.googleapis.com/books/v1/volumes?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toBeVisible();
  await reading.getByRole("button", { name: /Knihovna/ }).click();
  const library = page.getByRole("dialog", { name: "Moje knihovna" });
  await library.getByRole("button", { name: /Přidat přečtenou/ }).click();

  const form = library.locator(".df2-reading-library-add-form");
  await form.getByLabel("Název knihy").fill("Kulička");
  await expect(form).toContainText("Název není přesná shoda");
  await expect(form).toContainText("Miš Kulička v cirkuse");
  await expect(form.getByRole("button", { name: "Uložit do knihovny" })).toBeDisabled();

  await form.locator(".df2-reading-library-auto-choice").click();
  await expect(form.getByRole("button", { name: "Uložit do knihovny" })).toBeEnabled();
});
