import { test, expect } from "@playwright/test";

const URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const STORAGE_KEY = "dayframe-hygiene-v1";

async function fresh(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-hygiene-v1")))).toBe(true);
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
}

test("numeric threshold creates a shopping item, purchase updates stock, retains prices and clears cart", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("Čisticí gel");
  await editor.getByLabel("Počet balení / kusů na skladě").fill("0");
  await editor.getByLabel("Dokoupit při zásobě ≤").fill("1");
  await editor.getByLabel("Cena za balení / kus (Kč)").fill("129.50");
  await editor.getByRole("checkbox", { name: "Očistit obličej", exact: true }).check();
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await page.getByRole("button", { name: /Nákupní seznam/ }).click();
  const list = page.getByLabel("Nákupní seznam", { exact: true });
  const entry = list.locator("article").filter({ hasText: "Čisticí gel" });
  await expect(entry).toContainText("Nízká zásoba");
  await expect(entry).toContainText("259");
  await expect(entry.getByRole("spinbutton", { name: "Počet kusů k nákupu Čisticí gel" })).toHaveValue("2");
  await entry.getByRole("button", { name: "Koupeno" }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Nákupní seznam \(0\)/ })).toBeVisible();
  const result = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  const product = result.products.find((p) => p.name === "Čisticí gel");
  expect(product).toMatchObject({ stockCount: 2, stockMinimum: 1, priceCzk: 129.5, stockStatus: "ok" });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.locator('[data-product-id="' + product.id + '"]').click();
  const detail = page.getByRole("dialog", { name: "Detail produktu Čisticí gel" });
  await expect(detail).toContainText("Na skladě");
  await expect(detail).toContainText("129");
  await detail.getByRole("button", { name: "Spotřebovat jeden kus Čisticí gel" }).click();
  await detail.getByRole("button", { name: "Spotřebovat jeden kus Čisticí gel" }).click();
  await detail.getByRole("button", { name: "Zavřít detail produktu" }).click();
  await page.getByRole("button", { name: /Nákupní seznam \(1\)/ }).click();
  await expect(page.getByLabel("Nákupní seznam", { exact: true })).toContainText("Čisticí gel");
  const again = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(again.routines.find((r) => r.id === "morning").tasks.find((t) => t.id === "morning-face").productIds).toContain(product.id);
});

test("PAO uses calendar months and replacement alerts remain separate from purchasing", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("Holicí hlavice");
  await editor.getByRole("combobox", { name: "Kategorie" }).selectOption("Pomůcky");
  await editor.getByLabel("Datum otevření").fill("2026-09-09");
  await editor.getByLabel("Trvanlivost po otevření (měsíce)").fill("1");
  await editor.getByLabel("Expirace (pokud známá)").fill("2026-11-30");
  await editor.getByLabel("Vyměnit pomůcku každých (dní)").fill("14");
  await editor.getByLabel("Naposledy vyměněno").fill("2026-09-20");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await page.getByRole("button", { name: /Expirace a výměny/ }).click();
  const alerts = page.getByLabel("Hlídání expirace a výměn");
  await expect(alerts.locator("article")).toHaveCount(2);
  await expect(alerts).toContainText("2026-10-09");
  await expect(alerts).toContainText("Po otevření (PAO)");
  await expect(alerts).toContainText("2026-10-04");
  await expect(alerts).toContainText("Po termínu");
  await alerts.getByRole("button", { name: "Přidat k nákupu" }).first().click();
  await page.getByRole("button", { name: /Nákupní seznam \(1\)/ }).click();
  await page.getByRole("button", { name: "Koupeno" }).click();
  await page.getByRole("button", { name: /Expirace a výměny/ }).click();
  await expect(page.getByLabel("Hlídání expirace a výměn").locator("article")).toHaveCount(2);
  await alerts.getByRole("button", { name: "Vyměněno dnes Holicí hlavice" }).click();
  await expect(alerts.locator("article")).toHaveCount(1);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.products[0]).toMatchObject({ lastReplacedOn: "2026-10-09", openedOn: "2026-09-09", expiresOn: "2026-11-30", stockStatus: "ok" });
});

test("legacy manual-low stock items can be purchased without inventing package count; archived products are excluded", async ({ page }) => {
  await fresh(page);
  await page.evaluate((key) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.products = [
      { id: "old-one", name: "Staré mýdlo", brand: "", category: "Tělo", description: "", instructions: "",
        frequency: "", openedOn: "", expiresOn: "", paoMonths: null, amount: "",
        stockStatus: "low", shopUrl: "", archived: false },
      { id: "old-two", name: "Archivovaný krém", brand: "", category: "Pleť", description: "", instructions: "",
        frequency: "", openedOn: "", expiresOn: "", paoMonths: null, amount: "",
        stockStatus: "low", shopUrl: "", archived: true },
    ];
    localStorage.setItem(key, JSON.stringify(store));
    dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, STORAGE_KEY);
  await page.getByRole("button", { name: /Nákupní seznam \(1\)/ }).click();
  const items = page.getByLabel("Nákupní seznam", { exact: true });
  await expect(items).toContainText("Staré mýdlo");
  await expect(items).not.toContainText("Archivovaný krém");
  await items.getByRole("button", { name: "Koupeno" }).click();
  await expect(items).toHaveCount(0);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.products[0].stockCount).toBeNull();
  expect(saved.products[0].stockStatus).toBe("ok");
  expect(saved.products[1].stockStatus).toBe("low");
});
