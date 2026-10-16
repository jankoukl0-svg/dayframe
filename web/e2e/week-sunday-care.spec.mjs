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

test("An elapsed Hygiene reservation can be edited later today but never moved into an elapsed slot", async ({ page }) => {
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
  await repeated.click();
  const dialog = page.getByRole("dialog", { name: "Opakovaná rutina" });
  await dialog.getByLabel("Začátek bloku").fill("16:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(dialog.getByRole("alert")).toContainText("budoucí čas");
  await expect(repeated).toHaveAttribute("aria-label", "Opakovaná rutina, 15:15–15:45");
  await dialog.getByLabel("Začátek bloku").fill("23:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(repeated).toHaveAttribute("aria-label", "Opakovaná rutina, 23:00–23:30");
});

test("Elapsed Hygiene block with any saved progress stays locked and cannot be rescheduled via dialog", async ({ page }) => {
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
  await expect(repeated).toHaveAttribute("draggable", "true");
  await page.evaluate(({ key, id }) => {
    const store = JSON.parse(localStorage.getItem(key));
    const date = "2026-10-16";
    const routine = store.routines.find(item => item.id === id);
    const record = store.records[date]?.[id];
    if (!routine || !record || !record.scheduledTasks.length) throw Error("Missing Friday Hygiene occurrence");
    const taskId = record.scheduledTasks[0].id;
    record.states[taskId] = "done";
    record.completedOn = { ...(record.completedOn ?? {}), [taskId]: date };
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  }, { key: HYGIENE_KEY, id: REPEATED_ID });
  await expect(repeated).toHaveAttribute("draggable", "false");
  await repeated.click();
  const dialog = page.getByRole("dialog", { name: "Opakovaná rutina" });
  await dialog.getByLabel("Začátek bloku").fill("23:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Rozpracovanou nebo splněnou");
  await expect(repeated).toHaveAttribute("aria-label", "Opakovaná rutina, 15:15–15:45");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(stored.records["2026-10-16"][REPEATED_ID].states["repeat-e2e-0"]).toBe("done");
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
  await expect(dialog.getByRole("alert")).toContainText("mimo neděli");
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

test("Daily Cleaning removal is only for that day, has no Restore UI and leaves its checklist untouched", async ({ page }) => {
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
  await expect(page.locator("[data-week-care]")).toHaveCount(0); // No retroactive projections.
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

test("Sunday time can be moved on its day, persists, and cannot move the checklist to weekdays", async ({ page }) => {
  await fresh(page);
  await week(page);
  await expect(page.locator('[data-week-care="hygiene-day"]')).toHaveAttribute("draggable", "true");
  await dragCare(page, 6, 0, "hygiene-day", "18:00");
  await expect(page.locator('[data-week-care="hygiene-day"]')).toContainText("10:00–10:30");
  expect(await page.evaluate(key => localStorage.getItem(key), CARE_KEY)).toBeNull();

  await dragCare(page, 6, 6, "hygiene-day", "18:00");
  await expect(page.locator('[data-week-care="hygiene-day"]')).toContainText("18:00–18:30");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(stored.times["2026-10-18"]["hygiene-day"]).toBe("18:00");
  await page.reload({ waitUntil: "networkidle" });
  await week(page);
  await expect(page.locator('[data-week-care="hygiene-day"]')).toContainText("18:00–18:30");
  await expect(page.locator('[data-week-care="cleaning-sunday"]')).toContainText("10:30–11:00");
  const record = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), HYGIENE_KEY);
  expect(record.routines.find(item => item.id === "hygiene-day").schedule).toEqual({ type: "weekly", weekday: 0 });
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
