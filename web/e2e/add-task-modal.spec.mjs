import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
});

test("add task opens as a modal without leaving Today and closes with Escape", async ({ page }) => {
  const todayNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" });
  const addNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" });

  await expect(todayNav).toHaveClass(/active/);
  await page.getByRole("button", { name: "+ Nový úkol" }).click();

  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  await expect(todayNav).toHaveClass(/active/);
  await expect(addNav).not.toHaveClass(/active/);

  const expectedToday = await page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  await expect(dialog.locator('input[type="date"]').first()).toHaveValue(expectedToday);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(todayNav).toHaveClass(/active/);
});

test("sidebar and shortcut 2 open the modal while preserving the active week", async ({ page }) => {
  const weekNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" });
  const addNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" });
  await weekNav.click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  await addNav.click();
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
  await expect(weekNav).toHaveClass(/active/);
  await expect(addNav).not.toHaveClass(/active/);

  await page.getByRole("button", { name: "Zavřít" }).click();
  await page.keyboard.press("2");
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
  await expect(weekNav).toHaveClass(/active/);

  await page.locator(".df2-modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toHaveCount(0);
  await expect(page.locator(".df2-week-grid")).toBeVisible();
});

test("week day add prefills the date and scheduling returns directly to the week", async ({ page }) => {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  const today = page.locator(".df2-week-day.today");
  const expectedDate = await page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  await today.locator(".df2-week-day-head > button").click();
  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="date"]').first()).toHaveValue(expectedDate);

  await dialog.locator(".df2-title-input input").fill("Modal test 20 min");
  await dialog.getByRole("button", { name: "Naplánovat" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  await expect(page.locator(".df2-week-day.today")).toContainText("Modal test");
  await expect(page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" })).toHaveClass(/active/);
});
