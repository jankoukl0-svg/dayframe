/**
 * Vercel Function for the static Dayframe build. No API keys, no AI-generated usage
 * instructions: data comes from the supplied product page or Open Beauty Facts.
 * The static Vite preview cannot execute this function; browser specs mock it.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractGuideFromHtml, extractGuideFromCatalog } from "../lib/dayframe-product-guide-extract.mjs";
import { manufacturerGuideFor } from "../lib/dayframe-manufacturer-guide.mjs";
import { isCatalogBoilerplate, usefulDescription, safeFdaLabel } from "../lib/dayframe-product-quality.mjs";
import { bingRssResults, duckDuckGoResults, productPageIsRelevant, rankProductLinks } from "../lib/dayframe-product-discovery.mjs";

type Match = {
  name: string; brand: string; category: string; description: string;
  instructions: string; usageWhen: string; usageAmount: string; usageDuration: string;
  precautions: string; frequency: string;
  amount: string; priceCzk: number | null;
  imageUrl: string; sourceUrl: string; sourceLabel: string; guideSourceUrl: string;
  guideSourceUrls?: string[];
  safetySource?: string;
};

const LIMIT = 500_000;
const PRODUCT_PAGE_LIMIT = 1_100_000;
const IMG_LIMIT = 6 * 1024 * 1024;
const UA = "Dayframe/1.0 (https://dayframe2.vercel.app; personal product inventory)";
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const clean = (value: unknown, max = 1000) =>
  str(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function parseSafeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || isIP(host) || host === "localhost"
      || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url;
  } catch { return null; }
}

function isPrivateIp(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
      || normalized.startsWith("fd") || normalized.startsWith("fe8")
      || normalized.startsWith("fe9") || normalized.startsWith("fea")
      || normalized.startsWith("feb") || normalized.startsWith("ff")
      || normalized.startsWith("2001:db8:") || normalized.startsWith("::ffff:");
  }
  const octets = normalized.split(".").map(Number);
  const [a,b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127 || a === 192 && b === 0
    || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && octets[2] === 100
    || a === 203 && b === 0 && octets[2] === 113;
}

async function validated(raw: string) {
  const url = parseSafeUrl(raw);
  if (!url) throw new Error("Odkaz není bezpečná veřejná HTTPS adresa.");
  // Reject DNS names resolving to loopback/private/link-local addresses.
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address)))
    throw new Error("Odkaz směřuje do neveřejné sítě.");
  return url;
}

async function requestPublic(raw: string, accept: string, timeoutMs = 6500): Promise<Response> {
  let url = await validated(raw);
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetch(url, {
      redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "cs,en;q=0.8" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Neplatné přesměrování stránky.");
      url = await validated(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error("Zdroj není dostupný (HTTP " + response.status + ").");
    return response;
  }
  throw new Error("Příliš mnoho přesměrování.");
}

async function readLimited(response: Response, max: number, partial = false): Promise<Uint8Array> {
  if (!partial && Number(response.headers.get("content-length") || 0) > max) throw new Error("Soubor je příliš velký.");
  if (!response.body) throw new Error("Zdroj neobsahuje data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (total + value.byteLength > max) {
        if (!partial) throw new Error("Zdroj je příliš velký.");
        const available = max - total;
        if (available > 0) { chunks.push(value.slice(0, available)); total += available; }
        break;
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
  return joined;
}

function entities(raw: string) {
  return raw.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, number: string) => {
    const code = number.startsWith("x") ? parseInt(number.slice(1), 16) : Number(number);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, (entity) =>
    ({ "&amp;": "&", "&quot;": "\"", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " })[entity] ?? entity);
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return entities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function metas(html: string) {
  const result: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") || attribute(tag, "name")).toLowerCase();
    const value = attribute(tag, "content");
    if (key && value && !result[key]) result[key] = value;
  }
  return result;
}

function getProductJsonld(html: string): Record<string, unknown> | null {
  const queue: unknown[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(match[1])) continue;
    try { queue.push(JSON.parse(entities(match[2]))); } catch {
      try { queue.push(JSON.parse(match[2])); } catch { /* skip broken data */ }
    }
  }
  const visit = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value)) {
      for (const item of value) { const found = visit(item); if (found) return found; }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((type) => typeof type === "string" && /(^|[/:])Product$/i.test(type))) return record;
    return visit(record["@graph"]) ?? visit(record.mainEntity);
  };
  for (const value of queue) { const found = visit(value); if (found) return found; }
  return null;
}

function categoryFrom(value: string) {
  const category = value.toLocaleLowerCase("cs");
  if (/(šampon|shampoo|conditioner|kondicion|hair|vlasy)/.test(category)) return "Vlasy";
  if (/(zub|tooth|dental|mouthwash|dentifrice)/.test(category)) return "Zuby";
  if (/(shav|razor|beard|holic|vous)/.test(category)) return "Holení";
  if (/(brush|tool|device|pomůc|kartáč)/.test(category)) return "Pomůcky";
  if (/(parf[eé]m|parfum|perfume|fragrance|cologne|eau de (?:parfum|toilette)|kolínsk|vůně|vone)/.test(category)) return "Vůně";
  if (/(body|tělo|sprch|deodor|antiperspirant)/.test(category)) return "Tělo";
  if (/(skin|face|facial|pleť|cleans|serum|acne|exfoliat|moisturi|cosmetic|beauty)/.test(category)) return "Pleť";
  return "";
}

function imageUrl(value: unknown, base?: string): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const raw = typeof candidate === "object" && candidate ? str((candidate as Record<string,unknown>).url) : str(candidate);
  try {
    const resolved = new URL(raw, base);
    return parseSafeUrl(resolved.href) ? resolved.href : "";
  } catch { return ""; }
}

function priceFrom(raw: unknown): number | null {
  const offers = Array.isArray(raw) ? raw[0] : raw;
  if (!offers || typeof offers !== "object") return null;
  const offer = offers as Record<string,unknown>;
  const spec = typeof offer.priceSpecification === "object" ? offer.priceSpecification as Record<string,unknown> : {};
  const currency = str(offer.priceCurrency || spec.priceCurrency).toUpperCase();
  const rawPrice = offer.price ?? spec.price;
  const price = Number(typeof rawPrice === "string" ? rawPrice.replace(",", ".") : rawPrice);
  return currency === "CZK" && rawPrice != null && Number.isFinite(price) && price >= 0 && price <= 1e6
    ? price : null;
}

export function fromHtml(html: string, url: string): Match | null {
  const meta = metas(html), ld = getProductJsonld(html);
  const pageTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = clean(ld?.name || meta["og:title"] || meta["twitter:title"] || entities(pageTitle), 160)
    .replace(/\s+[|\-–]\s+.+$/, "");
  if (!title) return null;
  const rawBrand = ld?.brand;
  const brand = clean(typeof rawBrand === "object" && rawBrand && !Array.isArray(rawBrand)
    ? (rawBrand as Record<string,unknown>).name : rawBrand || meta["product:brand"] || meta["brand"], 160);
  const category = categoryFrom(clean(ld?.category || meta["product:category"] || title + " " + (ld?.description || meta["og:description"] || ""), 300));
  const description = usefulDescription(clean(ld?.description || meta["og:description"] || meta.description, 1800));
  const amount = clean(ld?.size, 100);
  const guide = extractGuideFromHtml(html, ld);
  const verified = manufacturerGuideFor(brand, title);
  const mergedGuide = {
    instructions: guide.instructions || verified?.instructions || "",
    usageWhen: guide.usageWhen || verified?.usageWhen || "",
    usageAmount: guide.usageAmount || verified?.usageAmount || "",
    usageDuration: guide.usageDuration || verified?.usageDuration || "",
    precautions: guide.precautions || verified?.precautions || "",
    frequency: guide.frequency || verified?.frequency || "",
  };
  return {
    name: title, brand, category, description: description || verified?.description || "",
    ...mergedGuide,
    guideSourceUrl: guide.instructions || guide.precautions ? url : verified?.sourceUrl || "",
    guideSourceUrls: verified?.sourceUrls || [],
    amount,
    priceCzk: priceFrom(ld?.offers),
    imageUrl: imageUrl(ld?.image || meta["og:image"] || meta["twitter:image"], url),
    sourceUrl: url, sourceLabel: new URL(url).hostname,
  };
}

function score(candidate: Match, query: string) {
  const normalize = (value: string) => value.toLocaleLowerCase("cs").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = normalize(query).split(/\s+/).filter(Boolean);
  const name = normalize(candidate.name + " " + candidate.brand);
  if (!wanted.length) return 0;
  const matches = wanted.filter((word) => name.split(" ").some((segment) => segment === word));
  return matches.length / wanted.length;
}

async function searchBeauty(query: string): Promise<Match[]> {
  const url = new URL("https://world.openbeautyfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "12");
  url.searchParams.set("fields", "code,product_name,brands,quantity,categories,description,generic_name,image_front_url,image_url,usage,usage_text,usage_text_cs,usage_text_en,usage_instructions,directions,instructions,product_usage,precautions,warnings");
  const response = await requestPublic(url.href, "application/json");
  const content = new TextDecoder().decode(await readLimited(response, LIMIT));
  const payload = JSON.parse(content) as { products?: Record<string,unknown>[] };
  const unique = new Set<string>();
  return (payload.products ?? [])
    .map((product): Match => {
      const name = clean(product.product_name, 160);
      const brand = clean(product.brands, 160).split(",")[0];
      const description = usefulDescription(clean(product.generic_name || product.description, 1800));
      const code = String(product.code ?? "");
      const guide = extractGuideFromCatalog(product);
      const verified = manufacturerGuideFor(brand, name, code);
      const originalGuideSource = guide.instructions || guide.precautions
        ? (/^\d{8,14}$/.test(code) ? "https://world.openbeautyfacts.org/product/" + code : "https://world.openbeautyfacts.org") : "";
      return {
        name, brand, category: categoryFrom(clean(product.categories, 300)),
        description: description || verified?.description || "",
        instructions: guide.instructions || verified?.instructions || "",
        usageWhen: guide.usageWhen || verified?.usageWhen || "",
        usageAmount: guide.usageAmount || verified?.usageAmount || "",
        usageDuration: guide.usageDuration || verified?.usageDuration || "",
        precautions: guide.precautions || verified?.precautions || "",
        frequency: guide.frequency || verified?.frequency || "",
        guideSourceUrl: originalGuideSource || verified?.sourceUrl || "",
        guideSourceUrls: verified?.sourceUrls || [],
        amount: clean(product.quantity, 100),
        priceCzk: null,
        imageUrl: imageUrl(product.image_front_url || product.image_url),
        sourceUrl: /^\d{8,14}$/.test(code) ? "https://world.openbeautyfacts.org/product/" + code : "https://world.openbeautyfacts.org",
        sourceLabel: "Open Beauty Facts",
      };
    })
    .filter((item) => item.name && score(item, query) >= 0.55
      && productPageIsRelevant(item.name, query, item.brand) && (!unique.has(item.name + "|" + item.brand)
      && unique.add(item.name + "|" + item.brand)))
    .sort((a,b) => score(b, query) - score(a, query))
    .slice(0, 5);
}



function guideCount(guide: Partial<Match>) {
  return (["instructions", "usageWhen", "usageAmount", "usageDuration", "precautions"] as const)
    .filter((field) => Boolean(guide[field])).length;
}

type WebLink = { title: string; url: string; engine: string; score?: number };

async function searchPublicWeb(query: string, brand = "", qualifier = ""): Promise<WebLink[]> {
  const search = (brand ? brand + " " + query : query).slice(0, 170);
  const bing = new URL("https://www.bing.com/search");
  bing.searchParams.set("q", search + qualifier);
  bing.searchParams.set("format", "rss");
  const duck = new URL("https://html.duckduckgo.com/html/");
  duck.searchParams.set("q", search + qualifier);
  // Indexes are independent: one blocked engine must never suppress the other.
  const [bingResult, duckResult] = await Promise.allSettled([
    requestPublic(bing.href, "application/rss+xml,application/xml,text/xml", 3400).then(async (response) =>
      bingRssResults(new TextDecoder().decode(await readLimited(response, 200_000, true)), query)),
    requestPublic(duck.href, "text/html", 3400).then(async (response) =>
      duckDuckGoResults(new TextDecoder().decode(await readLimited(response, 300_000, true)), query)),
  ]);
  const candidates: WebLink[] = [
    ...(bingResult.status === "fulfilled" ? bingResult.value : []),
    ...(duckResult.status === "fulfilled" ? duckResult.value : []),
  ];
  return rankProductLinks(candidates, query, brand);
}

async function openProductPage(url: string, query: string, indexedTitle = ""): Promise<Match | null> {
  try {
    const response = await requestPublic(url, "text/html", 4200);
    if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return null;
    const html = new TextDecoder().decode(await readLimited(response, PRODUCT_PAGE_LIMIT, true));
    const product = fromHtml(html, url);
    if (!product || !productPageIsRelevant(product.name, query, product.brand, indexedTitle)) return null;
    return product;
  } catch {
    return null;
  }
}

function mergeFromSource(base: Match | null, another: Match): Match {
  if (!base) return another;
  const guideKeys = ["instructions", "usageWhen", "usageAmount", "usageDuration", "precautions", "frequency"] as const;
  const enriched = { ...base };
  for (const key of guideKeys) if (!enriched[key] && another[key]) enriched[key] = another[key];
  if ((!enriched.description || isCatalogBoilerplate(enriched.description)) && usefulDescription(another.description))
    enriched.description = usefulDescription(another.description);
  if (!enriched.imageUrl && another.imageUrl) enriched.imageUrl = another.imageUrl;
  if (!enriched.brand && another.brand) enriched.brand = another.brand;
  if (!enriched.amount && another.amount) enriched.amount = another.amount;
  if (enriched.priceCzk == null && another.priceCzk != null) enriched.priceCzk = another.priceCzk;
  const urls = new Set([...(base.guideSourceUrls ?? []), ...(another.guideSourceUrls ?? []),
    ...(another.guideSourceUrl ? [another.guideSourceUrl] : [])]);
  enriched.guideSourceUrls = [...urls].slice(0, 4);
  if (!enriched.guideSourceUrl && another.guideSourceUrl) enriched.guideSourceUrl = another.guideSourceUrl;
  return enriched;
}

async function researchProductPages(query: string, brand = ""): Promise<Match[]> {
  // First search the product itself, not instructions/directions: fragrances
  // often have no dedicated how-to-use pages in the public search indexes.
  const links = await searchPublicWeb(query, brand);
  const checked = await Promise.all(links.slice(0, 5).map((item) => openProductPage(item.url, query, item.title)));
  const products = checked.filter((item): item is Match => item !== null);
  if (products.length) return products;
  // When a product name does not reveal its type (e.g. "Le Male Elixir"),
  // supplement a failed lookup with perfume-oriented search terms. Retain
  // strict identity checks so this cannot yield an unrelated fragrance.
  const fallback = await searchPublicWeb(query, brand, " perfume parfum");
  const distinct = fallback.filter((item) => !links.some((seen) => seen.url === item.url));
  const additional = await Promise.all(distinct.slice(0, 4).map((item) => openProductPage(item.url, query, item.title)));
  return additional.filter((item): item is Match => item !== null);
}

async function fetchOfficialDrugLabel(name: string, brand: string) {
  // Labels are only queried for a recognizably medicinal/OTC product.
  if (!/(?:\bminoxidil\b|\btopical solution\b|\bhair regrowth\b|\btreatment\b|\bmedicated\b|\bspf\s*\d{2}\b|\b\d+(?:[.,]\d+)?\s*%\b)/i.test(name)) return null;
  const ingredient = name.match(/\bminoxidil\b/i)?.[0] ?? "";
  const safe = (value: string) => value.replace(/[^\p{L}\p{N} .%-]/gu, "").trim().slice(0, 80);
  const term = ingredient
    ? 'active_ingredient:"' + safe(ingredient) + '"' + (brand ? ' AND openfda.brand_name:"' + safe(brand) + '"' : "")
    : 'openfda.brand_name:"' + safe(brand || name.split(/\s+/).slice(0, 2).join(" ")) + '"';
  const query = new URL("https://api.fda.gov/drug/label.json");
  query.searchParams.set("search", term);
  query.searchParams.set("limit", "35");
  try {
    const response = await requestPublic(query.href, "application/json", 4000);
    const body = new TextDecoder().decode(await readLimited(response, 1_200_000));
    const data = JSON.parse(body) as { results?: Record<string, unknown>[] };
    const found = (data.results || []).map((entry) => safeFdaLabel(entry, name, brand))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return found[0] || null;
  } catch { return null; }
}

async function findDetailedGuide(brand: string, name: string, original: string) {
  const fallback = {
    instructions: "", usageWhen: "", usageAmount: "", usageDuration: "",
    precautions: "", frequency: "",
  };
  const verified = manufacturerGuideFor(brand, name);
  const [originalPage, pages, medical] = await Promise.all([
    parseSafeUrl(original) ? openProductPage(original, name) : Promise.resolve(null),
    researchProductPages(name, brand),
    fetchOfficialDrugLabel(name, brand),
  ]);
  let source: Match | null = originalPage;
  for (const page of pages) {
    if (brand && page.brand && !productPageIsRelevant(page.brand + " " + page.name, brand + " " + name)) continue;
    source = mergeFromSource(source, page);
    if (source && guideCount(source) >= 4 && source.description) break;
  }
  const guide = { ...fallback };
  let description = usefulDescription(source?.description);
  const sourceUrls = new Set<string>();
  if (source) {
    Object.assign(guide, {
      instructions: source.instructions,
      usageWhen: source.usageWhen,
      usageAmount: source.usageAmount,
      usageDuration: source.usageDuration,
      precautions: source.precautions,
      frequency: source.frequency,
    });
    for (const link of [...(source.guideSourceUrls ?? []), source.guideSourceUrl, source.sourceUrl])
      if (link) sourceUrls.add(link);
  }
  if (verified) {
    if (!description) description = verified.description;
    for (const key of Object.keys(fallback) as Array<keyof typeof fallback>)
      if (!guide[key] && verified[key]) guide[key] = verified[key];
    for (const link of verified.sourceUrls) sourceUrls.add(link);
  }
  if (medical) {
    // Regulatory instructions supersede retail copy, but must match strength.
    if (medical.description) description = medical.description;
    for (const key of Object.keys(fallback) as Array<keyof typeof fallback>)
      if (medical.guide[key]) guide[key] = medical.guide[key];
    for (const link of medical.sourceUrls) sourceUrls.add(link);
  }
  const ordered = [...sourceUrls].slice(0, 5);
  return {
    guide, description, sourceUrl: medical?.sourceUrl || verified?.sourceUrl || ordered[0] || "",
    sourceUrls: ordered, safetySource: medical?.safetySource || "",
    warning: medical ? "Lékový štítek pochází z USA. Ověřte přesný přípravek, koncentraci a údaje na obalu."
      : (!guide.precautions ? "Bezpečnostní upozornění se nepodařilo ověřit. Zkontrolujte obal nebo návod výrobce." : ""),
  };
}


type PhotoCandidate = { url: string; source: string; priority: number };

function imageSourcesFromHtml(html: string, pageUrl: string, productName: string): PhotoCandidate[] {
  const out: PhotoCandidate[] = [];
  const push = (value: unknown, priority: number) => {
    const url = imageUrl(value, pageUrl);
    if (url && !/(?:logo|avatar|icon|placeholder|sprite|pixel|badge)/i.test(new URL(url).pathname))
      out.push({ url, source: new URL(pageUrl).hostname, priority });
  };
  const ld = getProductJsonld(html);
  const images = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  for (const img of images.slice(0, 5)) push(img, 22);
  const metadata = metas(html);
  push(metadata["og:image"], 13);
  push(metadata["twitter:image"], 11);
  // Prefer the product's own front-facing photograph, not unrelated recommendations
  // or lifestyle cards. Reject images whose alt text identifies another variant.
  const expected = productName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(x=>x.length>=3);
  for (const tag of (html.match(/<img\b[^>]*>/gi) ?? []).slice(0, 130)) {
    const alt = attribute(tag, "alt").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const matches = expected.filter(word => alt.split(" ").includes(word)).length;
    if (expected.length && matches / expected.length < .65) continue;
    if (!alt || /(?:logo|banner|model|lifestyle|before and after)/i.test(alt)) continue;
    const candidate = attribute(tag, "data-src") || attribute(tag, "src");
    if (candidate.startsWith("data:")) continue;
    push(candidate, 9 + Math.floor(8 * matches / expected.length));
  }
  return out;
}

async function photoCandidates(name: string, brand: string, original: string, originalImage: string) {
  const results: PhotoCandidate[] = [];
  const selectedBrand = brand.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  function add(candidate: PhotoCandidate) {
    if (!candidate.url || candidate.url.length > 2000) return;
    if (!parseSafeUrl(candidate.url) || results.some(item => item.url === candidate.url)) return;
    results.push(candidate);
  }
  if (originalImage) add({url: originalImage, source: "Vybraný produkt", priority: 20});
  const responses = await Promise.allSettled([
    searchBeauty([brand, name].filter(Boolean).join(" ")).catch(() => [] as Match[]),
    researchProductPages(name, brand).catch(() => [] as Match[]),
    parseSafeUrl(original) ? requestPublic(original, "text/html", 4000)
      .then(async response => (response.headers.get("content-type") ?? "").includes("text/html")
        ? new TextDecoder().decode(await readLimited(response, PRODUCT_PAGE_LIMIT, true)) : "")
      .catch(() => "") : Promise.resolve(""),
  ]);
  const catalog = responses[0].status === "fulfilled" ? responses[0].value : [];
  const pages = responses[1].status === "fulfilled" ? responses[1].value : [];
  const html = responses[2].status === "fulfilled" ? responses[2].value : "";
  for (const item of catalog) {
    // Only the right product and concentration/variant may provide a packshot.
    if (!productPageIsRelevant(item.name, name)) continue;
    const b = item.brand.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]/gu,"");
    if (selectedBrand && b && !b.includes(selectedBrand) && !selectedBrand.includes(b)) continue;
    add({url: item.imageUrl, source: item.sourceLabel, priority: 14});
  }
  for (const item of pages) {
    if (!productPageIsRelevant(item.name, name)) continue;
    const normalize = (value: string) => value.toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]/gu,"");
    const b = normalize(item.brand);
    const makerDomain = normalize(new URL(item.sourceUrl).hostname);
    const title = normalize(item.name);
    const confirmedBrand = b ? (b.includes(selectedBrand) || selectedBrand.includes(b))
      : (makerDomain.includes(selectedBrand) || title.includes(selectedBrand));
    if (selectedBrand && !confirmedBrand) continue;
    add({url: item.imageUrl, source: item.sourceLabel, priority: 17});
  }
  if (html) {
    const parsed = fromHtml(html, original);
    if (parsed && productPageIsRelevant(parsed.name, name))
      for (const img of imageSourcesFromHtml(html, original, name)) add(img);
  }
  const prioritized = results.map(candidate => ({
    ...candidate,
    priority: candidate.priority + (
      selectedBrand && candidate.source.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"").includes(selectedBrand) ? 8 : 0),
  })).sort((a,b) => b.priority - a.priority);
  return prioritized.slice(0, 10);
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Nepodporovaná metoda." }, 405);
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "photos") {
    const name = clean(url.searchParams.get("name"), 160);
    const brand = clean(url.searchParams.get("brand"), 160);
    const original = url.searchParams.get("url") ?? "";
    const preferred = url.searchParams.get("image") ?? "";
    if (name.length < 3 || name.length > 160 || original.length > 2000 || preferred.length > 2000)
      return json({ error: "Zadej platný název produktu." }, 400);
    const candidates = await photoCandidates(name, brand, original, preferred);
    return json({ candidates, notice: candidates.length
      ? "Nalezené snímky. Výběr upřednostní čisté bílé nebo průhledné pozadí."
      : "Pro tento produkt nebyly nalezené ověřitelné produktové fotografie." });
  }
  if (url.searchParams.get("mode") === "guide") {
    const name = clean(url.searchParams.get("name"), 160);
    const brand = clean(url.searchParams.get("brand"), 160);
    const original = url.searchParams.get("url") ?? "";
    if (name.length < 3 || name.length > 160 || brand.length > 160 || original.length > 2048)
      return json({ error: "Pro dohledání návodu zadej název produktu." }, 400);
    const enriched = await findDetailedGuide(brand, name, original);
    return json(enriched);
  }
  if (url.searchParams.get("mode") === "image") {
    const image = url.searchParams.get("url") ?? "";
    if (!image || image.length > 2000) return json({ error: "Neplatná adresa fotografie." }, 400);
    try {
      const response = await requestPublic(image, "image/avif,image/webp,image/png,image/jpeg");
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(type))
        return json({ error: "Fotografie nemá podporovaný formát." }, 415);
      const bytes = await readLimited(response, IMG_LIMIT);
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return json({ error: "Fotografii nelze bezpečně načíst; lze ji nahrát ručně." }, 422);
    }
  }
  const query = (url.searchParams.get("query") ?? "").trim();
  if (query.length < 3 || query.length > 500) return json({ error: "Zadej název nebo odkaz (3–500 znaků)." }, 400);
  try {
    const isUrl = /^https?:\/\//i.test(query);
    if (isUrl) {
      if (!parseSafeUrl(query)) return json({ error: "Použij bezpečný veřejný HTTPS odkaz na produkt." }, 400);
      const response = await requestPublic(query, "text/html");
      const type = (response.headers.get("content-type") || "").toLowerCase();
      if (!type.includes("text/html")) return json({ error: "Odkaz neobsahuje běžnou produktovou stránku." }, 422);
      const html = new TextDecoder().decode(await readLimited(response, PRODUCT_PAGE_LIMIT, true));
      const match = fromHtml(html, query);
      if (!match) return json({ matches: [], notice: "Na stránce se nepodařilo ověřit název produktu. Zkus název nebo jiný odkaz." });
      return json({ matches: [match], notice: "Údaje pocházejí z metadat odkazované stránky. Před uložením je zkontroluj." });
    }
    let matches: Match[] = [];
    try { matches = await searchBeauty(query); } catch { /* independent web fallback */ }
    if (matches.length) return json({
      matches, notice: "Výsledky z katalogu Open Beauty Facts. Po výběru dohledáme také pokyny výrobce nebo prodejce.",
    });
    const webMatches = await researchProductPages(query);
    return json({ matches: webMatches.slice(0, 5), notice: webMatches.length
      ? "Produkt nebyl v katalogu; našel jsem odpovídající webové stránky. Vyber správnou variantu."
      : "Produkt se v dostupných zdrojích nepodařilo spolehlivě identifikovat. Zkus odkaz výrobce nebo e-shopu." });
  } catch {
    return json({ matches: [], notice: "Zdroj je nedostupný nebo blokuje automatické načítání. Zkus jiný odkaz či název." });
  }
}

export default { fetch: handle };
