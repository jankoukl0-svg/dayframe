import { test, expect } from "@playwright/test";
import {
  productMatchScore, productPageIsRelevant, bingRssResults, duckDuckGoResults,
  rankProductLinks, cleanIndexedUrl,
} from "./dayframe-product-discovery.mjs";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("generic index finds La Roche-Posay and The Ordinary without special-case brand data", () => {
  const rss = [
    "<rss><channel>",
    "<item><title>The Ordinary Niacinamide 10% + Zinc 1% | Official</title>",
    "<link>https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html</link></item>",
    "<item><title>The Ordinary Hair Care Set</title><link>https://theordinary.com/hair-care</link></item>",
    "<item><title>La Roche-Posay Effaclar Duo+M Face Cream</title>",
    "<link>https://www.laroche-posay.co.uk/en_GB/effaclar-duo-m.html</link></item>",
    "<item><title>The Ordinary Niacinamide 10% + Zinc 1%</title>",
    "<link>http://unsafe.example/product</link></item>",
    "</channel></rss>",
  ].join("");
  const ordinary = bingRssResults(rss, "The Ordinary Niacinamide 10% + Zinc 1%");
  expect(ordinary).toHaveLength(1);
  expect(ordinary[0].url).toContain("theordinary.com/");
  const laRoche = bingRssResults(rss, "La Roche-Posay Effaclar Duo+M Face Cream");
  expect(laRoche).toHaveLength(1);
});

test("generic product matching rejects wrong products and unrelated variants", () => {
  expect(productPageIsRelevant("CeraVe SA Smoothing Cream", "CeraVe SA Smoothing Cleanser")).toBe(false);
  expect(productPageIsRelevant("La Roche-Posay Effaclar Duo+M", "Effaclar Duo+M")).toBe(true);
  expect(productPageIsRelevant("The Ordinary Hyaluronic Acid 2% + B5", "The Ordinary Niacinamide 10% + Zinc 1%")).toBe(false);
  expect(productPageIsRelevant("Smoothing Cleanser Official Website", "Cleansers SA Smoothing Cleanser")).toBe(false);
  expect(productMatchScore("The Ordinary Niacinamide 10 Zinc 1 Serum", "Niacinamide 10 Zinc 1")).toBeGreaterThan(.9);
});

test("DuckDuckGo links are decoded and private IPs are discarded", () => {
  const target = "https://www.paulaschoice.com/skin-perfecting-2pct-bha-liquid-exfoliant/201.html";
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=' +
    encodeURIComponent(target) + '">Paulas Choice Skin Perfecting 2% BHA Liquid Exfoliant</a>' +
    '<a class="result__a" href="https://www.example.com/unrelated">Holiday travel tips</a>';
  const results = duckDuckGoResults(html, "Paulas Choice Skin Perfecting 2% BHA Liquid Exfoliant");
  expect(results).toHaveLength(1);
  expect(results[0].url).toBe(target);
  expect(cleanIndexedUrl("https://127.0.0.1/private")).toBe("");
  expect(cleanIndexedUrl("https://169.254.169.254/private")).toBe("");
});

test("brand-domain result ranks first but retailer fallback remains available", () => {
  const options = [
    { title: "La Roche-Posay Effaclar Duo+M | Eshop", url: "https://www.example-shop.cz/effaclar-duo", engine: "Bing" },
    { title: "La Roche-Posay Effaclar Duo+M | LRP", url: "https://www.laroche-posay.co.uk/effaclar-duo", engine: "DuckDuckGo" },
  ];
  const ranked = rankProductLinks(options, "La Roche-Posay Effaclar Duo+M", "La Roche-Posay");
  expect(ranked).toHaveLength(2);
  expect(ranked[0].url).toContain("laroche-posay.co.uk");
});

async function editor(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  return page.getByRole("dialog", { name: "Editor produktu" });
}

test("web-discovered product without a known brand receives guide enrichment", async ({ page }) => {
  const calls = [];
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.push(params.get("mode") || "search");
    if (params.get("mode") === "guide") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        guide: {
          instructions: "Apply to wet skin and rinse thoroughly.",
          usageWhen: "On wet skin", usageAmount: "Small amount",
          usageDuration: "", precautions: "Avoid contact with eyes.",
        },
        description: "Gentle cleanser for sensitive skin.",
        sourceUrl: "https://example-brand.com/face-cleanser",
        sourceUrls: ["https://example-brand.com/face-cleanser"],
      }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      matches: [{
        name: "Sensitive Face Cleanser", brand: "", category: "Pleť",
        description: "", instructions: "", amount: "150 ml", imageUrl: "",
        sourceLabel: "example-brand.com", sourceUrl: "https://example-brand.com/face-cleanser", priceCzk: null,
      }], notice: "Found via web index",
    }) });
  });
  const dlg = await editor(page);
  await dlg.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill("Sensitive Face Cleanser");
  await dlg.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await dlg.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(dlg.getByRole("textbox", { name: "Popis a účel" })).toHaveValue("Gentle cleanser for sensitive skin.");
  await expect(dlg.getByRole("textbox", { name: "Návod k použití" })).toHaveValue(/wet skin/);
  await expect(dlg.getByRole("textbox", { name: "Kdy používat" })).toHaveValue("On wet skin");
  await expect(dlg.getByRole("textbox", { name: "Množství na jedno použití" })).toHaveValue("Small amount");
  await expect(dlg.getByRole("textbox", { name: "Upozornění a omezení" })).toHaveValue("Avoid contact with eyes.");
  expect(calls).toContain("guide");
});

test("missing instructions show an explicit warning, not a false success message", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "guide") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ guide: { instructions: "", usageWhen: "", usageAmount: "",
          usageDuration: "", precautions: "", frequency: "" }, sourceUrl: "" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      matches: [{ name: "Unique Unlisted Face Serum", brand: "Small Maker",
        category: "Pleť", description: "", instructions: "", imageUrl: "", sourceLabel: "Small Maker",
        sourceUrl: "https://example-brand.com/serum", priceCzk: null, amount: "" }],
    }) });
  });
  const dlg = await editor(page);
  await dlg.getByRole("textbox", { name: "Název nebo odkaz na produkt" }).fill("Unique Unlisted Face Serum");
  await dlg.getByRole("button", { name: "Vyhledat a doplnit" }).click();
  await dlg.getByRole("button", { name: "Použít tento produkt" }).click();
  await expect(dlg.getByRole("status")).toContainText("nepodařilo najít");
  await expect(dlg.getByRole("textbox", { name: "Návod k použití" })).toHaveValue("");
  await expect(dlg.getByRole("textbox", { name: "Jak dlouho používat / nechat působit" })).toHaveValue("");
});
