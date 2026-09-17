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
