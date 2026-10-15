import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
async function fresh(page, date = "2026-10-12T12:00:00") {
  await page.clock.setFixedTime(new Date(date));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}
async function cleaning(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await page.getByRole("tab", { name: "Úklid" }).click();
  return page.getByRole("region", { name: "Úklid", exact: true });
}

test("Úklid separates daily chores and Sunday-only chores without weekday overdue", async ({ page }) => {
  await fresh(page);
  const root = await cleaning(page);
  const daily = root.locator('[data-cleaning-routine="cleaning-daily"]');
  const sunday = root.locator('[data-cleaning-routine="cleaning-sunday"]');
  await expect(daily).toBeVisible();
  await expect(sunday).toBeVisible();
  await expect(daily.locator(".df2-hygiene-cleaning-item")).toHaveCount(6);
  await expect(sunday.locator(".df2-hygiene-cleaning-item")).toHaveCount(13);
  await expect(sunday).toContainText("Zobrazí se k odškrtnutí v neděli");
  await expect(sunday.getByRole("button", { name: "Označit Vysát podlahy a koberce jako hotovo" })).toBeDisabled();
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toHaveCount(0);

  await daily.getByRole("button", { name: "Označit Ustlat postel jako hotovo" }).click();
  await expect(daily.getByRole("button", { name: "Vrátit Ustlat postel jako nesplněné" })).toHaveAttribute("aria-pressed", "true");
  await page.reload({ waitUntil: "networkidle" });
  await cleaning(page);
  await expect(root.locator('[data-cleaning-routine="cleaning-daily"]')).toContainText("1/5");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(saved.records["2026-10-12"]["cleaning-daily"].states["cleaning-make-bed"]).toBe("done");
  expect(saved.records["2026-10-12"]["cleaning-sunday"]).toBeUndefined();

  await page.clock.setFixedTime(new Date("2026-10-18T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await cleaning(page);
  await expect(sunday.getByRole("button", { name: "Označit Vysát podlahy a koberce jako hotovo" })).toBeEnabled();
  await sunday.getByRole("button", { name: "Označit Vysát podlahy a koberce jako hotovo" }).click();
  await expect(sunday).toContainText("1/13");
  await page.clock.setFixedTime(new Date("2026-10-19T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
  await expect(page.getByRole("region", { name: "Zmeškané hygienické úkoly" })).toHaveCount(0);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(history.records["2026-10-18"]["cleaning-sunday"].states["cleaning-vacuum"]).toBe("done");
});

test("cleaning task list is editable through its own tab and changes persist", async ({ page }) => {
  await fresh(page);
  const root = await cleaning(page);
  const daily = root.locator('[data-cleaning-routine="cleaning-daily"]');
  await daily.getByRole("button", { name: "+ Přidat úkol" }).click();
  const editor = page.getByRole("dialog", { name: "Upravit hygienický úkol" });
  await editor.getByRole("textbox", { name: "Název" }).fill("Uklidit knihy");
  await expect(editor.getByRole("combobox", { name: "Rutina" })).toHaveValue("cleaning-daily");
  await editor.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(daily).toContainText("Uklidit knihy");
  await daily.getByRole("button", { name: "Označit Uklidit knihy jako hotovo" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await cleaning(page);
  await expect(daily.getByRole("button", { name: "Vrátit Uklidit knihy jako nesplněné" })).toBeVisible();
});

test("legacy Hygiene Day chores move to Sunday cleaning once without rewriting past history", async ({ page }) => {
  await fresh(page, "2026-10-11T12:00:00");
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const hygiene = store.routines.find(r => r.id === "hygiene-day");
    const sunday = store.routines.find(r => r.id === "cleaning-sunday");
    const transferred = sunday.tasks.filter(t => t.id.startsWith("weekly-"));
    hygiene.tasks.push(...transferred.map(t => ({ ...t })));
    const preserved = store.records["2026-10-11"]["cleaning-sunday"];
    const old = store.records["2026-10-11"]["hygiene-day"];
    const moved = preserved.scheduledTasks.filter(t => t.id.startsWith("weekly-"));
    old.scheduledTasks.push(...moved);
    old.states["weekly-bed"] = "done";
    delete store.records["2026-10-11"]["cleaning-sunday"];
    store.routines = store.routines.filter(r => r.domain !== "cleaning");
    delete store.cleaningDefaultsInstalled;
    store.lastMaterializedDate = "2026-10-11";
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
  });
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  const root = await cleaning(page);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(state.cleaningDefaultsInstalled).toBe(true);
  expect(state.routines.filter(r => r.domain === "cleaning")).toHaveLength(2);
  expect(state.routines.find(r => r.id === "hygiene-day").tasks.some(t => t.id === "weekly-bed")).toBe(false);
  expect(state.routines.find(r => r.id === "cleaning-sunday").tasks.filter(t => t.id === "weekly-bed")).toHaveLength(1);
  expect(state.records["2026-10-11"]["hygiene-day"].states["weekly-bed"]).toBe("done");
  expect(state.records["2026-10-12"]["cleaning-daily"]).toBeUndefined();
  expect(state.records["2026-10-14"]["cleaning-daily"]).toBeUndefined();
  await expect(root.locator('[data-cleaning-routine="cleaning-daily"]')).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(saved.routines.filter(r => r.domain === "cleaning")).toHaveLength(2);
});

test("deleting a cleaning task does not re-install it from defaults", async ({ page }) => {
  await fresh(page);
  const root = await cleaning(page);
  const daily = root.locator('[data-cleaning-routine="cleaning-daily"]');
  await daily.getByRole("button", { name: "Upravit úkol Ustlat postel" }).click();
  await page.getByRole("dialog", { name: "Upravit hygienický úkol" })
    .getByRole("button", { name: "Smazat úkol" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await cleaning(page);
  await expect(daily).not.toContainText("Ustlat postel");
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.cleaningDefaultsInstalled).toBe(true);
  expect(data.routines.find(r => r.id === "cleaning-daily").tasks.some(t => t.id === "cleaning-make-bed")).toBe(false);
});


test("current Sunday completion is transferred without asking to redo a finished chore", async ({ page }) => {
  await fresh(page, "2026-10-11T12:00:00");
  await page.evaluate(() => {
    const store=JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const hygiene=store.routines.find(r=>r.id==="hygiene-day");
    const sunday=store.routines.find(r=>r.id==="cleaning-sunday");
    hygiene.tasks.push(...sunday.tasks.filter(t=>t.id.startsWith("weekly-")));
    const old=store.records["2026-10-11"]["hygiene-day"];
    const current=store.records["2026-10-11"]["cleaning-sunday"];
    old.scheduledTasks.push(...current.scheduledTasks.filter(t=>t.id.startsWith("weekly-")));
    old.states["weekly-bed"]="done";
    old.completedOn={"weekly-bed":"2026-10-11"};
    delete store.records["2026-10-11"]["cleaning-sunday"];
    store.routines=store.routines.filter(r=>r.domain!=="cleaning");
    delete store.cleaningDefaultsInstalled;
    localStorage.setItem("dayframe-hygiene-v1",JSON.stringify(store));
  });
  await page.reload({ waitUntil: "networkidle" });
  const root=await cleaning(page);
  const sunday=root.locator('[data-cleaning-routine="cleaning-sunday"]');
  await expect(sunday.getByRole("button",{name:"Vrátit Převléknout celou postel jako nesplněné"})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("tab",{name:"Dnes"}).click();
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).not.toContainText("Převléknout celou postel");
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.records["2026-10-11"]["cleaning-sunday"].states["weekly-bed"]).toBe("done");
  expect(data.records["2026-10-11"]["cleaning-sunday"].completedOn["weekly-bed"]).toBe("2026-10-11");
  expect(data.records["2026-10-11"]["hygiene-day"].states["weekly-bed"]).toBeUndefined();
});

test("a deleted completed task is displayed read-only without crashing its editor", async ({ page }) => {
  await fresh(page);
  const root=await cleaning(page);
  const daily=root.locator('[data-cleaning-routine="cleaning-daily"]');
  await daily.getByRole("button",{name:"Označit Ustlat postel jako hotovo"}).click();
  await page.evaluate(()=>{
    const store=JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const routine=store.routines.find(r=>r.id==="cleaning-daily");
    routine.tasks=routine.tasks.filter(t=>t.id!=="cleaning-make-bed");
    localStorage.setItem("dayframe-hygiene-v1",JSON.stringify(store));
  });
  await page.reload({waitUntil:"networkidle"});
  await cleaning(page);
  await expect(daily).toContainText("Ustlat postel");
  await expect(daily).toContainText("Historický úkon");
  await expect(daily.getByRole("button",{name:"Upravit úkol Ustlat postel"})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Hygiena"})).toBeVisible();
});
