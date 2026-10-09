import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMC/50MEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBXKqA31N0fbGAAAAAElFTkSuQmCC", "base64");

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

function lookupMock(page, matches, onRequest = () => {}) {
  return page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    onRequest(params);
    if (params.get("mode") === "image") {
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ matches, notice: "Nalezené produkty – ověř údaje před uložením." }),
    });
  });
}

const sample = {
  name: "CeraVe SA Smoothing Cleanser",
  brand: "CeraVe",
  category: "Pleť",
  description: "Čisticí gel pro hrubou a nerovnou pokožku.",
  instructions: "",
  amount: "236 ml",
  priceCzk: null,
  imageUrl: "https://images.openbeautyfacts.org/images/products/test.jpg",
  sourceUrl: "https://world.openbeautyfacts.org/product/3333333333333",
  sourceLabel: "Open Beauty Facts",
};

test("name-only lookup suggests verified product, imports photo and leaves personal fields unset", async ({ page }) => {
  await lookupMock(page, [sample]);
  const editor = await start(page);
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("CERAVE Smoothing Cleanser");
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await expect(editor.getByLabel("Nalezené produkty")).toContainText("CeraVe SA Smoothing Cleanser");
  await editor.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(editor.getByRole("textbox", { name: "Název produktu *" })).toHaveValue("CeraVe SA Smoothing Cleanser");
  await expect(editor.getByRole("textbox", { name: "Značka" })).toHaveValue("CeraVe");
  await expect(editor.getByRole("textbox", { name: "Popis a účel" })).toHaveValue(sample.description);
  await expect(editor.getByRole("textbox", { name: "Velikost balení" })).toHaveValue("236 ml");
  await expect(editor.getByRole("textbox", { name: "Návod k použití" })).toHaveValue("");
  await expect(editor.getByLabel("Datum otevření")).toHaveValue("");
  await expect(editor.getByLabel("Expirace (pokud známá)")).toHaveValue("");
  await expect(editor.locator('img[alt="Náhled nahrané fotografie"]')).toBeVisible();
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(editor).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  const product = saved.products.find((p) => p.name === "CeraVe SA Smoothing Cleanser");
  expect(product).toMatchObject({
    brand: "CeraVe", category: "Pleť", description: sample.description,
    amount: "236 ml", instructions: "", openedOn: "", expiresOn: "", stockCount: null,
  });
  expect(product.photoKey).toBeTruthy();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await expect(page.locator(".df2-product-card").filter({ hasText: "CeraVe SA Smoothing Cleanser" }).locator("img")).toBeVisible();
});

test("a product link fills factual metadata and preserves the exact store link", async ({ page }) => {
  let query = "";
  await lookupMock(page, [{ ...sample, sourceUrl: "https://example.org/cerave", sourceLabel: "example.org",
    priceCzk: 349, imageUrl: "" }], (params) => { if (!params.get("mode")) query = params.get("query") || ""; });
  const editor = await start(page);
  const link = "https://example.org/cerave";
  await editor.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill(link);
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await editor.getByRole("button", { name: "Použít tento produkt" }).click();
  expect(query).toBe(link);
  await expect(editor.getByRole("textbox", { name: "Odkaz do obchodu" })).toHaveValue(link);
  await expect(editor.getByLabel("Cena za balení / kus (Kč)")).toHaveValue("349");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  const product = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products[0]);
  expect(product).toMatchObject({ priceCzk: 349, shopUrl: link });
});

test("search failure does not delete handwritten data and manual save still works", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Zdroj je nedostupný." }) });
  });
  const editor = await start(page);
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("Můj přípravek");
  await editor.getByRole("textbox", { name: "Popis a účel" }).fill("Můj původní popis");
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await expect(editor.getByRole("alert")).toContainText("Zdroj je nedostupný.");
  await expect(editor.getByRole("textbox", { name: "Popis a účel" })).toHaveValue("Můj původní popis");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products);
  expect(saved[0].name).toBe("Můj přípravek");
});

test("lookup chooses a specific variant and does not overwrite known personal fields", async ({ page }) => {
  await lookupMock(page, [{ ...sample, name: "CeraVe SA Cleanser 236 ml" }, { ...sample, name: "CeraVe SA Cleanser 473 ml", amount: "473 ml" }]);
  const editor = await start(page);
  await editor.getByLabel("Datum otevření").fill("2026-10-03");
  await editor.getByRole("textbox", { name: "Popis a účel" }).fill("Vlastní poznámka");
  await editor.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill("CeraVe SA Cleanser");
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await expect(editor.getByLabel("Nalezené produkty").locator("article")).toHaveCount(2);
  await editor.getByLabel("Nalezené produkty").locator("article").filter({ hasText: "473 ml" })
    .getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(editor.getByRole("textbox", { name: "Velikost balení" })).toHaveValue("473 ml");
  await expect(editor.getByRole("textbox", { name: "Popis a účel" })).toHaveValue("Vlastní poznámka");
  await expect(editor.getByLabel("Datum otevření")).toHaveValue("2026-10-03");
});
