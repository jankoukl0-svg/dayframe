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

  const cover = reading.locator('[data-reading-active-book="undercover"] .df2-reading-book-cover img');
  await expect(cover).toBeVisible();
  await expect.poll(async () => cover.getAttribute("src")).toContain("/b/olid/OL17931310M-M.jpg");

  const geometry = await reading.locator('[data-reading-active-book="undercover"] .df2-reading-book-cover').evaluate((element) => {
    const image = element.querySelector("img");
    const parentBox = element.getBoundingClientRect();
    const imageBox = image?.getBoundingClientRect();
    return {
      parent: { width: parentBox.width, height: parentBox.height },
      image: imageBox ? { width: imageBox.width, height: imageBox.height } : null,
    };
  });

  expect(geometry.image).not.toBeNull();
  expect(Math.abs(geometry.image.width - geometry.parent.width)).toBeLessThan(1);
  expect(Math.abs(geometry.image.height - geometry.parent.height)).toBeLessThan(1);
  expect(geometry.image.width).toBeGreaterThan(35);
  expect(geometry.image.height).toBeGreaterThan(50);

  const metadata = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-reading-book-metadata-v1") || "{}"));
  expect(metadata.undercover.coverUrl).toContain("/b/olid/OL17931310M-M.jpg");
});


test("a failed cover on the second active book is recovered without changing the first", async ({ page }) => {
  await page.route("**/openlibrary.org/search.json?**", (route) => {
    const url = new URL(route.request().url());
    const title = url.searchParams.get("title") || "";
    const psych = title.toLowerCase().includes("psychology");
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ docs: [{
        title: psych ? "The Psychology of Money" : "The Undercover Economist",
        cover_edition_key: psych ? "OLPSYCH123M" : "OL17931310M",
      }] }),
    });
  });
  await page.route("**/covers.openlibrary.org/b/id/123456-M.jpg?default=false", (route) =>
    route.fulfill({ status: 404, body: "missing" }));
  await page.route("**/covers.openlibrary.org/b/olid/OLPSYCH123M-M.jpg?default=false", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }));
  await page.route("**/covers.openlibrary.org/b/id/333333-M.jpg?default=false", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }));

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: { id: "first", title: "The Undercover Economist", currentPage: 35, totalPages: 300, startedAt: now },
      reading: [{ id: "second", title: "The Psychology of Money", currentPage: 20, totalPages: 253, startedAt: now }],
      completed: [],
    }));
    localStorage.setItem("dayframe-reading-book-metadata-v1", JSON.stringify({
      first: { titleKey: "the undercover economist", coverUrl: "https://covers.openlibrary.org/b/id/333333-M.jpg?default=false", fetchedAt: now },
      second: { titleKey: "the psychology of money", coverUrl: "https://covers.openlibrary.org/b/id/123456-M.jpg?default=false", fetchedAt: now },
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Přehled/ }).click();

  const first = page.locator('[data-reading-active-book="first"] .df2-reading-book-cover img');
  const second = page.locator('[data-reading-active-book="second"] .df2-reading-book-cover img');
  await expect(first).toHaveAttribute("src", /333333-M\.jpg/);
  await expect.poll(async () => second.getAttribute("src")).toContain("/b/olid/OLPSYCH123M-M.jpg");
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-book-metadata-v1")));
  expect(meta.first.coverUrl).toContain("333333-M.jpg");
  expect(meta.second.coverUrl).toContain("OLPSYCH123M-M.jpg");
});


test("a book promoted after 300/300 completion restores a cover missing from saved metadata", async ({ page }) => {
  let searches = 0;
  await page.route("**/openlibrary.org/search.json?**", (route) => {
    searches++;
    const title = new URL(route.request().url()).searchParams.get("title") ?? "";
    if (!title.toLowerCase().includes("psychology")) {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ docs: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      docs: [
        // The first correct-title edition has no cover, as can happen in Open Library.
        { title: "The Psychology of Money", author_name: ["Morgan Housel"] },
        { title: "The Psychology of Money", author_name: ["Morgan Housel"],
          cover_edition_key: "OLPSYCH123M" },
      ],
    }) });
  });
  await page.route("**/covers.openlibrary.org/b/olid/OLPSYCH123M-M.jpg?default=false", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }));

  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1,
      current: { id: "finished", title: "The Undercover Economist", currentPage: 300,
        totalPages: 300, startedAt: now },
      reading: [{ id: "psych", title: "The Psychology of Money", currentPage: 22,
        totalPages: 253, startedAt: now }],
      completed: [],
    }));
    localStorage.setItem("dayframe-reading-book-metadata-v1", JSON.stringify({
      finished: { titleKey: "the undercover economist", author: "Tim Harford",
        fetchedAt: now },
      psych: { titleKey: "the psychology of money", author: "Morgan Housel",
        publisher: "Lulu Press, Inc.", genre: "Consumption (Economics)",
        fetchedAt: now },
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Přehled/ }).click();

  const card = page.locator('[data-reading-active-book="psych"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Morgan Housel");
  await expect(card).toContainText("Strana 22 z 253");
  const cover = card.locator(".df2-reading-book-cover img");
  await expect(cover).toHaveAttribute("src", /OLPSYCH123M-M\.jpg/);
  await expect(cover).toBeVisible();
  await expect(page.locator(".df2-reading-year-summary")).toContainText("1 kniha");
  const saved = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem("dayframe-reading-library-v1")),
    metadata: JSON.parse(localStorage.getItem("dayframe-reading-book-metadata-v1")),
  }));
  expect(saved.library.current.id).toBe("psych");
  expect(saved.library.completed.map((book) => book.id)).toEqual(["finished"]);
  expect(saved.metadata.psych.coverUrl).toContain("OLPSYCH123M-M.jpg");
  expect(saved.metadata.psych.publisher).toBe("Lulu Press, Inc.");
  expect(saved.metadata.psych.author).toBe("Morgan Housel");
  expect(searches).toBeLessThan(5);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  await expect(page.locator('[data-reading-active-book="psych"] .df2-reading-book-cover img'))
    .toHaveAttribute("src", /OLPSYCH123M-M\.jpg/);
});

test("missing cover recovery never replaces selected metadata on an unsuccessful lookup", async ({ page }) => {
  let searches = 0;
  await page.route("**/openlibrary.org/search.json?**", (route) => {
    searches++;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"docs":[]}' });
  });
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem("dayframe-reading-library-v1", JSON.stringify({
      version: 1, current: { id: "psych", title: "The Psychology of Money",
        currentPage: 22, totalPages: 253, startedAt: now }, reading: [], completed: [],
    }));
    localStorage.setItem("dayframe-reading-book-metadata-v1", JSON.stringify({
      psych: { titleKey: "the psychology of money", author: "Morgan Housel",
        publisher: "Lulu Press, Inc.", fetchedAt: now },
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Přehled/ }).click();
  await expect(page.locator('[data-reading-active-book="psych"]')).toContainText("Morgan Housel");
  await expect.poll(() => searches).toBeGreaterThan(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-reading-book-metadata-v1")));
  expect(saved.psych.author).toBe("Morgan Housel");
  expect(saved.psych.publisher).toBe("Lulu Press, Inc.");
  expect(saved.psych.coverUrl).toBeUndefined();
  await page.waitForTimeout(800);
  expect(searches).toBeLessThan(5);
});
