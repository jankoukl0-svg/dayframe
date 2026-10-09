import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const KEY = "dayframe-hygiene-v1";

async function fresh(page, date = "2026-10-06T12:00:00") {
  await page.clock.setFixedTime(new Date(date));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-hygiene-v1")))).toBe(true);
}

async function hygiene(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
}

async function changeDay(page, date) {
  await page.clock.setFixedTime(new Date(date + "T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
}

test("rolling Hygiene Day interval resets from actual late completion and does not create missed duplicates", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const task = data.routines.find((r) => r.id === "hygiene-day").tasks.find((t) => t.id === "weekly-hand-nails");
    task.schedule = { type: "rolling", everyDays: 7, anchorDate: "2026-10-06", unit: "days" };
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(data));
  });
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toContainText("Kontrola a případné stříhání nehtů na rukou");
  await changeDay(page, "2026-10-08");
  const overdue = page.getByRole("region", { name: "Zmeškané hygienické úkoly" });
  await expect(overdue).toContainText("Kontrola a případné stříhání nehtů na rukou");
  await overdue.getByRole("button", { name: "✓ Hotovo dnes" }).click();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.records["2026-10-06"]["hygiene-day"].states["weekly-hand-nails"]).toBe("done");
  expect(data.records["2026-10-06"]["hygiene-day"].completedOn["weekly-hand-nails"]).toBe("2026-10-08");
  await changeDay(page, "2026-10-12");
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toHaveCount(0);
  await changeDay(page, "2026-10-15");
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toContainText("Kontrola a případné stříhání nehtů na rukou");
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(after.records["2026-10-15"]["hygiene-day"].scheduledTasks.filter((t) => t.id === "weekly-hand-nails")).toHaveLength(1);
  for (const date of ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]) {
    expect(Object.values(after.records[date] ?? {}).flatMap((record) => record.scheduledTasks).some((t) => t.id === "weekly-hand-nails")).toBe(false);
  }
});

test("postpone overdue Hygiene Day once, keep an immutable original and materialize a single future occurrence", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const task = store.routines.find((r) => r.id === "hygiene-day").tasks.find((t) => t.id === "weekly-hand-nails");
    task.schedule = { type: "rolling", everyDays: 7, anchorDate: "2026-10-06", unit: "days" };
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
  });
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await changeDay(page, "2026-10-08");
  const overdue = page.getByRole("region", { name: "Zmeškané hygienické úkoly" });
  await overdue.getByRole("button", { name: "Odložit", exact: true }).click();
  await overdue.getByLabel("Nový termín Kontrola a případné stříhání nehtů na rukou").fill("2026-10-10");
  await overdue.getByRole("button", { name: "Potvrdit" }).click();
  let result = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(result.taskReschedules["2026-10-06|hygiene-day|weekly-hand-nails"]).toBe("2026-10-10");
  expect(result.records["2026-10-06"]["hygiene-day"].states["weekly-hand-nails"]).toBe("deferred");
  await expect(overdue).toHaveCount(0);
  await changeDay(page, "2026-10-10");
  const today = page.locator('[data-hygiene-routine="hygiene-day"] .df2-hygiene-task')
    .filter({ hasText: "Kontrola a případné stříhání nehtů na rukou" });
  await expect(today).toHaveCount(1);
  await today.getByRole("button", { name: "Přeskočit Kontrola a případné stříhání nehtů na rukou" }).click();
  result = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(result.records["2026-10-10"]["hygiene-day"].states["weekly-hand-nails"]).toBe("omitted");
  expect(result.records["2026-10-10"]["hygiene-day"].completedOn?.["weekly-hand-nails"]).toBeUndefined();
  await changeDay(page, "2026-10-17");
  const again = page.locator('[data-hygiene-routine="hygiene-day"]');
  await expect(again).toContainText("Kontrola a případné stříhání nehtů na rukou");
});

test("weekly chores stay fixed, not-needed and skipped remain distinct, old stores remain readable", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    delete data.taskReschedules;
    delete data.manualTaskDates;
    const task = data.routines.find((r) => r.id === "hygiene-day").tasks.find((t) => t.id === "weekly-hand-nails");
    task.schedule = { type: "rolling", everyDays: 1, anchorDate: "2026-10-09", unit: "weeks" };
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(data));
  });
  await changeDay(page, "2026-10-11");
  const sunday = page.locator('[data-hygiene-routine="hygiene-day"]');
  await expect(sunday).toContainText("Převléknout celou postel");
  await expect(sunday).not.toContainText("Kontrola a případné stříhání nehtů na rukou");
  const skipped = sunday.locator(".df2-hygiene-task").filter({ hasText: "Holení nebo úprava vousů" });
  await skipped.getByRole("button", { name: "Přeskočit Holení nebo úprava vousů" }).click();
  const notNeeded = sunday.locator(".df2-hygiene-task").filter({ hasText: "Úprava obočí podle potřeby" });
  await notNeeded.getByRole("button", { name: "Není potřeba" }).click();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.records["2026-10-11"]["hygiene-day"].states["weekly-beard"]).toBe("omitted");
  expect(data.records["2026-10-11"]["hygiene-day"].states["weekly-eyebrows"]).toBe("skipped");
  expect(data.records["2026-10-11"]["hygiene-day"].completedOn?.["weekly-beard"]).toBeUndefined();
  expect(data.records["2026-10-11"]["hygiene-day"].states["weekly-bed"]).toBeUndefined();
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toContainText("Přeskočeno");
});

test("manual hygiene task is scheduled once on a chosen day without extra duplicate checklist items", async ({ page }) => {
  await fresh(page);
  await hygiene(page);
  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await page.locator(".df2-hygiene-manage-task-copy").filter({ hasText: "Kontrola a případné stříhání nehtů na rukou" }).click();
  const editor = page.getByRole("dialog", { name: "Upravit hygienický úkol" });
  await editor.getByRole("combobox", { name: "Frekvence úkolu" }).selectOption("manual");
  await editor.getByRole("checkbox", { name: "Naplánovat konkrétní výskyt" }).check();
  await editor.getByLabel("Datum ručního úkolu").fill("2026-10-09");
  await editor.getByRole("button", { name: "Uložit", exact: true }).click();
  await changeDay(page, "2026-10-09");
  const manual = page.locator('[data-hygiene-routine="hygiene-day"] .df2-hygiene-task')
    .filter({ hasText: "Kontrola a případné stříhání nehtů na rukou" });
  await expect(manual).toHaveCount(1);
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await expect(page.locator('[data-hygiene-routine="hygiene-day"] .df2-hygiene-task')
    .filter({ hasText: "Kontrola a případné stříhání nehtů na rukou" })).toHaveCount(1);
});
