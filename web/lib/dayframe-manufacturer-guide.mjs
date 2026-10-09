/**
 * Small, explicitly verified manufacturer reference layer for products whose
 * public catalog records contain little more than a name and a photo.
 *
 * Do not infer directions from product categories: each entry must be a
 * product-specific match and cite pages published by the manufacturer.
 * New references can be added without changing the lookup/UI architecture.
 */
const entries = [
  {
    brand: "cerave",
    aliases: [
      "sa smoothing cleanser",
      "sa smoothing cleanser with salicylic acid",
      "zjemnujici cistici gel",
    ],
    // CeraVe SA Smoothing Cleanser (EU), not US Renewing SA Cleanser or SA Cream.
    codes: ["3337875795456"],
    urls: [
      "https://www.cerave.cz/pece-o-plet/hydratacni-pripravky/zjemnujici-cistici-gel",
      "https://www.cerave.com.au/ceramides-skin-care/cleansers/sa-smoothing-cleanser-with-salicylic-acid",
    ],
    guide: {
      description: "Jemný čisticí gel s kyselinou salicylovou pro suchou a drsnou pokožku s nerovnoměrným povrchem. Čistí a pomáhá zjemnit pokožku bez narušení kožní bariéry.",
      instructions: "Navlhčete pokožku vlažnou vodou. Jemnými krouživými pohyby vmasírujte čisticí gel do pokožky. Opláchněte.",
      usageWhen: "Na navlhčenou pokožku obličeje nebo těla.",
      usageAmount: "Pro obličej množství přibližně velikosti mince.",
      usageDuration: "Několik sekund jemně masírujte, poté opláchněte.",
      precautions: "Podle české stránky CeraVe nejsou při běžném použití vyžadována specifická opatření. Řiďte se pokyny na obalu.",
      frequency: "",
    },
  },
];

const normalized = (value) => String(value ?? "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

export function manufacturerGuideFor(brand, name, code = "") {
  const brandName = normalized(brand);
  const productName = normalized(name);
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!brandName || !productName) return null;
  for (const entry of entries) {
    if (!brandName.split(" ").includes(entry.brand)) continue;
    const nameMatch = entry.aliases.some((alias) => productName === alias
      || productName.endsWith(" " + alias)
      || productName.startsWith(alias + " "));
    if (!nameMatch && !entry.codes.includes(digits)) continue;
    // Avoid accidentally treating a different variant or cream as the cleanser.
    if (/(?:\bcream\b|\brenewing\b|\bserum\b|\bmilk\b|\bhydrating\b)/.test(productName)) continue;
    return { ...entry.guide, sourceUrl: entry.urls[0], sourceUrls: [...entry.urls] };
  }
  return null;
}
