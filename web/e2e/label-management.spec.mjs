import { test, expect } from "@playwright/test";

test("labels can be renamed, added, and assigned to routines", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [
      {
        id: "label-routine",
        title: "Testovací rutina štítků",
        duration: 30,
        start: "20:00",
        category: "Matika",
        frequency: "daily",
        active: true,
        createdAt: now.toISOString(),
      },
    ];
    state.plans = {
      [date]: [
        {
          id: "label-task",
          title: "Testovací blok štítků",
          date,
          duration: 30,
          start: "18:00",
          end: "18:30",
          requestedStart: "18:00",
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
    window.localStorage.setItem("dayframe-label-colors-v1", JSON.stringify({ Matika: "#eb0000" }));
    window.localStorage.removeItem("dayframe-labels-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();

  const mathRow = page.locator('[data-label-color-row="Matika"]');
  await expect(mathRow).toBeVisible();
  await mathRow.getByRole("button", { name: "Upravit" }).click();
  await mathRow.getByLabel("Název štítku Matika").fill("Matematika");
  await mathRow.getByRole("button", { name: "Uložit" }).click();

  await expect(page.locator('[data-label-color-row="Matematika"]')).toBeVisible();
  await expect(page.locator('[data-label-color-row="Matika"]')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const colors = JSON.parse(window.localStorage.getItem("dayframe-label-colors-v1") || "{}");
    const labels = JSON.parse(window.localStorage.getItem("dayframe-labels-v1") || "[]");
    return {
      routine: state.routines?.find((item) => item.id === "label-routine")?.category,
      task: Object.values(state.plans || {}).flat().find((item) => item.id === "label-task")?.category,
      color: colors.Matematika,
      oldColor: colors.Matika,
      hasNew: labels.includes("Matematika"),
      hasOld: labels.includes("Matika"),
    };
  })).toEqual({
    routine: "Matematika",
    task: "Matematika",
    color: "#eb0000",
    oldColor: undefined,
    hasNew: true,
    hasOld: false,
  });

  await page.getByRole("button", { name: "+ Nový štítek" }).click();
  await page.getByLabel("Název nového štítku").fill("Čtení");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.locator('[data-label-color-row="Čtení"]')).toBeVisible();

  const routineGroup = page.locator(".df2-routine-group").filter({ hasText: "Testovací rutina štítků" }).first();
  await expect(routineGroup).toBeVisible();
  await routineGroup.locator(".df2-routine-group-summary").click();
  await routineGroup.getByRole("button", { name: "Upravit" }).click();

  const editor = page.locator(".df2-routine-editor");
  await expect(editor).toBeVisible();
  const category = editor.getByLabel("Oblast");
  await expect(category).toHaveValue("Matematika");
  await expect(category.locator('option[value="Čtení"]')).toHaveCount(1);
  await expect(editor.getByLabel("Barva štítku Matematika v editoru")).toBeVisible();
  await category.selectOption("Čtení");

  const load = page.waitForEvent("load");
  await editor.getByRole("button", { name: "Uložit změny" }).click();
  await load;
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Nastavení" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.routines?.find((item) => item.id === "label-routine")?.category;
  })).toBe("Čtení");
});
