import { test, expect } from "@playwright/test";

async function initialize(page, title, id) {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  return page.evaluate(({ title, id }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.routines = [];
    state.plans = {
      [date]: [{
        id,
        title,
        date,
        duration: 20,
        start: title === "Čtení knihy" ? "22:40" : "20:00",
        end: title === "Čtení knihy" ? "23:00" : "20:20",
        requestedStart: title === "Čtení knihy" ? "22:40" : "20:00",
        deadlineTime: title === "Čtení knihy" ? "23:00" : "22:30",
        priority: "normal",
        category: title === "Čtení knihy" ? "Rutina" : "Studium",
        mode: "flexible",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date };
  }, { title, id });
}

async function startDrag(page, title) {
  await page.evaluate((wantedTitle) => {
    const source = [...document.querySelectorAll(".df2-week-day.today .df2-week-task")]
      .find((element) => element.querySelector("strong")?.textContent?.trim() === wantedTitle);
    if (!(source instanceof HTMLElement)) throw new Error(`Task ${wantedTitle} not found`);
    const rect = source.getBoundingClientRect();
    const transfer = new DataTransfer();
    window.__dayframeReadingLateTransfer = transfer;
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + 20,
      clientY: rect.top + 1,
    }));
  }, title);
}

async function dispatchLateEvent(page, type) {
  return page.evaluate((eventType) => {
    const body = document.querySelector(".df2-week-day.today .df2-time-body");
    const transfer = window.__dayframeReadingLateTransfer;
    if (!(body instanceof HTMLElement) || !(transfer instanceof DataTransfer)) throw new Error("Late drop target not ready");
    const rect = body.getBoundingClientRect();
    const clientY = rect.top + ((23 * 60 + 2) - 10 * 60) * 0.72;
    body.dispatchEvent(new DragEvent(eventType, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + Math.min(80, Math.max(20, rect.width / 2)),
      clientY,
    }));
  }, type);
}

test("Čtení knihy can be moved into the 23:00 hour", async ({ page }) => {
  const seeded = await initialize(page, "Čtení knihy", "reading-late-test");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  const body = page.locator(".df2-week-day.today .df2-time-body");
  await expect(body).toBeVisible();
  const height = await body.evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(604);

  await startDrag(page, "Čtení knihy");
  await dispatchLateEvent(page, "dragover");
  await expect(page.locator(".df2-reading-late-preview")).toContainText("23:00");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    dispatchLateEvent(page, "drop"),
  ]);

  const stored = await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans[date].find((task) => task.title === "Čtení knihy");
  }, seeded);
  expect(`${stored.start}-${stored.end}`).toBe("23:00-23:20");
});

test("the 23:00 hour stays locked for ordinary tasks", async ({ page }) => {
  const seeded = await initialize(page, "Jiný úkol", "ordinary-late-test");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();

  await startDrag(page, "Jiný úkol");
  await dispatchLateEvent(page, "dragover");
  await expect(page.locator(".df2-reading-late-preview")).toHaveCount(0);
  await dispatchLateEvent(page, "drop");
  await page.waitForTimeout(100);

  const stored = await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return state.plans[date].find((task) => task.id === "ordinary-late-test");
  }, seeded);
  expect(`${stored.start}-${stored.end}`).toBe("20:00-20:20");
});
