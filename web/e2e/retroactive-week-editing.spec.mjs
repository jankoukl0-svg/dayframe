import { test, expect } from "@playwright/test";

test("past week days stay editable and accept retroactive tasks", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();

  const pastDay = page.locator(".df2-week-day").first();
  await expect(pastDay).toHaveClass(/df2-week-past-editable/);
  const addButton = pastDay.locator(".df2-week-day-head > button");
  await expect(addButton).toBeEnabled();

  const historyLabel = await pastDay.locator(".df2-week-day-head").evaluate((head) => getComputedStyle(head, "::after").content.replaceAll('"', ""));
  expect(historyLabel).toBe("historie");

  await addButton.click();
  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  const dayInput = dialog.locator(".df2-chips input[type='date']").first();
  const retroDate = await dayInput.inputValue();
  const today = await page.evaluate(() => {
    const now = new Date();
    if (now.getHours() < 2) now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  expect(retroDate < today).toBe(true);
  await expect(dayInput).not.toHaveAttribute("min");

  await dialog.locator(".df2-title-input input").fill("Zpětně doplněná práce");
  await dialog.locator("input[type='time']").first().fill("18:00");
  await page.getByRole("button", { name: "Naplánovat", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(pastDay.locator(".df2-week-task").filter({ hasText: "Zpětně doplněná práce" })).toBeVisible();
});
