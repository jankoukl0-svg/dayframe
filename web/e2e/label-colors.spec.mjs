import { test, expect } from "@playwright/test";

// These fixtures use calendar dates, whereas Dayframe's planning day ends at 02:00.
// Freeze the browser clock at noon so tests stay valid across midnight UTC.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-09T12:00:00Z"));
});

test("label colors can be edited and persist in the week calendar", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "colored-math",
          title: "Barevná matematika",
          date,
          duration: 60,
          start: "10:00",
          end: "11:00",
          requestedStart: "10:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-label-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();
  const row = page.locator('[data-label-color-row="Matika"]');
  await expect(row).toBeVisible();
  const picker = row.getByLabel("Barva štítku Matika");
  await picker.fill("#3366cc");

  await expect.poll(() => page.evaluate(() => {
    const colors = JSON.parse(window.localStorage.getItem("dayframe-label-colors-v1") || "{}");
    return colors.Matika;
  })).toBe("#3366cc");

  await page.getByRole("button", { name: /Týden/ }).click();
  const task = page.locator(".df2-week-task").filter({ hasText: "Barevná matematika" });
  await expect(task).toBeVisible();
  await expect(task).toHaveCSS("border-left-color", "rgb(51, 102, 204)");
  await expect(task).toHaveAttribute("data-label-category", "Matika");
  await expect(task).toHaveCSS("background-color", "rgb(242, 240, 234)");
  await expect.poll(() => task.evaluate((element) => getComputedStyle(element).backgroundImage))
    .toContain("rgba(51, 102, 204, 0.09)");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  const persisted = page.locator(".df2-week-task").filter({ hasText: "Barevná matematika" });
  await expect(persisted).toBeVisible();
  await expect(persisted).toHaveCSS("border-left-color", "rgb(51, 102, 204)");
  await expect(persisted).toHaveCSS("background-color", "rgb(242, 240, 234)");
  await expect.poll(() => persisted.evaluate((element) => getComputedStyle(element).backgroundImage))
    .toContain("rgba(51, 102, 204, 0.09)");
});

test("task edit modal exposes the color picker for its category", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [
        {
          id: "modal-colored-math",
          title: "Matematika modal",
          date,
          duration: 60,
          start: "10:00",
          end: "11:00",
          requestedStart: "10:00",
          deadlineTime: "22:30",
          priority: "normal",
          category: "Matika",
          mode: "flexible",
          completed: false,
          source: "user",
          dateLocked: true,
          autoScheduled: false,
          createdAt: now.toISOString(),
        },
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-label-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-task").filter({ hasText: "Matematika modal" }).click();

  const modal = page.locator(".df2-modal");
  await expect(modal).toBeVisible();
  const picker = modal.getByLabel("Barva štítku Matika v editoru");
  await expect(picker).toBeVisible();
  await picker.fill("#7c3aed");

  await expect.poll(() => page.evaluate(() => {
    const colors = JSON.parse(window.localStorage.getItem("dayframe-label-colors-v1") || "{}");
    return colors.Matika;
  })).toBe("#7c3aed");

  await modal.getByRole("button", { name: "×" }).click();
  const task = page.locator(".df2-week-task").filter({ hasText: "Matematika modal" });
  await expect(task).toHaveCSS("border-left-color", "rgb(124, 58, 237)");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await expect(page.locator(".df2-week-task").filter({ hasText: "Matematika modal" }))
    .toHaveCSS("border-left-color", "rgb(124, 58, 237)");
});

test("new custom labels render as React-owned category options and history period changes do not crash", async ({ page }) => {
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.getByRole("button", { name: /Nastavení/ }).click();
  await page.getByRole("button", { name: "+ Nový štítek" }).click();
  await page.getByRole("textbox", { name: "Název nového štítku" }).fill("Vlastní výzkum");
  await page.locator(".df2-label-add").getByRole("button", { name: "Přidat" }).click();
  await expect(page.locator('[data-label-color-row="Vlastní výzkum"]')).toBeVisible();

  await page.keyboard.press("2");
  const dialog = page.locator(".df2-add-modal");
  await expect(dialog).toBeVisible();
  await dialog.locator("summary").filter({ hasText: "Podrobnosti" }).click();
  const category = dialog.locator("label").filter({ hasText: "Oblast" }).locator("select");
  await expect(category.locator("option")).toContainText(["Vlastní výzkum"]);
  await category.selectOption("Vlastní výzkum");
  await expect(category).toHaveValue("Vlastní výzkum");
  await page.waitForTimeout(450); // Previously an interval replaced React's option nodes.
  await expect(category).toHaveValue("Vlastní výzkum");
  await dialog.getByRole("button", { name: "Zavřít" }).click();

  await page.getByRole("button", { name: /Přehled/ }).click();
  const overview = page.locator(".df2-history-view");
  await expect(overview).toBeVisible();
  await overview.getByRole("button", { name: "Měsíc", exact: true }).click();
  await overview.getByRole("button", { name: "Předchozí období" }).click();
  await expect(overview).toBeVisible();
  await expect(overview.locator("[data-reading-overview-host]")).toBeVisible();
  expect(browserErrors.filter(message => message.includes("removeChild"))).toEqual([]);
});
