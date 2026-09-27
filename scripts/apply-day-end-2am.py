from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))

# Core planning clock: 08:00 through 02:00 of the next calendar day.
path = "web/lib/dayframe-calendar.ts"
replace_once(path, "const DAY_END = 23 * 60;", "const DAY_END = 26 * 60;")
replace_once(path, '''export function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

export function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
''', '''export function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  const clockMinute = hours * 60 + minutes;
  return hours < DAY_START / 60 ? clockMinute + 24 * 60 : clockMinute;
}

export function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(DAY_END, Math.round(total)));
  const clockMinute = safe % (24 * 60);
  return `${String(Math.floor(clockMinute / 60)).padStart(2, "0")}:${String(clockMinute % 60).padStart(2, "0")}`;
}

export function planningDateKey(date: Date) {
  const clockMinute = date.getHours() * 60 + date.getMinutes();
  if (clockMinute >= 2 * 60) return localDateKey(date);
  return localDateKey(addDays(date, -1));
}

export function planningMinute(date: Date) {
  const clockMinute = date.getHours() * 60 + date.getMinutes();
  return clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
}
''')
replace_once(path, '''export function findSlot(tasks: CalendarTask[], date: string, duration: number, now: Date, deadlineTime = "22:30", exactStart?: string) {
  const todayKey = localDateKey(now);
  const deadline = Math.min(DAY_END, timeToMinutes(deadlineTime));
  const floor = date === todayKey
    ? Math.max(DAY_START, Math.ceil((now.getHours() * 60 + now.getMinutes()) / SLOT) * SLOT)
    : DAY_START;
''', '''export function findSlot(tasks: CalendarTask[], date: string, duration: number, now: Date, deadlineTime = "22:30", exactStart?: string) {
  const todayKey = planningDateKey(now);
  const deadline = Math.min(DAY_END, timeToMinutes(deadlineTime));
  const floor = date === todayKey
    ? Math.max(DAY_START, Math.ceil(planningMinute(now) / SLOT) * SLOT)
    : DAY_START;
''')
replace_once(path, '''function dateRangeForDraft(draft: TaskDraft, now: Date) {
  if (draft.date) return [draft.date];
  const today = localDateKey(now);
''', '''function dateRangeForDraft(draft: TaskDraft, now: Date) {
  if (draft.date) return [draft.date];
  const today = planningDateKey(now);
''')
replace_once(path, '''export function sortTasks(tasks: CalendarTask[]) {
  return [...tasks].sort((a, b) => {
    if (!a.start && b.start) return -1;
    if (a.start && !b.start) return 1;
    if (!a.start && !b.start) return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt);
    return (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title, "cs");
  });
}
''', '''export function sortTasks(tasks: CalendarTask[]) {
  return [...tasks].sort((a, b) => {
    if (!a.start && b.start) return -1;
    if (a.start && !b.start) return 1;
    if (!a.start && !b.start) return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt);
    return timeToMinutes(a.start) - timeToMinutes(b.start) || a.title.localeCompare(b.title, "cs");
  });
}
''')
replace_once(path, '''export function overdueTasks(state: DayframeState, now = new Date()) {
  const today = localDateKey(now);
  const minute = now.getHours() * 60 + now.getMinutes();
''', '''export function overdueTasks(state: DayframeState, now = new Date()) {
  const today = planningDateKey(now);
  const minute = planningMinute(now);
''')

# Main UI uses the logical planning date/minute before 02:00 and renders an 18-hour timeline.
path = "web/app/dayframe-v2.tsx"
replace_once(path, "  localDateKey,\n", "  localDateKey,\n  planningDateKey,\n  planningMinute,\n")
replace_once(path, "  const todayKey = localDateKey(now);", "  const todayKey = planningDateKey(now);")
replace_once(path, '''      const today = localDateKey(new Date());
      const ready = materializeRange(migrated, addDaysKey(today, -7), addDaysKey(today, 28), new Date());
''', '''      const reference = new Date();
      const today = planningDateKey(reference);
      const ready = materializeRange(migrated, addDaysKey(today, -7), addDaysKey(today, 28), reference);
''')
replace_once(path, '''      const today = localDateKey(new Date());
      setData(materializeRange(fresh, addDaysKey(today, -7), addDaysKey(today, 28), new Date()));
''', '''      const reference = new Date();
      const today = planningDateKey(reference);
      setData(materializeRange(fresh, addDaysKey(today, -7), addDaysKey(today, 28), reference));
''')
replace_once(path, "        const today = localDateKey(reference);", "        const today = planningDateKey(reference);")
replace_once(path, "        const visibleMonday = addDays(startOfWeek(reference), weekOffset * 7);", "        const visibleMonday = addDays(startOfWeek(dateFromKey(today)), weekOffset * 7);")
replace_once(path, "    const monday = addDays(startOfWeek(now), weekOffset * 7);", "    const monday = addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7);")
replace_once(path, "  const currentMinute = now.getHours() * 60 + now.getMinutes();", "  const currentMinute = planningMinute(now);")
replace_once(path, "  const monday = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [weekOffset, todayKey]);", "  const monday = useMemo(() => addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7), [weekOffset, todayKey]);")
replace_once(path, '''                          style={{ height: `${(24 * 60 - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}
''', '''                          style={{ height: `${(calendarBounds.dayEnd - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}
''')
replace_once(path, '''          <div className="df2-sidebar-bottom"><span>Den končí</span><strong>00:30</strong></div>''', '''          <div className="df2-sidebar-bottom"><span>Den končí</span><strong>02:00</strong></div>''')
replace_once(path, '''              <div className="df2-settings-card"><div><strong>Pracovní den</strong><span>{minutesToTime(calendarBounds.dayStart)}–22:30 · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>00:30</span></div><div><strong>Auto-plánování</strong><span>Týden · 15 min</span></div></div>''', '''              <div className="df2-settings-card"><div><strong>Pracovní den</strong><span>{minutesToTime(calendarBounds.dayStart)}–{minutesToTime(calendarBounds.dayEnd)} · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>02:00</span></div><div><strong>Auto-plánování</strong><span>Týden · 15 min · standardně do 22:30</span></div></div>''')
replace_once(path, '''          <div className="df2-day-scale" aria-hidden="true"><span>09</span><span>12</span><span>15</span><span>18</span><span>21</span><span>00:30</span></div>''', '''          <div className="df2-day-scale" aria-hidden="true"><span>08</span><span>12</span><span>16</span><span>20</span><span>00</span><span>02</span></div>''')
replace_once(path, '''  const today = localDateKey(now);
  const nextMilestone =''', '''  const today = planningDateKey(now);
  const nextMilestone =''')
replace_once(path, '''      <header className="df2-page-head"><div><p>{formatDay(now)}</p><h1>Dnes</h1></div><button className="df2-accent-button" onClick={onAdd}>+ Nový úkol</button></header>''', '''      <header className="df2-page-head"><div><p>{formatDay(dateFromKey(today))}</p><h1>Dnes</h1></div><button className="df2-accent-button" onClick={onAdd}>+ Nový úkol</button></header>''')

# Day countdown boundary becomes 02:00.
path = "web/lib/dayframe-countdown.ts"
replace_once(path, "const DAY_WINDOW_MS = 15.5 * 60 * 60 * 1000;", "const DAY_WINDOW_MS = 18 * 60 * 60 * 1000;")
replace_once(path, "  end.setHours(0, 30, 0, 0);", "  end.setHours(2, 0, 0, 0);")

# Activity controller follows the same logical date/minute and allows manual execution through 02:00.
path = "web/app/activity-time-controller.tsx"
replace_once(path, 'import { calendarBounds } from "../lib/dayframe-calendar";', 'import { calendarBounds, planningDateKey, planningMinute } from "../lib/dayframe-calendar";')
replace_once(path, "const WEEK_VIEW_END = 23 * 60;", "const WEEK_VIEW_END = calendarBounds.dayEnd;")
replace_once(path, '''function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
''', '''function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  const clockMinute = hours * 60 + minutes;
  return hours < DAY_START / 60 ? clockMinute + 24 * 60 : clockMinute;
}

function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(calendarBounds.dayEnd, Math.round(total)));
  const clockMinute = safe % (24 * 60);
  return `${String(Math.floor(clockMinute / 60)).padStart(2, "0")}:${String(clockMinute % 60).padStart(2, "0")}`;
}
''')
replace_once(path, "  return state.plans[localDateKey(now)] ?? [];", "  return state.plans[planningDateKey(now)] ?? [];")
replace_once(path, '''function currentMinute(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function currentSecond(now = new Date()) {
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}
''', '''function currentMinute(now = new Date()) {
  return planningMinute(now);
}

function currentSecond(now = new Date()) {
  return planningMinute(now) * 60 + now.getSeconds();
}
''')
replace_once(path, "  const date = localDateKey(new Date());", "  const date = planningDateKey(new Date());")
replace_once(path, "      if (candidateEnd <= 23 * 60 + 59) {", "      if (candidateEnd <= calendarBounds.dayEnd) {")
replace_once(path, "  const date = localDateKey(now);", "  const date = planningDateKey(now);")
replace_once(path, "  if (extendedEnd > 23 * 60 + 59) return { ok: false, error: \"Dnes už není další prostor.\" };", "  if (extendedEnd > calendarBounds.dayEnd) return { ok: false, error: \"Dnes už není další prostor.\" };")
replace_once(path, "      if (shiftedEnd > 23 * 60 + 59) return { ok: false, error: \"Navazující bloky už se dnes nevejdou.\" };", "      if (shiftedEnd > calendarBounds.dayEnd) return { ok: false, error: \"Navazující bloky už se dnes nevejdou.\" };")
# There is another logical-day date inside replanRemainingToday.
text = Path(path).read_text()
old = "  const date = localDateKey(now);"
if old in text:
    Path(path).write_text(text.replace(old, "  const date = planningDateKey(now);", 1))
replace_once(path, '''  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
''', '''  const minute = planningMinute(now) + now.getSeconds() / 60;
''')

# Late-reading drag lane now reaches 02:00 and wraps labels after midnight.
path = "web/app/late-reading-controller.tsx"
replace_once(path, "const LATE_END = 24 * 60;", "const LATE_END = 26 * 60;")
replace_once(path, '''function timeToMinutes(value?: string) {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const safe = Math.max(0, Math.min(LATE_END, Math.round(value)));
  if (safe === LATE_END) return "24:00";
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
''', '''function timeToMinutes(value?: string) {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  const clockMinute = hours * 60 + minutes;
  return hours < DAY_START / 60 ? clockMinute + 24 * 60 : clockMinute;
}

function minutesToTime(value: number) {
  const safe = Math.max(0, Math.min(LATE_END, Math.round(value)));
  const clockMinute = safe % (24 * 60);
  return `${String(Math.floor(clockMinute / 60)).padStart(2, "0")}:${String(clockMinute % 60).padStart(2, "0")}`;
}
''')
replace_once(path, '''  state.plans[toDate] = [...(state.plans[toDate] ?? []).filter((item) => item.id !== task.id), moved]
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
''', '''  state.plans[toDate] = [...(state.plans[toDate] ?? []).filter((item) => item.id !== task.id), moved]
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
''')

# Capacity calculation understands ranges such as 23:30–00:30.
path = "web/app/week-capacity-controller.tsx"
replace_once(path, '''function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
''', '''function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const clockMinute = hours * 60 + minutes;
  return hours < 8 ? clockMinute + 24 * 60 : clockMinute;
}
''')

# Unit tests for the new planning boundary and wrapped time axis.
path = "web/lib/dayframe-countdown.test.mjs"
text = Path(path).read_text()
text = text.replace('counts down to the 00:30 Dayframe day boundary', 'counts down to the 02:00 Dayframe day boundary')
text = text.replace('assert.equal(countdown.hours, 4);\n  assert.equal(countdown.minutes, 30);', 'assert.equal(countdown.hours, 6);\n  assert.equal(countdown.minutes, 0);', 1)
text = text.replace('assert.equal(countdown.end.getHours(), 0);\n  assert.equal(countdown.end.getMinutes(), 30);', 'assert.equal(countdown.end.getHours(), 2);\n  assert.equal(countdown.end.getMinutes(), 0);', 1)
text = text.replace('resets the day countdown after 00:30', 'resets the day countdown after 02:00')
text = text.replace('new Date(2026, 8, 18, 0, 31, 0)', 'new Date(2026, 8, 18, 2, 1, 0)')
text = text.replace('assert.equal(countdown.end.getHours(), 0);\n  assert.equal(countdown.end.getMinutes(), 30);', 'assert.equal(countdown.end.getHours(), 2);\n  assert.equal(countdown.end.getMinutes(), 0);', 1)
Path(path).write_text(text)

path = "web/lib/dayframe-calendar.test.mjs"
text = Path(path).read_text()
text = text.replace('  localDateKey,\n', '  localDateKey,\n  minutesToTime,\n  planningDateKey,\n  planningMinute,\n  timeToMinutes,\n', 1)
anchor = '''test("day starts at 08:00 and future auto-planning can use the first slot", () => {
  assert.equal(calendarBounds.dayStart, 8 * 60);
  const slot = findSlot([], "2026-09-18", 60, now);
  assert.deepEqual(slot, { start: "08:00", end: "09:00" });
});
'''
addition = anchor + '''\n
test("planning day continues through 02:00 after midnight", () => {
  assert.equal(calendarBounds.dayEnd, 26 * 60);
  assert.equal(timeToMinutes("23:30"), 23 * 60 + 30);
  assert.equal(timeToMinutes("00:30"), 24 * 60 + 30);
  assert.equal(timeToMinutes("02:00"), 26 * 60);
  assert.equal(minutesToTime(25 * 60 + 30), "01:30");
  const afterMidnight = new Date(2026, 8, 18, 1, 15, 0);
  assert.equal(planningDateKey(afterMidnight), "2026-09-17");
  assert.equal(planningMinute(afterMidnight), 25 * 60 + 15);
});
'''
if anchor not in text:
    raise SystemExit('calendar test anchor missing')
Path(path).write_text(text.replace(anchor, addition, 1))

# Browser geometry: 18 hour intervals and an explicit 02:00 bottom line.
path = "web/e2e/dayframe-calendar.spec.mjs"
text = Path(path).read_text()
text = text.replace('toContainText("00:30")', 'toContainText("02:00")', 1)
text = text.replace('weekVisual.hourSlotHeight * 16', 'weekVisual.hourSlotHeight * 18', 1)
text = text.replace('expect(weekVisual.visibleHourLabels).toHaveLength(16);', 'expect(weekVisual.visibleHourLabels).toHaveLength(19);', 1)
text = text.replace('expect(weekVisual.visibleHourLabels.at(-1)).toBe("23:00");', 'expect(weekVisual.visibleHourLabels.slice(-3)).toEqual(["00:00", "01:00", "02:00"]);', 1)
Path(path).write_text(text)
