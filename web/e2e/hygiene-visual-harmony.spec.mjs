import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function fresh(page) {
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00"));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}

async function hygiene(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await expect(page.getByRole("heading", { name: "Hygiena", exact: true })).toBeVisible();
}

async function style(locator) {
  return locator.evaluate(element => {
    const value = getComputedStyle(element);
    return {
      backgroundColor: value.backgroundColor,
      borderColor: value.borderColor,
      borderRadius: value.borderRadius,
      padding: value.padding,
      fontSize: value.fontSize,
      fontWeight: value.fontWeight,
    };
  });
}

test("Hygiena and Zdraví have the same navigation geometry and active accent", async ({ page }) => {
  await fresh(page);
  await hygiene(page);
  const selectedHygiene = await style(page.getByRole("tab", { name: "Dnes", exact: true }));
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Zdraví" }).click();
  const selectedHealth = await style(page.getByRole("tab", { name: "Gym & Tréninky" }));

  expect(selectedHygiene.borderRadius).toBe(selectedHealth.borderRadius);
  expect(selectedHygiene.backgroundColor).toBe(selectedHealth.backgroundColor);
  expect(selectedHygiene.borderColor).toBe(selectedHealth.borderColor);
  expect(selectedHygiene.padding).toBe(selectedHealth.padding);
  expect(selectedHygiene.fontSize).toBe(selectedHealth.fontSize);
  expect(selectedHygiene.fontWeight).toBe(selectedHealth.fontWeight);
});

test("Hygiena cards across Today, Cleaning, History and Management share Health card language", async ({ page }) => {
  await fresh(page);
  await hygiene(page);
  const routine = page.locator(".df2-hygiene-routine").first();
  await expect(routine).toBeVisible();
  await expect(routine).toHaveCSS("border-radius", "12px");
  await expect(routine).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".df2-hygiene-overall")).toHaveCSS("background-color", "rgb(252, 251, 248)");
  await expect(page.locator(".df2-hygiene-overall")).toHaveCSS("border-radius", "12px");

  await page.getByRole("tab", { name: "Úklid" }).click();
  await expect(page.locator('[data-cleaning-routine="cleaning-daily"]')).toHaveCSS("border-radius", "12px");
  await expect(page.locator('[data-cleaning-routine="cleaning-sunday"]')).toHaveCSS("border-radius", "12px");

  await page.getByRole("tab", { name: "Historie" }).click();
  await expect(page.locator(".df2-hygiene-stats-grid article").first()).toHaveCSS("border-radius", "12px");

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await expect(page.locator(".df2-hygiene-manage-list > article").first()).toHaveCSS("border-radius", "12px");
  await page.locator(".df2-hygiene-manage-list > article > header button").first().click();
  const modal = page.getByRole("dialog", { name: "Upravit hygienickou rutinu" });
  await expect(modal).toBeVisible();
  // Modal fields share the care input design (9px in both sections).
  await expect(modal.locator("input:not([type=checkbox])").first()).toHaveCSS("border-radius", "9px");
  await modal.getByRole("button", { name: "Zavřít" }).click();

  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await expect(page.locator(".df2-products-top h2")).toHaveCSS("font-size", "24px");
  await expect(page.locator(".df2-products-toolbar button").first()).toHaveCSS("border-radius", "9px");
});

test("Hygiene tabs are accessible on mobile without wrapping into extra rows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page);
  await hygiene(page);
  const tabs = page.locator(".df2-hygiene-tabs");
  await expect(tabs).toHaveCSS("overflow-x", "auto");
  await expect(tabs).toHaveCSS("flex-wrap", "nowrap");
  const widths = await tabs.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(widths.scroll).toBeGreaterThan(widths.client);
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await expect(page.locator(".df2-products-top")).toBeVisible();
  await page.getByRole("tab", { name: "Úklid" }).click();
  await expect(page.locator('[data-cleaning-routine="cleaning-daily"]')).toBeVisible();
});

test("Body, Sleep, Prevention and Supplements reuse the shared care card radius", async ({ page }) => {
  await fresh(page);
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Zdraví" }).click();
  const cases = [
    ["Tělo & Progress", ".df2-body-kpis article"],
    ["Spánek & Regenerace", ".df2-sleep-kpis article"],
    ["Prevence", ".df2-prevention-stats article"],
    ["Suplementy", ".df2-supplements-overview"],
  ];
  for (const [tab, selector] of cases) {
    await page.getByRole("tab", { name: tab }).click();
    const card = page.locator(selector).first();
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("border-radius", "12px");
    await expect(card).toHaveCSS("box-shadow", "none");
  }
});
