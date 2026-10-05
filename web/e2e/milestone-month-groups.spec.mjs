import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function atMonth(year, monthIndex, day) {
  return dateKey(new Date(year, monthIndex, day, 12));
}

test("milestones group by month, show continuous day spacing, and distinguish deadline from option", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const seed = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
    const followingMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1, 12);
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const firstDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 3, 12);
    const secondDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 10, 12);
    const thirdDate = new Date(followingMonth.getFullYear(), followingMonth.getMonth(), 5, 12);
    const first = key(firstDate);
    const second = key(secondDate);
    const third = key(thirdDate);
    const past = key(new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 2), 12));
    const crossMonthGapDays = Math.round((Date.UTC(thirdDate.getFullYear(), thirdDate.getMonth(), thirdDate.getDate()) - Date.UTC(secondDate.getFullYear(), secondDate.getMonth(), secondDate.getDate())) / 86_400_000);
    state.milestones = [
      { id: "past-hidden", title: "Starý termín", date: past, note: "Vlastní termín" },
      { id: "month-deadline", title: "Deadline test", date: first, note: "Musím stihnout" },
      { id: "month-option", title: "Možnost test", date: second, note: "Alternativní termín" },
      { id: "next-month-deadline", title: "Další měsíc", date: third, note: "Vlastní termín" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-milestone-types-v1", JSON.stringify({
      "month-deadline": "deadline",
      "month-option": "option",
      "next-month-deadline": "deadline",
    }));
    return {
      nextMonthYear: nextMonth.getFullYear(),
      nextMonthIndex: nextMonth.getMonth(),
      crossMonthGapDays,
    };
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".df2-sidebar nav button", { hasText: "Milníky" }).click();
  await expect(page.getByRole("heading", { name: "Milníky" })).toBeVisible();

  const list = page.locator(".df2-milestones");
  await expect(list.locator(":scope > .df2-milestone-month-divider")).toHaveCount(2);
  await expect(list.locator('article[data-milestone-id="past-hidden"]')).toBeHidden();

  const deadline = list.locator('article[data-milestone-id="month-deadline"]');
  const option = list.locator('article[data-milestone-id="month-option"]');
  await expect(deadline).toBeVisible();
  await expect(option).toBeVisible();
  await expect(deadline.locator(".df2-milestone-kind-badge")).toHaveText("Deadline");
  await expect(option.locator(".df2-milestone-kind-badge")).toHaveText("Možnost");

  const sameMonthGap = list.locator(':scope > .df2-milestone-day-gap[aria-label="7 dní mezi termíny"]');
  await expect(sameMonthGap).toHaveCount(1);
  await expect(sameMonthGap).toHaveAttribute("style", /--df2-gap-days: 7/);

  const crossMonthGap = list.locator(`:scope > .df2-milestone-day-gap[aria-label="${seed.crossMonthGapDays} dní mezi termíny"]`);
  await expect(crossMonthGap).toHaveCount(1);
  await expect(crossMonthGap).toHaveAttribute("style", new RegExp(`--df2-gap-days: ${seed.crossMonthGapDays}`));
  await expect(list.locator(":scope > .df2-milestone-day-gap")).toHaveCount(2);

  await option.click();
  const editModal = page.locator(".df2-modal", { has: page.getByRole("heading", { name: "Upravit milník" }) });
  await expect(editModal).toBeVisible();
  const kindSelect = editModal.locator(".df2-milestone-kind-editor select");
  await expect(kindSelect).toHaveValue("option");
  await kindSelect.selectOption("deadline");
  await editModal.getByRole("button", { name: "×" }).click();
  await expect(option.locator(".df2-milestone-kind-badge")).toHaveText("Deadline");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-milestone-types-v1") || "{}")["month-option"])).toBe("deadline");

  const newDate = atMonth(seed.nextMonthYear, seed.nextMonthIndex, 20);
  const addForm = page.locator(".df2-inline-form");
  await addForm.locator('input[placeholder="Nový milník"]').fill("Dodatečná možnost");
  await addForm.locator('input[type="date"]').fill(newDate);
  await addForm.getByLabel("Typ milníku").selectOption("option");
  await addForm.getByRole("button", { name: "Přidat" }).click();

  const added = list.locator("article", { hasText: "Dodatečná možnost" });
  await expect(added).toBeVisible();
  await expect(added.locator(".df2-milestone-kind-badge")).toHaveText("Možnost");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const types = JSON.parse(window.localStorage.getItem("dayframe-milestone-types-v1") || "{}");
    const milestone = (state.milestones || []).find((item) => item.title === "Dodatečná možnost");
    return milestone ? types[milestone.id] : null;
  })).toBe("option");
});