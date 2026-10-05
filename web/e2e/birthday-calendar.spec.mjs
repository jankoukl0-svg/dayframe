import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function keyFor(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

test("birthdays recur yearly with age and stay separate from milestones", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seeded = await page.evaluate(() => {
    window.localStorage.removeItem("dayframe-birthdays-v1");
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      birthYear: now.getFullYear() - 20,
    };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-month-calendar-nav-button").click();
  await expect(page.getByRole("heading", { name: "Kalendář" })).toBeVisible();

  const targetKey = keyFor(seeded.year, seeded.month, 15);
  const targetCell = page.locator(`.df2-month-day[data-date="${targetKey}"]`);
  await expect(targetCell).toBeVisible();
  const addBirthday = targetCell.getByRole("button", { name: `Přidat narozeniny ${targetKey}` });
  await expect(addBirthday).toBeVisible();
  await addBirthday.click();

  const birthdayModal = page.locator(".df2-birthday-modal");
  await expect(birthdayModal.getByRole("heading", { name: "Nové narozeniny" })).toBeVisible();
  await birthdayModal.locator('input[name="name"]').fill("Anna");
  await birthdayModal.locator('input[name="birthYear"]').fill(String(seeded.birthYear));
  await birthdayModal.locator('textarea[name="note"]').fill("Koupit dárek");
  await birthdayModal.getByRole("button", { name: "Přidat narozeniny" }).click();

  const birthdayCard = targetCell.locator(".df2-month-birthday");
  await expect(birthdayCard).toContainText("Anna");
  await expect(birthdayCard).toContainText("20. narozeniny");
  await expect.poll(() => page.evaluate(() => {
    const birthdays = JSON.parse(window.localStorage.getItem("dayframe-birthdays-v1") || "[]");
    return birthdays.length === 1
      && birthdays[0].name === "Anna"
      && birthdays[0].day === 15
      && birthdays[0].birthYear === new Date().getFullYear() - 20;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return (state.milestones || []).some((milestone) => milestone.title === "Anna");
  })).toBe(false);

  for (let index = 0; index < 12; index += 1) {
    await page.getByRole("button", { name: "Další měsíc" }).click();
  }

  const nextYearKey = keyFor(seeded.year + 1, seeded.month, 15);
  const nextYearCell = page.locator(`.df2-month-day[data-date="${nextYearKey}"]`);
  await expect(nextYearCell).toBeVisible();
  const nextYearBirthday = nextYearCell.locator(".df2-month-birthday");
  await expect(nextYearBirthday).toContainText("Anna");
  await expect(nextYearBirthday).toContainText("21. narozeniny");

  await nextYearBirthday.click();
  await expect(page.getByRole("heading", { name: "Upravit narozeniny" })).toBeVisible();
  const editModal = page.locator(".df2-birthday-modal");
  await editModal.locator('input[name="name"]').fill("Anna Nováková");
  await editModal.getByRole("button", { name: "Uložit změny" }).click();
  await expect(nextYearCell.locator(".df2-month-birthday")).toContainText("Anna Nováková");
  await expect.poll(() => page.evaluate(() => {
    const birthdays = JSON.parse(window.localStorage.getItem("dayframe-birthdays-v1") || "[]");
    return birthdays[0]?.name;
  })).toBe("Anna Nováková");
});
