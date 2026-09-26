from pathlib import Path

path = Path("web/e2e/dayframe-calendar.spec.mjs")
text = path.read_text()

old = '''    const visibleHourLabels = [...grid.querySelectorAll(".df2-hour-line em")]
      .filter((label) => getComputedStyle(label).display !== "none").length;'''
new = '''    const visibleHourLabels = [...grid.querySelectorAll(".df2-hour-line em")]
      .filter((label) => getComputedStyle(label).display !== "none")
      .map((label) => label.textContent?.trim() ?? "");'''
if old not in text:
    if new not in text:
        raise SystemExit("hour label collection target not found")
else:
    text = text.replace(old, new, 1)

old = '''  expect(weekVisual.bodyHeights.every((height) => height >= 604 && height <= 606)).toBe(true);
  expect(weekVisual.visibleHourLabels).toBe(14);'''
new = '''  expect(weekVisual.bodyHeights.every((height) => Math.abs(height - weekVisual.hourSlotHeight * 15) < 1.5)).toBe(true);
  expect(weekVisual.visibleHourLabels).toHaveLength(16);
  expect(weekVisual.visibleHourLabels.slice(0, 3)).toEqual(["08:00", "09:00", "10:00"]);
  expect(weekVisual.visibleHourLabels.at(-1)).toBe("23:00");'''
if old not in text:
    if new not in text:
        raise SystemExit("week geometry assertion target not found")
else:
    text = text.replace(old, new, 1)

path.write_text(text)
