import { test, expect } from "@playwright/test";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6S8AAAAASUVORK5CYII=",
  "base64",
);

test("broken reading cover falls back to a working Open Library edition cover", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [
          {
            title: "The Undercover Economist",
            cover_i: 999999,
            cover_edition_key: "OL17931310M",
            isbn: ["9780345494016"],
          },
        ],
      }),
    });
  });

  await page.route("**/covers.openlibrary.org/b/id/123456-M.jpg?default=false", async (route) => {
    await route.fulfill({ status: 404, body: "missing" });
  });
  await page.route("**/covers.openlibrary.org/b/olid/OL17931310M-M.jpg?default=false", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: transparentPng });
  });

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: {
        id: "undercover",
        title: "The Undercover Economist",
        currentPage: 103,
        totalPages: 384,
        startedAt: now,
      },
      completed: [],
    }));
    window.localStorage.setItem("dayframe-reading-book-metadata-v1", JSON.stringify({
      undercover: {
        titleKey: "the undercover economist",
        author: "Tim Harford",
        publisher: "Oxford University Press",
        genre: "Economics",
        coverUrl: "https://covers.openlibrary.org/b/id/123456-M.jpg?default=false",
        fetchedAt: now,
      },
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const reading = page.locator(".df2-reading-card");
  await expect(reading).toContainText("The Undercover Economist");

  const cover = reading.locator(".df2-reading-real-cover-host img");
  await expect(cover).toBeVisible();
  await expect.poll(async () => cover.getAttribute("src")).toContain("/b/olid/OL17931310M-M.jpg");

  const metadata = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-book-metadata-v1") || "{}"));
  expect(metadata.undercover.coverUrl).toContain("/b/olid/OL17931310M-M.jpg");
});
