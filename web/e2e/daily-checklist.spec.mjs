import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function openFresh(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.removeItem("dayframe-daily-checklist-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
}

async function addItem(page, title, repeat = "Každý den") {
  await page.getByRole("button", { name: "+ Přidat položku" }).click();
  const modal = page.locator(".df2-checklist-modal");
  await expect(modal).toBeVisible();
  await modal.locator('input[name="title"]').fill(title);
  if (repeat !== "Každý den") {
    await modal.getByRole("button", { name: repeat, exact: true }).click();
  }
  await modal.getByRole("button", { name: "Přidat položku", exact: true }).click();
}

test("daily checklist stays separate from tasks and resets on the next planning day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00Z"));
  await openFresh(page);

  const checklist = page.locator("[data-daily-checklist]");
  await expect(checklist).toBeVisible();
  await expect(checklist.getByRole("heading", { name: "Denní checklist" })).toBeVisible();
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/0");

  await addItem(page, "Vitamíny");
  await addItem(page, "Angličtina", "Po–Pá");

  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/2");
  await checklist.getByRole("button", { name: "Označit Vitamíny jako hotovo" }).click();
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/2");

  await expect.poll(() => page.evaluate(() => {
    const checklistStore = JSON.parse(window.localStorage.getItem("dayframe-daily-checklist-v1") || "{}");
    const dayframe = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const plannedTitles = Object.values(dayframe.plans || {}).flat().map((item) => item.title);
    return {
      items: (checklistStore.items || []).map((item) => item.title),
      completionDays: Object.keys(checklistStore.completedByDate || {}),
      leakedToPlanner: plannedTitles.includes("Vitamíny") || plannedTitles.includes("Angličtina"),
    };
  })).toEqual({
    items: ["Vitamíny", "Angličtina"],
    completionDays: ["2026-10-06"],
    leakedToPlanner: false,
  });

  await page.reload({ waitUntil: "networkidle" });
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/2");
  await expect(checklist.getByRole("button", { name: "Vrátit Vitamíny jako nesplněné" })).toBeVisible();

  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  await page.reload({ waitUntil: "networkidle" });
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/2");
  await expect(checklist.getByRole("button", { name: "Označit Vitamíny jako hotovo" })).toBeVisible();

  await page.clock.setFixedTime(new Date("2026-10-10T12:00:00Z"));
  await page.reload({ waitUntil: "networkidle" });
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/1");
  await expect(checklist.getByRole("button", { name: "Vitamíny", exact: true })).toBeVisible();
  await expect(checklist.getByRole("button", { name: "Angličtina", exact: true })).toHaveCount(0);
});

test("daily checklist items can be renamed, reordered and deleted", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00Z"));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-daily-checklist-v1", JSON.stringify({
      version: 1,
      items: [
        { id: "a", title: "Vitamíny", days: [1, 2, 3, 4, 5, 6, 0] },
        { id: "b", title: "Čtení", days: [1, 2, 3, 4, 5, 6, 0] },
        { id: "c", title: "Protáhnout se", days: [1, 2, 3, 4, 5, 6, 0] },
      ],
      completedByDate: {},
    }));
  });
  await page.reload({ waitUntil: "networkidle" });

  const checklist = page.locator("[data-daily-checklist]");
  await checklist.getByRole("button", { name: "Čtení", exact: true }).click();
  const modal = page.locator(".df2-checklist-modal");
  await modal.locator('input[name="title"]').fill("20 min čtení");
  await modal.getByRole("button", { name: "Uložit změny", exact: true }).click();
  await expect(checklist.getByRole("button", { name: "20 min čtení", exact: true })).toBeVisible();

  const first = checklist.locator('[data-checklist-id="a"]');
  const third = checklist.locator('[data-checklist-id="c"]');
  await first.dragTo(third);
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("dayframe-daily-checklist-v1") || "{}");
    return (stored.items || []).map((item) => item.id).join(",");
  })).toBe("b,a,c");

  await checklist.getByRole("button", { name: "Protáhnout se", exact: true }).click();
  await modal.getByRole("button", { name: "Smazat položku", exact: true }).click();
  await expect(checklist.getByRole("button", { name: "Protáhnout se", exact: true })).toHaveCount(0);
});
