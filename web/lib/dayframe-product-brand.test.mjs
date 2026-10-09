import test from "node:test";
import assert from "node:assert/strict";
import { productBrandMatches } from "./dayframe-product-discovery.mjs";

test("photographs never inherit a different brand with a substring identity", () => {
  assert.equal(productBrandMatches("e.l.f.", "Self", "Self Hydrating Cream", "selfcosmetics.com"), false);
  assert.equal(productBrandMatches("Aveda", "Ave", "Aveda Botanical Repair", "avedashop.com"), false);
  assert.equal(productBrandMatches("CeraVe", "Ceraveda", "Ceraveda Cleanser", "ceraveda.com"), false);
  assert.equal(productBrandMatches("e.l.f.", "", "Self Hydrating Cream", "selfcosmetics.com"), false);
});

test("real brand identity works with dots, accents, hyphens and descriptive suffixes", () => {
  assert.equal(productBrandMatches("e.l.f.", "E.L.F. Cosmetics", "Power Grip Primer"), true);
  assert.equal(productBrandMatches("e.l.f.", "elf cosmetics", "Power Grip Primer"), true);
  assert.equal(productBrandMatches("L'Oréal", "Loreal Paris", "Hydra Genius"), true);
  assert.equal(productBrandMatches("La Roche-Posay", "La Roche Posay", "Cicaplast"), true);
  assert.equal(productBrandMatches("CeraVe", "CeraVe", "SA Smoothing Cleanser"), true);
  assert.equal(productBrandMatches("Dove", "Dove Men+Care", "Body wash"), true);
});

test("unbranded product page can still use exact brand in title or manufacturer host", () => {
  assert.equal(productBrandMatches("e.l.f.", "", "e.l.f. Power Grip Primer", "generic-shop.cz"), true);
  assert.equal(productBrandMatches("e.l.f.", "", "Power Grip Primer", "www.elfcosmetics.com"), true);
  assert.equal(productBrandMatches("CeraVe", "", "CeraVe SA Smoothing Cleanser", "generic-shop.cz"), true);
  assert.equal(productBrandMatches("CeraVe", "", "SA Smoothing Cleanser", "www.cerave.com"), true);
  assert.equal(productBrandMatches("CeraVe", "", "SA Smoothing Cleanser", "generic-shop.cz"), false);
  assert.equal(productBrandMatches("", "", "Unknown Cleanser", "generic-shop.cz"), true);
});

test("an explicit conflicting catalog brand cannot be overridden by page title or host", () => {
  assert.equal(productBrandMatches("CeraVe", "Unrelated Beauty", "CeraVe Cleanser", "cerave.com"), false);
});
