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
  await modal.getByLabel("Frekvence úkolu").selectOption("daily");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  card = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Manuální péče" });
  await expect(card.getByRole("button", { name: "Odebrat z dneška" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Naplánovat dnes" })).toHaveCount(0);

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
    return {
      record: Boolean(store.records?.["2026-10-06"]?.[id]),
      suppressed: (store.suppressedDates?.["2026-10-06"] || []).includes(id),
    };
  }, routineId)).toEqual({ record: false, suppressed: true });

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


test("completed current-day snapshots stay in history after routine deactivation", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");

  const morning = page.locator('[data-hygiene-routine="morning"]');
  const checks = morning.locator(".df2-hygiene-check");
  for (let index = 0; index < 6; index += 1) await checks.nth(index).click();
  await expect(morning).toContainText("6/6");

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const manage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Ranní rutina" });
  await manage.getByRole("button", { name: "Upravit", exact: true }).click();
  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Aktivní").uncheck();
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await page.getByRole("tab", { name: "Dnes" }).click();
  await expect(page.locator('[data-hygiene-routine="morning"]')).toHaveCount(0);

  await page.getByRole("tab", { name: "Historie" }).click();
  const stats = page.locator(".df2-hygiene-stats-grid article").filter({ hasText: "Ranní rutina" });
  await expect(stats).toContainText("Splněno");
  await expect(stats).toContainText("1");

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const record = store.records?.["2026-10-06"]?.morning;
    return { archived: record?.archived, done: Object.values(record?.states || {}).filter((state) => state === "done").length };
  })).toEqual({ archived: true, done: 6 });
});

test("moving a completed task between today's routines preserves its state", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");

  const morning = page.locator('[data-hygiene-routine="morning"]');
  await morning.getByRole("button", { name: "Označit Vyčistit zuby jako hotovo" }).click();

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const morningManage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Ranní rutina" });
  await morningManage.getByRole("button", { name: "Vyčistit zuby Péče", exact: true }).click();

  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Rutina", { exact: true }).selectOption("evening");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return {
      morning: store.records?.["2026-10-06"]?.morning?.states?.["morning-teeth"] ?? null,
      evening: store.records?.["2026-10-06"]?.evening?.states?.["morning-teeth"] ?? null,
    };
  })).toEqual({ morning: null, evening: "done" });

  await page.getByRole("tab", { name: "Dnes" }).click();
  const evening = page.locator('[data-hygiene-routine="evening"]');
  await expect(evening.locator(".df2-hygiene-task").filter({ hasText: "Vyčistit zuby" }).getByRole("button", { name: "Vrátit Vyčistit zuby jako nesplněné" })).toBeVisible();
});


test("numeric Hygiene schedules are normalized before persistence", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Správa rutin" }).click();

  await page.getByRole("button", { name: "+ Vlastní rutina" }).click();
  let modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Interval rutina");
  await modal.getByLabel("Frekvence", { exact: true }).selectOption("interval");
  await modal.getByLabel("Každých", { exact: true }).fill("120.7");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await page.getByRole("button", { name: "+ Vlastní rutina" }).click();
  modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Název").fill("Měsíční rutina");
  await modal.getByLabel("Frekvence", { exact: true }).selectOption("monthly");
  await modal.getByLabel("Den v měsíci", { exact: true }).fill("12.6");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const interval = store.routines.find((routine) => routine.title === "Interval rutina")?.schedule;
    const monthly = store.routines.find((routine) => routine.title === "Měsíční rutina")?.schedule;
    return { interval, monthly };
  })).toEqual({
    interval: { type: "interval", everyDays: 90, anchorDate: "2026-10-06" },
    monthly: { type: "monthly", day: 13 },
  });

  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await expect(page.locator(".df2-hygiene-error")).toHaveCount(0);
  await expect(page.locator(".df2-hygiene-manage-list")).toContainText("Interval rutina");
  await expect(page.locator(".df2-hygiene-manage-list")).toContainText("Měsíční rutina");
});


test("moving a completed task into an unscheduled routine preserves today's snapshot", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");

  const morning = page.locator('[data-hygiene-routine="morning"]');
  await morning.getByRole("button", { name: "Označit Vyčistit zuby jako hotovo" }).click();

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const morningManage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Ranní rutina" });
  await morningManage.getByRole("button", { name: "Vyčistit zuby Péče", exact: true }).click();

  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Rutina", { exact: true }).selectOption("hygiene-day");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const source = store.records?.["2026-10-06"]?.morning;
    const destination = store.records?.["2026-10-06"]?.["hygiene-day"];
    return {
      sourceState: source?.states?.["morning-teeth"] ?? null,
      sourceHasSnapshot: Boolean(source?.scheduledTasks?.some((task) => task.id === "morning-teeth")),
      destinationState: destination?.states?.["morning-teeth"] ?? null,
    };
  })).toEqual({ sourceState: "done", sourceHasSnapshot: true, destinationState: null });

  await page.getByRole("tab", { name: "Dnes" }).click();
  await expect(page.locator('[data-hygiene-routine="morning"]')
    .locator(".df2-hygiene-task").filter({ hasText: "Vyčistit zuby" })
    .getByRole("button", { name: "Vrátit Vyčistit zuby jako nesplněné" })).toBeVisible();
  await expect(page.locator('[data-hygiene-routine="hygiene-day"]')).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await expect(page.locator('[data-hygiene-routine="morning"]')
    .locator(".df2-hygiene-task").filter({ hasText: "Vyčistit zuby" })
    .getByRole("button", { name: "Vrátit Vyčistit zuby jako nesplněné" })).toBeVisible();
});


test("a sole completed moved task stays visible today when its destination is unscheduled", async ({ page }) => {
  await openFresh(page);
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    store.routines.push(
      {
        id: "single-source",
        title: "Jedna dnešní věc",
        active: true,
        order: 80,
        schedule: { type: "daily" },
        tasks: [{
          id: "single-source-task",
          title: "Jediný hotový úkol",
          section: "Péče",
          active: true,
          optional: false,
          allowSkip: false,
        }],
      },
      {
        id: "single-sunday",
        title: "Nedělní cíl",
        active: true,
        order: 81,
        schedule: { type: "weekly", weekday: 0 },
        tasks: [],
      },
    );
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });

  await openSidebar(page, "Hygiena");
  const source = page.locator('[data-hygiene-routine="single-source"]');
  await source.getByRole("button", { name: "Označit Jediný hotový úkol jako hotovo" }).click();
  await expect(source).toContainText("1/1");

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const manage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Jedna dnešní věc" });
  await manage.getByRole("button", { name: "Jediný hotový úkol Péče", exact: true }).click();
  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Rutina", { exact: true }).selectOption("single-sunday");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await page.getByRole("tab", { name: "Dnes" }).click();
  const preserved = page.locator('[data-hygiene-routine="single-source"]');
  await expect(preserved).toBeVisible();
  await expect(preserved).toContainText("1/1");
  await expect(preserved).toContainText("Hotovo");
  await expect(page.locator('[data-hygiene-routine="single-sunday"]')).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await expect(page.locator('[data-hygiene-routine="single-source"]')).toContainText("1/1");
});

test("moving the sole completed task to a scheduled routine removes the empty source record", async ({ page }) => {
  await openFresh(page);
  await page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    store.routines.push({
      id: "single-transfer",
      title: "Jedna přesouvaná věc",
      active: true,
      order: 82,
      schedule: { type: "daily" },
      tasks: [{
        id: "single-transfer-task",
        title: "Přesouvaný hotový úkol",
        section: "Péče",
        active: true,
        optional: false,
        allowSkip: false,
      }],
    });
    window.localStorage.setItem("dayframe-hygiene-v1", JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });

  await openSidebar(page, "Hygiena");
  const source = page.locator('[data-hygiene-routine="single-transfer"]');
  await source.getByRole("button", { name: "Označit Přesouvaný hotový úkol jako hotovo" }).click();

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const manage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Jedna přesouvaná věc" });
  await manage.getByRole("button", { name: "Přesouvaný hotový úkol Péče", exact: true }).click();
  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Rutina", { exact: true }).selectOption("evening");
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    return {
      sourceExists: Boolean(store.records?.["2026-10-06"]?.["single-transfer"]),
      destinationState: store.records?.["2026-10-06"]?.evening?.states?.["single-transfer-task"] ?? null,
    };
  })).toEqual({ sourceExists: false, destinationState: "done" });

  await page.getByRole("tab", { name: "Dnes" }).click();
  await expect(page.locator('[data-hygiene-routine="single-transfer"]')).toHaveCount(0);
  await expect(page.locator('[data-hygiene-routine="evening"]')
    .locator(".df2-hygiene-task").filter({ hasText: "Přesouvaný hotový úkol" })
    .getByRole("button", { name: "Vrátit Přesouvaný hotový úkol jako nesplněné" })).toBeVisible();
});


test("partially handled snapshots survive routine deactivation in history", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");

  const morning = page.locator('[data-hygiene-routine="morning"]');
  await morning.getByRole("button", { name: "Označit Ranní sprcha jako hotovo" }).click();
  await expect(morning).toContainText("1/6");

  await page.getByRole("tab", { name: "Správa rutin" }).click();
  const manage = page.locator(".df2-hygiene-manage-list > article").filter({ hasText: "Ranní rutina" });
  await manage.getByRole("button", { name: "Upravit", exact: true }).click();
  const modal = page.locator(".df2-hygiene-modal").last();
  await modal.getByLabel("Aktivní").uncheck();
  await modal.getByRole("button", { name: "Uložit", exact: true }).click();

  await page.getByRole("tab", { name: "Dnes" }).click();
  await expect(page.locator('[data-hygiene-routine="morning"]')).toHaveCount(0);

  await page.getByRole("tab", { name: "Historie" }).click();
  const stats = page.locator(".df2-hygiene-stats-grid article").filter({ hasText: "Ranní rutina" });
  await expect(stats).toContainText("částečně");
  await expect(stats).toContainText("1");

  await expect.poll(() => page.evaluate(() => {
    const store = JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1") || "{}");
    const record = store.records?.["2026-10-06"]?.morning;
    return {
      exists: Boolean(record),
      archived: record?.archived,
      shower: record?.states?.["morning-shower"] ?? null,
    };
  })).toEqual({ exists: true, archived: true, shower: "done" });
});


test("product photo survives reload, appears in assigned routine without adding a checkbox", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("Čisticí gel");
  await editor.getByRole("textbox", { name: "Značka" }).fill("Testovací značka");
  await editor.getByRole("textbox", { name: "Návod k použití" }).fill("Jemně opláchnout.");
  await editor.getByRole("checkbox", { name: "Očistit obličej", exact: true }).check();
  await editor.getByRole("checkbox", { name: "Očištění obličeje", exact: true }).check();
  await editor.getByLabel("Fotografie produktu").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XBe8AAAAASUVORK5CYII=", "base64"),
  });
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(editor).toHaveCount(0);
  const card = page.locator(".df2-product-card").filter({ hasText: "Čisticí gel" });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toBeVisible();

  await page.getByRole("tab", { name: "Dnes" }).click();
  const morning = page.locator('[data-hygiene-routine="morning"]');
  await expect(morning.locator(".df2-hygiene-check")).toHaveCount(6);
  const faceStep = morning.locator(".df2-hygiene-task").filter({ hasText: "Očistit obličej" });
  await expect(faceStep).toContainText("Čisticí gel");
  await expect(faceStep).toContainText("Jemně opláchnout.");
  await faceStep.getByRole("button", { name: "Detail produktu Čisticí gel" }).click();
  await expect(page.getByRole("dialog", { name: "Detail produktu Čisticí gel" })).toContainText("Testovací značka");
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await expect(page.locator(".df2-product-card").filter({ hasText: "Čisticí gel" }).locator("img")).toBeVisible();
});

test("product replacements preserve order, checked actions and historical snapshots", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.evaluate(() => {
    const key = "dayframe-hygiene-v1";
    const store = JSON.parse(window.localStorage.getItem(key));
    const make = (id, name) => ({
      id, name, brand: "Test", category: "Pleť", description: "", instructions: "Podle etikety",
      frequency: "", openedOn: "", expiresOn: "", paoMonths: null, amount: "",
      stockStatus: "ok", shopUrl: "", archived: false,
    });
    store.products = [make("gel", "Gel"), make("cream", "Krém"), make("serum", "Sérum")];
    const face = store.routines.find((r) => r.id === "morning").tasks.find((t) => t.id === "morning-face");
    face.productIds = ["gel", "cream"];
    window.localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  const morning = page.locator('[data-hygiene-routine="morning"]');
  const face = morning.locator(".df2-hygiene-task").filter({ hasText: "Očistit obličej" });
  await expect(face.locator(".df2-hygiene-used-product")).toHaveCount(2);
  await face.getByRole("button", { name: "Označit Očistit obličej jako hotovo" }).click();
  await expect(face.locator(".df2-hygiene-check")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.locator('[data-product-id="gel"]').click();
  await page.getByRole("combobox", { name: "Náhradní produkt" }).selectOption("serum");
  await page.getByRole("button", { name: "Nahradit všude" }).click();
  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await page.locator(".df2-hygiene-manage-task-copy").filter({ hasText: "Očistit obličej" }).click();
  const taskEditor = page.getByRole("dialog", { name: "Upravit hygienický úkol" });
  await expect(taskEditor.getByRole("combobox", { name: "Nahradit produkt Sérum" })).toBeVisible();
  await taskEditor.getByRole("button", { name: "Posunout produkt Krém nahoru" }).click();
  await taskEditor.getByRole("button", { name: "Uložit" }).click();
  await page.getByRole("tab", { name: "Dnes" }).click();
  // Completed tasks retain the products actually shown when completion was recorded.
  await expect(face).toContainText("Gel");
  await expect(face).toContainText("Krém");
  await expect(face.locator(".df2-hygiene-check")).toHaveAttribute("aria-pressed", "true");
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  const nextFace = page.locator('[data-hygiene-routine="morning"] .df2-hygiene-task').filter({ hasText: "Očistit obličej" });
  await expect(nextFace.locator(".df2-hygiene-used-product").first()).toContainText("Krém");
  await expect(nextFace.locator(".df2-hygiene-used-product").nth(1)).toContainText("Sérum");
  const history = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1")));
  const oldFace = history.records["2026-10-06"].morning.scheduledTasks.find((task) => task.id === "morning-face");
  expect(oldFace.products.map((product) => product.name)).toEqual(["Gel", "Krém"]);
  await page.evaluate(() => {
    const key = "dayframe-hygiene-v1";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.products.find((product) => product.id === "gel").instructions = "Později změněný návod";
    localStorage.setItem(key, JSON.stringify(saved));
    dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  await page.getByRole("tab", { name: "Historie" }).click();
  await page.getByRole("button", { name: "Historický produkt Gel" }).click();
  const historicalDetail = page.getByRole("dialog", { name: "Historický produkt Gel" });
  await expect(historicalDetail).toContainText("Podle etikety");
  await expect(historicalDetail).not.toContainText("Později změněný návod");
});

test("archiving unlinks active product without removing historical completion", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.evaluate(() => {
    const key = "dayframe-hygiene-v1";
    const store = JSON.parse(window.localStorage.getItem(key));
    store.products = [{
      id: "old-cream", name: "Starý krém", brand: "", category: "Pleť",
      description: "", instructions: "", frequency: "", openedOn: "", expiresOn: "",
      paoMonths: null, amount: "", stockStatus: "low", shopUrl: "", archived: false,
    }];
    store.routines.find((r) => r.id === "morning").tasks.find((t) => t.id === "morning-spf").productIds = ["old-cream"];
    window.localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  const morning = page.locator('[data-hygiene-routine="morning"]');
  const step = morning.locator(".df2-hygiene-task").filter({ hasText: "Hydratační krém + SPF" });
  await step.getByRole("button", { name: "Označit Hydratační krém + SPF jako hotovo" }).click();
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.locator('[data-product-id="old-cream"]').click();
  await page.getByRole("button", { name: "Archivovat" }).click();
  await expect(page.locator('[data-product-id="old-cream"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Archivované" }).click();
  await expect(page.locator('[data-product-id="old-cream"]')).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  await openSidebar(page, "Hygiena");
  await expect(page.locator('[data-hygiene-routine="morning"]')).not.toContainText("Starý krém");
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-hygiene-v1")));
  expect(saved.records["2026-10-06"].morning.states["morning-spf"]).toBe("done");
  expect(saved.records["2026-10-06"].morning.scheduledTasks.find((t) => t.id === "morning-spf").products[0].name).toBe("Starý krém");
});


test("scheduled days do not duplicate product instructions; completed steps retain historical details", async ({ page }) => {
  await openFresh(page);
  await openSidebar(page, "Hygiena");
  await page.evaluate(() => {
    const key = "dayframe-hygiene-v1";
    const store = JSON.parse(localStorage.getItem(key));
    store.products = [{
      id: "long-instructions", name: "Testovací gel", brand: "", category: "Pleť",
      description: "", instructions: "N".repeat(3000), frequency: "", openedOn: "",
      expiresOn: "", paoMonths: null, amount: "", stockStatus: "ok",
      shopUrl: "", archived: false,
    }];
    store.routines.find((r) => r.id === "morning").tasks.find((t) => t.id === "morning-face").productIds = ["long-instructions"];
    localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-hygiene-sync"));
  });
  const face = page.locator('[data-hygiene-routine="morning"] .df2-hygiene-task').filter({ hasText: "Očistit obličej" });
  await expect(face).toContainText("Testovací gel");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1"))
    .records["2026-10-06"].morning.scheduledTasks.find((t) => t.id === "morning-face").products?.length ?? 0)).toBe(0);
  await face.getByRole("button", { name: "Označit Očistit obličej jako hotovo" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1"))
    .records["2026-10-06"].morning.scheduledTasks.find((t) => t.id === "morning-face").products[0].instructions.length)).toBe(3000);
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
  await page.reload({ waitUntil: "networkidle" });
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(data.records["2026-10-07"].morning.scheduledTasks.find((t) => t.id === "morning-face").products?.length ?? 0).toBe(0);
});
