import { test, expect } from "@playwright/test";

test("Focus → Přehled → Focus keeps the overview light and restores dark focus", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const root = page.locator(".df2-root");
  const main = page.locator(".df2-main");
  const sidebar = page.locator(".df2-sidebar");
  const focus = page.getByRole("button", { name: /Soustředění/ });
  const overview = page.getByRole("button", { name: /Přehled/ });
  const today = page.getByRole("button", { name: /Dnes/ });

  const lightMainBackground = await main.evaluate((element) => getComputedStyle(element).backgroundColor);
  const lightSidebarBackground = await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor);
  const normalActiveStyle = await today.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });

  await focus.click();
  await expect(root).toHaveClass(/df2-focus-mode/);
  const focusMainBackground = await main.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(focusMainBackground).not.toBe(lightMainBackground);

  await overview.click();
  await expect(root).toHaveClass(/df2-history-active/);
  await expect(page.locator(".df2-history-view")).toBeVisible();
  await expect.poll(() => main.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(lightMainBackground);
  await expect.poll(() => sidebar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(lightSidebarBackground);

  await expect(overview).toHaveClass(/active/);
  const inactiveStyle = await today.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });
  const focusVisualStyle = await focus.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });
  const overviewActiveStyle = await overview.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });
  expect(focusVisualStyle).toEqual(inactiveStyle);
  expect(overviewActiveStyle).toEqual(normalActiveStyle);

  await focus.click();
  await expect(root).toHaveClass(/df2-focus-mode/);
  await expect(root).not.toHaveClass(/df2-history-active/);
  await expect(page.locator(".df2-history-view")).toBeHidden();
  await expect(focus).toHaveClass(/active/);
  await expect.poll(() => main.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(focusMainBackground);
});

test("overview keeps the normal mobile top active indicator after focus", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const focus = page.getByRole("button", { name: /Soustředění/ });
  const overview = page.getByRole("button", { name: /Přehled/ });
  const today = page.getByRole("button", { name: /Dnes/ });
  const normalMobileShadow = await today.evaluate((element) => getComputedStyle(element).boxShadow);

  await focus.click();
  await overview.click();
  await expect(page.locator(".df2-history-view")).toBeVisible();
  await expect(overview).toHaveClass(/active/);
  await expect.poll(() => overview.evaluate((element) => getComputedStyle(element).boxShadow)).toBe(normalMobileShadow);
  await expect.poll(() => focus.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
});
