import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const STORAGE_KEY = "dayframe-hygiene-v1";

async function start(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate((key) => {
    const store = JSON.parse(localStorage.getItem(key));
    const items = [
      ["p1", "Face Serum", "Pleť", false],
      ["p2", "Body Lotion", "Tělo", false],
      ["p3", "Hair Shampoo", "Vlasy", false],
      ["p4", "Toothpaste", "Zuby", false],
      ["p5", "Beard Oil", "Holení", false],
      ["p6", "Le Male Elixir", "Vůně", false],
      ["p7", "Face Roller", "Pomůcky", false],
      ["p8", "Vitamin Case", "Doplňky", false],
      ["p9", "Other Product", "Ostatní", false],
      ["p10", "Unnamed Category Product", "", false],
      ["p11", "Old Shampoo", "Vlasy", true],
    ];
    store.products = items.map(([id, name, category, archived]) => ({
      id, name, brand: "", category, archived,
      description: "", instructions: "", frequency: "", openedOn: "", expiresOn: "",
      paoMonths: null, amount: "", stockStatus: "ok", stockCount: 1, shopUrl: "",
    }));
    localStorage.setItem(key, JSON.stringify(store));
    dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, STORAGE_KEY);
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
}

test("active products are grouped by category in a stable order, including custom and uncategorized products", async ({ page }) => {
  await start(page);
  const grouped = page.getByLabel("Produkty podle kategorií");
  await expect(grouped.locator(".df2-products-category-heading h3")).toHaveText([
    "Pleť", "Tělo", "Vlasy", "Zuby", "Holení", "Vůně", "Pomůcky", "Doplňky", "Ostatní",
  ]);
  await expect(page.getByRole("region", { name: "Kategorie Pleť" }).locator(".df2-product-card")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Kategorie Vlasy" })).toContainText("Hair Shampoo");
  await expect(page.getByRole("region", { name: "Kategorie Vůně" })).toContainText("Le Male Elixir");
  await expect(page.getByRole("region", { name: "Kategorie Ostatní" }).locator(".df2-product-card")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Kategorie Ostatní" }).locator(".df2-products-category-heading")).toContainText("2 produkty");
  await expect(grouped).not.toContainText("Old Shampoo");
});

test("search, archived tab and category editing regroup visible cards without changing stored products", async ({ page }) => {
  await start(page);
  const search = page.getByRole("searchbox", { name: "Hledat produkt" });
  await search.fill("lotion");
  await expect(page.getByLabel("Produkty podle kategorií").locator(".df2-products-category-heading h3")).toHaveText(["Tělo"]);
  await expect(page.getByRole("region", { name: "Kategorie Tělo" }).locator(".df2-product-card")).toHaveCount(1);
  await search.fill("");
  await page.locator(".df2-product-card").filter({ hasText: "Hair Shampoo" }).click();
  await page.getByRole("dialog", { name: "Detail produktu Hair Shampoo" }).getByRole("button", { name: "Upravit" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("combobox", { name: "Kategorie" }).selectOption("Tělo");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(page.getByRole("region", { name: "Kategorie Tělo" })).toContainText("Hair Shampoo");
  await expect(page.getByRole("region", { name: "Kategorie Vlasy" })).toHaveCount(0);
  await page.getByRole("button", { name: "Archivované" }).click();
  const grouped = page.getByLabel("Produkty podle kategorií");
  await expect(grouped.locator(".df2-products-category-heading h3")).toHaveText(["Vlasy"]);
  await expect(page.getByRole("region", { name: "Kategorie Vlasy" })).toContainText("Old Shampoo");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).products, STORAGE_KEY);
  expect(saved).toHaveLength(11);
  expect(saved.find((item) => item.name === "Hair Shampoo").category).toBe("Tělo");
  expect(saved.find((item) => item.name === "Old Shampoo").archived).toBe(true);
});

test("category groups remain readable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  const groups = page.getByLabel("Produkty podle kategorií");
  await expect(groups.locator(".df2-products-category-heading h3")).toHaveCount(9);
  await expect(page.getByRole("region", { name: "Kategorie Zuby" }).locator(".df2-product-card")).toHaveCount(1);
  const bounds = await groups.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds.width).toBeLessThanOrEqual(375);
});
