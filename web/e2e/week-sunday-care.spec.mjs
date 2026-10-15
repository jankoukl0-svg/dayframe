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

test("Sunday Hygiene and Cleaning appear as two 30-minute Week reservations, without duplicate calendar tasks", async ({ page }) => {
  await fresh(page);
  const days = await week(page);
  await expect(page.locator("[data-week-care]")).toHaveCount(2);
  for (let i = 0; i < 6; i++) await expect(days.nth(i).locator("[data-week-care]")).toHaveCount(0);
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("10:00–10:30");
  await expect(days.nth(6).locator('[data-week-care="hygiene-day"]')).toContainText("Nedělní hygiena");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("10:30–11:00");
  await expect(days.nth(6).locator('[data-week-care="cleaning-sunday"]')).toContainText("Nedělní úklid");
  const calendar = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(Object.values(calendar.plans).flat().filter(task => task.routineId === "hygiene-day" || task.routineId === "cleaning-sunday")).toHaveLength(0);

  await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
  await expect(page.locator("[data-week-care]")).toHaveCount(2);
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();
  await expect(page.locator("[data-week-care]")).toHaveCount(0); // No retroactive projections.
});

test("clicking each Sunday reservation opens the original Hygiene or Cleaning routine", async ({ page }) => {
  await fresh(page);
  await week(page);
  await page.locator('[data-week-care="cleaning-sunday"]').click();
  await expect(page.getByRole("tab", { name: "Úklid" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-cleaning-routine="cleaning-sunday"]')).toBeVisible();

  await week(page);
  await page.locator('[data-week-care="hygiene-day"]').click();
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
  await expect(page.locator("[data-week-care]")).toHaveCount(2);
  await expect(page.locator('[data-week-care="hygiene-day"]')).toHaveAttribute("draggable", "false");
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
