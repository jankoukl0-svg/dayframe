import { test, expect } from "@playwright/test";
import {
  isCatalogBoilerplate, usefulDescription, safeFdaLabel,
  chooseImportedValue, percentageStrength,
} from "./dayframe-product-quality.mjs";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const poor = "Ingredients INCI, allergens, additives, labels, origin of ingredients and information on product Facial Moisturizing Lotion AM Lightweight SPF 50 – CeraVe – 89 ml";

test("catalog SEO descriptions are not copied over real product descriptions", () => {
  expect(isCatalogBoilerplate(poor)).toBe(true);
  expect(usefulDescription(poor)).toBe("");
  expect(chooseImportedValue(poor, "Hydrating daily facial lotion with SPF 50", false, true))
    .toBe("Hydrating daily facial lotion with SPF 50");
  expect(chooseImportedValue("Moje vlastní poznámka", "New marketing copy", false, true))
    .toBe("Moje vlastní poznámka");
  expect(chooseImportedValue("Moje vlastní poznámka", "New marketing copy", true, true))
    .toBe("New marketing copy");
  expect(chooseImportedValue("Můj návod", "", true)).toBe("Můj návod");
});

test("drug warnings are used only from an exactly strength-matched official label", () => {
  const label = {
    openfda: {
      brand_name: ["Equate Hair Regrowth Treatment"],
      generic_name: ["Minoxidil Topical Solution"],
      substance_name: ["minoxidil"],
      spl_set_id: ["fd67b4d2-e71d-4145-bf69-437d0aa86cd3"],
    },
    active_ingredient: ["Minoxidil 2% w/v"],
    purpose: ["Hair regrowth treatment"],
    directions: ["apply one mL with dropper 2 times a day directly onto the scalp"],
    warnings: ["For external use only. Flammable: Keep away from fire or flame."],
    do_not_use: ["Do not use under the age of 18 or on irritated scalp."],
    stop_use: ["Stop use and ask a doctor if chest pain, rapid heartbeat or dizziness occurs."],
  };
  const safe = safeFdaLabel(label, "Hair Regrowth Formula, Minoxidil Topical Solution 2%", "equate");
  expect(safe).not.toBeNull();
  expect(safe.guide.instructions).toContain("one mL");
  expect(safe.guide.usageAmount).toBe("one mL");
  expect(safe.guide.precautions).toContain("chest pain");
  expect(safe.guide.precautions).toContain("Do not use");
  expect(safe.sourceUrl).toContain("dailymed.nlm.nih.gov");
  expect(safeFdaLabel({ ...label, active_ingredient: ["Minoxidil 5%"] },
    "Minoxidil Topical Solution 2%", "equate")).toBeNull();
  expect(safeFdaLabel(label, "Topical Solution 5%", "equate")).toBeNull();
  expect(safeFdaLabel(label, "Minoxidil Topical Solution 2%", "Some unrelated brand")).toBeNull();
  expect(percentageStrength("Minoxidil 2%")).toBe(2);
});

async function existingEditor(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const dialog = page.getByRole("dialog", { name: "Editor produktu" });
  await dialog.getByRole("textbox", { name: "Název produktu *" })
    .fill("Facial Moisturizing Lotion AM Lightweight SPF 50");
  await dialog.getByRole("textbox", { name: "Značka" }).fill("CeraVe");
  await dialog.getByRole("textbox", { name: "Popis a účel" }).fill(poor);
  await dialog.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".df2-product-card").filter({ hasText: "Facial Moisturizing Lotion AM Lightweight SPF 50" }).click();
  await page.getByRole("dialog", { name: /Detail produktu/ }).getByRole("button", { name: "Upravit" }).click();
  return page.getByRole("dialog", { name: "Editor produktu" });
}

test("existing product can enrich directly; bogus catalog description is replaced, safety warnings kept", async ({ page }) => {
  let observedParams = null;
  await page.route("**/api/hygiene-product-lookup?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    observedParams = Object.fromEntries(params.entries());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      description: "Daily AM moisturizing facial lotion with broad-spectrum SPF 50.",
      guide: {
        instructions: "Apply to face before sun exposure.",
        usageWhen: "Morning", usageAmount: "",
        usageDuration: "", frequency: "", precautions: "For external use. Avoid eye contact.",
      },
      sourceUrls: ["https://manufacturer.example/am-lotion-spf50"],
      warning: "",
    }) });
  });
  const dialog = await existingEditor(page);
  await expect(dialog.getByText(/Současný popis pochází z katalogového výpisu/)).toBeVisible();
  await dialog.getByRole("button", { name: "Doplnit návod a rizika k tomuto produktu" }).click();
  await expect(dialog.getByRole("textbox", { name: "Popis a účel" }))
    .toHaveValue("Daily AM moisturizing facial lotion with broad-spectrum SPF 50.");
  await expect(dialog.getByRole("textbox", { name: "Návod k použití" })).toHaveValue("Apply to face before sun exposure.");
  await expect(dialog.getByRole("textbox", { name: "Upozornění a omezení" }))
    .toHaveValue("For external use. Avoid eye contact.");
  expect(observedParams.mode).toBe("guide");
  expect(observedParams.brand).toBe("CeraVe");
  await dialog.getByRole("button", { name: "Uložit produkt" }).click();
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(store.products[0].precautions).toContain("Avoid eye contact");
});

test("never overwrite handwritten directions unless user expressly opts in", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      description: "Manufacturer description",
      guide: { instructions: "Manufacturer instructions", precautions: "Manufacturer warning", frequency: "" },
      sourceUrls: ["https://manufacturer.example/product"],
    }),
  }));
  const dialog = await existingEditor(page);
  await dialog.getByRole("textbox", { name: "Návod k použití" }).fill("Můj vlastní návod");
  await dialog.getByRole("button", { name: "Doplnit návod a rizika k tomuto produktu" }).click();
  await expect(dialog.getByRole("textbox", { name: "Návod k použití" })).toHaveValue("Můj vlastní návod");
  await dialog.getByRole("checkbox", { name: "Nahradit také existující texty nově nalezenými údaji" }).check();
  await dialog.getByRole("button", { name: "Doplnit návod a rizika k tomuto produktu" }).click();
  await expect(dialog.getByRole("textbox", { name: "Návod k použití" })).toHaveValue("Manufacturer instructions");
});

test("missing manufacturer safety facts are reported, never marked as zero risk", async ({ page }) => {
  await page.route("**/api/hygiene-product-lookup?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      guide: { instructions: "", usageWhen: "", usageAmount: "", usageDuration: "", precautions: "" },
      description: "", sourceUrls: [], warning: "Bezpečnostní upozornění se nepodařilo ověřit.",
    }),
  }));
  const dialog = await existingEditor(page);
  await dialog.getByRole("button", { name: "Doplnit návod a rizika k tomuto produktu" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Bezpečnostní upozornění se nepodařilo ověřit.");
  await expect(dialog.getByRole("textbox", { name: "Upozornění a omezení" })).toHaveValue("");
});
