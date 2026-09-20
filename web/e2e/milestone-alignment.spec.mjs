import { test, expect } from "@playwright/test";

test("aligns milestone day counts on one vertical axis", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Milníky" }).click();

  const counts = page.locator(".df2-milestone-remaining > strong");
  await expect(counts).toHaveCount(3);

  const countXs = await counts.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().x)));
  expect(new Set(countXs).size).toBe(1);

  const labels = page.locator(".df2-milestone-remaining > span");
  const labelXs = await labels.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().x)));
  expect(new Set(labelXs).size).toBe(1);
});
