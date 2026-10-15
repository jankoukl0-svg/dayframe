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

test("Care modal edits just one day and protects occupied slots", async ({ page }) => {
  await fresh(page);
  await week(page);
  const friday = page.locator(".df2-week-day").nth(4);
  await friday.locator('[data-week-care="morning"]').click();
  const dialog = page.getByRole("dialog", { name: "Ranní hygiena" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Začátek bloku").fill("14:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(friday.locator('[data-week-care="morning"]')).toHaveAttribute("aria-label","Ranní hygiena, 14:00–14:20");
  await expect(page.locator(".df2-week-day").nth(5).locator('[data-week-care="morning"]')).toHaveAttribute("aria-label", "Ranní hygiena, 09:00–09:20");
  await friday.locator('[data-week-care="morning"]').click();
  await dialog.getByLabel("Začátek bloku").fill("10:00");
  await dialog.getByRole("button", { name: "Uložit čas" }).click();
  await expect(dialog.getByRole("alert")).toContainText("zabírá jiný blok");
  await expect(friday.locator('[data-week-care="morning"]')).toHaveAttribute("aria-label","Ranní hygiena, 14:00–14:20");
  await dialog.getByRole("button", { name: "Zavřít" }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CARE_KEY);
  expect(saved.times["2026-10-16"].morning).toBe("14:00");
});

test("One-day cancel hides only the calendar reservation, persists and can be restored", async ({ page }) => {
  await fresh(page);
  await week(page);
  const thursday = page.locator(".df2-week-day").nth(3);
  const friday = page.locator(".df2-week-day").nth(4);
  await friday.locator('[data-week-care="morning"]').click();
  const dialog = page.getByRole("dialog", { name: "Ranní hygiena" });
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
  const restore = page.getByRole("button",{name:"Obnovit Ranní hygiena v rozvrhu 2026-10-16"});
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator(".df2-week-day").nth(4).locator('[data-week-care="morning"]')).toBeVisible();
  expect((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).hidden,CARE_KEY))?.["2026-10-16"]).toBeUndefined();
});

test("Restoring a hidden day checks collisions and refuses to overlap another care block", async ({ page }) => {
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
  await friday.getByRole("button", { name: "Obnovit Ranní hygiena v rozvrhu 2026-10-16" }).click();
  await expect(friday.locator('[data-week-care="morning"]')).toHaveCount(0);
  await expect(page.locator(".df2-notice")).toContainText("obsazený");
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
  await sunday.getByRole("button", {name:"Obnovit Nedělní hygiena v rozvrhu 2026-10-18"}).click();
  await expect(sunday.locator('[data-week-care="hygiene-day"]')).toContainText("18:00–18:30");
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),CARE_KEY);
  expect(saved.times["2026-10-18"]["hygiene-day"]).toBe("18:00");
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
  await expect(page.locator("[data-week-care]")).toHaveCount(16);
  for (let i = 0; i < 6; i++) await expect(days.nth(i).locator("[data-week-care]")).toHaveCount(2);
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("10:00–10:30");
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("Nedělní hygiena");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("10:30–11:00");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("Nedělní úklid");
  const calendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(calendar.plans).flat().filter(task => task.routineId === "hygiene-day" || task.routineId === "cleaning-sunday")).toHaveLength(0);

  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await expect(page.locator("[data-week-care]")).toHaveCount(16);
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
  await expect(page.locator("[data-week-care]")).toHaveCount(16);
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
