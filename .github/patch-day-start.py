from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"Patch target not found in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Patch target is ambiguous in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "web/lib/dayframe-calendar.ts",
    "const DAY_START = 10 * 60;",
    "const DAY_START = 8 * 60;",
)

replace_once(
    "web/app/dayframe-v2.tsx",
    '''                        <div
                          className={`df2-time-body ${dropPreview?.date === key ? "drop-active" : ""}`}
                          onDragOver={(event) => onDragOver(event, key)}
                          onDrop={(event) => onDrop(event, key)}
                        >
                          {Array.from({ length: 14 }, (_, index) => <span className="df2-hour-line" key={index} style={{ top: `${index * 60 * MINUTE_HEIGHT}px` }}><em>{10 + index}:00</em></span>)}''',
    '''                        <div
                          className={`df2-time-body ${dropPreview?.date === key ? "drop-active" : ""}`}
                          style={{ height: `${(calendarBounds.dayEnd - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}
                          onDragOver={(event) => onDragOver(event, key)}
                          onDrop={(event) => onDrop(event, key)}
                        >
                          {Array.from({ length: Math.floor((calendarBounds.dayEnd - calendarBounds.dayStart) / 60) + 1 }, (_, index) => {
                            const minute = calendarBounds.dayStart + index * 60;
                            return <span className="df2-hour-line" key={minute} style={{ top: `${index * 60 * MINUTE_HEIGHT}px` }}><em>{minutesToTime(minute)}</em></span>;
                          })}''',
)

replace_once(
    "web/lib/dayframe-calendar.test.mjs",
    '''  getTasksForDate,
  localDateKey,''',
    '''  getTasksForDate,
  calendarBounds,
  localDateKey,''',
)

replace_once(
    "web/lib/dayframe-calendar.test.mjs",
    '''    "2026-09-17": [{ id: "busy", title: "Busy", date: "2026-09-17", duration: 750, start: "10:00", end: "22:30", priority: "normal", category: "X", mode: "flexible", completed: false, source: "user", dateLocked: true, createdAt: now.toISOString() }],''',
    '''    "2026-09-17": [{ id: "busy", title: "Busy", date: "2026-09-17", duration: 870, start: "08:00", end: "22:30", priority: "normal", category: "X", mode: "flexible", completed: false, source: "user", dateLocked: true, createdAt: now.toISOString() }],''',
)

replace_once(
    "web/lib/dayframe-calendar.test.mjs",
    '''    duration: 180,
    start: "10:00",''',
    '''    duration: 300,
    start: "08:00",''',
)

replace_once(
    "web/lib/dayframe-calendar.test.mjs",
    '''test("automatic scheduling still avoids the lunch preference", () => {''',
    '''test("day starts at 08:00 and future auto-planning can use the first slot", () => {
  assert.equal(calendarBounds.dayStart, 8 * 60);
  const slot = findSlot([], "2026-09-18", 60, now);
  assert.deepEqual(slot, { start: "08:00", end: "09:00" });
});

test("automatic scheduling still avoids the lunch preference", () => {''',
)
