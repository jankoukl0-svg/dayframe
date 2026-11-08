import { test, expect } from "@playwright/test";

test("overview keeps learning history while showing a minimal progress summary", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);

  const fixture = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = key(now);
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
    const previousYear = new Date(now.getFullYear() - 1, 0, 15, 12);
    const make = (id, title, date, duration, actualMinutes, category) => ({
      id,
      title,
      date,
      duration,
      start: "10:00",
      end: "11:00",
      requestedStart: "10:00",
      deadlineTime: "22:30",
      priority: "normal",
      category,
      mode: "flexible",
      completed: true,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
      actualMinutes,
    });

    state.routines = [];
    state.plans = {
      [today]: [
        make("review-old", "Matematika", today, 45, 25, "Matika"),
        make("review-a", "Finance A", today, 60, 50, "Finance"),
        make("review-b", "Finance B", today, 30, 30, "Finance"),
      ],
      [key(previousMonth)]: [
        make("history-month", "Matematika minulý měsíc", key(previousMonth), 120, 7, "Matika"),
      ],
      [key(previousYear)]: [
        make("history-year", "Angličtina minulý rok", key(previousYear), 180, 12, "Angličtina"),
      ],
    };
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));

    return {
      previousMonthLabel: new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(previousMonth),
      previousYearLabel: String(previousYear.getFullYear()),
    };
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Přehled/ }).click();
  const history = page.locator(".df2-history-view");
  await expect(history).toBeVisible();
  await expect(history.locator(".df2-overview-summary")).toContainText("1 h 45 min");
  await expect(history.locator(".df2-overview-summary")).toContainText("3 z 3 bloků");
  await expect(history.locator("[data-activity-chart-row]")).toHaveCount(3);
  const day = history.locator("[data-activity-ledger] [data-activity-day]").first();
  await expect(day).toHaveCount(1);
  await expect(day.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await day.getByRole("button").click();
  await expect(day).toContainText("Matematika");
  await expect(history.locator(".df2-history-categories")).toContainText("Finance");
  await expect(history.locator(".df2-history-period-history")).toContainText("Historie");
  await expect(history.locator(".df2-history-insights")).toHaveCount(0);

  await history.getByRole("button", { name: "Měsíc", exact: true }).click();
  await expect(history).toHaveAttribute("data-history-mode", "month");
  await expect(history.locator(".df2-history-bars article")).toHaveCount(5);
  page.on("console", msg => {
    if (msg.text().startsWith("DF_OVERVIEW_REMOVAL")) console.log("DF_OVERVIEW_REMOVAL", msg.text());
  });
  page.on("pageerror", err => console.log("DF_OVERVIEW_ERROR", err.message));
  await page.evaluate(() => {
    const nativeRemove = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      if (child.parentNode !== this) {
        console.error("DF_OVERVIEW_REMOVAL", JSON.stringify({
          parent: this.nodeName, className: this instanceof Element ? this.className : "",
          child: child.nodeName, childClassName: child instanceof Element ? child.className : "",
          parentText: this instanceof Element ? this.textContent?.slice(0,80) : "",
          childText: child.textContent?.slice(0,80),
          stack: new Error().stack?.slice(0,700),
        }));
      }
      return nativeRemove.call(this, child);
    };
  });
  await history.locator(".df2-history-period-grid").getByRole("button", { name: new RegExp(fixture.previousMonthLabel, "i") }).click();
  await expect(history.locator("[data-reading-overview-host]")).toBeVisible();
  await expect(history).toBeVisible();
  await expect(history.locator(".df2-overview-summary")).toContainText("7 min");
  await expect(history.locator(".df2-history-categories")).toContainText("Matika");

  await history.getByRole("button", { name: "Rok", exact: true }).click();
  await expect(history).toHaveAttribute("data-history-mode", "year");
  await history.locator(".df2-history-period-grid").getByRole("button", { name: new RegExp(fixture.previousYearLabel) }).click();
  await expect(history.locator(".df2-overview-summary")).toContainText("12 min");
  await expect(history.locator(".df2-history-categories")).toContainText("Angličtina");
});
