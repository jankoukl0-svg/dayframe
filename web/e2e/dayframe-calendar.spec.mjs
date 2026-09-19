import { test, expect } from "@playwright/test";

test("adds a task from the week without leaking internal scheduling syntax", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });

  await expect(page.getByText("Do konce dne", { exact: true })).toBeVisible();
  await expect(page.locator(".df2-sidebar-bottom")).toContainText("00:30");
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
  await expect(page.getByText(/zamknut/i)).toHaveCount(0);
  await expect(page.locator(".df2-task-lock")).toHaveCount(0);
  await expect(page.locator(".df2-lock-glyph")).toHaveCount(0);

  const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const stateLabels = await page.locator(".df2-week-day").evaluateAll((days) => days.map((day) => {
    const head = day.querySelector(".df2-week-day-head");
    return head ? getComputedStyle(head, "::after").content.replaceAll('"', "") : "";
  }));
  expect(stateLabels[todayIndex]).toBe("dnes");
  for (let index = 0; index < todayIndex; index += 1) expect(stateLabels[index]).toBe("historie");
  for (let index = todayIndex + 1; index < 7; index += 1) expect(stateLabels[index]).toBe("plán");

  if (todayIndex > 0) {
    const pastDays = page.locator(".df2-week-day:has(.df2-week-day-head > button:disabled)");
    await expect(pastDays).toHaveCount(todayIndex);
    await expect(pastDays.locator(".df2-week-task:visible")).toHaveCount(0);
    const pastPointerEvents = await pastDays.first().locator(".df2-time-body").evaluate((element) => getComputedStyle(element).pointerEvents);
    expect(pastPointerEvents).toBe("none");
  }

  const weekVisual = await page.locator(".df2-week-grid").evaluate((grid) => {
    const bodies = [...grid.querySelectorAll(".df2-time-body")];
    const tasks = [...grid.querySelectorAll(".df2-week-task")]
      .filter((task) => getComputedStyle(task).display !== "none");
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

    const geometryDay = grid.querySelector(".df2-week-day.today");
    const hourLines = geometryDay ? [...geometryDay.querySelectorAll(".df2-hour-line")] : [];
    const oneHourTask = geometryDay
      ? [...geometryDay.querySelectorAll(".df2-week-task")].find((task) => task.textContent?.includes("Matematika") && getComputedStyle(task).display !== "none")
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
  if (weekVisual.oneHourTaskHeight > 0) {
    expect(Math.abs(weekVisual.oneHourTaskHeight - weekVisual.hourSlotHeight)).toBeLessThan(0.6);
  }

  await page.locator(".df2-week-controls button").filter({ hasText: "Tento týden" }).click();
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

  await result.getByRole("button", { name: "Týden", exact: true }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);
  await expect(targetAfterSave).toContainText("Zeměpis");

  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
  await expect(page.getByText("Prázdné = Dayframe najde volný čas automaticky.", { exact: true })).toBeVisible();
  await page.locator(".df2-modal header > button").click();

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Milníky" }).click();
  const milestone = page.locator(".df2-milestones article").filter({ hasText: "Dokončit CFI Excel" });
  await milestone.click();
  await expect(page.getByRole("heading", { name: "Upravit milník" })).toBeVisible();
  await page.locator('.df2-modal input[name="title"]').fill("Dokončit CFI Excel test");
  await page.locator('.df2-modal input[name="date"]').fill("2026-11-02");
  await page.locator('.df2-modal input[name="note"]').fill("Aktualizovaný termín");
  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(page.locator(".df2-milestones")).toContainText("Dokončit CFI Excel test");
  await expect(page.locator(".df2-milestones")).toContainText("Aktualizovaný termín");
});
