import test from "node:test";
import assert from "node:assert/strict";
import {packCountFromLabel,looksLikeSupplementCategory,sameSupplementProduct,foodCatalogCandidates,plausibleSupplementListing,supplementSuggestionFromUrl} from "./dayframe-supplement-lookup.ts";
test("extracts package counts but never invents dosing from mg strength or weight",()=>{
  assert.deepEqual(packCountFromLabel("Vitamin C 1000 mg – 60 kapslí"),{count:60,unit:"kapsle"});
  assert.deepEqual(packCountFromLabel("Creatine 120 capsules"),{count:120,unit:"kapsle"});
  assert.deepEqual(packCountFromLabel("Omega-3 90 softgels"),{count:90,unit:"kapsle"});
  assert.deepEqual(packCountFromLabel("Magnesium 60 tablets"),{count:60,unit:"tablety"});
  assert.equal(packCountFromLabel("Protein 1000 g"),null);
  assert.equal(packCountFromLabel("Vitamin C 1000 mg"),null);
  assert.equal(packCountFromLabel("Magnesium Citrate"),null);
});
test("matching rejects different strengths and packs when the user specified them",()=>{
  assert.equal(sameSupplementProduct("Now Foods Vitamin D3 1000 IU 120 kapslí","Now Foods","Now Foods Vitamin D3 1000 IU 120 kapslí"),true);
  assert.equal(sameSupplementProduct("Now Foods Vitamin D3 2000 IU 120 kapslí","Now Foods","Now Foods Vitamin D3 1000 IU 120 kapslí"),false);
  assert.equal(sameSupplementProduct("Creatine 60 capsules","","Creatine 120 capsules"),false);
  assert.equal(sameSupplementProduct("Fish Oil","","Vitamin D3"),false);
  assert.equal(looksLikeSupplementCategory("en:dietary-supplements"),true);
  assert.equal(looksLikeSupplementCategory("en:soft-drinks"),false);
});
test("Open Food Facts supplement results are identity-filtered and never supply doses",()=>{
  const products=[
    {product_name:"Vitamin C 1000 mg 60 capsules",brands:"Sample Labs",
      categories_tags:["en:dietary-supplements"],code:"1234567890123",quantity:"60 capsules",
      image_front_url:"https://images.openfoodfacts.org/images/products/123/front.png"},
    {product_name:"Vitamin C 500 mg 60 capsules",brands:"Sample Labs",
      categories_tags:["en:dietary-supplements"],code:"1234567890124",quantity:"60 capsules"},
    {product_name:"Orange Soda",brands:"Sample",categories_tags:["en:soft-drinks"],code:"1234567890125"}
  ];
  const results=foodCatalogCandidates(products,"Vitamin C 1000 mg 60 capsules");
  assert.equal(results.length,1);
  assert.equal(results[0].packServings,60);
  assert.equal(results[0].packUnit,"kapsle");
  assert.equal(results[0].priceCzk,null);
  assert.equal("doseLabel" in results[0],false);
  assert.ok(results[0].imageUrl.startsWith("https://"));
});

test("public web results exclude cosmetic collisions while allowing ingestible supplements",()=>{
  assert.equal(plausibleSupplementListing("Collagen Face Serum","Pleť","Collagen peptide skincare"),false);
  assert.equal(plausibleSupplementListing("Magnesium Body Spray","Tělo","Magnesium skincare"),false);
  assert.equal(plausibleSupplementListing("Vitamin C Cream","Pleť","Vitamin C antioxidant serum"),false);
  assert.equal(plausibleSupplementListing("Creatine Monohydrate 500g","Ostatní","Creatine powder"),true);
  assert.equal(plausibleSupplementListing("Magnesium Citrate 60 capsules","Ostatní","Supplement"),true);
  assert.equal(plausibleSupplementListing("Collagen 60 kapslí","Ostatní",""),true);
});

test("GymBeam URL produces a clearly unverified, safe fallback without invented photo, pack or dose",()=>{
  const url="https://gymbeam.cz/omega-3-gym-beam.html";
  const suggestion=supplementSuggestionFromUrl(url);
  assert.ok(suggestion);
  assert.equal(suggestion.name,"Omega 3 Gymbeam");
  assert.equal(suggestion.sourceUrl,url);
  assert.match(suggestion.sourceLabel,/neověřeno/);
  assert.equal(suggestion.imageUrl,"");
  assert.equal(suggestion.priceCzk,null);
  assert.equal(suggestion.packServings,null);
  assert.equal("doseLabel" in suggestion,false);
  for(const link of ["http://gymbeam.cz/omega-3-gym-beam.html",
    "https://localhost/omega-3.html","https://192.168.1.1/omega-3.html",
    "https://user:password@gymbeam.cz/omega-3.html",
    "https://gymbeam.cz:8888/omega-3.html",
    "https://gymbeam.cz/123.html"]){
    assert.equal(supplementSuggestionFromUrl(link),null,link);
  }
});
