export type Priority = "high" | "normal" | "low";
export type TaskMode = "fixed" | "flexible";
export type RepeatRule = "none" | "daily" | "weekly" | "alternate";

export type CalendarTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  requestedStart?: string;
  dueDate?: string;
  deadlineTime?: string;
  priority: Priority;
  category: string;
  mode: TaskMode;
  completed: boolean;
  source: "user" | "routine" | "legacy";
  routineId?: string;
  milestoneId?: string;
  dateLocked?: boolean;
  autoScheduled?: boolean;
  createdAt: string;
};

export type Routine = {
  id: string;
  title: string;
  duration: number;
  start?: string;
  category: string;
  priority: Priority;
  frequency: "daily" | "weekly" | "alternate";
  startsOn?: string;
  weekdays?: number[];
  active: boolean;
  createdAt: string;
};

export type Milestone = { id: string; title: string; date: string; note: string; targetMinutes?: number; blockMinutes?: number; category?: string };

export type DayframeState = {
  schema: 5;
  plans: Record<string, CalendarTask[]>;
  backlog: CalendarTask[];
  routines: Routine[];
  routineSkips: string[];
  milestones: Milestone[];
  dismissedOverdueKeys: string[];
};

export type TaskDraft = {
  title: string;
  duration: number;
  date?: string;
  start?: string;
  dueDate?: string;
  deadlineTime?: string;
  priority: Priority;
  category: string;
  repeat?: RepeatRule;
  milestoneId?: string;
};

const DAY_START = 10 * 60;
const LUNCH_START = 13 * 60;
const LUNCH_END = 14 * 60;
const DAY_END = 22 * 60 + 30;
const SLOT = 15;

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addDaysKey(key: string, days: number) {
  return localDateKey(addDays(dateFromKey(key), days));
}

export function startOfWeek(reference: Date) {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

export function weekKeys(reference: Date) {
  const monday = startOfWeek(reference);
  return Array.from({ length: 7 }, (_, index) => localDateKey(addDays(monday, index)));
}

export function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

export function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function roundToQuarter(minutes: number) {
  return Math.round(minutes / SLOT) * SLOT;
}

export function durationBetween(start?: string, end?: string) {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : 45;
}

function cleanTitle(title: string) {
  return title
    .replace(/\s*\[\[(?:date:\d{4}-\d{2}-\d{2}|start:\d{1,2}:\d{2})\]\]\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function taskId(prefix = "task") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultMilestones(): Milestone[] {
  return [
    { id: "vse", title: "Přijímací zkouška VŠE", date: "2027-04-05", note: "Hlavní termín" },
    { id: "cfi", title: "Dokončit CFI Excel", date: "2026-10-31", note: "Kurz a certifikát" },
    { id: "scio", title: "Začít přípravu SCIO", date: "2026-11-15", note: "Nový studijní blok" },
  ];
}

function routine(id: string, title: string, weekday: number | "daily", start: string, duration: number, category: string): Routine {
  return {
    id,
    title,
    start,
    duration,
    category,
    priority: "normal",
    frequency: weekday === "daily" ? "daily" : "weekly",
    weekdays: weekday === "daily" ? undefined : [weekday],
    active: true,
    createdAt: "2026-09-17T00:00:00.000Z",
  };
}

export function defaultRoutines(): Routine[] {
  return [
    routine("read", "Čtení knihy", "daily", "22:40", 20, "Rutina"),
    routine("mon-cfi", "CFI / Excel", 1, "10:00", 90, "Finance"),
    routine("mon-math", "Matematika", 1, "12:00", 60, "Matika"),
    routine("mon-en", "Běžná angličtina", 1, "14:00", 60, "Angličtina"),
    routine("mon-vse", "VŠE English test", 1, "15:00", 60, "VŠE AJ"),
    routine("tue-econ", "Ekonomie z učebnice", 2, "10:00", 90, "Ekonomie"),
    routine("tue-en", "Běžná angličtina", 2, "12:00", 60, "Angličtina"),
    routine("tue-cfi", "CFI / Excel", 2, "14:00", 60, "Finance"),
    routine("wed-math", "Matematika", 3, "10:00", 90, "Matika"),
    routine("wed-cfi", "CFI / Excel", 3, "12:00", 60, "Finance"),
    routine("wed-en", "Běžná angličtina", 3, "14:00", 60, "Angličtina"),
    routine("wed-vse", "VŠE English test", 3, "15:00", 60, "VŠE AJ"),
    routine("thu-econ", "Ekonomie z učebnice", 4, "10:00", 90, "Ekonomie"),
    routine("thu-math", "Matematika", 4, "12:00", 60, "Matika"),
    routine("thu-en", "Běžná angličtina", 4, "14:00", 60, "Angličtina"),
    routine("fri-cfi", "CFI / Excel", 5, "10:00", 90, "Finance"),
    routine("fri-econ", "Ekonomie z učebnice", 5, "12:00", 60, "Ekonomie"),
    routine("fri-review", "Opakování týdne", 5, "14:00", 60, "Opakování"),
    routine("fri-vse", "VŠE English test", 5, "15:00", 60, "VŠE AJ"),
    routine("sat-catchup", "Dohnat resty týdne", 6, "10:00", 60, "Flex blok"),
    routine("sat-en", "Běžná angličtina", 6, "12:00", 60, "Angličtina"),
    routine("sun-plan", "Naplánovat další týden", 0, "14:00", 30, "Plánování"),
    routine("sun-vse", "VŠE English test", 0, "15:00", 60, "VŠE AJ"),
  ];
}

export function createEmptyState(): DayframeState {
  return {
    schema: 5,
    plans: {},
    backlog: [],
    routines: defaultRoutines(),
    routineSkips: [],
    milestones: defaultMilestones(),
    dismissedOverdueKeys: [],
  };
}

function withoutLockMode(task: any): CalendarTask {
  const start = typeof task.start === "string" ? task.start : undefined;
  const requestedStart = typeof task.requestedStart === "string"
    ? task.requestedStart
    : task.mode === "fixed"
      ? start
      : undefined;
  return {
    ...task,
    mode: "flexible",
    requestedStart,
    autoScheduled: requestedStart ? false : task.autoScheduled !== false,
  } as CalendarTask;
}

function normalizeLegacyTask(raw: any, date: string, index: number): CalendarTask {
  const start = typeof raw.start === "string" ? raw.start : undefined;
  const end = typeof raw.end === "string" ? raw.end : undefined;
  return {
    id: `legacy-${date}-${String(raw.id ?? index)}`,
    title: cleanTitle(String(raw.title ?? "Úkol")),
    date,
    duration: Number(raw.duration) || durationBetween(start, end),
    start,
    end,
    requestedStart: start,
    dueDate: date,
    deadlineTime: typeof raw.deadline === "string" ? raw.deadline : "22:30",
    priority: raw.priority === "high" || raw.priority === "low" ? raw.priority : "normal",
    category: String(raw.category ?? "Studium"),
    mode: "flexible",
    completed: Boolean(raw.completed),
    source: "legacy",
    dateLocked: true,
    autoScheduled: start ? false : Boolean(raw.autoScheduled),
    createdAt: new Date().toISOString(),
  };
}

export function migrateStoredState(raw: any, now = new Date()): DayframeState {
  if (raw?.schema === 5 && raw?.plans && typeof raw.plans === "object") {
    const plans = Object.fromEntries(Object.entries(raw.plans).map(([date, tasks]) => [
      date,
      Array.isArray(tasks) ? tasks.map(withoutLockMode) : [],
    ]));
    return {
      schema: 5,
      plans,
      backlog: Array.isArray(raw.backlog) ? raw.backlog.map(withoutLockMode) : [],
      routines: Array.isArray(raw.routines) ? raw.routines : defaultRoutines(),
      routineSkips: Array.isArray(raw.routineSkips) ? raw.routineSkips : [],
      milestones: Array.isArray(raw.milestones) ? raw.milestones : defaultMilestones(),
      dismissedOverdueKeys: Array.isArray(raw.dismissedOverdueKeys) ? raw.dismissedOverdueKeys : [],
    };
  }

  const state = createEmptyState();
  if (!raw || typeof raw !== "object") return state;

  const migrateDay = (date: unknown, tasks: unknown) => {
    if (typeof date !== "string" || !Array.isArray(tasks)) return;
    state.plans[date] = tasks.map((task, index) => normalizeLegacyTask(task, date, index));
  };
  migrateDay(raw.date, raw.tasks);
  migrateDay(raw.tomorrowDate, raw.tomorrowTasks);

  if (Array.isArray(raw.inboxTasks)) {
    raw.inboxTasks.forEach((item: any, index: number) => {
      const date = typeof item.targetDate === "string" ? item.targetDate : "";
      const requestedStart = typeof item.requestedStart === "string" ? item.requestedStart : undefined;
      const task: CalendarTask = {
        id: `legacy-wait-${String(item.id ?? index)}`,
        title: cleanTitle(String(item.title ?? "Úkol")),
        date,
        duration: Number(item.duration) || 45,
        requestedStart,
        dueDate: date || undefined,
        deadlineTime: typeof item.deadline === "string" ? item.deadline : "22:30",
        priority: item.priority === "high" || item.priority === "low" ? item.priority : "normal",
        category: String(item.category ?? "Studium"),
        mode: "flexible",
        completed: false,
        source: "legacy",
        dateLocked: Boolean(date),
        autoScheduled: !requestedStart,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      };
      if (date) state.plans[date] = [...(state.plans[date] ?? []), task];
      else state.backlog.push(task);
    });
  }

  if (Array.isArray(raw.milestones)) {
    state.milestones = raw.milestones.map((item: any, index: number) => ({
      id: String(item.id ?? `milestone-${index}`),
      title: String(item.title ?? "Milník"),
      date: String(item.date ?? localDateKey(now)),
      note: String(item.note ?? ""),
    }));
  }
  if (Array.isArray(raw.dismissedOverdueKeys)) state.dismissedOverdueKeys = raw.dismissedOverdueKeys;
  return state;
}

function routineMatchesDate(routine: Routine, date: Date) {
  if (!routine.active || (routine.startsOn && localDateKey(date) < routine.startsOn)) return false;
  if (routine.frequency === "alternate") {
    const anchor = routine.startsOn ?? routine.createdAt.slice(0, 10);
    const serial = (key: string) => Date.UTC(...(key.split("-").map(Number).map((v,i) => i === 1 ? v - 1 : v) as [number, number, number]));
    return Math.round((serial(localDateKey(date)) - serial(anchor)) / 86400000) % 2 === 0;
  }
  if (routine.frequency === "daily") return true;
  return (routine.weekdays ?? []).includes(date.getDay());
}

function overlapsLunch(start: number, end: number) {
  return start < LUNCH_END && end > LUNCH_START;
}

function occupiedBlocks(tasks: CalendarTask[], ignoreId?: string) {
  return tasks
    .filter((task) => task.id !== ignoreId && task.start && task.end)
    .map((task) => ({ start: timeToMinutes(task.start), end: timeToMinutes(task.end) }))
    .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end));
}

/* Manual placement may use the lunch hour. Lunch is a soft planning preference,
   not a collision. Auto-planning still skips it in findSlot below. */
export function canPlaceAt(tasks: CalendarTask[], start: number, duration: number, ignoreId?: string) {
  const end = start + duration;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 15 || start < DAY_START || end > 23 * 60) return false;
  return !occupiedBlocks(tasks, ignoreId).some((block) => start < block.end && end > block.start);
}

export function findSlot(tasks: CalendarTask[], date: string, duration: number, now: Date, deadlineTime = "22:30", exactStart?: string) {
  const todayKey = localDateKey(now);
  if (date < todayKey || !Number.isFinite(duration) || duration < 15) return null;
  const deadline = Math.min(DAY_END, timeToMinutes(deadlineTime));
  const floor = date === todayKey
    ? Math.max(DAY_START, Math.ceil((now.getHours() * 60 + now.getMinutes()) / SLOT) * SLOT)
    : DAY_START;

  /* An explicit/manual start is authoritative, including during lunch. */
  if (exactStart) {
    const start = timeToMinutes(exactStart);
    if (!Number.isFinite(start) || start < floor || start + duration > deadline || !canPlaceAt(tasks, start, duration)) return null;
    return { start: minutesToTime(start), end: minutesToTime(start + duration) };
  }

  /* Automatic scheduling treats 13:00–14:00 as a protected preference and
     looks elsewhere first; users can still override this manually. */
  for (let start = floor; start + duration <= deadline; start += SLOT) {
    if (overlapsLunch(start, start + duration)) continue;
    if (canPlaceAt(tasks, start, duration)) return { start: minutesToTime(start), end: minutesToTime(start + duration) };
  }
  return null;
}

function scheduleUnscheduledOnDate(state: DayframeState, date: string, now: Date) {
  const current = [...(state.plans[date] ?? [])];
  const scheduled = current.filter((task) => task.start && task.end);
  const waiting = current
    .filter((task) => !task.start || !task.end)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.deadlineTime ?? "22:30").localeCompare(b.deadlineTime ?? "22:30"));

  const next = [...scheduled];
  waiting.forEach((task) => {
    const slot = findSlot(next, date, task.duration, now, task.deadlineTime, task.requestedStart);
    if (slot) next.push({ ...task, ...slot, autoScheduled: !task.requestedStart, mode: "flexible" });
    else next.push(task);
  });
  return { ...state, plans: { ...state.plans, [date]: sortTasks(next) } };
}

export function materializeRange(state: DayframeState, fromKey: string, toKey: string, now = new Date()) {
  let next: DayframeState = { ...state, plans: { ...state.plans } };
  for (let cursor = fromKey; cursor <= toKey; cursor = addDaysKey(cursor, 1)) {
    if (cursor < localDateKey(now)) continue;
    const date = dateFromKey(cursor);
    const existing = [...(next.plans[cursor] ?? [])];
    for (const routine of next.routines) {
      if (!routineMatchesDate(routine, date)) continue;
      const skipKey = `${routine.id}:${cursor}`;
      if (next.routineSkips.includes(skipKey)) continue;
      const id = `routine-${routine.id}-${cursor}`;
      const duplicate = existing.some((task) => task.id === id || (task.title === routine.title && task.start === routine.start));
      if (duplicate) continue;
      if (routine.startsOn && cursor === localDateKey(now) && routine.start && timeToMinutes(routine.start) <= now.getHours() * 60 + now.getMinutes()) continue;
      const fits = !routine.start || canPlaceAt(existing, timeToMinutes(routine.start), routine.duration);
      existing.push({
        id,
        title: routine.title,
        date: cursor,
        duration: routine.duration,
        start: fits ? routine.start : undefined,
        end: fits && routine.start ? minutesToTime(timeToMinutes(routine.start) + routine.duration) : undefined,
        requestedStart: routine.start,
        dueDate: cursor,
        deadlineTime: routine.start ? minutesToTime(timeToMinutes(routine.start) + routine.duration) : "22:30",
        priority: routine.priority,
        category: routine.category,
        mode: "flexible",
        completed: false,
        source: "routine",
        routineId: routine.id,
        dateLocked: true,
        autoScheduled: false,
        createdAt: routine.createdAt,
      });
    }
    next.plans[cursor] = sortTasks(existing);
    next = scheduleUnscheduledOnDate(next, cursor, now);
  }
  return next;
}

export function sortTasks(tasks: CalendarTask[]) {
  return [...tasks].sort((a, b) => {
    if (!a.start && b.start) return -1;
    if (a.start && !b.start) return 1;
    if (!a.start && !b.start) return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt);
    return (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title, "cs");
  });
}

export function getTasksForDate(state: DayframeState, date: string) {
  return sortTasks(state.plans[date] ?? []);
}

export function priorityRank(priority: Priority) {
  return priority === "high" ? 0 : priority === "low" ? 2 : 1;
}

function createTaskFromDraft(draft: TaskDraft, date: string, now: Date, dateLocked: boolean): CalendarTask {
  return {
    id: taskId(),
    title: cleanTitle(draft.title),
    date,
    duration: Math.max(15, draft.duration || 45),
    requestedStart: draft.start,
    milestoneId: draft.milestoneId,
    dueDate: draft.dueDate,
    deadlineTime: draft.deadlineTime ?? "22:30",
    priority: draft.priority,
    category: draft.category,
    mode: "flexible",
    completed: false,
    source: "user",
    dateLocked,
    autoScheduled: !draft.start,
    createdAt: now.toISOString(),
  };
}

function dateRangeForDraft(draft: TaskDraft, now: Date) {
  if (draft.date) return [draft.date];
  const today = localDateKey(now);
  const weekEnd = addDaysKey(today, 6);
  const end = draft.dueDate && draft.dueDate < weekEnd ? draft.dueDate : weekEnd;
  const keys: string[] = [];
  for (let cursor = today; cursor <= end; cursor = addDaysKey(cursor, 1)) keys.push(cursor);
  return keys;
}

export function addTask(state: DayframeState, draft: TaskDraft, now = new Date()) {
  const dates = dateRangeForDraft(draft, now);
  let next = materializeRange(state, dates[0], dates[dates.length - 1], now);
  const base = createTaskFromDraft(draft, dates[0] ?? localDateKey(now), now, Boolean(draft.date));

  for (const date of dates) {
    const slot = findSlot(next.plans[date] ?? [], date, base.duration, now, draft.deadlineTime, draft.start);
    if (!slot) continue;
    const task = { ...base, date, ...slot, dateLocked: Boolean(draft.date), autoScheduled: !draft.start };
    next = { ...next, plans: { ...next.plans, [date]: sortTasks([...(next.plans[date] ?? []), task]) } };
    return { state: maybeAddRoutine(next, draft, task, now), task, status: "scheduled" as const };
  }

  const targetDate = draft.date ?? dates[0] ?? localDateKey(now);
  const waiting = { ...base, date: targetDate };
  if (draft.date) {
    next = { ...next, plans: { ...next.plans, [targetDate]: sortTasks([...(next.plans[targetDate] ?? []), waiting]) } };
  } else {
    next = { ...next, backlog: [...next.backlog, waiting] };
  }
  return { state: maybeAddRoutine(next, draft, waiting, now), task: waiting, status: "waiting" as const };
}

function maybeAddRoutine(state: DayframeState, draft: TaskDraft, task: CalendarTask, now: Date) {
  if (!draft.repeat || draft.repeat === "none") return state;
  const frequency = draft.repeat;
  const routineItem: Routine = {
    id: taskId("routine"),
    title: task.title,
    duration: task.duration,
    start: draft.start,
    category: task.category,
    priority: task.priority,
    frequency,
    startsOn: task.date,
    weekdays: frequency === "weekly" ? [dateFromKey(task.date).getDay()] : undefined,
    active: true,
    createdAt: now.toISOString(),
  };
  // Link the first occurrence so deleting it cannot rematerialize a duplicate.
  const plans = { ...state.plans, [task.date]: (state.plans[task.date] ?? []).map(t => t.id === task.id ? { ...t, routineId: routineItem.id, source: "routine" as const } : t) };
  return { ...state, plans, routines: [...state.routines, routineItem] };
}

export function updateTask(state: DayframeState, taskIdValue: string, patch: Partial<CalendarTask>, now = new Date()) {
  let found: CalendarTask | undefined;
  let fromDate = "";
  Object.entries(state.plans).some(([date, tasks]) => {
    found = tasks.find((task) => task.id === taskIdValue);
    if (found) fromDate = date;
    return Boolean(found);
  });
  found ??= state.backlog.find(task => task.id === taskIdValue);
  if (!found) return { state, error: "Úkol nebyl nalezen." };
  if ((fromDate && fromDate < localDateKey(now)) || (patch.date && patch.date < localDateKey(now))) return { state, error: "Minulé dny jsou historie." };
  if (patch.duration !== undefined && (!Number.isFinite(patch.duration) || patch.duration < 15)) return { state, error: "Délka musí být alespoň 15 minut." };

  const updated: CalendarTask = { ...found, ...patch, id: found.id, mode: "flexible" };
  const toDate = patch.date ?? (fromDate || localDateKey(now));
  updated.date = toDate;
  if (updated.start) {
    updated.end = minutesToTime(timeToMinutes(updated.start) + updated.duration);
    const destination = (state.plans[toDate] ?? []).filter((task) => task.id !== updated.id);
    const start = timeToMinutes(updated.start);
    if (!canPlaceAt(destination, start, updated.duration)) return { state, error: "V tomto čase už je jiný blok." };
  } else {
    updated.end = undefined;
    updated.requestedStart = undefined;
    updated.autoScheduled = true;
  }

  const plans = { ...state.plans };
  if (fromDate) plans[fromDate] = (plans[fromDate] ?? []).filter((task) => task.id !== updated.id);
  plans[toDate] = sortTasks([...(plans[toDate] ?? []).filter((task) => task.id !== updated.id), updated]);
  let next = { ...state, plans, backlog: state.backlog.filter(task => task.id !== updated.id) };
  if (!updated.start) next = scheduleUnscheduledOnDate(next, toDate, now);
  return { state: next, task: updated };
}

export function deleteTask(state: DayframeState, taskIdValue: string, now = new Date()) {
  const plans: Record<string, CalendarTask[]> = {};
  let removed: CalendarTask | undefined;
  for (const [date, tasks] of Object.entries(state.plans)) {
    const task = tasks.find((item) => item.id === taskIdValue);
    if (task) removed = task;
    if (task && date < localDateKey(now)) return state;
    plans[date] = tasks.filter((item) => item.id !== taskIdValue);
  }
  let routineSkips = state.routineSkips;
  if (removed?.routineId) routineSkips = [...new Set([...routineSkips, `${removed.routineId}:${removed.date}`])];
  return { ...state, plans, backlog: state.backlog.filter((task) => task.id !== taskIdValue), routineSkips };
}

export function toggleTask(state: DayframeState, id: string, now = new Date()) {
  const plans = Object.fromEntries(Object.entries(state.plans).map(([date, tasks]) => [
    date,
    tasks.map((task) => date >= localDateKey(now) && task.id === id ? { ...task, completed: !task.completed } : task),
  ]));
  return { ...state, plans };
}

export function moveTask(state: DayframeState, id: string, toDate: string, toStart: string, now = new Date()) {
  let task: CalendarTask | undefined;
  let fromDate = "";
  for (const [date, tasks] of Object.entries(state.plans)) {
    const match = tasks.find((item) => item.id === id);
    if (match) { task = match; fromDate = date; break; }
  }
  if (!task) return { state, error: "Úkol nebyl nalezen." };
  if (fromDate < localDateKey(now) || toDate < localDateKey(now)) return { state, error: "Minulé dny jsou historie." };

  const start = roundToQuarter(timeToMinutes(toStart));
  const destination = (state.plans[toDate] ?? []).filter((item) => item.id !== id);
  if (!canPlaceAt(destination, start, task.duration)) return { state, error: "Sem se úkol nevejde." };

  const plans = { ...state.plans };
  plans[fromDate] = (plans[fromDate] ?? []).filter((item) => item.id !== id);
  const moved: CalendarTask = {
    ...task,
    id: task.source === "routine" ? taskId() : task.id,
    date: toDate,
    start: minutesToTime(start),
    end: minutesToTime(start + task.duration),
    requestedStart: minutesToTime(start),
    mode: "flexible",
    source: task.source === "routine" ? "user" : task.source,
    routineId: task.source === "routine" ? undefined : task.routineId,
    dateLocked: true,
    autoScheduled: false,
  };
  plans[toDate] = sortTasks([...destination, moved]);
  const routineSkips = task.routineId
    ? [...new Set([...state.routineSkips, `${task.routineId}:${fromDate}`])]
    : state.routineSkips;
  return { state: { ...state, plans, routineSkips }, task: moved };
}

export function moveTaskToTomorrow(state: DayframeState, id: string, now = new Date()) {
  let task: CalendarTask | undefined;
  for (const tasks of Object.values(state.plans)) {
    task = tasks.find((item) => item.id === id);
    if (task) break;
  }
  if (!task || task.date < localDateKey(now)) return state;
  const tomorrow = addDaysKey(localDateKey(now), 1);
  const without = deleteTask(state, id, now);
  const stripped: CalendarTask = { ...task, id: taskId(), date: tomorrow, start: undefined, end: undefined, requestedStart: undefined, mode: "flexible", source: "user", routineId: undefined, dateLocked: true, autoScheduled: true, completed: false };
  const next = { ...without, plans: { ...without.plans, [tomorrow]: sortTasks([...(without.plans[tomorrow] ?? []), stripped]) } };
  return scheduleUnscheduledOnDate(next, tomorrow, now);
}

export function replanWeek(state: DayframeState, reference: Date, now = new Date()) {
  const keys = weekKeys(reference);
  let next = materializeRange(state, keys[0], keys[6], now);
  const movable: CalendarTask[] = [];
  const plans = { ...next.plans };

  for (const date of keys) {
    if (date < localDateKey(now)) continue;
    const keep: CalendarTask[] = [];
    for (const task of plans[date] ?? []) {
      const manuallyPlaced = Boolean(task.requestedStart) || task.autoScheduled === false;
      if ((date === localDateKey(now) && task.start && timeToMinutes(task.start) < now.getHours() * 60 + now.getMinutes()) || task.completed || task.source === "routine" || task.dateLocked || manuallyPlaced) keep.push(task);
      else movable.push({ ...task, start: undefined, end: undefined });
    }
    plans[date] = keep;
  }
  next = { ...next, plans };

  movable.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)
    || (a.dueDate ?? keys[6]).localeCompare(b.dueDate ?? keys[6])
    || a.createdAt.localeCompare(b.createdAt));

  for (const task of movable) {
    const allowed = keys.filter((date) => date >= localDateKey(now) && (!task.dueDate || date <= task.dueDate));
    let placed = false;
    for (const date of allowed) {
      const slot = findSlot(next.plans[date] ?? [], date, task.duration, now, task.deadlineTime);
      if (!slot) continue;
      const moved = { ...task, date, ...slot, mode: "flexible" as const, autoScheduled: true };
      next.plans[date] = sortTasks([...(next.plans[date] ?? []), moved]);
      placed = true;
      break;
    }
    if (!placed) next.backlog = [...next.backlog, task];
  }
  return retryBacklog(next, reference, now);
}

export function addMilestone(state: DayframeState, title: string, date: string) {
  const milestone: Milestone = { id: taskId("milestone"), title: title.trim(), date, note: "Vlastní termín" };
  return { ...state, milestones: [...state.milestones, milestone].sort((a, b) => a.date.localeCompare(b.date)) };
}

function futureRoutineTask(task: CalendarTask, now: Date) {
  const today = localDateKey(now);
  return !task.completed && (task.date > today || (task.date === today && (!task.start || timeToMinutes(task.start) > now.getHours() * 60 + now.getMinutes())));
}

export function deleteRoutine(state: DayframeState, id: string, now = new Date()) {
  const routines = state.routines.filter((item) => item.id !== id);
  const plans = Object.fromEntries(Object.entries(state.plans).map(([date, tasks]) => [date, tasks.filter((task) => task.routineId !== id || !futureRoutineTask(task, now))]));
  return { ...state, routines, plans };
}

export function setRoutineActive(state: DayframeState, id: string, active: boolean, now = new Date()) {
  const original = state.routines.find(r => r.id === id);
  if (!original) return state;
  const clean = deleteRoutine(state, id, now);
  const next = { ...clean, routines: state.routines.map(r => r.id === id ? { ...r, active } : r) };
  return materializeRange(next, localDateKey(now), addDaysKey(localDateKey(now), 28), now);
}

export function retryBacklog(state: DayframeState, reference: Date, now = new Date(), onlyId?: string) {
  let next = { ...state, plans: { ...state.plans }, backlog: [] as CalendarTask[] };
  const keys = weekKeys(reference).filter(date => date >= localDateKey(now));
  for (const task of [...state.backlog].sort((a,b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))) {
    if (onlyId && task.id !== onlyId) { next.backlog.push(task); continue; }
    let placed = false;
    for (const date of keys.filter(date => (!task.dateLocked || task.date === date) && (!task.dueDate || date <= task.dueDate))) {
      next = materializeRange(next, date, date, now);
      const slot = findSlot(next.plans[date] ?? [], date, task.duration, now, task.deadlineTime, task.requestedStart);
      if (!slot) continue;
      next.plans[date] = sortTasks([...(next.plans[date] ?? []), { ...task, date, ...slot }]);
      placed = true;
      break;
    }
    if (!placed) next.backlog.push(task);
  }
  return next;
}

export function overdueTasks(state: DayframeState, now = new Date()) {
  const today = localDateKey(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  return (state.plans[today] ?? []).filter((task) => !task.completed && task.end && timeToMinutes(task.end) <= minute);
}

export const calendarBounds = { dayStart: DAY_START, lunchStart: LUNCH_START, lunchEnd: LUNCH_END, dayEnd: DAY_END, slot: SLOT };
export function routineLabel(routine: Routine) {
  if (routine.frequency === "daily") return "Každý den";
  if (routine.frequency === "alternate") return `Obden od ${routine.startsOn ?? routine.createdAt.slice(0, 10)}`;
  const names = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  return [...(routine.weekdays ?? [])].sort((a,b) => ((a+6)%7)-((b+6)%7)).map(d => names[d]).join(", ");
}

export function saveRoutine(state: DayframeState, input: Routine, now = new Date()): { state: DayframeState; error?: string } {
  if (!input.title.trim() || !input.start || !Number.isFinite(input.duration) || input.duration < 15 || input.duration > 360 || timeToMinutes(input.start) < DAY_START || timeToMinutes(input.start) + input.duration > 23 * 60 || (input.frequency === "weekly" && !input.weekdays?.length)) return { state, error: "Vyplň název, čas, délku a dny opakování (10:00–23:00)." };
  const today = localDateKey(now);
  if (!input.startsOn || input.startsOn < today) return { state, error: "Začátek opakování musí být dnes nebo později." };
  const existing = state.routines.find(r => r.id === input.id);
  const saved = { ...input, id: input.id || taskId("routine"), title: input.title.trim(), createdAt: existing?.createdAt ?? now.toISOString() };
  const clean = existing ? deleteRoutine(state, input.id, now) : state;
  const end = addDaysKey(input.startsOn, 28);
  for (let date = input.startsOn; date <= end; date = addDaysKey(date, 1)) {
    if (!saved.active || !routineMatchesDate(saved, dateFromKey(date))) continue;
    if (date === today && timeToMinutes(saved.start) <= now.getHours() * 60 + now.getMinutes()) continue;
    if (!canPlaceAt(clean.plans[date] ?? [], timeToMinutes(saved.start), saved.duration)) return { state, error: `V ${date} v ${saved.start} už je jiný blok. Zvol jiný čas.` };
  }
  const next = { ...clean, routines: [...clean.routines, saved] };
  return { state: materializeRange(next, today, end, now) };
}

export function milestoneProgress(state: DayframeState, id: string, now = new Date()) {
  const tasks = [...Object.values(state.plans).flat(), ...state.backlog].filter(t => t.milestoneId === id);
  const completed = tasks.filter(t => t.completed).reduce((n,t) => n + t.duration, 0);
  const planned = tasks.filter(t => !t.completed && t.start && (t.date > localDateKey(now) || (t.date === localDateKey(now) && timeToMinutes(t.end) > now.getHours()*60 + now.getMinutes()))).reduce((n,t) => n + t.duration, 0);
  const allocated = tasks.reduce((n,t) => n + t.duration, 0);
  const target = state.milestones.find(m => m.id === id)?.targetMinutes ?? 0;
  return { completed, planned, waiting: allocated - completed - planned, missing: Math.max(0, target - allocated), target };
}

export function planMilestone(state: DayframeState, id: string, now = new Date()) {
  const milestone = state.milestones.find(m => m.id === id);
  const today = localDateKey(now);
  if (!milestone || milestone.date < today || !milestone.targetMinutes || milestone.targetMinutes < 15) return { state, tasks: [] as CalendarTask[], error: "Nastav budoucí termín a alespoň 15 minut přípravy." };
  const horizon = addDaysKey(today, 365);
  const end = milestone.date < horizon ? milestone.date : horizon;
  let next = materializeRange(state, today, end, now);
  let remaining = milestoneProgress(next, id, now).missing;
  const tasks: CalendarTask[] = [];
  const block = Math.max(15, Math.min(180, milestone.blockMinutes ?? 60));
  // One block per day on each pass spreads preparation rather than filling one day.
  for (let pass = 0; pass < 32 && remaining >= 15; pass++) {
    let progress = false;
    for (let date = today; date <= end && remaining >= 15; date = addDaysKey(date, 1)) {
      const duration = Math.min(block, remaining);
      const slot = findSlot(next.plans[date] ?? [], date, duration, now);
      if (!slot) continue;
      const task = { ...createTaskFromDraft({ title: milestone.title, duration, dueDate: milestone.date, priority: "normal", category: milestone.category ?? "Studium" }, date, now, false), ...slot, milestoneId: id };
      next = { ...next, plans: { ...next.plans, [date]: sortTasks([...(next.plans[date] ?? []), task]) } };
      tasks.push(task);
      remaining -= duration;
      progress = true;
    }
    if (!progress) break;
  }
  return { state: next, tasks, remaining, error: undefined };
}
