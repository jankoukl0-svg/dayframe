from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing block in {path}: {old[:80]!r}')
    p.write_text(text.replace(old, new, 1))

path = 'web/lib/dayframe-calendar.ts'
replace_once(path,
'''  /* An explicit/manual start is authoritative, including during lunch. */
  if (exactStart) {
    const start = timeToMinutes(exactStart);
    if (!Number.isFinite(start) || start < floor || start + duration > deadline || !canPlaceAt(tasks, start, duration)) return null;
    return { start: minutesToTime(start), end: minutesToTime(start + duration) };
  }
''',
'''  /* An explicit/manual start is authoritative, including during lunch and the late 22:30–02:00 lane. */
  if (exactStart) {
    const start = timeToMinutes(exactStart);
    const manualDeadline = deadlineTime === "22:30" ? DAY_END : deadline;
    if (!Number.isFinite(start) || start < floor || start + duration > manualDeadline || !canPlaceAt(tasks, start, duration)) return null;
    return { start: minutesToTime(start), end: minutesToTime(start + duration) };
  }
''')
replace_once(path, '  const tomorrow = addDaysKey(localDateKey(now), 1);', '  const tomorrow = addDaysKey(planningDateKey(now), 1);')
replace_once(path, '    const allowed = keys.filter((date) => date >= localDateKey(now) && (!task.dueDate || date <= task.dueDate));', '    const allowed = keys.filter((date) => date >= planningDateKey(now) && (!task.dueDate || date <= task.dueDate));')

path = 'web/app/activity-time-controller.tsx'
replace_once(path,
'''function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

''', '')
replace_once(path, '.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))\n    .find', '.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))\n    .find')
replace_once(path, '.sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));', '.sort((a, b) => timeToMinutes(a.end) - timeToMinutes(b.end));')
replace_once(path, '.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))[0] ?? null;', '.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0] ?? null;')
replace_once(path, '.sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));', '.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));')
replace_once(path, '      return (a.start ?? "").localeCompare(b.start ?? "");', '      return timeToMinutes(a.start) - timeToMinutes(b.start);')

# Calendar unit coverage: default 22:30 remains an auto-planning cutoff, while explicit late starts work.
path = 'web/lib/dayframe-calendar.test.mjs'
p = Path(path)
text = p.read_text()
anchor = '''test("planning day continues through 02:00 after midnight", () => {
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
addition = anchor + '''\n
test("manual placement can use the late lane while automatic planning keeps its 22:30 cutoff", () => {
  const manual = findSlot([], "2026-09-18", 30, now, "22:30", "01:00");
  assert.deepEqual(manual, { start: "01:00", end: "01:30" });
  const automatic = findSlot([], "2026-09-18", 30, now, "22:30");
  assert.deepEqual(automatic, { start: "08:00", end: "08:30" });
});
'''
if anchor not in text:
    raise SystemExit('calendar test anchor missing')
p.write_text(text.replace(anchor, addition, 1))
