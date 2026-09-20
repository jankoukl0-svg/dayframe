import { test, expect } from "@playwright/test";

test("pins and unpins a milestone directly from its editor", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Milníky" }).click();
  const vseMilestone = page.locator(".df2-milestones article").filter({ hasText: "Přijímací zkouška VŠE" });
  await vseMilestone.click();

  await expect(page.getByRole("heading", { name: "Upravit milník" })).toBeVisible();
  const featuredToggle = page.getByRole("checkbox", { name: "Zobrazovat na Dnes" });
  await expect(featuredToggle).toBeVisible();
  await expect(featuredToggle).not.toBeChecked();
  await featuredToggle.check();
  await expect(featuredToggle).toBeChecked();

  await page.locator(".df2-modal header > button").click();
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  await expect(page.locator(".df2-event-countdown")).toContainText("Vybraný termín");
  await expect(page.locator(".df2-event-countdown")).toContainText("Přijímací zkouška VŠE");

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Milníky" }).click();
  await page.locator(".df2-milestones article").filter({ hasText: "Přijímací zkouška VŠE" }).click();
  await expect(page.getByRole("checkbox", { name: "Zobrazovat na Dnes" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Zobrazovat na Dnes" }).uncheck();
  await page.locator(".df2-modal header > button").click();

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" }).click();
  await expect(page.locator(".df2-event-countdown")).toContainText("Nejbližší termín");
  await expect(page.locator(".df2-event-countdown")).toContainText("Dokončit CFI Excel");
});
