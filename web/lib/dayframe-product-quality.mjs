/**
 * Product-data quality checks shared by server and browser.
 * No field is synthesized from the type of product or a cosmetic category.
 */
const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function isCatalogBoilerplate(value) {
  const text = normalize(value).toLowerCase();
  if (!text) return false;
  return /(?:ingredients inci|allergens, additives, labels|origin of ingredients|information on product)/i.test(text)
    || /^(?:product|cosmetic|skin care|hair care)\s*(?:information|details|description)\s*[-:]/i.test(text)
    || /^ingredients\s*:\s*(?:water|aqua|inci)\b/i.test(text)
    || /(?:additives|allergens|inci|origin of ingredients).{0,100}(?:labels|information on product)/i.test(text);
}

export function usefulDescription(value) {
  const text = normalize(value);
  return text.length >= 15 && !isCatalogBoilerplate(text) ? text.slice(0, 1800) : "";
}

/** Match strength so 2% drug labels never pick a similarly named 5% preparation. */
export function percentageStrength(value) {
  const match = String(value ?? "").match(/(?:^|[^\d])(\d{1,2}(?:[.,]\d+)?)\s*%/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function strings(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").join("\n");
  return typeof value === "string" ? value : "";
}

function strip(value, max = 1250) {
  return strings(value).replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

function first(record, keys, max) {
  for (const key of keys) {
    const value = strip(record[key], max);
    if (value) return value;
  }
  return "";
}

/**
 * openFDA exposes many brand/formulation variants. Only use a label that matches
 * the user's named ingredient/brand AND numerical strength where supplied.
 * Never borrow dosage or safety language from a different concentration.
 */
export function safeFdaLabel(label, name, brand = "") {
  if (!label || typeof label !== "object") return null;
  const obj = label;
  const openfda = obj.openfda || {};
  const input = (name + " " + brand).toLowerCase();
  const tokenized = (v) => String(v).toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const labelName = tokenized([...openfda.brand_name || [], ...openfda.generic_name || [],
    ...openfda.substance_name || [], ...openfda.product_type || []].join(" "));
  const ingredient = tokenized(strip(obj.active_ingredient, 350));
  const requestedName = tokenized(name);
  const requestedBrand = tokenized(brand);
  const coreTokens = requestedName.split(" ").filter((token) => token.length >= 5
    && !["topical", "solution", "formula", "regrowth", "cream", "lotion", "serum", "strength", "liquid", "generic", "product"].includes(token));
  const overlap = coreTokens.filter((token) => labelName.includes(token) || ingredient.includes(token));
  if (!overlap.length && !(requestedBrand && labelName.includes(requestedBrand))) return null;
  if (coreTokens.length >= 2 && overlap.length / coreTokens.length < 0.5) return null;
  const requestedStrength = percentageStrength(name);
  if (requestedStrength != null) {
    const actual = percentageStrength(strings(obj.active_ingredient) + " " + labelName);
    if (actual == null || Math.abs(actual - requestedStrength) > 0.001) return null;
  }
  // If the user provided an explicit medicine brand, enforce it on the label
  // unless it is already part of a clear ingredient+strength match.
  if (requestedBrand && !labelName.includes(requestedBrand)
    && !(overlap.length >= 2 && requestedStrength != null)) return null;

  const directions = first(obj, ["directions", "dosage_and_administration"], 1400);
  const purpose = first(obj, ["purpose", "indications_and_usage"], 850);
  const warningSections = [
    ["Upozornění", ["warnings", "boxed_warning"]],
    ["Nepoužívejte, pokud", ["do_not_use"]],
    ["Před použitím se poraďte s lékařem", ["ask_doctor", "ask_doctor_or_pharmacist"]],
    ["Při používání", ["when_using"]],
    ["Přestaňte používat a kontaktujte lékaře", ["stop_use"]],
    ["Těhotenství a kojení", ["pregnancy_or_breast_feeding"]],
    ["Uchovávejte mimo dosah dětí", ["keep_out_of_reach_of_children"]],
  ].map(([title, keys]) => {
    const value = first(obj, keys, 850);
    return value ? title + ":\n" + value : "";
  }).filter(Boolean);
  const precautions = warningSections.join("\n\n").slice(0, 2600);
  const amount = directions.match(/\b\d+(?:[.,]\d+)?\s*(?:ml|millilit(?:er|re)s?|drops?|tablets?|capsules?|pump(?:s)?)\b/i);
  const frequency = directions.match(/\b(?:once|twice|three times|two times|\d+\s*times)\s*(?:a|per)\s*day\b/i);
  const setid = String(openfda.spl_set_id?.[0] ?? "");
  const labelUrl = /^[0-9a-f-]{36}$/i.test(setid)
    ? "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=" + setid : "https://open.fda.gov/apis/drug/label/";
  return {
    description: purpose,
    guide: {
      instructions: directions,
      usageWhen: "",
      usageAmount: amount?.[0] || "",
      usageDuration: "",
      frequency: frequency?.[0] || "",
      precautions,
    },
    sourceUrl: labelUrl,
    sourceUrls: [labelUrl],
    safetySource: "FDA / DailyMed – oficiální americký příbalový text; ověřte přesný přípravek a obal.",
  };
}

/**
 * Combine richer sources while rejecting catalog SEO boilerplate. A user's
 * meaningful handwritten note is never replaced without explicit permission.
 */
export function chooseImportedValue(current, incoming, overwrite = false, description = false) {
  const existing = normalize(current);
  const proposed = normalize(incoming);
  if (!proposed) return existing;
  if (description && isCatalogBoilerplate(proposed)) return existing;
  if (overwrite || !existing || (description && isCatalogBoilerplate(existing))) return proposed;
  return existing;
}
