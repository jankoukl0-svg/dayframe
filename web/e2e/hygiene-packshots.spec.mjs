import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function imageFixture(page, background) {
  const dataUrl = await page.evaluate((fill) => {
    const c = document.createElement("canvas"); c.width = 280; c.height = 320;
    const ctx = c.getContext("2d");
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 280, 320);
    ctx.fillStyle = "#205aba"; ctx.fillRect(93, 58, 94, 221);
    ctx.fillStyle = "#fff"; ctx.fillRect(113, 95, 55, 40);
    return c.toDataURL("image/png");
  }, background);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function start(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  return page.getByRole("dialog", { name: "Editor produktu" });
}

async function inspectPreviewCorners(dialog) {
  return dialog.locator('img[alt="Náhled nahrané fotografie"]').evaluate(async (img) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);
    const rgba = (x, y) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    return { corner: rgba(0, 0), center: rgba(Math.round(img.naturalWidth / 2), Math.round(img.naturalHeight / 2)) };
  });
}

test("new product chooses a white studio packshot over a dark image from the same product", async ({ page }) => {
  const dialog = await start(page);
  const white = await imageFixture(page, "#ffffff");
  const dark = await imageFixture(page, "#373737");
  const image = "https://cdn.example.org/photos/dark.png";
  const studio = "https://cdn.example.org/photos/white.png";
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "image") {
      return route.fulfill({ status: 200, contentType: "image/png",
        body: params.get("url") === studio ? white : dark });
    }
    if (params.get("mode") === "photos") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ candidates: [
          { url: image, source: "Dark shop", priority: 30 },
          { url: studio, source: "White manufacturer", priority: 12 },
        ] }) });
    }
    if (params.get("mode") === "guide") return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ guide: {} }),
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      matches: [{ name: "Universal Cleanser", brand: "Any Brand", category: "Pleť",
        description: "", instructions: "", sourceUrl: "https://example.org/cleanser",
        sourceLabel: "Store", imageUrl: image, amount: "250 ml", priceCzk: null }],
    }) });
  });
  await dialog.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill("Universal Cleanser");
  await dialog.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await dialog.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(dialog.locator(".df2-packshot-notice")).toContainText("bílým nebo průhledným pozadím");
  await expect(dialog.locator(".df2-packshot-notice")).toContainText("White manufacturer");
  const preview = await inspectPreviewCorners(dialog);
  expect(preview.corner.every(value => value >= 240)).toBe(true);
  expect(preview.center[2]).toBeGreaterThan(preview.center[0] * 1.5);
  await dialog.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products
    .find((item) => item.name === "Universal Cleanser")?.photoKey)).toBeTruthy();
});

test("uniform nonwhite backdrop is cleaned safely to white", async ({ page }) => {
  const dialog = await start(page);
  const gray = await imageFixture(page, "#b5b5b5");
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "image") return route.fulfill({ status: 200, contentType: "image/png", body: gray });
    if (params.get("mode") === "photos") return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        candidates: [{ url: "https://example.org/gray.png", priority: 20, source: "Generic catalog" }],
      }),
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await dialog.getByRole("textbox", { name: "Název produktu *" }).fill("My Special Product");
  await dialog.getByRole("button", { name: "Najít lepší fotku" }).click();
  await expect(dialog.locator(".df2-packshot-notice")).toContainText("sjednotil na bílou");
  const preview = await inspectPreviewCorners(dialog);
  expect(preview.corner.every(value => value >= 240)).toBe(true);
  expect(preview.center[2]).toBeGreaterThan(preview.center[0] * 1.5);
});

test("existing uploaded photo is not replaced silently, explicit refresh replaces only on Save", async ({ page }) => {
  const dialog = await start(page);
  const manual = await imageFixture(page, "#f8f8f8");
  const refreshed = await imageFixture(page, "#ffffff");
  const inputs = dialog.getByRole("textbox", { name: "Název produktu *" });
  await inputs.fill("Special Hand Lotion");
  await dialog.getByLabel("Fotografie produktu").setInputFiles({
    name: "my-photo.png", mimeType: "image/png", buffer: manual,
  });
  await expect(dialog.locator(".df2-packshot-notice")).toContainText("nahraná fotografie");
  await dialog.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products
    .find((item) => item.name === "Special Hand Lotion")?.photoKey)).toBeTruthy();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products
    .find((item) => item.name === "Special Hand Lotion"));
  await page.locator(".df2-product-card").filter({ hasText: "Special Hand Lotion" }).click();
  await page.getByRole("dialog", { name: /Detail produktu/ }).getByRole("button", { name: "Upravit" }).click();
  const edit = page.getByRole("dialog", { name: "Editor produktu" });
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "image") return route.fulfill({ status: 200, contentType: "image/png", body: refreshed });
    if (params.get("mode") === "photos") return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        candidates: [{ url: "https://example.org/white.png", source: "Maker", priority: 10 }],
      }),
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await edit.getByRole("button", { name: "Najít lepší fotku" }).click();
  await expect(edit.locator(".df2-packshot-notice")).toContainText("bílým nebo průhledným pozadím");
  const stillSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products
    .find((item) => item.name === "Special Hand Lotion"));
  expect(stillSaved.photoKey).toBe(saved.photoKey);
  await edit.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(edit).toHaveCount(0);
  const newSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products
    .find((item) => item.name === "Special Hand Lotion"));
  expect(newSaved.photoKey).not.toBe(saved.photoKey);
});

test("photo lookup failure preserves existing manual photograph", async ({ page }) => {
  const dialog = await start(page);
  const manual = await imageFixture(page, "#ffffff");
  await dialog.getByRole("textbox", { name: "Název produktu *" }).fill("Unlisted Item");
  await dialog.getByLabel("Fotografie produktu").setInputFiles({
    name: "manual.png", mimeType: "image/png", buffer: manual,
  });
  await page.route("**/api/hygiene-product-lookup?*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await dialog.getByRole("button", { name: "Najít lepší fotku" }).click();
  await expect(dialog.locator(".df2-packshot-notice")).toContainText("nepodařilo stáhnout");
  await expect(dialog.locator('img[alt="Náhled nahrané fotografie"]')).toBeVisible();
});
