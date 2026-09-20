import { test, expect } from "@playwright/test";

test("lets the user choose which milestone is shown on Today and remembers it", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const card = page.locator(".df2-event-countdown");
  const picker = page.getByRole("button", { name: "Vybrat zobrazený milník" });

  await expect(card).toContainText("Dokončit CFI Excel");
  await expect(picker).toBeVisible();

  await picker.click();
  await page.getByRole("menu", { name: "Zobrazený milník" })
    .getByRole("button", { name: /Přijímací zkouška VŠE/ })
    .click();

  await expect(card).toContainText("Vybraný termín");
  await expect(card).toContainText("Přijímací zkouška VŠE");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".df2-event-countdown")).toContainText("Přijímací zkouška VŠE");

  await page.getByRole("button", { name: "Vybrat zobrazený milník" }).click();
  await page.getByRole("menu", { name: "Zobrazený milník" })
    .getByRole("button", { name: /Automaticky/ })
    .click();

  await expect(page.locator(".df2-event-countdown")).toContainText("Nejbližší termín");
  await expect(page.locator(".df2-event-countdown")).toContainText("Dokončit CFI Excel");
});
