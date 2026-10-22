import { test, expect } from "@playwright/test";

const base = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

for (const viewport of [{ width: 1520, height: 900 }, { width: 680, height: 810 }]) {
  test(`week hour lines stay aligned when individual days have extra content (${viewport.width}px)`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-15T12:00:00"));
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
    await expect(page.locator(".df2-week-day")).toHaveCount(7);

    // An unscheduled block and an off-hours departure reminder are rendered
    // above the clock grid in only some days. They must not move those days'
    // hour lines lower than the rest of the week.
    await page.evaluate(() => {
      const days = [...document.querySelectorAll(".df2-week-day")];
      const backlog = document.createElement("button");
      backlog.textContent = "Úkol bez času";
      days[0].querySelector(".df2-unscheduled").append(backlog);
      const second = document.createElement("button");
      second.textContent = "Další úkol bez času";
      days[0].querySelector(".df2-unscheduled").append(second);

      const reminder = document.createElement("div");
      reminder.className = "df2-week-travel-outside";
      reminder.setAttribute("role", "note");
      reminder.innerHTML = '<button><strong>Vyjeď v 07:59</strong><span>Základy marketingu</span></button>';
      days[2].insertBefore(reminder, days[2].querySelector(".df2-time-body"));
    });

    const rows = await page.locator(".df2-week-day").evaluateAll((days) =>
      days.map((day) => {
        const body = day.querySelector(".df2-time-body");
        const grid = body.getBoundingClientRect();
        const lines = [...body.querySelectorAll(".df2-hour-line")];
        const midnight = lines.find((line) => line.querySelector("em")?.textContent?.trim() === "00:00");
        return {
          top: grid.top, bottom: grid.bottom, height: grid.height,
          midnight: midnight?.getBoundingClientRect().top,
          lineCount: lines.length,
        };
      })
    );

    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(Math.abs(row.top - rows[0].top)).toBeLessThan(1);
      expect(Math.abs(row.bottom - rows[0].bottom)).toBeLessThan(1);
      expect(Math.abs(row.height - rows[0].height)).toBeLessThan(1);
      expect(row.lineCount).toBe(rows[0].lineCount);
      expect(row.midnight).toBeDefined();
      expect(Math.abs(row.midnight - rows[0].midnight)).toBeLessThan(1);
    }
  });
}
