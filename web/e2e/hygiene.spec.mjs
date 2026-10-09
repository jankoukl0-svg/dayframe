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
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const record = store.records?.["2026-10-11"]?.["hygiene-day"];
    for (const task of record?.scheduledTasks || []) {
      if (!task.optional) record.states[task.id] = "done";
    }
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  await expect(weekly).toContainText("12/12");
  await expect(weekly).toContainText("Hotovo");

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
  await morningManage.getByRole("button", { name: "Vyčistit zuby Péče", exact: true }).click();
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


test("manual routine can be removed from today without leaving a missed history record", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Správa rutin" }).click();

  await page.getByRole("button", { name: "+ Vlastní rutina" }).click();
  let modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Manuální péče");
  await modal.getByLabel("Frekvence").selectOption("manual");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  let card = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Manuální péče" });
  await card.getByRole("button", { name: "+ Přidat úkol" }).click();
  modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Jednorázová péče");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  card = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Manuální péče" });
  await card.getByRole("button", { name: "Naplánovat dnes" }).click();

  const routineId = await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return store.routines.find((routine) => routine.title === "Manuální péče")?.id;
  });
  expect(routineId).toBeTruthy();
  await expect.poll(() => page.evaluate((id) => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return Boolean(store.records?.["2026-10-06"]?.[id]);
  }, routineId)).toBe(true);

  await card.getByRole("button", { name: "Odebrat z dneška" }).click();
  await expect.poll(() => page.evaluate((id) => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return Boolean(store.records?.["2026-10-06"]?.[id]);
  }, routineId)).toBe(false);

  await card.getByRole("button", { name: "Upravit" }).click();
  modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Aktivní").uncheck();
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  card = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Manuální péče" });
  await expect(card.getByRole("button", { name: "Naplánovat dnes" })).toHaveCount(0);
});


test("optional-only routines never turn optional tasks into completion requirements", async ({ page }) => {
  await openFresh(page);
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    store.routines.push({
      id: "optional-only",
      title: "Volitelná péče",
      active: true,
      order: 99,
      schedule: { type: "daily" },
      tasks: [{
        id: "optional-only-task",
        title: "Bonus péče",
        section: "Péče",
        active: true,
        optional: true,
        allowSkip: true,
      }],
    });
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });

  await openSidebar(page, "Hygiena");
  const routine = page.locator('[data-hygiene-routine="optional-only"]');
  await expect(routine).toContainText("0/0");
  await expect(routine).toContainText("Hotovo");

  await openSidebar(page, "Dnes");
  const aggregate = page.locator('[data-hygiene-checklist-routine="optional-only"]');
  await expect(aggregate).toContainText("Hotovo");
});


test("history preserves skipped-only status and aligns month dates to weekdays", async ({ page }) => {
  await openFresh(page, "2026-10-08T12:00:00");
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    store.routines = store.routines.map((routine) => ({ ...routine, active: false }));
    store.records["2026-10-08"] = {};
    store.routines.push({
      id: "skip-only",
      title: "Přeskočitelná rutina",
      active: true,
      order: 90,
      schedule: { type: "daily" },
      tasks: [{
        id: "skip-only-task",
        title: "Podle potřeby",
        section: "Péče",
        active: true,
        optional: false,
        allowSkip: true,
      }],
    });
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });

  await openSidebar(page, "Hygiena");
  const routine = page.locator('[data-hygiene-routine="skip-only"]');
  await routine.getByRole("button", { name: "Není potřeba" }).click();

  await page.getByRole("tab", { name: "Historie" }).click();
  const today = page.locator(".df2-hygiene-history-day").filter({ hasText: "čt 8" });
  await expect(today).toContainText("Přeskočeno");

  const octoberFirst = page.locator('[data-calendar-date="2026-10-01"]');
  await expect(octoberFirst).toHaveCSS("grid-column-start", "4");
});


test("task-specific cadence can schedule work outside the parent routine cadence", async ({ page }) => {
  await openFresh(page, "2026-10-12T12:00:00");
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    store.routines.push({
      id: "mixed-cadence",
      title: "Smíšená frekvence",
      active: true,
      order: 95,
      schedule: { type: "weekly", weekday: 0 },
      tasks: [
        {
          id: "mixed-inherited",
          title: "Jen v neděli",
          section: "Péče",
          active: true,
          optional: false,
          allowSkip: false,
        },
        {
          id: "mixed-daily",
          title: "Denní uvnitř týdenní rutiny",
          section: "Péče",
          active: true,
          optional: false,
          allowSkip: false,
          schedule: { type: "daily" },
        },
      ],
    });
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });

  await openSidebar(page, "Hygiena");
  const routine = page.locator('[data-hygiene-routine="mixed-cadence"]');
  await expect(routine).toBeVisible();
  await expect(routine).toContainText("Vlastní frekvence úkolu");
  await expect(routine).toContainText("Denní uvnitř týdenní rutiny");
  await expect(routine).not.toContainText("Jen v neděli");
  await expect(routine).not.toContainText("Každý Ne");

  await openSidebar(page, "Dnes");
  await expect(page.locator('[data-hygiene-checklist-routine="mixed-cadence"]')).toContainText("0/1");
});
