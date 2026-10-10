import test from "node:test";
import assert from "node:assert/strict";
import { fromHtml } from "../api/hygiene-product-lookup.ts";
import { productPageIsRelevant, bingRssResults, duckDuckGoResults } from "./dayframe-product-discovery.mjs";

const query = "Jean Paul Gaultier Le Male Elixir";

test("official fragrance JSON-LD exposes identity, category, size and product image", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Product",
    name: "Le Male Elixir Parfum", brand: { "@type": "Brand", name: "Jean Paul Gaultier" },
    category: "Fragrance / Perfume", size: "125 ml",
    description: "Woody aromatic amber fragrance.",
    image: "https://cdn.example.com/le-male-elixir-packshot.png",
  })}</script></head></html>`;
  const result = fromHtml(html, "https://www.jeanpaulgaultier.com/ww/en/fragrances/le-male-elixir");
  assert.ok(result);
  assert.equal(result.brand, "Jean Paul Gaultier");
  assert.equal(result.category, "Vůně");
  assert.equal(result.amount, "125 ml");
  assert.equal(result.imageUrl, "https://cdn.example.com/le-male-elixir-packshot.png");
  assert.ok(productPageIsRelevant(result.name, query, result.brand));
});

test("perfumery metadata without product JSON-LD still identifies the product", () => {
  const html = '<html><head><title>Le Male Elixir PARFUM ⋅ Jean Paul Gaultier</title>'
    + '<meta property="og:description" content="An aromatic woody amber perfume for men.">'
    + '<meta property="og:image" content="/assets/le-male.png"></head></html>';
  const result = fromHtml(html, "https://www.jeanpaulgaultier.com/ww/en/fragrances/le-male-elixir");
  assert.ok(result);
  assert.equal(result.category, "Vůně");
  assert.equal(result.imageUrl, "https://www.jeanpaulgaultier.com/assets/le-male.png");
  assert.ok(productPageIsRelevant(result.name, query));
});

test("name-only fragrance page must match the full indexed title before acceptance", () => {
  const indexed = "Jean Paul Gaultier Le Male Elixir Parfum | Official";
  assert.equal(productPageIsRelevant("Le Male Elixir Parfum", query), false);
  assert.equal(productPageIsRelevant("Le Male Elixir Parfum", query, "", indexed), true);
  assert.equal(productPageIsRelevant("Le Male Elixir Parfum 125 ml", query, "", indexed), true);
  assert.equal(productPageIsRelevant("Le Male Elixir Absolu", query, "", indexed), false);
  assert.equal(productPageIsRelevant("Le Male Le Parfum", query, "", indexed), false);
  assert.equal(productPageIsRelevant("Le Male Elixir Parfum", query, "", "Wrong Brand Le Male Elixir"), false);
});

test("generic identity matching also works for other perfume houses without allowlists", () => {
  assert.equal(productPageIsRelevant("Sauvage Elixir", "Dior Sauvage Elixir",
    "", "Dior Sauvage Elixir official fragrance"), false); // Short queries need full identity
  assert.equal(productPageIsRelevant("Acqua di Gio Profondo", "Giorgio Armani Acqua di Gio Profondo",
    "", "Giorgio Armani Acqua di Gio Profondo official perfume"), true);
  assert.equal(productPageIsRelevant("Dior Sauvage Elixir", "Dior Sauvage"), false);
  assert.equal(productPageIsRelevant("Giorgio Armani Acqua di Gio Profondo", "Giorgio Armani Acqua di Gio Parfum"), false);
  assert.equal(productPageIsRelevant("Le Male Elixir Parfum 75 ml", query + " 125 ml", "",
    "Jean Paul Gaultier Le Male Elixir Parfum 75 ml"), false);
});

test("public fragrance results use exact product identity before fetching a page", () => {
  const rss = "<rss><channel><item><title>Jean Paul Gaultier Le Male Elixir Parfum | Official</title>"
    + "<link>https://www.jeanpaulgaultier.com/ww/en/fragrances/le-male-elixir</link></item>"
    + "<item><title>Jean Paul Gaultier Le Male Le Parfum</title>"
    + "<link>https://example.com/le-male-le-parfum</link></item></channel></rss>";
  const links = bingRssResults(rss, query);
  assert.equal(links.length, 1);
  assert.ok(links[0].url.includes("jeanpaulgaultier.com"));
  const html = '<a class="result__a" href="https://example.com/fragrance/elixir">'
    + 'Jean Paul Gaultier Le Male Elixir Parfum</a>';
  assert.equal(duckDuckGoResults(html, query).length, 1);
});
