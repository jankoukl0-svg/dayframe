import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("milestone color can be changed and persists after reload", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [{
      id: "milestone-color-test",
      title: "SCIO test",
      date: "2027-01-30",
      note: "Vlastní termín",
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    window.localStorage.removeItem("dayframe-milestone-colors-v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Milníky/ }).click();
  const row = page.locator(".df2-milestones article").filter({ hasText: "SCIO test" });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-milestone-id", "milestone-color-test");

  await row.click();
  const colorInput = page.getByLabel("Barva milníku");
  await expect(colorInput).toBeVisible();
  await colorInput.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Native input value setter is unavailable");
    setter.call(element, "#2563eb");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect.poll(() => page.evaluate(() => {
    const colors = JSON.parse(window.localStorage.getItem("dayframe-milestone-colors-v1") || "{}");
    return colors["milestone-color-test"];
  })).toBe("#2563eb");

  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(row).toHaveCSS("border-left-color", "rgb(37, 99, 235)");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();
  const persistedRow = page.locator(".df2-milestones article").filter({ hasText: "SCIO test" });
  await expect(persistedRow).toHaveAttribute("data-milestone-id", "milestone-color-test");
  await expect(persistedRow).toHaveCSS("border-left-color", "rgb(37, 99, 235)");
});
