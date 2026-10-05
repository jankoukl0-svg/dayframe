import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function atNoon(year, month, day) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

test("milestones are grouped by month with daily distance ticks and deadline/option types", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const fixture = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const firstMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
    const secondMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1, 12);
    const first = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 6, 12);
    const option = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 20, 12);
    const next = new Date(secondMonth.getFullYear(), secondMonth.getMonth(), 3, 12);
    const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    state.milestones = [
      { id: "past-milestone", title: "Starý termín", date: key(past), note: "Vlastní termín" },
      { id: "deadline-a", title: "Hlavní deadline", date: key(first), note: "Přihláška" },
      { id: "option-a", title: "Alternativní termín", date: key(option), note: "Volitelný termín" },
      { id: "deadline-b", title: "Další deadline", date: key(next), note: "Vlastní termín" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-milestone-kinds-v1", JSON.stringify({
      "deadline-a": "deadline",
      "option-a": "option",
      "deadline-b": "deadline",
    }));
    window.localStorage.setItem("dayframe-milestone-hidden-colors-v1", JSON.stringify({ preset: [], custom: false }));
    return {
      next: key(next),
      firstMonth: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}`,
      secondMonth: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Milníky" }).click();

  const list = page.locator(".df2-milestones");
  await expect(list).toBeVisible();
  await expect(list.locator(":scope > .df2-milestone-today-anchor")).toContainText("Dnes");
  await expect(list.locator(":scope > .df2-milestone-month-head")).toHaveCount(2);
  await expect(list.locator(`:scope > .df2-milestone-month-head[data-month="${fixture.firstMonth}"]`)).toBeVisible();
  await expect(list.locator(`:scope > .df2-milestone-month-head[data-month="${fixture.secondMonth}"]`)).toBeVisible();
  await expect(list.locator('[data-milestone-id="past-milestone"]')).toBeHidden();

  const deadline = list.locator('article[data-milestone-id="deadline-a"]');
  const option = list.locator('article[data-milestone-id="option-a"]');
  await expect(deadline).toBeVisible();
  await expect(option).toBeVisible();
  await expect(deadline.locator("[data-milestone-kind-badge]")).toHaveText("Deadline");
  await expect(option.locator("[data-milestone-kind-badge]")).toHaveText("Možnost");

  const fourteenDayGap = list.locator(':scope > .df2-milestone-day-gap[data-gap-days="14"]');
  await expect(fourteenDayGap).toBeVisible();
  await expect(fourteenDayGap.locator(".df2-milestone-day-ruler > span")).toHaveCount(14);
  await expect(fourteenDayGap.locator(".df2-milestone-day-ruler > span.week")).toHaveCount(2);

  await option.click();
  const editModal = page.locator(".df2-modal").filter({ has: page.getByRole("heading", { name: "Upravit milník" }) });
  await expect(editModal).toBeVisible();
  await expect(editModal.getByLabel("Typ milníku")).toHaveValue("option");
  await editModal.getByLabel("Typ milníku").selectOption("deadline");
  await editModal.getByRole("button", { name: "Uložit změny" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-milestone-kinds-v1") || "{}")["option-a"])).toBe("deadline");
  await expect(option.locator("[data-milestone-kind-badge]")).toHaveText("Deadline");

  const newDate = atNoon(Number(fixture.next.slice(0, 4)), Number(fixture.next.slice(5, 7)) - 1, 18);
  const newDateKey = dateKey(newDate);
  const addForm = page.locator(".df2-inline-form");
  await addForm.locator('input[placeholder="Nový milník"]').fill("Nová možnost");
  await addForm.locator('input[type="date"]').fill(newDateKey);
  await addForm.getByLabel("Typ nového milníku").selectOption("option");
  await addForm.getByRole("button", { name: "Přidat" }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return Boolean(state.milestones?.find((milestone) => milestone.title === "Nová možnost"));
  })).toBe(true);

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const milestone = state.milestones?.find((item) => item.title === "Nová možnost");
    const kinds = JSON.parse(window.localStorage.getItem("dayframe-milestone-kinds-v1") || "{}");
    return milestone ? kinds[milestone.id] : null;
  })).toBe("option");

  const created = list.locator('article[data-milestone-kind="option"]').filter({ hasText: "Nová možnost" });
  await expect(created).toBeVisible();
  await expect(created.locator("[data-milestone-kind-badge]")).toHaveText("Možnost");
});
