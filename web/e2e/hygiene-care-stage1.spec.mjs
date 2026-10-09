import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

async function fresh(page) {
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00"));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("dayframe-hygiene-v1")))).toBe(true);
}

async function hygiene(page) {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Hygiena" }).click();
}

test("product guidance is configured in the catalog, follows the assigned step, and is preserved at completion", async ({ page }) => {
  await fresh(page);
  await hygiene(page);
  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.getByRole("button", { name: "+ Přidat produkt" }).click();
  const editor = page.getByRole("dialog", { name: "Editor produktu" });
  await editor.getByRole("textbox", { name: "Název produktu *" }).fill("Můj čisticí gel");
  await editor.getByRole("textbox", { name: "Návod k použití" }).fill("Použij jemně.");
  await editor.getByRole("textbox", { name: "Kdy používat" }).fill("Při ranní péči");
  await editor.getByRole("textbox", { name: "Množství na jedno použití" }).fill("Podle vlastního návodu");
  await editor.getByRole("textbox", { name: "Jak dlouho používat / nechat působit" }).fill("Dle etikety");
  await editor.getByRole("textbox", { name: "Upozornění a omezení" }).fill("Pozor na oči.");
  await editor.getByRole("checkbox", { name: "Očistit obličej", exact: true }).check();
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await expect(editor).toHaveCount(0);

  await page.getByRole("tab", { name: "Dnes" }).click();
  const morning = page.locator('[data-hygiene-routine="morning"]');
  const step = morning.locator(".df2-hygiene-task").filter({ hasText: "Očistit obličej" });
  const instructions = step.locator(".df2-care-guide");
  await expect(instructions).toContainText("Použij jemně.");
  await expect(instructions).toContainText("Při ranní péči");
  await expect(instructions).toContainText("Podle vlastního návodu");
  await expect(instructions).toContainText("Dle etikety");
  await expect(instructions).toContainText("Pozor na oči.");
  await expect(morning.locator(".df2-hygiene-check")).toHaveCount(6);
  await step.getByRole("button", { name: "Označit Očistit obličej jako hotovo" }).click();
  const before = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("dayframe-hygiene-v1"));
    return store.records["2026-10-06"].morning.scheduledTasks.find((task) => task.id === "morning-face").products[0];
  });
  expect(before).toMatchObject({ usageWhen: "Při ranní péči", precautions: "Pozor na oči." });

  await page.getByRole("tab", { name: "Moje produkty" }).click();
  await page.locator(".df2-product-card").filter({ hasText: "Můj čisticí gel" }).click();
  await page.getByRole("dialog", { name: "Detail produktu Můj čisticí gel" }).getByRole("button", { name: "Upravit" }).click();
  await editor.getByRole("textbox", { name: "Upozornění a omezení" }).fill("Později změněné upozornění.");
  await editor.getByRole("button", { name: "Uložit produkt" }).click();
  await page.getByRole("tab", { name: "Dnes" }).click();
  await step.getByRole("button", { name: "Historický produkt Můj čisticí gel" }).click();
  const historic = page.getByRole("dialog", { name: "Historický produkt Můj čisticí gel" });
  await expect(historic).toContainText("Pozor na oči.");
  await expect(historic).not.toContainText("Později změněné upozornění.");
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await expect(page.locator('[data-hygiene-routine="morning"]')).toContainText("Pozor na oči.");
});

test("existing product data loads unchanged, multiple products keep order, and steps do not regroup across sections", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const key = "dayframe-hygiene-v1";
    const store = JSON.parse(localStorage.getItem(key));
    const basic = (id, name) => ({ id, name, brand: "", category: "Pleť",
      description: "", instructions: "Původní pokyn", frequency: "", openedOn: "",
      expiresOn: "", paoMonths: null, amount: "", stockStatus: "ok", shopUrl: "", archived: false });
    store.products = [basic("one", "Gel A"), basic("two", "Gel B")];
    const morning = store.routines.find((routine) => routine.id === "morning");
    morning.tasks.find((task) => task.id === "morning-face").productIds = ["two", "one"];
    morning.tasks[0].section = "A";
    morning.tasks[1].section = "B";
    morning.tasks[2].section = "A";
    localStorage.setItem(key, JSON.stringify(store));
  });
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  const morning = page.locator('[data-hygiene-routine="morning"]');
  await expect(morning.locator(".df2-hygiene-task")).toHaveCount(6);
  const steps = await morning.locator(".df2-hygiene-task > div > strong").allTextContents();
  expect(steps.slice(0, 3)).toEqual(["Ranní sprcha", "Vyčistit zuby", "Očistit obličej"]);
  const sections = await morning.locator(".df2-hygiene-task-group h3").allTextContents();
  expect(sections.slice(0, 3)).toEqual(["A", "B", "A"]);
  const face = morning.locator(".df2-hygiene-task").filter({ hasText: "Očistit obličej" });
  expect(await face.locator(".df2-hygiene-used-product b").allTextContents()).toEqual(["Gel B", "Gel A"]);
  await face.getByRole("button", { name: "Označit Očistit obličej jako hotovo" }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  expect(payload.records["2026-10-06"].morning.scheduledTasks.find((t) => t.id === "morning-face")
    .products.map((p) => p.name)).toEqual(["Gel B", "Gel A"]);
  expect(payload.products.every((p) => p.usageWhen === "")).toBe(true);
});

test("optional timer starts, expires, resets and never completes the hygiene step", async ({ page }) => {
  await fresh(page);
  await hygiene(page);
  await page.getByRole("tab", { name: "Správa rutin" }).click();
  await page.locator(".df2-hygiene-manage-task-copy").filter({ hasText: "Vyčistit zuby" }).click();
  const editor = page.getByRole("dialog", { name: "Upravit hygienický úkol" });
  await editor.getByRole("spinbutton", { name: "Časovač úkolu v minutách" }).fill("2");
  await editor.getByRole("button", { name: "Uložit", exact: true }).click();
  await page.getByRole("tab", { name: "Dnes" }).click();
  const morning = page.locator('[data-hygiene-routine="morning"]');
  const step = morning.locator(".df2-hygiene-task").filter({ hasText: "Vyčistit zuby" });
  const timer = step.locator('[data-hygiene-timer="Vyčistit zuby"]');
  await expect(timer).toContainText("02:00");
  await expect(step.locator(".df2-hygiene-check")).toHaveAttribute("aria-pressed", "false");
  await timer.getByRole("button", { name: "Spustit časovač Vyčistit zuby" }).click();
  await page.clock.setFixedTime(new Date("2026-10-06T12:02:30"));
  await expect(timer).toContainText("Čas vypršel");
  await expect(step.locator(".df2-hygiene-check")).toHaveAttribute("aria-pressed", "false");
  await timer.getByRole("button", { name: "Resetovat časovač Vyčistit zuby" }).click();
  await expect(timer).toContainText("02:00");
  await page.reload({ waitUntil: "networkidle" });
  await hygiene(page);
  await expect(page.locator('[data-hygiene-timer="Vyčistit zuby"]')).toContainText("02:00");
  await expect(page.locator('[data-hygiene-routine="morning"] .df2-hygiene-check')).toHaveCount(6);
});
