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

test("a new repeating routine rejects past dates in the historical Week editor",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T15:20:00"));
  await page.goto(process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Týden/}).click();
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await page.locator(".df2-week-day").first().locator(".df2-week-day-head > button").click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await expect(dialog).toBeVisible();
  const date=dialog.locator(".df2-chips input[type='date']");
  await expect(date).toHaveValue("2026-10-05");
  await dialog.locator(".df2-title-input input").fill("Budoucí testovací rutina");
  await dialog.locator(".df2-chips input[type='time']").fill("18:00");
  await dialog.locator("details.df2-details summary").click();
  await dialog.getByLabel("Opakování").selectOption("weekly");
  const before=await page.evaluate(()=>localStorage.getItem("dayframe-v1"));
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/jen do budoucna/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-v1"))).toBe(before);
  await date.fill("2026-10-14");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(state.routines.some(r=>r.title==="Budoucí testovací rutina")).toBe(true);
  expect((state.plans["2026-10-05"]??[]).some(t=>t.title==="Budoucí testovací rutina")).toBe(false);
  await page.reload({waitUntil:"networkidle"});
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((after.plans["2026-10-05"]??[]).some(t=>t.title==="Budoucí testovací rutina")).toBe(false);
});
