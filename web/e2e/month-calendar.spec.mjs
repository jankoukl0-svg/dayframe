import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("monthly calendar shows, edits, colors, countdowns and creates milestones", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`;
    const addKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-20`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextKey = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-05`;
    const targetUtc = Date.UTC(now.getFullYear(), now.getMonth(), 15);
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const currentDays = Math.round((targetUtc - todayUtc) / 86_400_000);
    const currentCountdown = currentDays === 0
      ? "dnes"
      : currentDays === 1
        ? "zítra"
        : currentDays > 1
          ? `za ${currentDays} ${currentDays <= 4 ? "dny" : "dní"}`
          : currentDays === -1
            ? "před 1 dnem"
            : `před ${Math.abs(currentDays)} dny`;
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [
      { id: "month-current", title: "SCIO online", date: currentKey, note: "OSP online v 9:00." },
      { id: "month-next", title: "VŠE nanečisto", date: nextKey, note: "FPH + FFÚ." },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-milestone-colors-v1", JSON.stringify({
      "month-current": "#2563eb",
      "month-next": "#dc2626",
    }));
    window.localStorage.setItem("dayframe-milestone-hidden-colors-v1", JSON.stringify({ preset: [], custom: false }));
    return { currentKey, nextKey, addKey, currentCountdown };
  });

  await page.reload({ waitUntil: "networkidle" });
  const calendarNav = page.locator(".df2-month-calendar-nav-button");
  await expect(calendarNav).toBeVisible();
  await calendarNav.click();

  await expect(page.getByRole("heading", { name: "Kalendář" })).toBeVisible();
  await expect(calendarNav).toHaveClass(/active/);
  const currentCell = page.locator(`.df2-month-day[data-date="${seeded.currentKey}"]`);
  const currentMilestone = currentCell.locator('.df2-month-milestone[data-milestone-id="month-current"]');
  await expect(currentMilestone).toContainText("SCIO online");
  await expect(currentMilestone).toContainText("OSP online v 9:00.");
  await expect(currentMilestone.locator(".df2-month-countdown")).toHaveText(seeded.currentCountdown);
  await expect.poll(() => currentMilestone.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe("rgb(37, 99, 235)");

  await currentMilestone.click();
  await expect(page.getByRole("heading", { name: "Upravit milník" })).toBeVisible();
  const note = page.locator('.df2-month-milestone-modal textarea[name="note"]');
  await note.fill("OSP online v 9:00, přihlásit se 15 minut předem.");
  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(currentMilestone).toContainText("přihlásit se 15 minut předem");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.milestones.find((milestone) => milestone.id === "month-current")?.note;
  })).toBe("OSP online v 9:00, přihlásit se 15 minut předem.");

  await page.getByRole("button", { name: "Další měsíc" }).click();
  const nextCell = page.locator(`.df2-month-day[data-date="${seeded.nextKey}"]`);
  await expect(nextCell.getByText("VŠE nanečisto")).toBeVisible();
  await expect(nextCell.locator(".df2-month-countdown")).toBeVisible();

  await page.getByRole("button", { name: "Tento měsíc" }).click();
  const addCell = page.locator(`.df2-month-day[data-date="${seeded.addKey}"]`);
  await addCell.getByRole("button", { name: `Přidat do kalendáře ${seeded.addKey}` }).click();
  await expect(page.getByRole("heading", { name: "Přidat do kalendáře" })).toBeVisible();
  const createModal = page.locator(".df2-month-milestone-modal");
  await createModal.getByRole("button", { name: "Milník", exact: true }).click();
  await createModal.locator('input[name="title"]').fill("Cambridge C1");
  await createModal.locator('textarea[name="note"]').fill("Digital test v Praze.");
  await createModal.getByRole("button", { name: "Událost", exact: true }).click();
  await expect(createModal.locator('textarea[name="note"]')).toHaveValue("Digital test v Praze.");
  await createModal.getByRole("button", { name: "Milník", exact: true }).click();
  await expect(createModal.locator('textarea[name="note"]')).toHaveValue("Digital test v Praze.");
  await createModal.getByRole("button", { name: "Přidat milník", exact: true }).click();
  await expect(addCell).toContainText("Cambridge C1");
  await expect(addCell).toContainText("Digital test v Praze.");
  await expect(addCell.locator(".df2-month-countdown")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.milestones.some((milestone) => milestone.title === "Cambridge C1" && milestone.note === "Digital test v Praze.");
  })).toBe(true);

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-month-calendar-nav-button").click();
  const reloadedAddCell = page.locator(`.df2-month-day[data-date="${seeded.addKey}"]`);
  await expect(reloadedAddCell).toContainText("Cambridge C1");
  await expect(reloadedAddCell.locator(".df2-month-countdown")).toBeVisible();
});


test("calendar additions default to regular events and existing milestones can be converted to events", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const eventKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-18`;
    const convertKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-19`;
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [
      { id: "convert-me", title: "Doučování VŠE matika", date: convertKey, note: "16:00" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-calendar-events-v1", "[]");
    return { eventKey, convertKey };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-month-calendar-nav-button").click();

  const eventCell = page.locator(`.df2-month-day[data-date="${seeded.eventKey}"]`);
  await eventCell.getByRole("button", { name: `Přidat do kalendáře ${seeded.eventKey}` }).click();

  const createModal = page.locator(".df2-month-milestone-modal");
  await expect(page.getByRole("heading", { name: "Přidat do kalendáře" })).toBeVisible();
  await expect(createModal.getByRole("button", { name: "Událost", exact: true })).toHaveAttribute("aria-pressed", "true");
  await createModal.locator('input[name="title"]').fill("Konzultace matiky");
  await createModal.locator('input[name="time"]').fill("15:30");
  await createModal.locator('textarea[name="note"]').fill("Jen běžná položka v kalendáři.");
  await createModal.getByRole("button", { name: "Milník", exact: true }).click();
  await createModal.getByRole("button", { name: "Událost", exact: true }).click();
  await expect(createModal.locator('input[name="time"]')).toHaveValue("15:30");
  await expect(createModal.locator('textarea[name="note"]')).toHaveValue("Jen běžná položka v kalendáři.");
  await createModal.getByRole("button", { name: "Přidat událost", exact: true }).click();

  const regularEvent = eventCell.locator(".df2-month-calendar-event").filter({ hasText: "Konzultace matiky" });
  await expect(regularEvent).toBeVisible();
  await expect(regularEvent).toContainText("15:30");
  await expect(regularEvent.locator(".df2-month-countdown")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const events = JSON.parse(window.localStorage.getItem("dayframe-calendar-events-v1") || "[]");
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return {
      eventSaved: events.some((item) => item.title === "Konzultace matiky" && item.time === "15:30"),
      leakedToMilestones: (state.milestones || []).some((item) => item.title === "Konzultace matiky"),
    };
  })).toEqual({ eventSaved: true, leakedToMilestones: false });

  const convertCell = page.locator(`.df2-month-day[data-date="${seeded.convertKey}"]`);
  const milestone = convertCell.locator('.df2-month-milestone[data-milestone-id="convert-me"]');
  await expect(milestone).toBeVisible();
  await expect(milestone.locator(".df2-month-countdown")).toBeVisible();
  await milestone.click();

  const editModal = page.locator(".df2-month-milestone-modal");
  await expect(page.getByRole("heading", { name: "Upravit milník" })).toBeVisible();
  await editModal.getByRole("button", { name: "Událost", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upravit událost" })).toBeVisible();
  await editModal.locator('input[name="time"]').fill("16:00");
  await editModal.getByRole("button", { name: "Milník", exact: true }).click();
  await editModal.getByRole("button", { name: "Událost", exact: true }).click();
  await expect(editModal.locator('input[name="time"]')).toHaveValue("16:00");
  await editModal.getByRole("button", { name: "Uložit změny", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const events = JSON.parse(window.localStorage.getItem("dayframe-calendar-events-v1") || "[]");
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return {
      eventSaved: events.some((item) => item.id === "convert-me" && item.title === "Doučování VŠE matika" && item.time === "16:00"),
      milestoneStillExists: (state.milestones || []).some((item) => item.id === "convert-me"),
    };
  })).toEqual({ eventSaved: true, milestoneStillExists: false });

  const convertedEvent = convertCell.locator('.df2-month-calendar-event[data-calendar-event-id="convert-me"]');
  await expect(convertedEvent).toBeVisible();
  await expect(convertedEvent).toContainText("16:00");
  await expect(convertedEvent.locator(".df2-month-countdown")).toHaveCount(0);
  await expect(convertCell.locator('.df2-month-milestone[data-milestone-id="convert-me"]')).toHaveCount(0);

});
