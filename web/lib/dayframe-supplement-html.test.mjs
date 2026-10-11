import test from "node:test";
import assert from "node:assert/strict";
import {supplementFromHtml} from "./dayframe-supplement-html.mjs";

const url="https://gymbeam.cz/omega-3-gym-beam.html";
test("extract product JSON-LD from a GymBeam-like page and avoid package/price fabrication",()=>{
  const html=`<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
    {"@type":"Product","name":"Omega 3 - GymBeam","brand":{"@type":"Brand","name":"GymBeam"},
    "image":["https://gymbeam.cz/media/omega-3-white.png"],"description":"Doplněk stravy"}]}
    </script></head></html>`;
  const result=supplementFromHtml(html,url);
  assert.equal(result.name,"Omega 3 - GymBeam");
  assert.equal(result.brand,"GymBeam");
  assert.equal(result.priceCzk,null);
  assert.equal(result.amount,"");
  assert.equal(result.imageUrl,"https://gymbeam.cz/media/omega-3-white.png");
});
test("fallback metadata decoding handles review titles and excludes javascript images",()=>{
  const html=`<title>Recenze - Omega 3 - GymBeam | GymBeam.cz</title>
    <meta property="og:image" content="javascript:alert(1)">
    <meta name="description" content="Omega 3 &amp; kvalitní rybí olej">`;
  const result=supplementFromHtml(html,url);
  assert.equal(result.name,"Omega 3");
  assert.equal(result.imageUrl,"");
  assert.equal(result.description,"Omega 3 & kvalitní rybí olej");
  assert.equal(result.priceCzk,null);
});
test("only priced CZK product offer may fill a price",()=>{
  const html=`<script type="application/ld+json">
    {"@type":"Product","name":"Omega 3 120 kapslí","offers":{"@type":"Offer","priceCurrency":"CZK","price":"259.00"}}
    </script>`;
  assert.equal(supplementFromHtml(html,url).priceCzk,259);
});
