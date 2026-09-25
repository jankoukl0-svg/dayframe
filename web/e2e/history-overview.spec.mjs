import { test, expect } from "@playwright/test";

test("history overview summarizes completed work, colors bars by labels, and keeps only Overview visually active", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {};
    state.plans[date] = [
      {
        id: "history-done-finance",
        title: "Hotový finance blok",
        date,
        duration: 45,
        actualMinutes: 45,
        start: "10:00",
        end: "10:45",
        requestedStart: "10:00",
        dueDate: date,
        deadlineTime: "22:30",
        priority: "normal",
        category: "Finance",
        mode: "flexible",
        completed: true,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      },
      {
        id: "history-done-math",
        title: "Hotový matika blok",
        date,
        duration: 15,
        actualMinutes: 15,
        start: "11:00",
        end: "11:15",
        requestedStart: "11:00",
        dueDate: date,
        deadlineTime: "22:30",
        priority: "normal",
        category: "Matika",
        mode: "flexible",
        completed: true,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      },
      {
        id: "history-open",
        title: "Nedokončený testovací blok",
        date,
        duration: 30,
        start: "12:00",
        end: "12:30",
        requestedStart: "12:00",
        dueDate: date,
        deadlineTime: "22:30",
        priority: "normal",
        category: "Angličtina",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.setItem("dayframe-label-colors-v1", JSON.stringify({ Finance: "#112233", Matika: "#44aa66" }));
  });
  await page.reload({ waitUntil: "networkidle" });

  const milestones = page.getByRole("button", { name: /Milníky/ });
  const overview = page.getByRole("button", { name: /Přehled/ });
  await milestones.click();
  await expect(milestones).toHaveClass(/active/);

  await overview.click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();
  await expect(history.getByRole("heading", { name: "Přehled" })).toBeVisible();
  await expect(history).toContainText("2 / 3");
  await expect(history).toContainText("67%");
  await expect(history).toContainText("1 h");
  await expect(history).toContainText("Finance");
  await expect(history).toContainText("Matika");

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const todayBar = history.locator(".df2-history-bars article").nth(todayIndex).locator(".df2-history-bar");
  const segments = todayBar.locator(":scope > span");
  await expect(segments).toHaveCount(2);
  await expect(todayBar.locator('[data-category="Finance"]')).toHaveCSS("background-color", "rgb(17, 34, 51)");
  await expect(todayBar.locator('[data-category="Matika"]')).toHaveCSS("background-color", "rgb(68, 170, 102)");
  expect(await todayBar.locator('[data-category="Finance"]').evaluate((element) => element.style.flexGrow)).toBe("45");
  expect(await todayBar.locator('[data-category="Matika"]').evaluate((element) => element.style.flexGrow)).toBe("15");

  await expect(overview).toHaveClass(/active/);
  const milestoneShadow = await milestones.evaluate((element) => getComputedStyle(element).boxShadow);
  const overviewShadow = await overview.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(milestoneShadow).toBe("none");
  expect(overviewShadow).not.toBe("none");

  await page.getByRole("button", { name: /Dnes/ }).click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("heading", { name: "Dnes" })).toBeVisible();
});
