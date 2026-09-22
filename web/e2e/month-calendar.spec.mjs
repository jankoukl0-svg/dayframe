import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("monthly calendar shows, edits, colors and creates milestones", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`;
    const addKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-20`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextKey = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-05`;
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
    return { currentKey, nextKey, addKey };
  });

  await page.reload({ waitUntil: "networkidle" });
  const calendarNav = page.getByRole("button", { name: /^KalendářK$/ });
  await expect(calendarNav).toBeVisible();
  await calendarNav.click();

  await expect(page.getByRole("heading", { name: "Kalendář" })).toBeVisible();
  await expect(calendarNav).toHaveClass(/active/);
  const currentCell = page.locator(`.df2-month-day[data-date="${seeded.currentKey}"]`);
  const currentMilestone = currentCell.locator('.df2-month-milestone[data-milestone-id="month-current"]');
  await expect(currentMilestone).toContainText("SCIO online");
  await expect(currentMilestone).toContainText("OSP online v 9:00.");
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

  await page.getByRole("button", { name: "Tento měsíc" }).click();
  const addCell = page.locator(`.df2-month-day[data-date="${seeded.addKey}"]`);
  await addCell.getByRole("button", { name: `Přidat milník ${seeded.addKey}` }).click();
  await expect(page.getByRole("heading", { name: "Nový milník" })).toBeVisible();
  await page.locator('.df2-month-milestone-modal input[name="title"]').fill("Cambridge C1");
  await page.locator('.df2-month-milestone-modal textarea[name="note"]').fill("Digital test v Praze.");
  await page.getByRole("button", { name: "Přidat milník" }).click();
  await expect(addCell).toContainText("Cambridge C1");
  await expect(addCell).toContainText("Digital test v Praze.");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.milestones.some((milestone) => milestone.title === "Cambridge C1" && milestone.note === "Digital test v Praze.");
  })).toBe(true);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^KalendářK$/ }).click();
  await expect(page.locator(`.df2-month-day[data-date="${seeded.addKey}"]`)).toContainText("Cambridge C1");
});
