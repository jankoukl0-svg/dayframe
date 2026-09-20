import { test, expect } from "@playwright/test";

test("edits a recurring routine and persists the new schedule", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();

  const cfiGroup = page.locator(".df2-routine-group").filter({ hasText: "CFI / Excel" }).first();
  await expect(cfiGroup).toBeVisible();
  await cfiGroup.locator(".df2-routine-group-summary").click();

  const firstOccurrence = cfiGroup.locator(".df2-routine-occurrence").first();
  await firstOccurrence.getByRole("button", { name: "Upravit" }).click();

  const editor = page.locator(".df2-routine-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Název").fill("CFI / Excel deep");
  await editor.getByLabel("Čas").fill("10:30");
  await editor.getByLabel("Délka").fill("75");

  const reload = page.waitForEvent("load");
  await editor.getByRole("button", { name: "Uložit změny" }).click();
  await reload;
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Nastavení" })).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}"));
  const edited = stored.routines.find((routine) => routine.id === "mon-cfi");
  expect(edited.title).toBe("CFI / Excel deep");
  expect(edited.start).toBe("10:30");
  expect(edited.duration).toBe(75);

  const editedGroup = page.locator(".df2-routine-group").filter({ hasText: "CFI / Excel deep" }).first();
  await expect(editedGroup).toBeVisible();
  await expect(editedGroup.locator(".df2-routine-group-summary")).toContainText("10:30 · 75 min");
});
