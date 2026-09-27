import { test, expect } from "@playwright/test";

test("week timeline separates midnight graphically without adding labels", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  const body = page.locator(".df2-time-body").first();
  await expect(body).toBeVisible();

  const visual = await body.evaluate((element) => {
    const shade = getComputedStyle(element, "::before");
    const divider = getComputedStyle(element, "::after");
    return {
      shadeContent: shade.content,
      shadeTop: parseFloat(shade.top),
      shadeBottom: shade.bottom,
      shadeBackground: shade.backgroundImage,
      dividerContent: divider.content,
      dividerTop: parseFloat(divider.top),
      dividerHeight: parseFloat(divider.height),
      dividerBackground: divider.backgroundColor,
    };
  });

  expect(visual.shadeContent).toBe('""');
  expect(visual.dividerContent).toBe('""');
  expect(visual.shadeTop).toBeCloseTo(691.2, 1);
  expect(visual.shadeBottom).toBe("0px");
  expect(visual.shadeBackground).toContain("linear-gradient");
  expect(visual.dividerTop).toBeCloseTo(690.2, 1);
  expect(visual.dividerHeight).toBeCloseTo(2, 1);
  expect(visual.dividerBackground).not.toBe("rgba(0, 0, 0, 0)");
});
