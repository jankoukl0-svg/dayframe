import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function shiftDate(date, days) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

async function moveToMonth(page, targetYear, targetMonth) {
  await page.getByRole("button", { name: "Tento měsíc" }).click();
  const current = await page.evaluate(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }));
  const difference = (targetYear - current.year) * 12 + targetMonth - current.month;
  const control = difference >= 0 ? "Další měsíc" : "Předchozí měsíc";
  for (let index = 0; index < Math.abs(difference); index += 1) {
    await page.getByRole("button", { name: control }).click();
  }
}

test("calendar includes readable but secondary Czech holidays, Easter, Christmas, Halloween and major world observances without storing duplicates", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const milestoneSnapshot = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return JSON.stringify(state.milestones || []);
  });
  const year = await page.evaluate(() => new Date().getFullYear());

  await page.locator(".df2-month-calendar-nav-button").click();
  await expect(page.getByRole("heading", { name: "Kalendář" })).toBeVisible();

  await moveToMonth(page, year, 9);
  const october24 = page.locator(`.df2-month-day[data-date="${year}-10-24"]`);
  const october27 = page.locator(`.df2-month-day[data-date="${year}-10-27"]`);
  const october28 = page.locator(`.df2-month-day[data-date="${year}-10-28"]`);
  const october31 = page.locator(`.df2-month-day[data-date="${year}-10-31"]`);
  const publicObservance = october28.locator(".df2-calendar-observance.public");
  const publicLabel = publicObservance.locator("strong");

  await expect(october28.getByText("Den vzniku samostatného československého státu", { exact: true })).toBeVisible();
  await expect(october31.getByText("Halloween", { exact: true })).toBeVisible();
  await expect(october24.getByText("Den OSN", { exact: true })).toBeVisible();

  await expect.poll(() => publicObservance.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderTopWidth,
    opacity: getComputedStyle(element).opacity,
  }))).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px", opacity: "0.86" });

  await expect.poll(() => publicLabel.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).toEqual({ background: "rgb(241, 223, 220)", fontSize: "10px", fontWeight: "640" });

  const dayBackgrounds = await Promise.all([
    october24,
    october27,
    october28,
    october31,
  ].map((locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor)));
  const [worldBackground, ordinaryBackground, publicBackground, traditionBackground] = dayBackgrounds;
  expect(worldBackground).not.toBe(ordinaryBackground);
  expect(publicBackground).not.toBe(ordinaryBackground);
  expect(traditionBackground).not.toBe(ordinaryBackground);
  expect(new Set([worldBackground, publicBackground, traditionBackground]).size).toBe(3);

  await moveToMonth(page, year, 11);
  await expect(page.locator(`.df2-month-day[data-date="${year}-12-24"]`).getByText("Štědrý den", { exact: true })).toBeVisible();
  await expect(page.locator(`.df2-month-day[data-date="${year}-12-25"]`).getByText("1. svátek vánoční", { exact: true })).toBeVisible();
  await expect(page.locator(`.df2-month-day[data-date="${year}-12-26"]`).getByText("2. svátek vánoční", { exact: true })).toBeVisible();

  const easter = easterSunday(year);
  const goodFriday = shiftDate(easter, -2);
  const easterMonday = shiftDate(easter, 1);

  await moveToMonth(page, goodFriday.getFullYear(), goodFriday.getMonth());
  await expect(page.locator(`.df2-month-day[data-date="${dateKey(goodFriday)}"]`).getByText("Velký pátek", { exact: true })).toBeVisible();

  await moveToMonth(page, easter.getFullYear(), easter.getMonth());
  await expect(page.locator(`.df2-month-day[data-date="${dateKey(easter)}"]`).getByText("Velikonoční neděle", { exact: true })).toBeVisible();

  await moveToMonth(page, easterMonday.getFullYear(), easterMonday.getMonth());
  await expect(page.locator(`.df2-month-day[data-date="${dateKey(easterMonday)}"]`).getByText("Velikonoční pondělí", { exact: true })).toBeVisible();

  await moveToMonth(page, year, 8);
  await expect(page.locator(`.df2-month-day[data-date="${year}-09-21"]`).getByText("Mezinárodní den míru", { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return JSON.stringify(state.milestones || []);
  })).toBe(milestoneSnapshot);
});
