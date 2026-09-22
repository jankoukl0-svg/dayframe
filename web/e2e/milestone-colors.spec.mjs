import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("milestone color can be changed and persists after reload", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [{
      id: "milestone-color-test",
      title: "SCIO test",
      date: "2027-01-30",
      note: "Vlastní termín",
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-milestone-colors-v1");
    window.localStorage.removeItem("dayframe-milestone-hidden-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Milníky/ }).click();
  const row = page.locator(".df2-milestones article").filter({ hasText: "SCIO test" });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-milestone-id", "milestone-color-test");

  await row.click();
  await expect(page.locator(".df2-milestone-color-presets button")).toHaveCount(10);
  await page.getByRole("button", { name: "Nastavit modré" }).click();

  await expect.poll(() => page.evaluate(() => {
    const colors = JSON.parse(window.localStorage.getItem("dayframe-milestone-colors-v1") || "{}");
    return colors["milestone-color-test"];
  })).toBe("#2563eb");

  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(row).toHaveCSS("border-left-color", "rgb(37, 99, 235)");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();
  const persistedRow = page.locator(".df2-milestones article").filter({ hasText: "SCIO test" });
  await expect(persistedRow).toHaveAttribute("data-milestone-id", "milestone-color-test");
  await expect(persistedRow).toHaveCSS("border-left-color", "rgb(37, 99, 235)");
});

test("milestone filters use ten presets and keep custom colors separate", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [
      { id: "blue-1", title: "SCIO online", date: "2026-11-05", note: "Vlastní termín" },
      { id: "blue-2", title: "SCIO test", date: "2026-12-05", note: "Vlastní termín" },
      { id: "custom-1", title: "Custom milestone", date: "2027-01-10", note: "Vlastní termín" },
      { id: "orange-1", title: "VŠE nanečisto", date: "2027-03-14", note: "Vlastní termín" },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-milestone-colors-v1", JSON.stringify({
      "blue-1": "#2563eb",
      "blue-2": "#2563eb",
      "custom-1": "#123456",
      "orange-1": "#c85b32",
    }));
    window.localStorage.removeItem("dayframe-milestone-hidden-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();

  await expect(page.locator(".df2-milestone-preset-filters button")).toHaveCount(10);

  const blueOne = page.locator('.df2-milestones article[data-milestone-id="blue-1"]');
  const blueTwo = page.locator('.df2-milestones article[data-milestone-id="blue-2"]');
  const custom = page.locator('.df2-milestones article[data-milestone-id="custom-1"]');
  const orange = page.locator('.df2-milestones article[data-milestone-id="orange-1"]');

  await page.getByRole("button", { name: "Skrýt modré milníky" }).click();
  await expect(blueOne).toBeHidden();
  await expect(blueTwo).toBeHidden();
  await expect(custom).toBeVisible();
  await expect(orange).toBeVisible();

  await page.getByRole("button", { name: "Skrýt custom" }).click();
  await expect(custom).toBeHidden();
  await expect(orange).toBeVisible();

  await expect.poll(() => page.evaluate(() => JSON.parse(
    window.localStorage.getItem("dayframe-milestone-hidden-colors-v1") || "{}",
  ))).toEqual({ preset: ["#2563eb"], custom: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();
  const persistedBlue = page.locator('.df2-milestones article[data-milestone-id="blue-1"]');
  const persistedCustom = page.locator('.df2-milestones article[data-milestone-id="custom-1"]');
  await expect(persistedBlue).toBeHidden();
  await expect(persistedCustom).toBeHidden();

  await page.getByRole("button", { name: "Zobrazit custom" }).click();
  await expect(persistedCustom).toBeVisible();
  await expect(persistedBlue).toBeHidden();

  await page.getByRole("button", { name: "Zobrazit vše" }).click();
  await expect(persistedBlue).toBeVisible();
});
