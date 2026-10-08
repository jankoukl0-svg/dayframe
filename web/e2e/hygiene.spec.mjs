import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function openFresh(page, iso = "2026-10-06T12:00:00") {
  await page.clock.setFixedTime(new Date(iso));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-hygiene-v1")))).toBe(true);
}

async function openSidebar(page, label) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: label }).click();
}

test("morning routine syncs with the Daily checklist and survives reload", async ({ page }) => {
  await openFresh(page);

  const checklist = page.locator("[data-daily-checklist]");
  const morningAggregate = checklist.locator('[data-hygiene-checklist-routine="morning"]');
  await expect(morningAggregate).toContainText("Ranní rutina");
  await expect(morningAggregate).toContainText("0/6");

  await morningAggregate.getByRole("button", { name: "Otevřít Ranní rutina v Hygieně" }).click();
  await expect(page.getByRole("heading", { name: "Hygiena" })).toBeVisible();

  const morning = page.locator('[data-hygiene-routine="morning"]');
  const checks = morning.locator(".df2-hygiene-check");
  await expect(checks).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await checks.nth(index).click();
  await expect(morning).toContainText("6/6");
  await expect(morning).toContainText("Hotovo");

  await openSidebar(page, "Dnes");
  await expect(checklist.locator('[data-hygiene-checklist-routine="morning"]')).toContainText("Hotovo");

  await checklist.locator('[data-hygiene-checklist-routine="morning"]').getByRole("button").click();
  await morning.getByRole("button", { name: "Vrátit Vyčistit zuby jako nesplněné" }).click();
  await openSidebar(page, "Dnes");
  await expect(checklist.locator('[data-hygiene-checklist-routine="morning"]')).toContainText("5/6");

  await page.reload({ waitUntil: "networkidle" });
  await expect(checklist.locator('[data-hygiene-checklist-routine="morning"]')).toContainText("5/6");
});

test("Hygiene Day appears only on Sunday and first Sunday adds Monthly care to the same routine", async ({ page }) => {
  await openFresh(page, "2026-10-11T12:00:00");
  await openSidebar(page, "Hygiena");

  const weekly = page.locator('[data-hygiene-routine="hygiene-day"]');
  await expect(weekly).toBeVisible();
  await expect(weekly.getByRole("heading", { name: "Měsíční péče" })).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");

  const monthly = page.locator('[data-hygiene-routine="hygiene-day"]');
  await expect(monthly).toBeVisible();
  await expect(monthly).toContainText("Hygiene Day+");
  await expect(monthly.getByRole("heading", { name: "Měsíční péče" })).toBeVisible();
  await expect(monthly.locator(".df2-hygiene-task-group").filter({ hasText: "Měsíční péče" }).locator(".df2-hygiene-task")).toHaveCount(5);

  await openSidebar(page, "Dnes");
  await expect(page.locator('[data-hygiene-checklist-routine="hygiene-day"]')).toBeVisible();
});

test("Není potřeba is preserved separately and does not block Hygiene Day completion", async ({ page }) => {
  await openFresh(page, "2026-10-11T12:00:00");
  await openSidebar(page, "Hygiena");

  const weekly = page.locator('[data-hygiene-routine="hygiene-day"]');
  const checks = weekly.locator(".df2-hygiene-check");
  const count = await checks.count();
  for (let index = 0; index < count; index += 1) await checks.nth(index).click();

  const nails = weekly.locator(".df2-hygiene-task").filter({ hasText: "nehtů na rukou" });
  await nails.getByRole("button", { name: "Není potřeba" }).click();

  await expect(weekly).toContainText("12/12");
  await expect(weekly).toContainText("Hotovo");
  await expect(nails).toContainText("Není potřeba");

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return store.records?.["2026-10-11"]?.["hygiene-day"]?.states?.["weekly-hand-nails"];
  })).toBe("skipped");
});

test("new planning day gets fresh routine state while yesterday remains in history", async ({ page }) => {
  await openFresh(page, "2026-10-06T12:00:00");
  await openSidebar(page, "Hygiena");

  const morning = page.locator('[data-hygiene-routine="morning"]');
  const checks = morning.locator(".df2-hygiene-check");
  for (let index = 0; index < 6; index += 1) await checks.nth(index).click();
  await expect(morning).toContainText("6/6");

  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await expect(page.locator('[data-hygiene-routine="morning"]')).toContainText("0/6");

  await page.getByRole("tab", { name: "Historie" }).click();
  const stats = page.locator(".df2-hygiene-stats-grid article").filter({ hasText: "Ranní rutina" });
  await expect(stats).toContainText("Plánované dny");
  await expect(stats).toContainText("2");

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return {
      yesterday: Boolean(store.records?.["2026-10-06"]?.morning),
      today: Boolean(store.records?.["2026-10-07"]?.morning),
    };
  })).toEqual({ yesterday: true, today: true });
});

test("editing a task changes today but does not rewrite yesterday's snapshot", async ({ page }) => {
  await openFresh(page, "2026-10-06T12:00:00");
  await openSidebar(page, "Hygiena");

  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Správa rutin" }).click();

  const morningManage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Ranní rutina" });
  await morningManage.getByRole("button", { name: /Vyčistit zuby/ }).click();
  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Vyčistit zuby 2 min");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const title = (date) => store.records?.[date]?.morning?.scheduledTasks?.find((task) => task.id === "morning-teeth")?.title;
    return { yesterday: title("2026-10-06"), today: title("2026-10-07") };
  })).toEqual({ yesterday: "Vyčistit zuby", today: "Vyčistit zuby 2 min" });
});

test("custom routine and task can be created and appear as one aggregate checklist item", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Správa rutin" }).click();

  await page.getByRole("button", { name: "+ Vlastní rutina" }).click();
  let modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Péče o čočky");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  const custom = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Péče o čočky" });
  await custom.getByRole("button", { name: "+ Přidat úkol" }).click();
  modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Vyčistit pouzdro");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await page.getByRole("tab", { name: "Dnes" }).click();
  const card = page.locator('[data-hygiene-routine]').filter({ hasText: "Péče o čočky" });
  await expect(card).toContainText("Vyčistit pouzdro");

  await openSidebar(page, "Dnes");
  const aggregate = page.locator("[data-daily-checklist] [data-hygiene-checklist-routine]").filter({ hasText: "Péče o čočky" });
  await expect(aggregate).toContainText("0/1");
});

test("Hygiene remains usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await expect(page.locator('[data-hygiene-routine="morning"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
