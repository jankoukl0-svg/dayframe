import { test, expect } from "@playwright/test";

test("core Dayframe views share the softer Přehled visual language without changing navigation", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const today = page.getByRole("button", { name: /Dnes/ });
  await expect(today).toHaveClass(/active/);
  await expect(today).toHaveCSS("border-radius", "10px");

  const week = page.getByRole("button", { name: /Týden/ });
  await week.click();
  await expect(page.locator(".df2-week-grid")).toHaveCSS("border-radius", "18px");

  const calendar = page.getByRole("button", { name: "Kalendář", exact: true });
  await calendar.click();
  await expect(calendar).toHaveClass(/active/);
  await expect(calendar).toHaveCSS("border-radius", "10px");
  await expect.poll(() => week.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");

  await page.getByRole("button", { name: /Milníky/ }).click();
  const milestones = page.locator(".df2-milestones");
  await expect(milestones).toHaveCSS("border-radius", "20px");
  await expect(milestones).toHaveCSS("background-color", "rgb(255, 254, 250)");

  const milestoneTitle = page.locator(".df2-page-head h1");
  const milestoneTitleStyle = await milestoneTitle.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
    };
  });

  await page.getByRole("button", { name: "Přehled", exact: true }).click();
  const overviewTitle = page.locator(".df2-history-head h1");
  await expect(overviewTitle).toHaveText("Přehled");
  await expect.poll(() => overviewTitle.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
    };
  })).toEqual(milestoneTitleStyle);

  await page.getByRole("button", { name: /Nastavení/ }).click();
  const settings = page.locator(".df2-settings-card");
  await expect(settings).toHaveCSS("border-radius", "20px");
  await expect(settings).toHaveCSS("background-color", "rgb(255, 254, 250)");

  await page.keyboard.press("2");
  const modal = page.locator(".df2-modal").first();
  await expect(modal).toBeVisible();
  await expect(modal).toHaveCSS("border-radius", "22px");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Soustředění/ }).click();
  await expect(page.locator(".df2-root")).toHaveClass(/df2-focus-mode/);
  await expect(page.locator(".df2-focus-actions button").first()).toHaveCSS("border-radius", "10px");
});
