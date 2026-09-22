import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test("milestone description is shown under the title and persists after editing", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    state.milestones = [
      {
        id: "description-test",
        title: "C1 Praha digital",
        date: "2026-11-25",
        note: "Cambridge C1 digital – být na místě 30 minut před začátkem.",
      },
      {
        id: "empty-description-test",
        title: "SCIO test",
        date: "2026-12-05",
        note: "Vlastní termín",
      },
    ];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();

  const row = page.locator('.df2-milestones article[data-milestone-id="description-test"]');
  await expect(row).toBeVisible();
  await expect(row.getByText("Cambridge C1 digital – být na místě 30 minut před začátkem.")).toBeVisible();

  const titleBox = await row.locator("strong").first().boundingBox();
  const descriptionBox = await row.locator("span").first().boundingBox();
  expect(titleBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(descriptionBox.y).toBeGreaterThan(titleBox.y);

  const emptyRow = page.locator('.df2-milestones article[data-milestone-id="empty-description-test"]');
  await expect(emptyRow).toContainText("Přidat popisek");

  await row.click();
  const descriptionInput = page.locator('input[name="note"]');
  await expect(descriptionInput).toBeVisible();
  await descriptionInput.fill("Cambridge C1 digital. Registrace 8:30, speaking i writing ve stejný den.");
  await page.getByRole("button", { name: "Uložit změny" }).click();

  await expect(row).toContainText("Registrace 8:30");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.milestones.find((milestone) => milestone.id === "description-test")?.note;
  })).toBe("Cambridge C1 digital. Registrace 8:30, speaking i writing ve stejný den.");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Milníky/ }).click();
  const persisted = page.locator('.df2-milestones article[data-milestone-id="description-test"]');
  await expect(persisted).toContainText("Registrace 8:30");
});
