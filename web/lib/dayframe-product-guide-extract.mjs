/**
 * Conservative extraction of product-specific instructions from public catalog
 * records and manufacturer/retailer HTML. Only verbatim, labelled directions;
 * no model-generated treatment schedules, dosages or safety advice.
 */
const blank = () => ({ instructions: "", usageWhen: "", usageAmount: "", usageDuration: "", precautions: "", frequency: "" });

function decode(value) {
  return String(value ?? "").replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, number) => {
    const code = number.startsWith("x") ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/&(?:amp|quot|apos|lt|gt|nbsp|ndash|mdash|bull);/gi, (entity) =>
    ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
      "&ndash;": "–", "&mdash;": "—", "&bull;": "•" })[entity.toLowerCase()] ?? entity);
}

const stripTags = (value) => decode(String(value ?? "").replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, "\n")
  .replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " "))
  .replace(/[\u00a0 \t]+/g, " ").trim();

function clean(value, max = 1400) {
  return stripTags(value).replace(/\n\s*\n+/g, "\n").slice(0, max).trim();
}

function plainObjectText(value) {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(plainObjectText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return plainObjectText(value.text || value.description || value.itemListElement
      || value.steps || value.name || "");
  }
  return "";
}

const titles = {
  instructions: /^(?:how to use(?:\s+(?:this|the)\s+product)?|how to apply|directions(?: for use)?|usage(?: instructions)?|application(?: instructions)?|instructions(?: for use)?|použití(?: produktu)?|návod(?: k použití)?|způsob použití|jak používat|anwendung|anwendungshinweise|mode d'emploi|conseils d'utilisation|modo de uso)(?:\s*[:?])?$/i,
  precautions: /^(?:warnings?|precautions?|safety(?: information| statement| statements)?|important safety information|cautions?|upozornění(?: a omezení)?|varování|bezpečnostní (?:upozornění|tvrzení|informace)|opatření|hinweise|warnhinweise|précautions(?: d'emploi)?)(?:\s*[:?])?$/i,
  usageWhen: /^(?:when to use|when|kdy používat|kdy aplikovat|time of day)(?:\s*[:?])?$/i,
  usageAmount: /^(?:how much(?: to use)?|množství(?: na jedno použití)?|amount to use|dosage|dávkování)(?:\s*[:?])?$/i,
  usageDuration: /^(?:how long(?: to leave on)?|doba působení|jak dlouho (?:používat|nechat působit)|contact time)(?:\s*[:?])?$/i,
  frequency: /^(?:frequency(?: of use)?|frekvence(?: používání)?|how often)(?:\s*[:?])?$/i,
};

function normalizeSection(text, max) {
  const lines = clean(text, max + 300).split("\n").map((line) =>
    line.replace(/^(?:\s*[•·\-]\s*)/, "").trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    if (line.length > 320) continue;
    if (/^(?:read more|see more|show more|zobrazit více|dozvědět se více|ingredients|složení)$/i.test(line)) break;
    if (kept[kept.length - 1] !== line) kept.push(line);
    if (kept.join("\n").length > max) break;
  }
  return kept.join("\n").slice(0, max).trim();
}

function sectionAfterHeading(html, kind, max = 1100) {
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]{1,900}?)<\/\1\s*>/gi)];
  for (let i = 0; i < headings.length; i++) {
    const label = clean(headings[i][2], 100).replace(/\s+/g, " ").trim();
    if (!titles[kind].test(label)) continue;
    const start = headings[i].index + headings[i][0].length;
    const stop = headings[i + 1]?.index ?? html.length;
    const nextHtml = html.slice(start, Math.min(stop, start + 10000));
    const text = normalizeSection(nextHtml
      .replace(/<(?:script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|noscript)\s*>/gi, "")
      .replace(/<\/li\s*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n"), max);
    if (text) return text;
  }
  // Many retail and cosmetic sites label content using strong tags rather than headings.
  for (const [open, close] of [["strong", "strong"], ["b", "b"]]) {
    const re = new RegExp("<" + open + "\\b[^>]*>([\\s\\S]{1,90}?)<\\/" + close + "\\s*>", "gi");
    for (const match of html.matchAll(re)) {
      const label = clean(match[1], 100).replace(/\s+/g, " ").replace(/:$/, "").trim();
      if (!titles[kind].test(label)) continue;
      const text = normalizeSection(html.slice(match.index + match[0].length,
        match.index + match[0].length + 2300), max);
      if (text) return text;
    }
  }
  return "";
}

function explicitHints(text) {
  const result = {};
  const normalized = text.replace(/\s+/g, " ");
  const dosage = normalized.match(/\b(?:a |an |use |apply |take |naneste |použijte )?(?:pea[- ]sized|coin[- ]sized|dime[- ]sized|small|thin layer|thin film|množství o velikosti hrášku|malé množství|tenkou vrstvu)(?:\s+(?:amount|layer|of [\w-]+))?\b/i)
    || normalized.match(/\b\d{1,3}(?:[.,]\d+)?\s*(?:drops?|kapky?|pump(?:s)?|stisk(?:y|ů)?|ml)\b/i);
  if (dosage) result.usageAmount = dosage[0].trim().slice(0, 180);
  const duration = normalized.match(/\b(?:leave (?:on|for)|nechte (?:působit|na pokožce)|nechat působit|wait(?: for)?)\s*(?:for\s*)?\d{1,3}\s*(?:seconds?|minutes?|hours?|sekund(?:y|u)?|minut(?:y|u)?|hodin(?:y|u)?)\b/i);
  if (duration) result.usageDuration = duration[0].trim().slice(0, 180);
  const when = normalized.match(/\b(?:morning and evening|every morning|every evening|before bedtime|at night|after cleansing|on wet skin|na navlhčenou pokožku|ráno a večer|každé ráno|každý večer|před spaním|po očištění pleti|na vlhkou pokožku)\b/i);
  if (when) result.usageWhen = when[0].trim().slice(0, 180);
  const frequency = normalized.match(/\b(?:use|apply|používejte|aplikujte)\s*(?:it\s*)?(?:once|twice|three times)\s*(?:a|per)\s*day\b/i)
    || normalized.match(/\b(?:používejte|aplikujte)\s*(?:1|2|3|jednou|dvakrát|třikrát)\s*(?:×|krát)?\s*(?:denně|za den)\b/i);
  if (frequency) result.frequency = frequency[0].trim().slice(0, 180);
  return result;
}

function fromLabelledData(record) {
  const get = (...keys) => {
    for (const key of keys) {
      const candidate = plainObjectText(record?.[key]);
      if (candidate) return candidate;
    }
    return "";
  };
  const details = blank();
  details.instructions = get("howToUse", "usageInstructions", "directions", "instructions", "usageInfo", "usage_text", "usage", "usage_text_cs", "usage_text_en", "usage_instructions", "product_usage").slice(0, 1800);
  details.precautions = get("warnings", "warning", "precautions", "safetyInformation", "safetyWarning", "precautions_cs", "precautions_en").slice(0, 1200);
  details.usageWhen = get("whenToUse", "usageWhen").slice(0, 400);
  details.usageAmount = get("usageAmount", "amountToUse", "dosage").slice(0, 400);
  details.usageDuration = get("usageDuration", "contactTime").slice(0, 400);
  details.frequency = get("frequencyOfUse", "usageFrequency").slice(0, 400);
  if (Array.isArray(record?.additionalProperty)) {
    for (const property of record.additionalProperty) {
      if (!property || typeof property !== "object") continue;
      const key = clean(property.name || property.propertyID, 100);
      const value = plainObjectText(property.value).slice(0, 1000);
      if (!value) continue;
      for (const [field, regex] of Object.entries(titles)) {
        if (!details[field] && regex.test(key)) details[field] = value;
      }
    }
  }
  return details;
}

export function extractGuideFromHtml(html, productStructuredData = null) {
  const body = String(html ?? "").replace(/<(?:script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|noscript|template)\s*>/gi, "");
  const fields = fromLabelledData(productStructuredData);
  for (const key of Object.keys(titles)) {
    if (fields[key]) continue;
    const found = sectionAfterHeading(body, key, key === "instructions" ? 1800 : 1200);
    if (found) fields[key] = found;
  }
  const hints = explicitHints(fields.instructions);
  for (const [key,value] of Object.entries(hints)) if (!fields[key]) fields[key] = value;
  return fields;
}

export function extractGuideFromCatalog(product) {
  const guide = fromLabelledData(product);
  const hints = explicitHints(guide.instructions);
  for (const [key,value] of Object.entries(hints)) if (!guide[key]) guide[key] = value;
  return guide;
}
