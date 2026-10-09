/**
 * Vercel Function for the static Dayframe build. No API keys, no AI-generated usage
 * instructions: data comes from the supplied product page or Open Beauty Facts.
 * The static Vite preview cannot execute this function; browser specs mock it.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type Match = {
  name: string; brand: string; category: string; description: string;
  instructions: string; amount: string; priceCzk: number | null;
  imageUrl: string; sourceUrl: string; sourceLabel: string;
};

const LIMIT = 500_000;
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

async function requestPublic(raw: string, accept: string): Promise<Response> {
  let url = await validated(raw);
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetch(url, {
      redirect: "manual", signal: AbortSignal.timeout(6500),
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

async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") || 0) > max) throw new Error("Soubor je příliš velký.");
  if (!response.body) throw new Error("Zdroj neobsahuje data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Error("Zdroj je příliš velký.");
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
    if (types.some((type) => typeof type === "string" && /(^|:)Product$/i.test(type))) return record;
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

function fromHtml(html: string, url: string): Match | null {
  const meta = metas(html), ld = getProductJsonld(html);
  const title = clean(ld?.name || meta["og:title"] || meta["twitter:title"], 160)
    .replace(/\s+[|\-–]\s+.+$/, "");
  if (!title) return null;
  const rawBrand = ld?.brand;
  const brand = clean(typeof rawBrand === "object" && rawBrand && !Array.isArray(rawBrand)
    ? (rawBrand as Record<string,unknown>).name : rawBrand, 160);
  const category = categoryFrom(clean(ld?.category || "", 100));
  const description = clean(ld?.description || meta["og:description"] || meta.description, 1800);
  const amount = clean(ld?.size, 100);
  return {
    name: title, brand, category, description,
    // Descriptive marketing text is not a validated usage instruction or precaution.
    instructions: "", amount,
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
  url.searchParams.set("fields", "code,product_name,brands,quantity,categories,description,generic_name,image_front_url,image_url");
  const response = await requestPublic(url.href, "application/json");
  const content = new TextDecoder().decode(await readLimited(response, LIMIT));
  const payload = JSON.parse(content) as { products?: Record<string,unknown>[] };
  const unique = new Set<string>();
  return (payload.products ?? [])
    .map((product): Match => {
      const name = clean(product.product_name, 160);
      const brand = clean(product.brands, 160).split(",")[0];
      const description = clean(product.generic_name || product.description, 1800);
      const code = String(product.code ?? "");
      return {
        name, brand, category: categoryFrom(clean(product.categories, 300)),
        description, instructions: "", amount: clean(product.quantity, 100),
        priceCzk: null,
        imageUrl: imageUrl(product.image_front_url || product.image_url),
        sourceUrl: /^\d{8,14}$/.test(code) ? "https://world.openbeautyfacts.org/product/" + code : "https://world.openbeautyfacts.org",
        sourceLabel: "Open Beauty Facts",
      };
    })
    .filter((item) => item.name && score(item, query) >= 0.55 && (!unique.has(item.name + "|" + item.brand)
      && unique.add(item.name + "|" + item.brand)))
    .sort((a,b) => score(b, query) - score(a, query))
    .slice(0, 5);
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Nepodporovaná metoda." }, 405);
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "image") {
    const image = url.searchParams.get("url") ?? "";
    if (!image || image.length > 2000) return json({ error: "Neplatná adresa fotografie." }, 400);
    try {
      const response = await requestPublic(image, "image/avif,image/webp,image/png,image/jpeg");
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(type))
        return json({ error: "Fotografie nemá podporovaný formát." }, 415);
      const bytes = await readLimited(response, IMG_LIMIT);
      return new Response(bytes, {
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
      const html = new TextDecoder().decode(await readLimited(response, LIMIT));
      const match = fromHtml(html, query);
      if (!match) return json({ matches: [], notice: "Na stránce se nepodařilo ověřit název produktu. Zkus název nebo jiný odkaz." });
      return json({ matches: [match], notice: "Údaje pocházejí z metadat odkazované stránky. Před uložením je zkontroluj." });
    }
    const matches = await searchBeauty(query);
    return json({ matches, notice: matches.length
      ? "Výsledky z komunitní databáze Open Beauty Facts. Vyber odpovídající balení a zkontroluj údaje."
      : "V Open Beauty Facts nebyl nalezen dostatečně podobný produkt. Můžeš zkusit přímý odkaz." });
  } catch {
    return json({ matches: [], notice: "Zdroj je nedostupný nebo blokuje automatické načítání. Zkus jiný odkaz či název." });
  }
}

export default { fetch: handle };
