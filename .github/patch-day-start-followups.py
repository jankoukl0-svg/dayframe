from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old in text:
        if text.count(old) != 1:
            raise SystemExit(f"Ambiguous patch target in {path}: {old!r}")
        p.write_text(text.replace(old, new, 1))
        return
    if new not in text:
        raise SystemExit(f"Patch target not found in {path}: {old!r}")


replace_once(
    "web/app/activity-time-controller.tsx",
    'import { createPortal } from "react-dom";\n',
    'import { createPortal } from "react-dom";\nimport { calendarBounds } from "../lib/dayframe-calendar";\n',
)
replace_once(
    "web/app/activity-time-controller.tsx",
    "const DAY_START = 10 * 60;",
    "const DAY_START = calendarBounds.dayStart;",
)

replace_once(
    "web/app/dayframe-v2.tsx",
    'style={{ height: `${(calendarBounds.dayEnd - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}',
    'style={{ height: `${(24 * 60 - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}',
)
replace_once(
    "web/app/dayframe-v2.tsx",
    '<span>10:00–22:30 · oběd 13:00–14:00</span>',
    '<span>{minutesToTime(calendarBounds.dayStart)}–22:30 · oběd 13:00–14:00</span>',
)

replace_once(
    "web/app/late-reading-controller.css",
    "  height: 605px;",
    "  height: 691.2px;",
)

replace_once(
    "web/e2e/dayframe-calendar.spec.mjs",
    "weekVisual.hourSlotHeight * 15",
    "weekVisual.hourSlotHeight * 16",
)

replace_once(
    "web/e2e/week-capacity.spec.mjs",
    '  await expect(body).toHaveCSS("height", "648px");',
    '  const bodyHeight = await body.evaluate((element) => element.getBoundingClientRect().height);\n  expect(bodyHeight).toBeGreaterThan(690);',
)

replace_once(
    "web/e2e/week-reading-23.spec.mjs",
    "  expect(height).toBeGreaterThanOrEqual(647);",
    "  expect(height).toBeGreaterThan(690);",
)

replace_once(
    "web/e2e/activity-time-adjustments.spec.mjs",
    "    const floor = Math.max(10 * 60, Math.ceil(minute / 15) * 15);",
    "    const floor = Math.max(8 * 60, Math.ceil(minute / 15) * 15);",
)
replace_once(
    "web/e2e/activity-time-adjustments.spec.mjs",
    "  if (minute >= 10 * 60 && minute <= 23 * 60) await expect(line).toBeVisible();",
    "  if (minute >= 8 * 60 && minute <= 23 * 60) await expect(line).toBeVisible();",
)
