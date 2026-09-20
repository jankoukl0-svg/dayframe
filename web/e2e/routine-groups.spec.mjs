import { test, expect } from "@playwright/test";

test("groups repeated routines into compact rows and keeps their controls", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Nastavení" }).click();

  const groups = page.locator(".df2-routine-group");
  await expect(groups).toHaveCount(9);

  const english = groups.filter({ has: page.getByRole("button", { name: /Běžná angličtina/ }) });
  await expect(english).toHaveCount(1);
  await expect(english.locator(".df2-routine-slot")).toHaveCount(5);
  await expect(english).toContainText("Po 14:00");
  await expect(english).toContainText("Út 12:00");

  await english.getByRole("button", { name: /Běžná angličtina/ }).click();
  const mondayToggle = english.getByRole("checkbox", { name: /Běžná angličtina Po 14:00/ });
  await expect(mondayToggle).toBeVisible();
  await expect(mondayToggle).toBeChecked();
  await mondayToggle.click();
  await expect(mondayToggle).not.toBeChecked();
  await expect(english.locator(".df2-routine-slot.off")).toHaveCount(1);
});
