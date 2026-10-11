/** Reuse Hygiene's security policy without coupling its test selection to Supplements. */
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
const UA="Dayframe/1.0 (https://dayframe2.vercel.app; supplement product lookup)";
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

export async function requestPublic(raw: string, accept: string, timeoutMs = 6500): Promise<Response> {
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

export async function readLimited(response: Response, max: number, partial = false): Promise<Uint8Array> {
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

