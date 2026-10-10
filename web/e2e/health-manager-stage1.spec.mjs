import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const HYGIENE_KEY = "dayframe-hygiene-v1";

async function fresh(page) {
  await page.clock.setFixedTime(new Date("2026-10-09T12:00:00"));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}
async function goHealth(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Zdraví" }).click();
  return page.getByRole("region", { name: "Zdraví", exact: true });
}

test("Health navigation is distinct and stage-two modules are clearly marked as future work", async ({ page }) => {
  await fresh(page);
  const health = await goHealth(page);
  await expect(health.getByRole("heading", { name: "Zdraví", exact: true })).toBeVisible();
  await expect(health.getByRole("tab")).toHaveCount(7);
  await expect(health).toContainText("Pro dnešek nejsou naplánované žádné zdravotní návyky");
  await health.getByRole("tab", { name: "Gym & Tréninky" }).click();
  await expect(health).toContainText("ETAPA 2");
  await expect(health).not.toContainText("Absolvované tréninky");
  await health.getByRole("tab", { name: "Suplementy" }).click();
  await expect(health).toContainText("ETAPA 3");
  await health.getByRole("tab", { name: "Přehled" }).click();
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await expect(page.getByRole("tab", { name: "Moje produkty" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Správa rutin" })).toBeVisible();
});

test("Health habit shares recurrence/history storage and Today shows one linked summary, not a duplicate checklist", async ({ page }) => {
  await fresh(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  const health = await goHealth(page);
  await health.getByRole("button", { name: "+ Přidat návyk" }).click();
  const editor = page.getByRole("dialog", { name: "Zdravotní návyk" });
  await editor.getByRole("textbox", { name: "Název rutiny" }).fill("Ranní protažení");
  await editor.getByRole("textbox", { name: "Název úkolu" }).fill("Protáhnout se");
  await editor.getByRole("button", { name: "Uložit návyk" }).click();
  await expect(editor).toHaveCount(0);
  await expect(health).toContainText("Ranní protažení");

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  const added = saved.routines.find((routine) => routine.domain === "health");
  expect(added).toBeTruthy();
  // The legacy parser normalizes absent productIds to [], which is not a
  // change to the existing routine definitions or their scheduling semantics.
  const invariant = (routines) => routines.map((routine) => ({
    id: routine.id, title: routine.title, active: routine.active,
    schedule: routine.schedule, order: routine.order,
    tasks: routine.tasks.map((task) => ({
      id: task.id, title: task.title, section: task.section, active: task.active,
      optional: task.optional, allowSkip: task.allowSkip, schedule: task.schedule,
      timerSeconds: task.timerSeconds, linkedProducts: task.productIds ?? [],
    })),
  }));
  expect(invariant(saved.routines.filter((item) => item.domain !== "health"))).toEqual(invariant(before.routines));
  expect(saved.products).toEqual(before.products);
  expect(saved.records["2026-10-09"][added.id].domain).toBe("health");

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  const aggregate = page.locator('[data-health-checklist-routine="' + added.id + '"]');
  await expect(aggregate).toHaveCount(1);
  await expect(aggregate).toContainText("0/1");
  await expect(page.locator('[data-hygiene-checklist-routine="' + added.id + '"]')).toHaveCount(0);
  await aggregate.getByRole("button", { name: "Otevřít Ranní protažení ve Zdraví" }).click();
  const healthAgain = page.getByRole("region", { name: "Zdraví", exact: true });
  await expect(healthAgain.getByText("Protáhnout se")).toBeVisible();
  await healthAgain.getByRole("button", { name: "Hotovo", exact: true }).click();

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  await expect(aggregate).toContainText("Hotovo");
  const finished = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(finished.records["2026-10-09"][added.id].states[added.tasks[0].id]).toBe("done");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('[data-health-checklist-routine="' + added.id + '"]')).toContainText("Hotovo");

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await expect(page.getByText("Ranní protažení")).toHaveCount(0);
  await page.getByRole("tab", { name: "Historie" }).click();
  await expect(page.getByText("Ranní protažení")).toHaveCount(0);
});

test("custom Health recurrence does not schedule out-of-day tasks; edits retain original history", async ({ page }) => {
  await fresh(page);
  const health = await goHealth(page);
  await health.getByRole("button", { name: "+ Přidat návyk" }).click();
  const editor = page.getByRole("dialog", { name: "Zdravotní návyk" });
  await editor.getByRole("textbox", { name: "Název rutiny" }).fill("Nedělní pohyb");
  await editor.getByRole("textbox", { name: "Název úkolu" }).fill("Protáhnout nohy");
  await editor.getByRole("combobox", { name: "Frekvence" }).selectOption("weekly");
  await editor.getByRole("combobox", { name: "Den" }).selectOption("0");
  await editor.getByRole("button", { name: "Uložit návyk" }).click();
  await expect(health).toContainText("Nedělní pohyb");
  await expect(health).toContainText("Pro dnešek nejsou naplánované žádné zdravotní návyky");
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  await expect(page.locator("[data-health-checklist-routine]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Zdraví" }).click();
  await health.getByRole("button", { name: "Upravit" }).click();
  const changed = page.getByRole("dialog", { name: "Zdravotní návyk" });
  await changed.getByRole("combobox", { name: "Frekvence" }).selectOption("daily");
  await changed.getByRole("button", { name: "Uložit návyk" }).click();
  await expect(health).toContainText("Protáhnout nohy");
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  await expect(page.locator("[data-health-checklist-routine]")).toHaveCount(1);
});

test("Health menu and future-module tabs are usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fresh(page);
  const health = await goHealth(page);
  await expect(health.getByRole("tab", { name: "Prevence" })).toBeVisible();
  await health.getByRole("tab", { name: "Prevence" }).click();
  await expect(health).toContainText("ETAPA 6");
});

test("deactivating a completed Health habit keeps its actual completion in history", async ({ page }) => {
  await fresh(page);
  const health = await goHealth(page);
  await health.getByRole("button", { name: "+ Přidat návyk" }).click();
  const editor = page.getByRole("dialog", { name: "Zdravotní návyk" });
  await editor.getByRole("textbox", { name: "Název rutiny" }).fill("Zdravotní rutina");
  await editor.getByRole("textbox", { name: "Název úkolu" }).fill("Pohyb");
  await editor.getByRole("button", { name: "Uložit návyk" }).click();
  await health.getByRole("button", { name: "Hotovo", exact: true }).click();
  await health.getByRole("button", { name: "Upravit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Zdravotní návyk" });
  await edit.getByRole("checkbox", { name: "Aktivní" }).uncheck();
  await edit.getByRole("button", { name: "Uložit návyk" }).click();
  await expect(health).toContainText("Pro dnešek nejsou naplánované žádné zdravotní návyky");
  await health.getByRole("button", { name: "Zobrazit" }).click();
  await expect(health.locator(".df2-health-history")).toContainText("1/1 splněno");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  const record = Object.values(saved.records["2026-10-09"]).find((r) => r.domain === "health");
  expect(record.archived).toBe(true);
  expect(Object.values(record.states)).toContain("done");
});
