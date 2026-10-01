import { test, expect } from "@playwright/test";

test("library entry only needs a title and auto-fills the page count", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [
          {
            key: "/works/OLKULICKA1W",
            title: "Kulička",
            author_name: ["Guy de Maupassant"],
            cover_i: 424242,
            publisher: ["Test Publisher"],
            subject: ["Fiction"],
            number_of_pages_median: 216,
          },
        ],
      }),
    });
  });

  await page.route("**/covers.openlibrary.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#ddd"/></svg>',
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
  await title.fill("Kulička");

  const preview = form.locator(".df2-reading-library-auto-preview");
  await expect(preview).toContainText("Nalezeno");
  await expect(preview).toContainText("Kulička");
  await expect(preview).toContainText("Guy de Maupassant");
  await expect(preview).toContainText("216 stran");
  await expect(preview.locator("img")).toHaveAttribute("src", /424242-M\.jpg/);
  await expect(save).toBeEnabled();

  await save.click();
  await expect(form).toBeHidden();
  await expect(library).toContainText("Kulička");
  await expect(library).toContainText("216 stran");

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-library-v1") || "{}"));
  expect(stored.completed).toHaveLength(1);
  expect(stored.completed[0].title).toBe("Kulička");
  expect(stored.completed[0].totalPages).toBe(216);
  expect(stored.completed[0].currentPage).toBe(216);
  expect(stored.completed[0].finishedAt).toBeTruthy();
});
