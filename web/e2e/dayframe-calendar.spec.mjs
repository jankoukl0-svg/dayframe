import { test, expect } from "@playwright/test";

test("adds a task from the week without leaking internal scheduling syntax", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });

  await expect(page.getByText("Do konce dne", { exact: true })).toBeVisible();
  await expect(page.getByText("Konec 00:30", { exact: true })).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toBeVisible();
  await expect(page.locator(".df2-event-countdown")).toContainText("Nejbližší termín");

  const countdownVisual = await page.locator(".df2-day-ruler").evaluate((element) => {
    const ruler = getComputedStyle(element);
    const copy = getComputedStyle(element.querySelector(".df2-day-ruler-copy"));
    const clock = getComputedStyle(element.querySelector("strong"));
    const track = getComputedStyle(element.querySelector(".df2-day-track"));
    return {
      background: ruler.backgroundColor,
      borderTop: ruler.borderTopWidth,
      copyDisplay: copy.display,
      clockSize: Number.parseFloat(clock.fontSize),
      trackHeight: track.height,
    };
  });
  expect(countdownVisual.background).toBe("rgba(0, 0, 0, 0)");
  expect(countdownVisual.borderTop).toBe("1px");
  expect(countdownVisual.copyDisplay).toBe("grid");
  expect(countdownVisual.clockSize).toBeGreaterThan(36);
  expect(countdownVisual.trackHeight).toBe("2px");

  const eventVisual = await page.locator(".df2-event-countdown").evaluate((element) => {
    const panel = getComputedStyle(element);
    const days = getComputedStyle(element.querySelector("strong"));
    return { display: panel.display, daysSize: Number.parseFloat(days.fontSize) };
  });
  expect(eventVisual.display).toBe("grid");
  expect(eventVisual.daysSize).toBeGreaterThan(40);

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  const weekVisual = await page.locator(".df2-week-grid").evaluate((grid) => {
    const bodies = [...grid.querySelectorAll(".df2-time-body")];
    const tasks = [...grid.querySelectorAll(".df2-week-task")];
    const visibleHourLabels = [...grid.querySelectorAll(".df2-hour-line em")]
      .filter((label) => getComputedStyle(label).display !== "none").length;
    const contained = tasks.every((task) => {
      const body = task.closest(".df2-time-body");
      if (!body) return false;
      const taskRect = task.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      return taskRect.top >= bodyRect.top - 1 && taskRect.bottom <= bodyRect.bottom + 1;
    });
    const contentFits = tasks.every((task) => task.scrollHeight <= task.clientHeight + 1);

    const firstDay = grid.querySelector(".df2-week-day");
    const hourLines = firstDay ? [...firstDay.querySelectorAll(".df2-hour-line")] : [];
    const oneHourTask = firstDay
      ? [...firstDay.querySelectorAll(".df2-week-task")].find((task) => task.textContent?.includes("Matematika"))
      : null;
    const hourSlotHeight = hourLines.length >= 2
      ? hourLines[1].getBoundingClientRect().top - hourLines[0].getBoundingClientRect().top
      : 0;
    const oneHourTaskHeight = oneHourTask?.getBoundingClientRect().height ?? 0;

    return {
      bodyHeights: bodies.map((body) => body.getBoundingClientRect().height),
      visibleHourLabels,
      contained,
      contentFits,
      hourSlotHeight,
      oneHourTaskHeight,
    };
  });
  expect(weekVisual.bodyHeights.every((height) => height >= 561 && height <= 563)).toBe(true);
  expect(weekVisual.visibleHourLabels).toBe(14);
  expect(weekVisual.contained).toBe(true);
  expect(weekVisual.contentFits).toBe(true);
  expect(weekVisual.hourSlotHeight).toBeGreaterThan(43);
  expect(Math.abs(weekVisual.oneHourTaskHeight - weekVisual.hourSlotHeight)).toBeLessThan(0.6);

  await expect(page.locator(".df2-week-task.fixed-block .df2-task-lock").first()).toBeVisible();

  const draggedTitle = "CFI / Excel";
  const sourceTask = page.locator(".df2-week-day").first().locator(".df2-week-task").filter({ hasText: draggedTitle }).first();
  const saturdayBody = page.locator(".df2-week-day").nth(5).locator(".df2-time-body");
  await sourceTask.dragTo(saturdayBody, { targetPosition: { x: 70, y: 378 } });
  await expect(page.locator(".df2-notice")).toContainText("zamknuto");
  const movedTask = page.locator(".df2-week-day").nth(5).locator(".df2-week-task").filter({ hasText: draggedTitle }).first();
  await expect(movedTask).toBeVisible();
  await expect(movedTask).toContainText("18:00");
  await expect(movedTask.locator(".df2-task-lock")).toBeVisible();

  await movedTask.click();
  const modeSelect = page.locator('select[name="mode"]');
  await expect(modeSelect).toHaveValue("fixed");
  await expect(modeSelect.locator('option[value="fixed"]')).toHaveText("Zamknutý čas");
  await page.locator(".df2-modal header > button").click();

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  let targetIndex = todayIndex + 1;
  if (targetIndex > 6) {
    await page.locator(".df2-week-controls button").filter({ hasText: "→" }).click();
    targetIndex = 0;
  }

  const targetDay = page.locator(".df2-week-day").nth(targetIndex);
  await targetDay.locator(".df2-week-day-head > button").click();
  await expect(page.getByRole("heading", { name: "Přidat úkol" })).toBeVisible();

  await page.locator(".df2-title-input input").fill("Zeměpis 20 min");
  await page.getByRole("button", { name: "Naplánovat" }).click();

  const result = page.locator(".df2-result");
  await expect(result).toContainText("Zeměpis");
  await expect(result).not.toContainText("[[");

  await result.getByRole("button", { name: "Ukázat v týdnu" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);
  await expect(targetAfterSave).toContainText("Zeměpis");

  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
});
