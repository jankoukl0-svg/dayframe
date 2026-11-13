import { test, expect } from "@playwright/test";

const ROOT = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const CARE_KEY = "dayframe-week-care-v1";
const HYGIENE_KEY = "dayframe-hygiene-v1";

async function fresh(page, iso = "2026-10-12T12:00:00") {
  await page.clock.setFixedTime(new Date(iso));
  await page.goto(ROOT, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}

async function week(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  return page.locator(".df2-week-day");
}

async function dragCare(page, sourceDay, targetDay, id, time) {
  // Match real browser event ordering: React commits onDragStart state before drop.
  await page.evaluate(({ sourceDay, id }) => {
    const source = document.querySelectorAll(".df2-week-day")[sourceDay]
      ?.querySelector('[data-week-care="' + id + '"]');
    if (!(source instanceof HTMLElement)) throw Error("Week care drag source missing");
    const transfer = new DataTransfer();
    window.__careWeekDragTransfer = transfer;
    const rect = source.getBoundingClientRect();
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + 12, clientY: rect.top + 4,
    }));
  }, { sourceDay, id });

  await page.evaluate(({ targetDay, time }) => {
    const target = document.querySelectorAll(".df2-week-day")[targetDay]
      ?.querySelector(".df2-time-body");
    if (!(target instanceof HTMLElement)) throw Error("Week care drop column missing");
    const transfer = window.__careWeekDragTransfer;
    if (!(transfer instanceof DataTransfer)) throw Error("Missing drag transfer");
    const [h, m] = time.split(":").map(Number);
    const minute = (h < 8 ? h + 24 : h) * 60 + m;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + 25,
      clientY: rect.top + (minute - 8 * 60) * 0.72 + 4,
    }));
  }, { targetDay, time });
  await expect(page.locator(".df2-week-day").nth(targetDay).locator(".df2-drop-preview")).toBeVisible();

  await page.evaluate(({ targetDay, time }) => {
    const target = document.querySelectorAll(".df2-week-day")[targetDay]
      ?.querySelector(".df2-time-body");
    if (!(target instanceof HTMLElement)) throw Error("Week care drop column missing");
    const transfer = window.__careWeekDragTransfer;
    if (!(transfer instanceof DataTransfer)) throw Error("Missing drag transfer");
    const [h, m] = time.split(":").map(Number);
    const minute = (h < 8 ? h + 24 : h) * 60 + m;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + 25,
      clientY: rect.top + (minute - 8 * 60) * 0.72 + 4,
    }));
    delete window.__careWeekDragTransfer;
  }, { targetDay, time });
}

const REPEATED_ID = "hygiene-routine-rolling-e2e";
const REPEATED_CARE_ID = "rolling:" + REPEATED_ID;
const REPEATED_TASKS = [
  "Masáž obličeje / Gua Sha",
  "Holení nebo úprava vousů",
  "Hydratace těla",
  "Paula's choice",
  "gel na zuby - sklovina",
  "Čištění jazyka",
  "Úprava obočí",
];

async function seedRepeatedHygiene(page) {
  await page.evaluate(({ key, routineId, names }) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.push({
      id: routineId, title: "Opakovaná rutina", active: true, order: 35,
      schedule: { type: "rolling", everyDays: 3, unit: "days", anchorDate: "2026-10-14" },
      tasks: names.map((title, i) => ({
        id: "repeat-e2e-" + i, title, section: "Péče",
        active: true, optional: false, allowSkip: false,
      })),
    });
    store.records["2026-10-09"] = {
      ...(store.records["2026-10-09"] ?? {}),
      [routineId]: {
        date: "2026-10-09", routineId, routineTitle: "Opakovaná rutina",
        scheduledTasks: [{ id: "repeat-e2e-0", title: names[0], section: "Péče",
          optional: false, allowSkip: false, scheduleType: "rolling" }],
        states: { "repeat-e2e-0": "done" },
        completedOn: { "repeat-e2e-0": "2026-10-09" },
      },
    };
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, { key: HYGIENE_KEY, routineId: REPEATED_ID, names: REPEATED_TASKS });
}

test("Conversion respects disabled Sunday equivalents instead of silently reactivating them", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.find(item => item.id === "hygiene-day").tasks
      .find(item => item.id === "weekly-body-hydration").active = false;
    localStorage.setItem(key, JSON.stringify(store));
  }, HYGIENE_KEY);
  await seedRepeatedHygiene(page);
  await week(page);
  const saved = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  const related = saved.routines.find(item=>item.id==="hygiene-day").tasks
    .filter(item=>item.id==="weekly-body-hydration" || item.title==="Hydratace těla");
  expect(related).toHaveLength(1);
  expect(related[0].active).toBe(false);
});

test("Deleting the converted routine never corrupts the shared Hygiene store", async ({ page }) => {
  await fresh(page);
  await seedRepeatedHygiene(page);
  await week(page);
  await page.evaluate(({key,id}) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines = store.routines.filter(routine=>routine.id!==id);
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },{key:HYGIENE_KEY,id:REPEATED_ID});
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator('[data-week-care="'+REPEATED_CARE_ID+'"]')).toHaveCount(0);
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(persisted.fixedRepeatRoutineId).toBe(REPEATED_ID);
  expect(persisted.routines.some(routine=>routine.id===REPEATED_ID)).toBe(false);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Hygiena"}).click();
  await expect(page.locator(".df2-hygiene-error")).toHaveCount(0);
});

test("Named rolling care migrates once to Tuesday and Friday, and keeps history", async ({ page }) => {
  await fresh(page, "2026-10-12T12:00:00");
  await seedRepeatedHygiene(page);
  const days = await week(page);
  await expect(days.nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]'))
    .toHaveAttribute("aria-label", "Opakovaná rutina, 20:30–21:00");
  await expect(days.nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]'))
    .toHaveAttribute("aria-label", "Opakovaná rutina, 20:30–21:00");
  await expect(page.locator('[data-week-care^="rolling:"]')).toHaveCount(2);
  await expect(days.nth(6).locator('[data-week-care^="rolling:"]')).toHaveCount(0);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  const repeated = stored.routines.find(item => item.id === REPEATED_ID);
  expect(repeated.schedule).toEqual({ type: "days", weekdays: [2, 5] });
  expect(repeated.tasks).toHaveLength(7);
  expect(stored.fixedRepeatRoutineId).toBe(REPEATED_ID);
  expect(stored.records["2026-10-09"][REPEATED_ID].states["repeat-e2e-0"]).toBe("done");
  await page.reload({ waitUntil: "networkidle" });
  const again = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(again.routines.find(item => item.id === "hygiene-day").tasks)
    .toEqual(stored.routines.find(item => item.id === "hygiene-day").tasks);
});

test("Every repeated step belongs to Sunday Hygiene Day once, without a Sunday repeated block", async ({ page }) => {
  await fresh(page);
  await seedRepeatedHygiene(page);
  await week(page);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  const sunday = stored.routines.find(r => r.id === "hygiene-day");
  const normalized = title => title.toLocaleLowerCase("cs-CZ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const title of REPEATED_TASKS) {
    const match = sunday.tasks.filter(t => t.active && (
      normalized(t.title) === normalized(title)
      || (title === "Úprava obočí" && t.id === "weekly-eyebrows")));
    expect(match.length, title).toBe(1);
  }
  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(1);
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(0);
});

test("Elapsed repeated Hygiene block remains draggable later today without changing completion history", async ({ page }) => {
  await fresh(page, "2026-10-16T16:49:00");
  await seedRepeatedHygiene(page);
  await page.evaluate(({ key, id }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1, times: { "2026-10-16": { [id]: "15:15" } },
    }));
    window.dispatchEvent(new Event("dayframe-week-care-sync"));
  }, { key: CARE_KEY, id: REPEATED_CARE_ID });
  const days = await week(page);
  const repeated = days.nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]');
  await expect(repeated).toHaveAttribute("aria-label", "Opakovaná rutina, 15:15–15:45");
  await expect(repeated).toHaveAttribute("draggable", "true");
  await dragCare(page, 4, 4, REPEATED_CARE_ID, "23:00");
  await expect(repeated).toHaveAttribute("aria-label", "Opakovaná rutina, 23:00–23:30");
  const stored = await page.evaluate(({ careKey, hygieneKey }) => ({
    times: JSON.parse(localStorage.getItem(careKey)).times,
    hygiene: JSON.parse(localStorage.getItem(hygieneKey)),
  }), { careKey: CARE_KEY, hygieneKey: HYGIENE_KEY });
  expect(stored.times["2026-10-16"][REPEATED_CARE_ID]).toBe("23:00");
  expect(stored.hygiene.records["2026-10-09"][REPEATED_ID].states["repeat-e2e-0"]).toBe("done");
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]'))
    .toHaveAttribute("aria-label", "Opakovaná rutina, 23:00–23:30");
});


test("An elapsed care reservation can be shifted to an earlier time within its day", async ({ page }) => {
  await fresh(page, "2026-10-16T16:49:00");
  await seedRepeatedHygiene(page);
  await page.evaluate(({ key, id }) => {
    localStorage.setItem(key, JSON.stringify({version:1,times:{"2026-10-16":{[id]:"15:15"}}}));
  }, { key: CARE_KEY, id: REPEATED_CARE_ID });
  const days=await week(page);
  const block=days.nth(4).locator('[data-week-care="'+REPEATED_CARE_ID+'"]');
  await block.click();
  const dialog=page.getByRole("dialog",{name:"Opakovaná rutina"});
  await dialog.getByLabel("Začátek bloku").fill("16:00");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(block).toHaveAttribute("aria-label","Opakovaná rutina, 16:00–16:30");
});

test("A completed care block may move within the same day but not change its completion date", async ({ page }) => {
  await fresh(page,"2026-10-16T16:49:00");
  await seedRepeatedHygiene(page);
  const days=await week(page);
  const block=days.nth(4).locator('[data-week-care="'+REPEATED_CARE_ID+'"]');
  await page.evaluate(({key,id})=>{
    const store=JSON.parse(localStorage.getItem(key));
    const record=store.records["2026-10-16"][id];
    if(!record?.scheduledTasks.length) throw Error("Missing Friday snapshot");
    const task=record.scheduledTasks[0].id;
    record.states[task]="done";
    record.completedOn={...(record.completedOn??{}),[task]:"2026-10-16"};
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },{key:HYGIENE_KEY,id:REPEATED_ID});
  await expect(block).toHaveAttribute("draggable","true");
  await block.click();
  const dialog=page.getByRole("dialog",{name:"Opakovaná rutina"});
  await expect(dialog.getByLabel("Den výskytu")).toBeDisabled();
  await dialog.getByLabel("Začátek bloku").fill("23:00");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(block).toHaveAttribute("aria-label","Opakovaná rutina, 23:00–23:30");
  const store=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(store.records["2026-10-16"][REPEATED_ID].completedOn["repeat-e2e-0"]).toBe("2026-10-16");
});

test("Friday repeat can move in time or be removed just for Friday with no Restore", async ({ page }) => {
  await fresh(page);
  await seedRepeatedHygiene(page);
  const days = await week(page);
  const friday = days.nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]');
  await friday.click();
  const dialog = page.getByRole("dialog", { name: "Opakovaná rutina" });
  await dialog.getByLabel("Začátek bloku").fill("22:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(friday).toHaveAttribute("aria-label", "Opakovaná rutina, 22:00–22:30");
  await expect(days.nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]'))
    .toHaveAttribute("aria-label", "Opakovaná rutina, 20:30–21:00");
  await friday.click();
  await dialog.getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(friday).toHaveCount(0);
  await expect(days.nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(1);
  await expect(days.nth(4).getByText(/obnovit/i)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(saved.times["2026-10-16"][REPEATED_CARE_ID]).toBe("22:00");
  expect(saved.hidden["2026-10-16"]).toContain(REPEATED_CARE_ID);
});

test("A fixed Tuesday occurrence moves to Wednesday without changing other weeks or duplicating Hygiene tasks", async ({ page }) => {
  await fresh(page, "2026-10-12T12:00:00");
  await seedRepeatedHygiene(page);
  const days = await week(page);
  await days.nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]').click();
  const dialog=page.getByRole("dialog",{name:"Opakovaná rutina"});
  await dialog.getByLabel("Den výskytu").fill("2026-10-14");
  await dialog.getByLabel("Začátek bloku").fill("19:00");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(days.nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(0);
  await expect(days.nth(2).locator('[data-week-care="' + REPEATED_CARE_ID + '"]'))
    .toHaveAttribute("aria-label","Opakovaná rutina, 19:00–19:30");
  await expect(days.nth(4).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(1);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(2).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveCount(1);
  const hygiene=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(hygiene.suppressedDates["2026-10-13"]).toContain(REPEATED_ID);
  expect(hygiene.taskReschedules["2026-10-13|"+REPEATED_ID+"|repeat-e2e-1"]).toBe("2026-10-14");
  const placement=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(placement.times["2026-10-14"][REPEATED_CARE_ID]).toBe("19:00");
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-care="'+REPEATED_CARE_ID+'"]')).toHaveCount(1);
});

test("Sunday already covered by Hygiene Day and cannot receive a second repeated occurrence", async ({ page }) => {
  await fresh(page, "2026-10-12T12:00:00");
  await seedRepeatedHygiene(page);
  const days=await week(page);
  await days.nth(1).locator('[data-week-care="'+REPEATED_CARE_ID+'"]').click();
  const dialog=page.getByRole("dialog",{name:"Opakovaná rutina"});
  await dialog.getByLabel("Den výskytu").fill("2026-10-18");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(dialog.getByRole("alert")).toContainText("na neděli");
  await expect(days.nth(1).locator('[data-week-care="'+REPEATED_CARE_ID+'"]')).toHaveCount(1);
});

test("Care modal edits just one day and protects occupied slots", async ({ page }) => {
  await fresh(page);
  await week(page);
  const friday = page.locator(".df2-week-day").nth(4);
  await friday.locator('[data-week-care="morning"]').click();
  const dialog = page.getByRole("dialog", { name: "Ranní hygiena" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Začátek bloku").fill("18:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(friday.locator('[data-week-care="morning"]')).toHaveAttribute("aria-label","Ranní hygiena, 18:00–18:20");
  await expect(page.locator(".df2-week-day").nth(5).locator('[data-week-care="morning"]')).toHaveAttribute("aria-label", "Ranní hygiena, 09:00–09:20");
  await friday.locator('[data-week-care="morning"]').click();
  await dialog.getByLabel("Začátek bloku").fill("10:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(dialog.getByRole("alert")).toContainText("zabírá jiný blok");
  await expect(friday.locator('[data-week-care="morning"]')).toHaveAttribute("aria-label","Ranní hygiena, 18:00–18:20");
  await dialog.getByRole("button", { name: "Zavřít" }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(saved.times["2026-10-16"].morning).toBe("18:00");
});

test("One-day removal leaves no restore option, persists, and preserves other dates", async ({ page }) => {
  await fresh(page);
  await week(page);
  const thursday = page.locator(".df2-week-day").nth(3);
  const friday = page.locator(".df2-week-day").nth(4);
  await friday.locator('[data-week-care="morning"]').click();
  const dialog = page.getByRole("dialog", { name: "Ranní hygiena" });
  await expect(dialog.getByText(/obnovit/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(friday.locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(thursday.locator('[data-week-care="morning"]')).toHaveCount(1);
  await expect(friday.locator('[data-week-care="evening"]')).toHaveCount(1);
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(1);
  const hygiene = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(hygiene.routines.find(r=>r.id==="morning").active).toBe(true);
  expect(hygiene.records["2026-10-12"].morning).toBeTruthy();
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(page.locator(".df2-week-day").nth(4).getByText(/obnovit/i)).toHaveCount(0);
  await expect(page.locator(".df2-week-day").nth(5).locator('[data-week-care="morning"]')).toHaveCount(1);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(stored.hidden["2026-10-16"]).toContain("morning");
  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(page.locator(".df2-week-day").nth(4).getByText(/obnovit/i)).toHaveCount(0);
});

test("Removed reservation stays absent when another block takes its former slot", async ({ page }) => {
  await fresh(page);
  await week(page);
  const friday = page.locator(".df2-week-day").nth(4);
  await friday.locator('[data-week-care="morning"]').click();
  await page.getByRole("dialog", { name: "Ranní hygiena" })
    .getByRole("button", { name: "Odebrat jen tento den" }).click();
  await friday.locator('[data-week-care="evening"]').click();
  const evening = page.getByRole("dialog", { name: "Večerní hygiena" });
  await evening.getByLabel("Začátek bloku").fill("09:00");
  await evening.getByRole("button", { name: "Uložit čas" }).click();
  await expect(friday.locator('[data-week-care="evening"]')).toHaveAttribute("aria-label","Večerní hygiena, 09:00–09:20");
  await expect(friday.locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(friday.getByText(/obnovit/i)).toHaveCount(0);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="evening"]')).toHaveAttribute("aria-label","Večerní hygiena, 09:00–09:20");
  const saved = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(saved.hidden["2026-10-16"]).toContain("morning");
  expect(saved.times["2026-10-16"].evening).toBe("09:00");
});

test("Sunday blocks can be cancelled just once; legacy saved times survive suppression", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => localStorage.setItem(key,JSON.stringify({version:1,times:{"2026-10-18":{"hygiene-day":"18:00"}}})),CARE_KEY);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  const sunday=page.locator(".df2-week-day").nth(6);
  await sunday.locator('[data-week-care="hygiene-day"]').click();
  await page.getByRole("dialog", {name:"Nedělní hygiena"}).getByRole("button",{name:"Odebrat jen tento den"}).click();
  await expect(sunday.locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  await expect(sunday.locator('[data-week-care="cleaning-sunday"]')).toHaveCount(1);
  await expect(sunday.getByText(/obnovit/i)).toHaveCount(0);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(saved.times["2026-10-18"]["hygiene-day"]).toBe("18:00");
  expect(saved.hidden["2026-10-18"]).toContain("hygiene-day");
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(1);
});

test("Invalid hidden placement remains read-only, without deleting saved Hygiene data", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => localStorage.setItem(key,JSON.stringify({version:1,times:{},hidden:{"2026-10-13":["cleaning-sunday"]}})),CARE_KEY);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  const block=page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]');
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute("draggable","false");
  await block.click();
  await expect(page.getByRole("dialog", {name:"Ranní hygiena"}).getByRole("button",{name:"Odebrat jen tento den"})).toBeDisabled();
  expect(await page.evaluate(key=>localStorage.getItem(key),CARE_KEY)).toContain('"cleaning-sunday"');
});

test("Daily Cleaning is a linked 20-minute morning reservation every day including Sunday", async ({ page }) => {
  await fresh(page);
  const days = await week(page);
  await expect(page.locator('[data-week-care="cleaning-daily"]')).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    const block = days.nth(i).locator('[data-week-care="cleaning-daily"]');
    await expect(block).toHaveAttribute("aria-label", "Denní úklid, 09:30–09:50");
    await expect(block).toHaveClass(/is-short/);
    expect(await block.evaluate(node => Math.abs(node.getBoundingClientRect().height - 14.4))).toBeLessThan(0.5);
    await expect(days.nth(i).locator('[data-week-care="morning"]')).toHaveAttribute("aria-label", "Ranní hygiena, 09:00–09:20");
  }
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toHaveCount(1);
  await expect(days.nth(6).locator('[data-week-care="cleaning-daily"]')).toHaveCount(1);
  const calendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(calendar.plans).flat().filter(task => task.routineId === "cleaning-daily")).toHaveLength(0);
});

test("Daily Cleaning Week label tracks edits to the original Cleaning routine", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const source = store.routines.find(item => item.id === "cleaning-daily");
    if (!source) throw Error("Daily Cleaning routine missing");
    source.title = "Ranní rychloúklid";
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(page.locator('[data-week-care="cleaning-daily"]')).toHaveCount(7);
  await expect(page.locator('[data-week-care="cleaning-daily"]').first())
    .toHaveAttribute("aria-label", "Ranní rychloúklid, 09:30–09:50");
  await page.locator('[data-week-care="cleaning-daily"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Ranní rychloúklid" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Otevřít v Hygieně" }).click();
  await expect(page.getByRole("tab", { name: "Úklid" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-cleaning-routine="cleaning-daily"]')).toContainText("Ranní rychloúklid");
});

test("Daily Cleaning opens the real Cleaning checklist and reflects its completion", async ({ page }) => {
  await fresh(page, "2026-10-12T08:20:00");
  const days = await week(page);
  const block = days.first().locator('[data-week-care="cleaning-daily"]');
  await expect(block).not.toHaveClass(/done/);
  await block.click();
  await page.getByRole("dialog", { name: "Denní úklid" }).getByRole("button", { name: "Otevřít v Hygieně" }).click();
  await expect(page.getByRole("tab", { name: "Úklid" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-cleaning-routine="cleaning-daily"]')).toBeVisible();
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const record = store.records["2026-10-12"]["cleaning-daily"];
    if (!record?.scheduledTasks.length) throw Error("Missing today's daily Cleaning checklist");
    record.states ??= {};
    for (const task of record.scheduledTasks) if (!task.optional) record.states[task.id] = "done";
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(block).toHaveClass(/done/);
});

test("Daily Cleaning can be moved later today after its original time passes, without altering Hygiene history", async ({ page }) => {
  await fresh(page, "2026-10-16T16:49:00");
  const days = await week(page);
  const block = days.nth(4).locator('[data-week-care="cleaning-daily"]');
  await expect(block).toHaveAttribute("aria-label", "Denní úklid, 09:30–09:50");
  await expect(block).toHaveAttribute("draggable", "true");
  await dragCare(page, 4, 4, "cleaning-daily", "23:00");
  await expect(block).toHaveAttribute("aria-label", "Denní úklid, 23:00–23:20");
  const placement = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(placement.times["2026-10-16"]["cleaning-daily"]).toBe("23:00");
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="cleaning-daily"]'))
    .toHaveAttribute("aria-label", "Denní úklid, 23:00–23:20");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(stored.routines.find(r => r.id === "cleaning-daily").schedule).toEqual({ type: "daily" });
});

test("Daily Cleaning removal excludes that Hygiene day but retains the recurring routine", async ({ page }) => {
  await fresh(page);
  const days = await week(page);
  await days.nth(4).locator('[data-week-care="cleaning-daily"]').click();
  await page.getByRole("dialog", { name: "Denní úklid" }).getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(days.nth(4).locator('[data-week-care="cleaning-daily"]')).toHaveCount(0);
  await expect(days.nth(3).locator('[data-week-care="cleaning-daily"]')).toHaveCount(1);
  await expect(days.nth(5).locator('[data-week-care="cleaning-daily"]')).toHaveCount(1);
  await expect(days.nth(4).getByText(/obnovit/i)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="cleaning-daily"]')).toHaveCount(0);
  const stored = await page.evaluate(({ placementKey, hygieneKey }) => ({
    care: JSON.parse(localStorage.getItem(placementKey)),
    hygiene: JSON.parse(localStorage.getItem(hygieneKey)),
  }), { placementKey: CARE_KEY, hygieneKey: HYGIENE_KEY });
  expect(stored.care.hidden["2026-10-16"]).toContain("cleaning-daily");
  expect(stored.hygiene.routines.find(r => r.id === "cleaning-daily").active).toBe(true);
});

test("Disabled Daily Cleaning shows no Week reservation and invalid placement remains read-only", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.find(item => item.id === "cleaning-daily").active = false;
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(page.locator('[data-week-care="cleaning-daily"]')).toHaveCount(0);
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  await page.evaluate(key => localStorage.setItem(key, "{corrupt-json"), CARE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator('[data-week-care="morning"]').first()).toHaveAttribute("draggable", "false");
  await expect(page.locator('[data-week-care="cleaning-sunday"]')).toHaveCount(1);
  expect(await page.evaluate(key => localStorage.getItem(key), CARE_KEY)).toBe("{corrupt-json");
});

test("Morning and Evening Hygiene appear every day for 20 minutes without duplicating tasks", async ({ page }) => {
  await fresh(page);
  const days = await week(page);
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  await expect(page.locator('[data-week-care="evening"]')).toHaveCount(7);
  for (let day = 0; day < 7; day++) {
    const morning = days.nth(day).locator('[data-week-care="morning"]');
    const evening = days.nth(day).locator('[data-week-care="evening"]');
    await expect(morning).toHaveAttribute("aria-label", "Ranní hygiena, 09:00–09:20");
    await expect(evening).toHaveAttribute("aria-label", "Večerní hygiena, 21:30–21:50");
    await expect(morning).toHaveClass(/is-short/);
    await expect(morning.locator("span")).toHaveCount(0);
    expect(await morning.evaluate(el => Math.abs(el.getBoundingClientRect().height - 14.4))).toBeLessThan(0.5);
  }
  const calendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(calendar.plans).flat().filter(task => task.routineId === "morning" || task.routineId === "evening")).toHaveLength(0);
});

test("Daily care tile opens its Hygiene routine and mirrors authoritative completion", async ({ page }) => {
  await fresh(page, "2026-10-12T08:20:00");
  await week(page);
  const morning = page.locator(".df2-week-day").first().locator('[data-week-care="morning"]');
  await expect(morning).not.toHaveClass(/done/);
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const record = store.records["2026-10-12"].morning;
    if (!record) throw Error("Missing morning hygiene record");
    for (const task of record.scheduledTasks) if (!task.optional) record.states[task.id] = "done";
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  await expect(morning).toHaveClass(/done/);
  await morning.click();
  await page.getByRole("dialog", { name: "Ranní hygiena" }).getByRole("button", { name: "Otevřít v Hygieně" }).click();
  await expect(page.getByRole("tab", { name: "Dnes", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-hygiene-routine="morning"]')).toContainText("Hotovo");
});

test("Daily blocks move only within their own day, persist, and preserve older Sunday placements", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, times: { "2026-10-18": { "hygiene-day": "18:00" } } })), CARE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  const days = await week(page);
  const friday = days.nth(4).locator('[data-week-care="morning"]');
  await expect(friday).toHaveAttribute("draggable", "true");
  await dragCare(page, 4, 5, "morning", "16:00");
  await expect(friday).toHaveAttribute("aria-label", "Ranní hygiena, 09:00–09:20");

  await dragCare(page, 4, 4, "morning", "16:00");
  await expect(friday).toHaveAttribute("aria-label", "Ranní hygiena, 16:00–16:20");
  const times = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).times, CARE_KEY);
  expect(times["2026-10-16"].morning).toBe("16:00");
  expect(times["2026-10-18"]["hygiene-day"]).toBe("18:00");
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]')).toHaveAttribute("aria-label", "Ranní hygiena, 16:00–16:20");
  await expect(page.locator('[data-week-care="hygiene-day"]')).toContainText("18:00–18:30");
});

test("A task with its own daily schedule keeps the Morning care block visible even when the parent is weekly", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const morning = store.routines.find(item => item.id === "morning");
    morning.schedule = { type: "weekly", weekday: 0 };
    morning.tasks[0].schedule = { type: "daily" };
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  await expect(page.locator('[data-week-care="evening"]')).toHaveCount(7);
});

test("Disabling a daily Hygiene source hides only that routine's calendar blocks", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.find(item => item.id === "evening").active = false;
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(page.locator('[data-week-care="evening"]')).toHaveCount(0);
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  await expect(page.locator('[data-week-care="cleaning-sunday"]')).toHaveCount(1);
});

test("Malformed daily care placement stays read-only, and invalid Sundays cannot be saved", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({version: 1, times: {"2026-10-12": {"hygiene-day": "18:00"}}})), CARE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator('[data-week-care="morning"]').first()).toHaveAttribute("draggable", "false");
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
  const saved = await page.evaluate(key => localStorage.getItem(key), CARE_KEY);
  expect(saved).toContain('"hygiene-day"');
});

test("Sunday Hygiene and Cleaning appear as two 30-minute Week reservations, without duplicate calendar tasks", async ({ page }) => {
  await fresh(page);
  const days = await week(page);
  await expect(page.locator("[data-week-care]")).toHaveCount(23);
  for (let i = 0; i < 6; i++) await expect(days.nth(i).locator("[data-week-care]")).toHaveCount(3);
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("10:00–10:30");
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("Nedělní hygiena");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("10:30–11:00");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("Nedělní úklid");
  const calendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(calendar.plans).flat().filter(task => task.routineId === "hygiene-day" || task.routineId === "cleaning-sunday")).toHaveLength(0);

  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await expect(page.locator("[data-week-care]")).toHaveCount(23);
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  // Product now retains historical projections; before the Cleaning routine's
  // startsOn date, only the two daily Hygiene routines and Sunday Hygiene appear.
  await expect(page.locator("[data-week-care]")).toHaveCount(15);
  await expect(page.locator(".df2-week-day").first().locator('[data-week-care="morning"]')).toBeVisible();
  await expect(page.locator("[data-week-care='cleaning-daily']")).toHaveCount(0);
  const previousCalendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(previousCalendar.plans).flat().filter(task =>
    task.routineId === "hygiene-day" || task.routineId === "cleaning-sunday")).toHaveLength(0);
});

test("clicking each Sunday reservation opens the original Hygiene or Cleaning routine", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.locator('[data-week-care="cleaning-sunday"]').click();
  await page.getByRole("dialog", { name: "Nedělní úklid" }).getByRole("button", { name: "Otevřít v Hygieně" }).click();
  await expect(page.getByRole("tab", { name: "Úklid" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-cleaning-routine="cleaning-sunday"]')).toBeVisible();

  await week(page);
  await page.locator('[data-week-care="hygiene-day"]').click();
  await page.getByRole("dialog", { name: "Nedělní hygiena" }).getByRole("button", { name: "Otevřít v Hygieně" }).click();
  await expect(page.getByRole("tab", { name: "Správa rutin" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#hygiene-routine-hygiene-day")).toBeVisible();
});

test("Sunday reservation reflects Hygiene completion, not its own independent checkmark", async ({ page }) => {
  await fresh(page, "2026-10-18T09:00:00");
  await week(page);
  const cleaning = page.locator('[data-week-care="cleaning-sunday"]');
  await expect(cleaning).not.toHaveClass(/done/);
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    const record = store.records["2026-10-18"]["cleaning-sunday"];
    if (!record) throw Error("Missing authoritative Sunday cleaning record");
    for (const task of record.scheduledTasks) if (!task.optional) record.states[task.id] = "done";
    localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  await expect(cleaning).toHaveClass(/done/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(saved.records["2026-10-18"]["cleaning-sunday"].scheduledTasks).toHaveLength(13);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator('[data-week-care="cleaning-sunday"]')).toHaveClass(/done/);
});

test("disabling a Hygiene source routine removes only its linked Week reservation", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.evaluate((key) => {
    const store = JSON.parse(localStorage.getItem(key));
    const routine = store.routines.find(item => item.id === "cleaning-sunday");
    if (!routine) throw Error("Missing Sunday cleaning definition");
    routine.active = false;
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await expect(page.locator('[data-week-care="cleaning-sunday"]')).toHaveCount(0);
  await expect(page.locator('[data-week-care="hygiene-day"]')).toHaveCount(1);
});


test("Sunday Hygiene moves to a free weekday without duplicating recurrence or losing its origin", async ({ page }) => {
  await fresh(page);
  const days=await week(page);
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toHaveAttribute("draggable","true");
  await dragCare(page,6,0,"hygiene-day","18:00");
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  await expect(days.nth(0).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 18:00–18:30");
  const careStore=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(careStore.moves["2026-10-18"]["hygiene-day"]).toBe("2026-10-12");
  const hygiene=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(hygiene.suppressedDates["2026-10-18"]).toContain("hygiene-day");
  expect(Object.entries(hygiene.taskReschedules).some(([key,value])=>
    key.startsWith("2026-10-18|hygiene-day|")&&value==="2026-10-12")).toBe(true);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(0).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 18:00–18:30");
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
});

test("corrupted placement data leaves Sunday reservations visible but read-only", async ({ page }) => {
  await fresh(page);
  await page.evaluate(key => localStorage.setItem(key, "{broken-json"), CARE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator("[data-week-care]")).toHaveCount(23);
  await expect(page.locator('[data-week-care="hygiene-day"]')).toHaveAttribute("draggable", "false");
  await expect(page.locator('[data-week-care="evening"]').first()).toHaveAttribute("draggable", "false");
  expect(await page.evaluate(key => localStorage.getItem(key), CARE_KEY)).toBe("{broken-json");
});

test("Sunday reservation typography fits its actual 30-minute time geometry", async ({ page }) => {
  await fresh(page);
  await week(page);
  const tile = page.locator('[data-week-care="hygiene-day"]');
  await expect(tile).toHaveCSS("min-height", "0px");
  await expect(tile.locator("strong")).toHaveCSS("font-size", "9px");
  await expect(tile.locator("span")).toHaveCSS("font-size", "7px");
});

test("yesterday's repeated Hygiene stays in Week and can be checked retroactively without changing other dates", async ({ page }) => {
  await fresh(page, "2026-11-11T12:00:00");
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    state.routines.find(item => item.id === "cleaning-daily").startsOn = "2026-11-01";
    state.lastMaterializedDate = "2026-11-09";
    localStorage.setItem(key, JSON.stringify(state));
  }, HYGIENE_KEY);
  await seedRepeatedHygiene(page);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);

  // Tuesday, 10 November is in the past; its recurring reservation used to
  // disappear entirely, even though the authoritative Hygiene history remains.
  const yesterday = page.locator(".df2-week-day").nth(1);
  const repeated = yesterday.locator('[data-week-care="' + REPEATED_CARE_ID + '"]');
  await expect(repeated).toBeVisible();
  await expect(repeated).not.toHaveClass(/done/);
  await repeated.click();

  const editor = page.getByRole("dialog", { name: "Opakovaná rutina" });
  await expect(editor.locator("[data-week-care-history]")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Uložit čas" })).toBeEnabled();
  await editor.getByRole("button", { name: "Označit celou rutinu hotovou" }).click();

  await expect(editor.getByRole("button", { name: "Vrátit celou rutinu jako nesplněnou" })).toBeVisible();
  await expect(repeated).toHaveClass(/done/);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  const record = stored.records["2026-11-10"][REPEATED_ID];
  expect(record).toBeTruthy();
  expect(record.scheduledTasks.filter(item => !item.optional)).not.toHaveLength(0);
  for (const task of record.scheduledTasks.filter(item => !item.optional)) {
    expect(record.states[task.id]).toBe("done");
    expect(record.completedOn[task.id]).toBe("2026-11-10");
  }
  expect(Object.keys(stored.records["2026-11-11"]?.[REPEATED_ID]?.states ?? {})).toHaveLength(0);

  const first = record.scheduledTasks.find(item => !item.optional);
  await editor.getByRole("button", { name: "Odškrtnout " + first.title }).click();
  await expect(repeated).not.toHaveClass(/done/);
  await editor.getByRole("button", { name: "Označit hotovo " + first.title }).click();
  await expect(repeated).toHaveClass(/done/);

  await editor.getByRole("button", { name: "Zavřít" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-care="' + REPEATED_CARE_ID + '"]')).toHaveClass(/done/);
});

test("past daily Cleaning can be marked complete from Week without affecting today's routine", async ({ page }) => {
  await fresh(page, "2026-11-11T12:00:00");
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.find(item => item.id === "cleaning-daily").startsOn = "2026-11-01";
    store.lastMaterializedDate = "2026-11-09";
    localStorage.setItem(key, JSON.stringify(store));
  }, HYGIENE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await week(page);

  const previous = page.locator(".df2-week-day").nth(1).locator('[data-week-care="cleaning-daily"]');
  await expect(previous).toBeVisible();
  await previous.click();
  const modal = page.getByRole("dialog", { name: "Denní úklid" });
  await modal.getByRole("button", { name: "Označit celou rutinu hotovou" }).click();
  await expect(previous).toHaveClass(/done/);

  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(stored.records["2026-11-10"]["cleaning-daily"].states["cleaning-make-bed"]).toBe("done");
  expect(stored.records["2026-11-11"]["cleaning-daily"].states["cleaning-make-bed"]).toBeUndefined();
  await expect(page.locator(".df2-week-day").nth(2).locator('[data-week-care="cleaning-daily"]')).not.toHaveClass(/done/);
});

test("completing today's custom rolling Hygiene keeps its Week block visible and schedules next interval", async ({ page }) => {
  await fresh(page, "2026-10-12T12:00:00");
  const routineId = "hygiene-routine-custom-rolling";
  const weekId = "rolling:" + routineId;
  await page.evaluate(({key,id}) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.routines.push({
      id, title: "Třídenní péče", active: true, order: 37,
      schedule: {type:"rolling",everyDays:3,unit:"days",anchorDate:"2026-10-12"},
      tasks: [{id:"rolling-step-e2e",title:"Ošetření pleti",section:"Péče",
        active:true,optional:false,allowSkip:false}],
    });
    localStorage.setItem(key, JSON.stringify(state));
  }, {key:HYGIENE_KEY,id:routineId});
  await page.reload({waitUntil:"networkidle"});
  await week(page);

  const block = page.locator(".df2-week-day").first().locator('[data-week-care="'+weekId+'"]');
  await expect(block).toBeVisible();
  await block.click();
  const dialog = page.getByRole("dialog",{name:"Třídenní péče"});
  await dialog.getByRole("button",{name:"Označit celou rutinu hotovou"}).click();
  await expect(block).toHaveClass(/done/);
  await expect(dialog.getByRole("button",{name:"Odškrtnout Ošetření pleti"})).toBeEnabled();

  const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  const saved=after.records["2026-10-12"][routineId];
  expect(saved.archived).not.toBe(true);
  expect(saved.states["rolling-step-e2e"]).toBe("done");
  expect(saved.completedOn["rolling-step-e2e"]).toBe("2026-10-12");

  await dialog.getByRole("button",{name:"Zavřít"}).click();
  await page.clock.setFixedTime(new Date("2026-10-13T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").first().locator('[data-week-care="'+weekId+'"]')).toHaveClass(/done/);
  const retained=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(retained.records["2026-10-12"][routineId].archived).not.toBe(true);
});

test("Yesterday's recorded care stays completed while its calendar time can be moved by drag", async ({page})=>{
  await fresh(page,"2026-11-11T12:00:00");
  await week(page);
  const day=page.locator(".df2-week-day").nth(1);
  const morning=day.locator('[data-week-care="morning"]');
  await expect(morning).toBeVisible();
  // Use the real retroactive Week check-in; it materializes the exact
  // historical snapshot and preserves all Hygiene invariants.
  await morning.click();
  const dialog=page.getByRole("dialog",{name:"Ranní hygiena"});
  await dialog.getByRole("button",{name:"Označit celou rutinu hotovou"}).click();
  await expect(morning).toHaveClass(/done/);
  await dialog.getByRole("button",{name:"Zavřít"}).click();
  await expect(morning).toHaveAttribute("draggable","true");
  await dragCare(page,1,1,"morning","17:00");
  await expect(morning).toHaveAttribute("aria-label","Ranní hygiena, 17:00–17:20");
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(Object.values(saved.records["2026-11-10"].morning.completedOn)).toContain("2026-11-10");
  expect(saved.records["2026-11-11"].morning.states).toEqual({});
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-care="morning"]'))
    .toHaveAttribute("aria-label","Ranní hygiena, 17:00–17:20");
});

test("Moving a Sunday occurrence back to Sunday cancels the one-off exception without corrupting care storage", async ({page})=>{
  await fresh(page);
  const days=await week(page);
  await dragCare(page,6,0,"hygiene-day","18:00");
  await expect(days.nth(0).locator('[data-week-care="hygiene-day"]')).toBeVisible();
  await dragCare(page,0,6,"hygiene-day","17:00");
  await expect(days.nth(0).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
  const data=await page.evaluate(()=>({
    care:JSON.parse(localStorage.getItem("dayframe-week-care-v1")),
    hygiene:JSON.parse(localStorage.getItem("dayframe-hygiene-v1")),
  }));
  expect(data.care.moves?.["2026-10-18"]?.["hygiene-day"]).toBeUndefined();
  expect(data.hygiene.suppressedDates?.["2026-10-18"]??[]).not.toContain("hygiene-day");
  expect(Object.keys(data.hygiene.taskReschedules).filter(key=>key.startsWith("2026-10-18|hygiene-day|"))).toHaveLength(0);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
  await expect(page.locator('[data-week-care="morning"]')).toHaveCount(7);
});

test("Sunday Cleaning moved to a weekday can still be removed from that day", async ({page})=>{
  await fresh(page);
  const days=await week(page);
  await dragCare(page,6,0,"cleaning-sunday","19:00");
  const moved=days.nth(0).locator('[data-week-care="cleaning-sunday"]');
  await expect(moved).toBeVisible();
  await moved.click();
  const dialog=page.getByRole("dialog",{name:"Nedělní úklid"});
  await dialog.getByRole("button",{name:"Odebrat jen tento den"}).click();
  await expect(moved).toHaveCount(0);
  const store=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(store.hidden["2026-10-12"]).toContain("cleaning-sunday");
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").first().locator('[data-week-care="cleaning-sunday"]')).toHaveCount(0);
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="cleaning-sunday"]')).toHaveCount(0);
  const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(after.hidden["2026-10-12"]).toContain("cleaning-sunday");
});

test("A shifted unhandled historical Sunday snapshot no longer counts as missed on its original date", async ({page})=>{
  await fresh(page,"2026-11-11T12:00:00");
  await page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem(key));
    const routine=store.routines.find(item=>item.id==="hygiene-day");
    if(!routine) throw Error("Missing Sunday routine");
    store.records["2026-11-08"]={...(store.records["2026-11-08"]??{}),
      "hygiene-day":{
        date:"2026-11-08",routineId:"hygiene-day",routineTitle:routine.title,
        domain:routine.domain,states:{},scheduledTasks:routine.tasks
          .filter(item=>item.active).map(item=>({
            id:item.id,title:item.title,section:item.section,optional:item.optional,
            allowSkip:item.allowSkip,scheduleType:(item.schedule??routine.schedule).type,
          })),
      },
    };
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },HYGIENE_KEY);
  const days=await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toBeVisible();
  await dragCare(page,6,0,"hygiene-day","18:00");
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  const history=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(history.records["2026-11-08"]?.["hygiene-day"]).toBeUndefined();
  expect(history.suppressedDates["2026-11-08"]).toContain("hygiene-day");
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(page.locator(".df2-week-day").first().locator('[data-week-care="hygiene-day"]')).toBeVisible();
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(persisted.records["2026-11-08"]?.["hygiene-day"]).toBeUndefined();
});


test("A rolling routine cannot move before its anchor and completing the anchor still schedules the next interval", async ({page})=>{
  await fresh(page,"2026-10-12T12:00:00");
  const routineId="hygiene-routine-rolling-anchor-guard";
  const blockId="rolling:"+routineId;
  await page.evaluate(({key,id})=>{
    const store=JSON.parse(localStorage.getItem(key));
    store.routines.push({
      id,title:"Třídenní ochranná rutina",active:true,order:85,
      schedule:{type:"rolling",everyDays:3,unit:"days",anchorDate:"2026-10-14"},
      tasks:[{id:"anchor-guard-task",title:"Kontrola kotvy",section:"Péče",
        active:true,optional:false,allowSkip:false}],
    });
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },{key:HYGIENE_KEY,id:routineId});
  const days=await week(page);
  const due=days.nth(2).locator('[data-week-care="'+blockId+'"]');
  await expect(due).toBeVisible();
  await due.click();
  const dialog=page.getByRole("dialog",{name:"Třídenní ochranná rutina"});
  await dialog.getByLabel("Den výskytu").fill("2026-10-12");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Přesun se nepodařilo uložit");
  await expect(due).toBeVisible();
  const unchanged=await page.evaluate(({key,id})=>{
    const store=JSON.parse(localStorage.getItem(key));
    return {
      reschedules:Object.entries(store.taskReschedules).filter(([origin])=>origin.includes("|"+id+"|")),
      suppressed:store.suppressedDates["2026-10-14"]??[],
    };
  },{key:HYGIENE_KEY,id:routineId});
  expect(unchanged.reschedules).toHaveLength(0);
  expect(unchanged.suppressed).not.toContain(routineId);
  await dialog.getByRole("button",{name:"Zavřít"}).click();

  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  const updatedDays=await week(page);
  await updatedDays.nth(2).locator('[data-week-care="'+blockId+'"]').click();
  const active=page.getByRole("dialog",{name:"Třídenní ochranná rutina"});
  await active.getByRole("button",{name:"Označit celou rutinu hotovou"}).click();
  const recorded=await page.evaluate(({key,id})=>{
    const store=JSON.parse(localStorage.getItem(key));
    return store.records["2026-10-14"]?.[id]?.states["anchor-guard-task"];
  },{key:HYGIENE_KEY,id:routineId});
  expect(recorded).toBe("done");
  await active.getByRole("button",{name:"Zavřít"}).click();
  await expect(updatedDays.nth(5).locator('[data-week-care="'+blockId+'"]')).toBeVisible();
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(5).locator('[data-week-care="'+blockId+'"]')).toBeVisible();
});


test("A moved Sunday origin cannot silently swallow another Sunday's occurrence",async({page})=>{
  await fresh(page,"2026-11-11T12:00:00");
  const days=await week(page);
  await days.nth(6).locator('[data-week-care="hygiene-day"]').click();
  let editor=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await editor.getByLabel("Den výskytu").fill("2026-11-16");
  await editor.getByLabel("Začátek bloku").fill("18:00");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);

  // A second, distinct Sunday occurrence must not land on the original
  // suppressed Sunday; doing so would make it disappear after saving.
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(days.nth(0).locator('[data-week-care="hygiene-day"]')).toBeVisible();
  const nextSunday=days.nth(6).locator('[data-week-care="hygiene-day"]');
  await expect(nextSunday).toBeVisible();
  await nextSunday.click();
  editor=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await editor.getByLabel("Den výskytu").fill("2026-11-15");
  await editor.getByLabel("Začátek bloku").fill("19:00");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  await expect(editor.getByRole("alert")).toContainText("Přesun se nepodařilo uložit");
  await expect(nextSunday).toBeVisible();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(saved.suppressedDates["2026-11-15"]).toContain("hygiene-day");
  expect(saved.suppressedDates["2026-11-22"]??[]).not.toContain("hygiene-day");
  expect(Object.entries(saved.taskReschedules).some(([origin,date])=>
    origin.startsWith("2026-11-15|hygiene-day|")&&date==="2026-11-16")).toBe(true);
  expect(Object.keys(saved.taskReschedules).some(origin=>
    origin.startsWith("2026-11-22|hygiene-day|"))).toBe(false);
  await editor.getByRole("button",{name:"Zavřít"}).click();
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(page.locator(".df2-week-day").nth(0).locator('[data-week-care="hygiene-day"]')).toBeVisible();
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]')).toBeVisible();
});

test("Moving an untouched past Sunday into older materialized history keeps exactly one missed-day record",async({page})=>{
  await fresh(page,"2026-11-11T12:00:00");
  await page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem(key));
    const routine=store.routines.find(item=>item.id==="hygiene-day");
    if(!routine)throw Error("Missing Sunday routine");
    store.lastMaterializedDate="2026-11-11";
    store.records["2026-11-08"]={...(store.records["2026-11-08"]??{}),
      "hygiene-day":{
        date:"2026-11-08",routineId:"hygiene-day",routineTitle:routine.title,
        domain:routine.domain,states:{},scheduledTasks:routine.tasks
          .filter(item=>item.active).map(item=>({
            id:item.id,title:item.title,section:item.section,optional:item.optional,
            allowSkip:item.allowSkip,scheduleType:(item.schedule??routine.schedule).type,
          })),
      },
    };
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },HYGIENE_KEY);
  const before=await page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem(key));
    return Object.values(store.records).filter(day=>day?.["hygiene-day"]).length;
  },HYGIENE_KEY);
  const days=await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await days.nth(6).locator('[data-week-care="hygiene-day"]').click();
  const editor=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await editor.getByLabel("Den výskytu").fill("2026-11-02");
  await editor.getByLabel("Začátek bloku").fill("18:00");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  await expect(days.nth(0).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 18:00–18:30");
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(stored.lastMaterializedDate).toBe("2026-11-11");
  expect(stored.records["2026-11-08"]?.["hygiene-day"]).toBeUndefined();
  expect(stored.records["2026-11-02"]?.["hygiene-day"]).toBeDefined();
  expect(stored.records["2026-11-02"]["hygiene-day"].states).toEqual({});
  expect(stored.records["2026-11-02"]["hygiene-day"].scheduledTasks.every(task=>
    task.originDate==="2026-11-08")).toBe(true);
  expect(Object.values(stored.records).filter(day=>day?.["hygiene-day"]).length).toBe(before);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(page.locator(".df2-week-day").nth(0).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 18:00–18:30");
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(persisted.records["2026-11-02"]?.["hygiene-day"]).toBeDefined();
  expect(persisted.records["2026-11-08"]?.["hygiene-day"]).toBeUndefined();

  // A later cancellation must restore that same unhandled historical record
  // even though this week's dates are no longer re-materialized automatically.
  await page.locator(".df2-week-day").nth(0).locator('[data-week-care="hygiene-day"]').click();
  const undo=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await undo.getByLabel("Den výskytu").fill("2026-11-08");
  await undo.getByLabel("Začátek bloku").fill("17:00");
  await undo.getByRole("button",{name:"Uložit čas"}).click();
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
  const restored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(restored.records["2026-11-08"]?.["hygiene-day"]).toBeDefined();
  expect(restored.records["2026-11-02"]?.["hygiene-day"]).toBeUndefined();
  expect(restored.records["2026-11-08"]["hygiene-day"].states).toEqual({});
  expect(Object.values(restored.records).filter(day=>day?.["hygiene-day"]).length).toBe(before);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(page.locator(".df2-week-day").nth(6).locator('[data-week-care="hygiene-day"]'))
    .toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
});

test("Hygiene-postponed Sunday step can be edited, moved and hidden on an extra weekday", async ({page}) => {
  await fresh(page);
  const days = await week(page);
  await dragCare(page,6,0,"hygiene-day","18:00");

  // A later postponement in Hygiene redirects just one step to Tuesday.
  // The remaining Sunday steps retain their original Monday Week trace.
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const routine = store.routines.find(item => item.id === "hygiene-day");
    const task = routine.tasks.find(item => item.active);
    const trace = "2026-10-18|hygiene-day|" + task.id;
    if (store.taskReschedules[trace] !== "2026-10-12") throw Error("Missing Sunday move");
    store.taskReschedules[trace] = "2026-10-13";
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);

  const tuesday = days.nth(1).locator('[data-week-care="hygiene-day"]');
  await expect(tuesday).toBeVisible();
  await tuesday.click();
  let dialog = page.getByRole("dialog",{name:"Nedělní hygiena"});
  await dialog.getByLabel("Začátek bloku").fill("17:00");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();
  await expect(tuesday).toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");

  await tuesday.click();
  dialog = page.getByRole("dialog",{name:"Nedělní hygiena"});
  await dialog.getByLabel("Den výskytu").fill("2026-10-14");
  await dialog.getByRole("button",{name:"Uložit čas"}).click();

  const wednesday = days.nth(2).locator('[data-week-care="hygiene-day"]');
  await expect(tuesday).toHaveCount(0);
  await expect(wednesday).toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  const persisted = page.locator(".df2-week-day").nth(2).locator('[data-week-care="hygiene-day"]');
  await expect(persisted).toHaveAttribute("aria-label","Nedělní hygiena, 17:00–17:30");
  await persisted.click();
  await page.getByRole("dialog",{name:"Nedělní hygiena"})
    .getByRole("button",{name:"Odebrat jen tento den"}).click();
  await expect(persisted).toHaveCount(0);

  const data = await page.evaluate(() => ({
    hygiene:JSON.parse(localStorage.getItem("dayframe-hygiene-v1")),
    care:JSON.parse(localStorage.getItem("dayframe-week-care-v1")),
  }));
  expect(data.care.moves["2026-10-18"]["hygiene-day"]).toBe("2026-10-12");
  expect(data.care.hidden["2026-10-14"]).toContain("hygiene-day");
  expect(Object.entries(data.hygiene.taskReschedules)
    .filter(([key]) => key.startsWith("2026-10-18|hygiene-day|"))
    .some(([,destination]) => destination === "2026-10-14")).toBe(false);
  expect(data.hygiene.suppressedDates["2026-10-14"]).toContain("hygiene-day");
  expect(data.hygiene.records["2026-10-14"]?.["hygiene-day"]).toBeUndefined();
});

test("Week retains valid positions after Hygiene postpones the same step again", async ({page}) => {
  await fresh(page);
  const days = await week(page);
  await dragCare(page,6,0,"hygiene-day","18:00");

  const trace = await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const routine = store.routines.find(item => item.id === "hygiene-day");
    const step = routine.tasks.find(item => item.active);
    const id = "2026-10-18|hygiene-day|" + step.id;
    if (store.taskReschedules[id] !== "2026-10-12") throw Error("Missing move");
    store.taskReschedules[id] = "2026-10-13";
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
    return id;
  },HYGIENE_KEY);
  const tuesday = days.nth(1).locator('[data-week-care="hygiene-day"]');
  await expect(tuesday).toBeVisible();
  await tuesday.click();
  const editor=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await editor.getByLabel("Začátek bloku").fill("17:00");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(saved.provenance["2026-10-13"]["hygiene-day"]).toBe("2026-10-18");

  await page.evaluate(({key,trace})=>{
    const store=JSON.parse(localStorage.getItem(key));
    store.taskReschedules[trace]="2026-10-14";
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },{key:HYGIENE_KEY,trace});
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
  const wednesday=page.locator(".df2-week-day").nth(2).locator('[data-week-care="hygiene-day"]');
  await expect(wednesday).toBeVisible();
  await wednesday.click();
  const next=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await expect(next.getByRole("button",{name:"Uložit čas"})).toBeEnabled();
  await next.getByLabel("Začátek bloku").fill("19:00");
  await next.getByRole("button",{name:"Uložit čas"}).click();
  await expect(wednesday).toHaveAttribute("aria-label","Nedělní hygiena, 19:00–19:30");
  await wednesday.click();
  await page.getByRole("dialog",{name:"Nedělní hygiena"})
    .getByRole("button",{name:"Odebrat jen tento den"}).click();
  await expect(wednesday).toHaveCount(0);
  await page.reload({waitUntil:"networkidle"});
  await week(page);
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(state.hidden["2026-10-14"]).toContain("hygiene-day");
  expect(state.provenance["2026-10-13"]["hygiene-day"]).toBe("2026-10-18");
});

test("Returning only a postponed Sunday step cannot restore duplicate routine tasks",async({page})=>{
  await fresh(page);
  const days=await week(page);
  await dragCare(page,6,0,"hygiene-day","18:00");
  await page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem(key));
    const step=store.routines.find(r=>r.id==="hygiene-day").tasks.find(t=>t.active);
    const trace="2026-10-18|hygiene-day|"+step.id;
    if (store.taskReschedules[trace]!=="2026-10-12")throw Error("Missing move");
    store.taskReschedules[trace]="2026-10-13";
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },HYGIENE_KEY);
  const tuesday=days.nth(1).locator('[data-week-care="hygiene-day"]');
  await expect(tuesday).toBeVisible();
  await tuesday.click();
  const editor=page.getByRole("dialog",{name:"Nedělní hygiena"});
  await editor.getByLabel("Den výskytu").fill("2026-10-18");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  await expect(editor.getByRole("alert")).toContainText("Přesun se nepodařilo uložit");
  const history=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(history.suppressedDates["2026-10-18"]).toContain("hygiene-day");
  expect(Object.entries(history.taskReschedules)
    .filter(([key])=>key.startsWith("2026-10-18|hygiene-day|"))
    .some(([,date])=>date==="2026-10-12")).toBe(true);
  await editor.getByRole("button",{name:"Zavřít"}).click();
  await expect(tuesday).toBeVisible();
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
});

test("Rolling occurrence cannot move before the latest completed interval",async({page})=>{
  await fresh(page,"2026-11-13T12:00:00");
  const id="hygiene-routine-cadence-history";
  const careId="rolling:"+id;
  await page.evaluate(({key,id})=>{
    const store=JSON.parse(localStorage.getItem(key));
    store.routines.push({
      id,title:"Třídenní péče - kadence",active:true,order:91,
      schedule:{type:"rolling",everyDays:3,unit:"days",anchorDate:"2026-11-01"},
      tasks:[{id:"cadence-step",title:"Ošetření",section:"Péče",active:true,optional:false,allowSkip:false}],
    });
    for(const date of ["2026-11-01","2026-11-04","2026-11-07","2026-11-10"]){
      store.records[date]={
        ...(store.records[date]??{}),
        [id]:{
          date,routineId:id,routineTitle:"Třídenní péče - kadence",
          scheduledTasks:[{id:"cadence-step",title:"Ošetření",section:"Péče",optional:false,allowSkip:false,scheduleType:"rolling"}],
          states:{"cadence-step":"done"},
          completedOn:{"cadence-step":date},
        },
      };
    }
    localStorage.setItem(key,JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  },{key:HYGIENE_KEY,id});
  await page.reload({waitUntil:"networkidle"});
  const days=await week(page);
  const due=days.nth(4).locator('[data-week-care="'+careId+'"]');
  await expect(due).toBeVisible();
  await due.click();
  const editor=page.getByRole("dialog",{name:"Třídenní péče - kadence"});
  await editor.getByLabel("Den výskytu").fill("2026-11-09");
  await editor.getByRole("button",{name:"Uložit čas"}).click();
  await expect(editor.getByRole("alert")).toContainText("Přesun se nepodařilo uložit");
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),HYGIENE_KEY);
  expect(saved.suppressedDates["2026-11-13"]??[]).not.toContain(id);
  expect(Object.entries(saved.taskReschedules).filter(([key])=>key.includes("|"+id+"|"))).toHaveLength(0);
  await editor.getByRole("button",{name:"Zavřít"}).click();
  await expect(due).toBeVisible();
});

test("Past evening hygiene can be removed completely without a missed day in Hygiene", async ({ page }) => {
  await fresh(page, "2026-11-13T12:00:00");
  const days = await week(page);
  const thursday = days.nth(3);
  const removed = thursday.locator('[data-week-care="evening"]');
  await expect(removed).toHaveCount(1);
  await removed.click();
  const dialog = page.getByRole("dialog", { name: "Večerní hygiena" });
  const remove = dialog.getByRole("button", { name: "Odebrat jen tento den" });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(removed).toHaveCount(0);
  await expect(days.nth(4).locator('[data-week-care="evening"]')).toHaveCount(1);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(saved.suppressedDates["2026-11-12"]).toContain("evening");
  expect(saved.records["2026-11-12"]?.evening).toBeUndefined();

  await page.reload({ waitUntil: "networkidle" });
  const reloaded = await week(page);
  await expect(reloaded.nth(3).locator('[data-week-care="evening"]')).toHaveCount(0);
  await expect(reloaded.nth(4).locator('[data-week-care="evening"]')).toHaveCount(1);
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(after.records["2026-11-12"]?.evening).toBeUndefined();
});

test("Removing a completed past Hygiene day asks before deleting its recorded work", async ({ page }) => {
  await fresh(page, "2026-11-13T12:00:00");
  const days = await week(page);
  const thursday = days.nth(3);
  await thursday.locator('[data-week-care="evening"]').click();
  const dialog = page.getByRole("dialog", { name: "Večerní hygiena" });
  await dialog.getByRole("button", { name: "Označit celou rutinu hotovou" }).click();
  const remove = dialog.getByRole("button", { name: "Odebrat jen tento den" });
  page.once("dialog", confirmation => confirmation.dismiss());
  await remove.click();
  await expect(thursday.locator('[data-week-care="evening"]')).toHaveCount(1);
  const preserved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(Object.keys(preserved.records["2026-11-12"].evening.states).length).toBeGreaterThan(0);
  page.once("dialog", confirmation => confirmation.accept());
  await remove.click();
  await expect(thursday.locator('[data-week-care="evening"]')).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(saved.records["2026-11-12"]?.evening).toBeUndefined();
  expect(saved.suppressedDates["2026-11-12"]).toContain("evening");
});

test("Deleting a completed rolling occurrence keeps the following due date", async ({ page }) => {
  await fresh(page, "2026-11-13T12:00:00");
  const id = "hygiene-routine-remove-cadence";
  const taskId = "remove-cadence-step";
  const careId = "rolling:" + id;
  await page.evaluate(({ key, id, taskId }) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.push({
      id, title: "Třídenní péče pro smazání", active: true, order: 94,
      schedule: { type: "rolling", everyDays: 3, unit: "days", anchorDate: "2026-11-01" },
      tasks: [{ id: taskId, title: "Ošetření", section: "Péče", active: true, optional: false, allowSkip: false }],
    });
    store.records["2026-11-10"] = {
      ...(store.records["2026-11-10"] ?? {}),
      [id]: {
        date: "2026-11-10", routineId: id, routineTitle: "Třídenní péče pro smazání",
        scheduledTasks: [{ id: taskId, title: "Ošetření", section: "Péče", optional: false, allowSkip: false, scheduleType: "rolling" }],
        states: { [taskId]: "done" }, completedOn: { [taskId]: "2026-11-10" },
      },
    };
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, { key: HYGIENE_KEY, id, taskId });
  await page.reload({ waitUntil: "networkidle" });
  const days = await week(page);
  const past = days.nth(1).locator('[data-week-care="' + careId + '"]');
  const next = days.nth(4).locator('[data-week-care="' + careId + '"]');
  await expect(past).toBeVisible();
  await expect(next).toBeVisible();
  await past.click();
  page.once("dialog", confirmation => confirmation.accept());
  await page.getByRole("dialog", { name: "Třídenní péče pro smazání" })
    .getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(past).toHaveCount(0);
  await expect(next).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  const after = await week(page);
  await expect(after.nth(4).locator('[data-week-care="' + careId + '"]')).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(saved.records["2026-11-10"]?.[id]).toBeUndefined();
  expect(saved.suppressedDates["2026-11-10"]).toContain(id);
  expect(saved.rollingCadenceAnchors[id + "|" + taskId]).toBe("2026-11-10");
});

test("Skipping an untouched rolling occurrence schedules its next interval", async ({ page }) => {
  await fresh(page, "2026-11-13T12:00:00");
  const id = "hygiene-routine-remove-initial";
  const taskId = "remove-initial-step";
  await page.evaluate(({ key, id, taskId }) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.push({
      id, title: "Třídenní péče bez historie", active: true, order: 95,
      schedule: { type: "rolling", everyDays: 3, unit: "days", anchorDate: "2026-11-10" },
      tasks: [{ id: taskId, title: "Ošetření", section: "Péče", active: true, optional: false, allowSkip: false }],
    });
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, { key: HYGIENE_KEY, id, taskId });
  await page.reload({ waitUntil: "networkidle" });
  const days = await week(page);
  const careId = "rolling:" + id;
  const past = days.nth(1).locator('[data-week-care="' + careId + '"]');
  const next = days.nth(4).locator('[data-week-care="' + careId + '"]');
  await expect(past).toBeVisible();
  await expect(next).toHaveCount(0);
  await past.click();
  await page.getByRole("dialog", { name: "Třídenní péče bez historie" })
    .getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(past).toHaveCount(0);
  await expect(next).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(saved.rollingCadenceAnchors[id + "|" + taskId]).toBe("2026-11-10");
  await page.reload({ waitUntil: "networkidle" });
  const after = await week(page);
  await expect(after.nth(4).locator('[data-week-care="' + careId + '"]')).toBeVisible();
});

test("A paused routine's recorded past day can still be deleted from Week and Hygiene", async ({ page }) => {
  await fresh(page, "2026-11-13T12:00:00");
  const days = await week(page);
  const past = days.nth(3).locator('[data-week-care="evening"]');
  await past.click();
  const editor = page.getByRole("dialog", { name: "Večerní hygiena" });
  await editor.getByRole("button", { name: /Označit hotovo/ }).first().click();
  await editor.getByRole("button", { name: "Zavřít" }).click();
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    store.routines.find(routine => routine.id === "evening").active = false;
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  const reloaded = await week(page);
  const recorded = reloaded.nth(3).locator('[data-week-care="evening"]');
  await expect(recorded).toBeVisible();
  await recorded.click();
  page.once("dialog", confirmation => confirmation.accept());
  await page.getByRole("dialog", { name: "Večerní hygiena" })
    .getByRole("button", { name: "Odebrat jen tento den" }).click();
  await expect(recorded).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(saved.suppressedDates["2026-11-12"]).toContain("evening");
  expect(saved.records["2026-11-12"]?.evening).toBeUndefined();
  expect(saved.routines.find(routine => routine.id === "evening").active).toBe(false);
});

test("Paused Sunday Hygiene postponed to a past weekday can be removed completely", async ({ page }) => {
  await fresh(page, "2026-10-16T12:00:00");
  await page.evaluate(key => {
    const store = JSON.parse(localStorage.getItem(key));
    const routine = store.routines.find(item => item.id === "hygiene-day");
    const step = routine.tasks.find(item => item.active);
    const source = "2026-10-11";
    const date = "2026-10-14";
    store.taskReschedules[source + "|hygiene-day|" + step.id] = date;
    store.records[date] = {
      ...(store.records[date] ?? {}),
      "hygiene-day": {
        date, routineId: "hygiene-day", routineTitle: routine.title,
        scheduledTasks: [{
          id: step.id, title: step.title, section: step.section,
          optional: step.optional, allowSkip: step.allowSkip,
          scheduleType: "weekly", originDate: source,
        }],
        states: {},
      },
    };
    routine.active = false;
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, HYGIENE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  const days = await week(page);
  const moved = days.nth(2).locator('[data-week-care="hygiene-day"]');
  await expect(moved).toBeVisible();
  await moved.click();
  const remove = page.getByRole("dialog", { name: "Nedělní hygiena" })
    .getByRole("button", { name: "Odebrat jen tento den" });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(moved).toHaveCount(0);
  const saved = await page.evaluate(() => ({
    hygiene: JSON.parse(localStorage.getItem("dayframe-hygiene-v1")),
    week: JSON.parse(localStorage.getItem("dayframe-week-care-v1")),
  }));
  expect(saved.hygiene.records["2026-10-14"]?.["hygiene-day"]).toBeUndefined();
  expect(saved.hygiene.suppressedDates["2026-10-14"]).toContain("hygiene-day");
  expect(Object.values(saved.hygiene.taskReschedules)).not.toContain("2026-10-14");
  expect(saved.week.hidden["2026-10-14"]).toContain("hygiene-day");
  expect(saved.week.provenance["2026-10-14"]["hygiene-day"]).toBe("2026-10-11");
  await page.reload({ waitUntil: "networkidle" });
  const after = await week(page);
  await expect(after.nth(2).locator('[data-week-care="hygiene-day"]')).toHaveCount(0);
});
