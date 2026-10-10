/**
 * Pure helpers for product discovery from public web-index results.
 * No per-brand rules, no inferred medical or cosmetic directions.
 */
export function canonicalProductTokens(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((token) => token.length > 1 && ![
      "the","and","for","with","product","products","buy","online","shop",
      "official","store","skincare","skin","care","cosmetics","cosmetic",
      "cleansers","cz","czech","eu","uk","us","of","by","at",
    ].includes(token));
}

export function productMatchScore(candidate, query) {
  const expected = canonicalProductTokens(query);
  const actual = new Set(canonicalProductTokens(candidate));
  if (!expected.length) return 0;
  let hits = 0;
  for (const token of expected) if (actual.has(token)) hits++;
  const coverage = hits / expected.length;
  const precision = hits / Math.max(expected.length, Math.min(actual.size, expected.length + 4));
  return coverage * .87 + precision * .13;
}

export function productPageIsRelevant(candidate, query, brand = "", indexedTitle = "") {
  const families = ["cleanser", "cream", "serum", "lotion", "toner", "shampoo", "conditioner",
    "sunscreen", "mask", "oil", "balm", "scrub", "exfoliant", "moisturizer", "wash", "deodorant"];
  const name = brand ? candidate + " " + brand : candidate;
  const wanted = new Set(canonicalProductTokens(query));
  const actual = canonicalProductTokens(name);
  const actualFamilies = new Set(actual.filter((part) => families.includes(part)));
  const wantedFamilies = families.filter((part) => wanted.has(part));
  if (wantedFamilies.length && actualFamilies.size
    && !wantedFamilies.some((part) => actualFamilies.has(part))) return false;

  // A family match must not silently turn an exact perfume/cosmetic variant
  // into a different flanker (e.g. Le Male Elixir vs Elixir Absolu).
  for (const qualifier of ["absolu", "elixir", "intense", "extreme", "ultra", "sport", "extrait"]) {
    if (actual.includes(qualifier) && !wanted.has(qualifier)) return false;
  }
  const volumes = (value) => [...String(value).toLowerCase().matchAll(/\b\d+(?:[.,]\d+)?\s*(?:ml|cl|oz)\b/g)]
    .map((match) => match[0].replace(/\s+/g, ""));
  const requestedSizes = volumes(query), candidateSizes = volumes(candidate);
  if (requestedSizes.length && candidateSizes.length
    && !candidateSizes.some((size) => requestedSizes.includes(size))) return false;

  const tokens = canonicalProductTokens(query);
  const score = productMatchScore(name, query);
  const threshold = tokens.length === 1 ? .94 : tokens.length === 2 ? .9 : .69;
  if (score >= threshold) return true;

  // Product pages often call a perfume only "Le Male Elixir", while their
  // indexed result includes "Jean Paul Gaultier". Accept such shortened
  // titles ONLY when the indexed title matches the entire query and the
  // exact trailing product identity is present without extra variant words.
  if (indexedTitle && tokens.length >= 5 && productPageIsRelevant(indexedTitle, query)) {
    const tail = tokens.slice(-3);
    const foundTail = actual.some((part, index) => part === tail[0]
      && tail.every((token, offset) => actual[index + offset] === token));
    const generic = new Set(["parfum", "perfume", "fragrance", "eau", "de", "toilette",
      "edp", "edt", "spray", "ml", "cl", "oz", "pour", "homme", "men", "women"]);
    const unknown = actual.filter((token) => !wanted.has(token)
      && !generic.has(token) && !/^\d+$/.test(token));
    return foundTail && unknown.length === 0;
  }
  return false;
}

function decodeMarkup(value) {
  return String(value ?? "").replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_m, hex, dec) => {
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (token) =>
    ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " })[token.toLowerCase()] ?? token);
}

function plain(value) {
  return decodeMarkup(String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

export function cleanIndexedUrl(raw) {
  try {
    let url = new URL(decodeMarkup(raw), "https://duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com")) {
      const redirected = url.searchParams.get("uddg");
      if (redirected) url = new URL(redirected);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(":")) return "";
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")
      || /(^|\.)((bing|google|duckduckgo|yahoo|yandex|baidu)\.com)$/.test(hostname)
      || /(^|\.)(instagram\.com|facebook\.com|pinterest\.com|tiktok\.com|reddit\.com|youtube\.com)$/.test(hostname))
      return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

export function bingRssResults(xml, query) {
  const output = [];
  for (const item of String(xml ?? "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = plain(item[1].match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const url = cleanIndexedUrl(item[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (!url || !productPageIsRelevant(title, query)) continue;
    output.push({ title, url, engine: "Bing" });
    if (output.length >= 8) break;
  }
  return output;
}

export function duckDuckGoResults(html, query) {
  const output = [];
  const anchors = String(html ?? "").matchAll(/<a\b([^>]*class\s*=\s*["'][^"']*(?:result__a|result-link)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for (const item of anchors) {
    const attribute = item[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const url = cleanIndexedUrl(attribute?.[1] || attribute?.[2] || "");
    const title = plain(item[2]);
    if (!url || !productPageIsRelevant(title, query)) continue;
    output.push({ title, url, engine: "DuckDuckGo" });
    if (output.length >= 8) break;
  }
  return output;
}

export function rankProductLinks(links, query, brand = "") {
  const brandKey = canonicalProductTokens(brand).join("");
  const seen = new Set();
  return links.filter(({ url }) => {
    if (!url || seen.has(url)) return false;
    seen.add(url); return true;
  }).map((item) => {
    const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]/g, "");
    return { ...item, score: productMatchScore(item.title, query)
      + (brandKey.length >= 3 && host.includes(brandKey) ? .18 : 0)
      + (brandKey && canonicalProductTokens(item.title).join("").includes(brandKey) ? .05 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 7);
}
