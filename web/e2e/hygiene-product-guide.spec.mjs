import { test, expect } from "@playwright/test";
import { extractGuideFromHtml, extractGuideFromCatalog } from "./dayframe-product-guide-extract.mjs";
import { manufacturerGuideFor } from "./dayframe-manufacturer-guide.mjs";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("extracts directions and explicit safety notes from a manufacturer-style Czech product page", () => {
  const html = `
    <main><h1>Zjemňující čisticí gel</h1>
    <h2>Použití</h2><ul>
      <li>Navlhčete pokožku vlažnou vodou</li>
      <li>Jemnými krouživými pohyby vmasírujte do pokožky</li><li>Opláchněte</li>
    </ul>
    <h2>Bezpečnostní tvrzení</h2>
    <p>Pro použití tohoto produktu nejsou vyžadována žádná specifická opatření.</p>
    <h2>Složení</h2><p>AQUA, GLYCERIN.</p></main>`;
  const guide = extractGuideFromHtml(html);
  expect(guide.instructions).toContain("Navlhčete pokožku");
  expect(guide.instructions).toContain("Opláchněte");
  expect(guide.instructions).not.toContain("AQUA");
  expect(guide.precautions).toContain("žádná specifická opatření");
  expect(guide.usageDuration).toBe("");
  expect(guide.usageAmount).toBe("");
});

test("structured directions provide only explicitly stated timing and amounts", () => {
  const html = "<h2>Benefits</h2><p>Leaves your skin younger after 10 minutes.</p>";
  const guide = extractGuideFromHtml(html, {
    howToUse: "Use a coin sized amount on wet skin and gently massage. Rinse off.",
    warnings: "Avoid contact with eyes.",
  });
  expect(guide.instructions).toContain("coin sized amount");
  expect(guide.usageAmount).toContain("coin sized");
  expect(guide.usageWhen).toContain("wet skin");
  expect(guide.usageDuration).toBe("");
  expect(guide.precautions).toContain("Avoid contact with eyes.");
});

test("community catalog directions are optional and marketing prose never invents dosage", () => {
  expect(extractGuideFromCatalog({
    description: "Skin is soft after 24 hours", generic_name: "face wash",
  })).toMatchObject({ instructions: "", usageAmount: "", usageWhen: "", usageDuration: "", precautions: "" });
  const guide = extractGuideFromCatalog({
    directions: "Apply a small amount to clean skin and leave on 10 minutes.",
    warnings: "Avoid the eye area.",
  });
  expect(guide.instructions).toContain("Apply a small amount");
  expect(guide.usageAmount).toContain("small amount");
  expect(guide.usageDuration).toContain("10 minutes");
  expect(guide.precautions).toContain("Avoid the eye area");
});

test("selecting a catalog match enriches all six fields from a labelled guide while preserving custom edits", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "guide") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        guide: {
          instructions: "Naneste na navlhčenou pleť. Jemně masírujte a opláchněte.",
          usageWhen: "Ráno a večer", usageAmount: "Množství velikosti mince",
          usageDuration: "Masírujte 30 sekund", precautions: "Vyhněte se kontaktu s očima.",
          frequency: "2× denně",
        }, sourceUrl: "https://www.cerave.cz/pece-o-plet/xyz",
      }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      matches: [{
        name: "CeraVe SA Smoothing Cleanser", brand: "CeraVe", category: "Pleť",
        description: "Čisticí gel pro hrubou pokožku.",
        instructions: "", amount: "236 ml", priceCzk: null, imageUrl: "",
        sourceUrl: "https://world.openbeautyfacts.org/product/3333333333333",
        sourceLabel: "Open Beauty Facts",
      }], notice: "Vyber produkt",
    }) });
  });
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("CeraVe SA Smoothing Cleanser");
  await editor.getByRole("textbox", { name: "Kdy používat" }).fill("Moje vlastní poznámka");
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await editor.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(editor.getByRole("textbox", { name: "Návod k použití" })).toHaveValue(/navlhčenou/);
  await expect(editor.getByRole("textbox", { name: "Kdy používat" })).toHaveValue("Moje vlastní poznámka");
  await expect(editor.getByRole("textbox", { name: "Množství na jedno použití" })).toHaveValue("Množství velikosti mince");
  await expect(editor.getByRole("textbox", { name: "Jak dlouho používat / nechat působit" })).toHaveValue("Masírujte 30 sekund");
  await expect(editor.getByRole("textbox", { name: "Upozornění a omezení" })).toHaveValue(/Vyhněte se kontaktu/);
  await expect(editor.getByRole("textbox", { name: "Frekvence podle obalu / vlastní" })).toHaveValue("2× denně");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")).products[0]);
  expect(saved).toMatchObject({
    instructions: "Naneste na navlhčenou pleť. Jemně masírujte a opláchněte.",
    usageWhen: "Moje vlastní poznámka",
    usageAmount: "Množství velikosti mince",
    usageDuration: "Masírujte 30 sekund",
    precautions: "Vyhněte se kontaktu s očima.",
    frequency: "2× denně",
  });
});


test("sparse catalog CeraVe SA Smoothing Cleanser uses verified manufacturer guide", () => {
  for (const name of ["SA Smoothing Cleanser", "Cleansers SA Smoothing Cleanser", "CeraVe SA Smoothing Cleanser 236 ml"]) {
    const match = manufacturerGuideFor("CeraVe", name, "3337875795456");
    expect(match).not.toBeNull();
    expect(match.description).toMatch(/čisticí gel/i);
    expect(match.instructions).toContain("Navlhčete pokožku");
    expect(match.instructions).toContain("Opláchněte");
    expect(match.usageAmount).toMatch(/mince/i);
    expect(match.usageDuration).toContain("Několik sekund");
    expect(match.precautions).toContain("specifická opatření");
    expect(match.sourceUrls).toContain("https://www.cerave.cz/pece-o-plet/hydratacni-pripravky/zjemnujici-cistici-gel");
  }
  expect(manufacturerGuideFor("Other brand", "SA Smoothing Cleanser")).toBeNull();
  expect(manufacturerGuideFor("CeraVe", "SA Smoothing Cream")).toBeNull();
  expect(manufacturerGuideFor("CeraVe", "Renewing SA Cleanser")).toBeNull();
  expect(manufacturerGuideFor("CeraVe", "Foaming Cleanser")).toBeNull();
});

test("real sparse catalog result now fills description and guide after selecting the correct product", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const official = manufacturerGuideFor("CeraVe", "SA Smoothing Cleanser", "3337875795456");
    if (params.get("mode") === "guide") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ guide: official, description: official.description, sourceUrl: official.sourceUrl, sourceUrls: official.sourceUrls }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ matches: [{
        name: "SA Smoothing Cleanser", brand: "CeraVe", category: "Pleť",
        description: official.description, instructions: official.instructions,
        usageWhen: official.usageWhen, usageAmount: official.usageAmount,
        usageDuration: official.usageDuration, precautions: official.precautions,
        frequency: official.frequency, amount: "236 ml", imageUrl: "",
        sourceUrl: "https://world.openbeautyfacts.org/product/3337875795456",
        sourceLabel: "Open Beauty Facts", guideSourceUrl: official.sourceUrl,
        guideSourceUrls: official.sourceUrls, priceCzk: null,
      }], notice: "Výsledky z Open Beauty Facts." }) });
  });
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill("Cleansers SA Smoothing Cleanser");
  await editor.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await editor.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(editor.getByRole("textbox", { name: "Popis a účel" })).toHaveValue(/čisticí gel/);
  await expect(editor.getByRole("textbox", { name: "Návod k použití" })).toHaveValue(/Navlhčete pokožku/);
  await expect(editor.getByRole("textbox", { name: "Množství na jedno použití" })).toHaveValue(/mince/);
  await expect(editor.getByRole("textbox", { name: "Jak dlouho používat \/ nechat působit" })).toHaveValue(/Několik sekund/);
  await expect(editor.getByRole("textbox", { name: "Upozornění a omezení" })).toHaveValue(/specifická opatření/);
  await expect(editor).toContainText("cerave.cz");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.products.find((item) => item.name === "SA Smoothing Cleanser")).toMatchObject({
    instructions: expect.stringContaining("Navlhčete"),
    usageAmount: expect.stringContaining("mince"),
    stockCount: null, openedOn: "", expiresOn: "",
  });
});
