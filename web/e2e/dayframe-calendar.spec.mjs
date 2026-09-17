import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4173";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-17T09:00:00") });
});

test("adds a task from the week without leaking internal scheduling syntax", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("http://127.0.0.1:4173", { waitUntil: "load" });

  await expect(page.getByText("Do konce dne", { exact: true })).toBeVisible();
  await expect(page.getByText("Konec 00:30", { exact: true })).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toContainText("Nejbližší termín");

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  let targetIndex = todayIndex + 1;
  if (targetIndex > 6) {
    await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
    targetIndex = 0;
  }

  const targetDay = page.locator(".df2-week-day").nth(targetIndex);
  await targetDay.locator(".df2-week-day-head > button").click();
  await expect(page.getByRole("heading", { name: "Přidat úkol" })).toBeVisible();

  await page.locator(".df2-title-input input").fill("Zeměpis 20 min");
  await page.getByRole("button", { name: "Naplánovat" }).click();

  const result = page.locator(".df2-result");
  await expect(result).toContainText("Zeměpis");
  await expect(result).not.toContainText("[[");

  await result.getByRole("button", { name: "Ukázat v týdnu" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);
  await expect(targetAfterSave).toContainText("Zeměpis");

  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
});

test("production CSS keeps countdowns readable on desktop and mobile", async ({ page }) => {
  await page.goto(origin, { waitUntil: "load" });
  for (const width of [1360, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const ruler = page.locator(".df2-day-ruler");
    await expect(ruler).toBeVisible();
    await expect(page.locator(".df2-day-ruler-copy")).toHaveCSS("display", "grid");
    const timer = await page.locator(".df2-day-ruler-copy strong").boundingBox();
    const box = await ruler.boundingBox();
    expect(timer.x).toBeGreaterThanOrEqual(box.x);
    expect(timer.x + timer.width).toBeLessThanOrEqual(box.x + box.width);
    const fontSize = await page.locator(".df2-day-ruler-copy strong").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator(".df2-event-countdown")).toHaveCSS("display", "grid");
  }
});

test("manual input wins, the result opens the right week, and completed edits survive reload", async ({ page }) => {
  await page.goto(origin, { waitUntil: "load" });
  await page.getByRole("button", { name: "Přidat úkol 2", exact: true }).click();
  await page.getByLabel("Co potřebuješ udělat?", { exact: true }).fill("Kontrola 20 min");
  await expect(page.getByLabel("Délka", { exact: true })).toHaveValue("20");
  await page.getByLabel("Délka", { exact: true }).selectOption("45");
  await page.getByLabel("Den", { exact: true }).fill("2026-10-01");
  await expect(page.locator(".df2-understood")).toContainText("45 min");
  await expect(page.locator(".df2-understood")).toContainText("1. 10.");
  await page.getByRole("button", { name: "Naplánovat", exact: true }).click();
  await page.getByRole("button", { name: "Ukázat v týdnu", exact: true }).click();
  const block = page.locator(".df2-week-task").filter({ hasText: "Kontrola" });
  await expect(block).toHaveCount(1);
  await block.click();
  const editor = page.getByRole("dialog", { name: "Upravit", exact: true });
  await expect(editor.getByLabel("Den", { exact: true })).toHaveValue("2026-10-01");
  await expect(editor.getByLabel("Délka", { exact: true })).toHaveValue("45");
  await editor.getByRole("button", { name: "Označit hotovo", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Vrátit jako nesplněné", exact: true })).toBeVisible();
  await editor.getByLabel("Název", { exact: true }).fill("Kontrola uložení");
  await editor.getByRole("button", { name: "Uložit změny", exact: true }).click();
  await expect(page.locator(".df2-week-task.done").filter({ hasText: "Kontrola uložení" })).toHaveCount(1);
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "Týden W", exact: true }).click();
  await page.getByRole("button", { name: "Další týden", exact: true }).click();
  await page.getByRole("button", { name: "Další týden", exact: true }).click();
  await expect(page.locator(".df2-week-task.done").filter({ hasText: "Kontrola uložení" })).toHaveCount(1);
});

test("corrupt saved data is not replaced with an empty plan", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dayframe-v1", "{broken"));
  await page.goto(origin, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Data se nepodařilo načíst" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("dayframe-v1"))).toBe("{broken");
});
