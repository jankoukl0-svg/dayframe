import { addDaysKey, dateFromKey } from "@/lib/dayframe-calendar";

export const HYGIENE_STORAGE_KEY = "dayframe-hygiene-v1";
export const HYGIENE_SYNC_EVENT = "dayframe-hygiene-sync";

export type HygieneTaskStatus = "done" | "skipped";

export type HygieneSchedule =
  | { type: "daily" }
  | { type: "days"; weekdays: number[] }
  | { type: "weekly"; weekday: number }
  | { type: "interval"; everyDays: number; anchorDate: string }
  | { type: "monthly"; day: number }
  | { type: "nth-weekday"; week: number; weekday: number }
  | { type: "manual" };

export type HygieneTaskDefinition = {
  id: string;
  title: string;
  section: string;
  active: boolean;
  optional: boolean;
  allowSkip: boolean;
  schedule?: HygieneSchedule;
};

export type HygieneRoutineDefinition = {
  id: string;
  title: string;
  active: boolean;
  order: number;
  schedule: HygieneSchedule;
  tasks: HygieneTaskDefinition[];
};

export type HygieneTaskSnapshot = {
  id: string;
  title: string;
  section: string;
  optional: boolean;
  allowSkip: boolean;
};

export type HygieneRoutineRecord = {
  date: string;
  routineId: string;
  routineTitle: string;
  scheduledTasks: HygieneTaskSnapshot[];
  states: Record<string, HygieneTaskStatus>;
};

export type HygieneStore = {
  version: 1;
  routines: HygieneRoutineDefinition[];
  records: Record<string, Record<string, HygieneRoutineRecord>>;
  manualDates: Record<string, string[]>;
  lastMaterializedDate: string | null;
};

export type HygieneRoutineStatus = "complete" | "partial" | "missed" | "skipped" | "scheduled";

export type HygieneRoutineSummary = {
  routine: HygieneRoutineDefinition;
  record: HygieneRoutineRecord;
  status: HygieneRoutineStatus;
  handled: number;
  total: number;
  done: number;
  skipped: number;
  optionalDone: number;
};

export type HygieneRoutineStats = {
  plannedDays: number;
  completedDays: number;
  skippedDays: number;
  skippedTasks: number;
  partialDays: number;
  missedDays: number;
  successRate: number;
  currentStreak: number;
  longestStreak: number;
};

const DEFAULT_SECTION = "Péče";

function task(
  id: string,
  title: string,
  section = DEFAULT_SECTION,
  options: Partial<Pick<HygieneTaskDefinition, "optional" | "allowSkip" | "schedule">> = {},
): HygieneTaskDefinition {
  return {
    id,
    title,
    section,
    active: true,
    optional: options.optional === true,
    allowSkip: options.allowSkip === true,
    schedule: options.schedule,
  };
}

export function createDefaultHygieneStore(today: string): HygieneStore {
  const monthlyFirstSunday: HygieneSchedule = { type: "nth-weekday", week: 1, weekday: 0 };

  return {
    version: 1,
    routines: [
      {
        id: "morning",
        title: "Ranní rutina",
        active: true,
        order: 10,
        schedule: { type: "daily" },
        tasks: [
          task("morning-shower", "Ranní sprcha"),
          task("morning-teeth", "Vyčistit zuby"),
          task("morning-face", "Očistit obličej"),
          task("morning-spf", "Hydratační krém + SPF"),
          task("morning-deodorant", "Deodorant"),
          task("morning-grooming", "Úprava vlasů a vousů"),
        ],
      },
      {
        id: "evening",
        title: "Večerní rutina",
        active: true,
        order: 20,
        schedule: { type: "daily" },
        tasks: [
          task("evening-shower", "Večerní sprcha"),
          task("evening-face", "Očištění obličeje"),
          task("evening-skin", "Hydratace pokožky"),
          task("evening-teeth", "Vyčištění zubů"),
          task("evening-interdental", "Mezizubní čištění"),
        ],
      },
      {
        id: "hygiene-day",
        title: "Hygiene Day",
        active: true,
        order: 30,
        schedule: { type: "weekly", weekday: 0 },
        tasks: [
          task("weekly-exfoliation", "Jemná exfoliace těla kartáčem", "Péče o tělo a obličej", { optional: true, allowSkip: true }),
          task("weekly-gua-sha", "Masáž obličeje / Gua Sha", "Péče o tělo a obličej", { optional: true, allowSkip: true }),
          task("weekly-body-hydration", "Hydratace těla", "Péče o tělo a obličej"),
          task("weekly-feet", "Péče o chodidla", "Péče o tělo a obličej"),
          task("weekly-beard", "Holení nebo úprava vousů", "Grooming", { allowSkip: true }),
          task("weekly-hand-nails", "Kontrola a případné stříhání nehtů na rukou", "Grooming", { allowSkip: true }),
          task("weekly-eyebrows", "Úprava obočí podle potřeby", "Grooming", { allowSkip: true }),
          task("weekly-nose-ears", "Zastřižení chloupků v nose a uších podle potřeby", "Grooming", { allowSkip: true }),
          task("weekly-bed", "Převléknout celou postel", "Hygiena prostředí a pomůcek"),
          task("weekly-phone", "Vyčistit mobilní telefon a jeho obal", "Hygiena prostředí a pomůcek"),
          task("weekly-headphones", "Vyčistit sluchátka", "Hygiena prostředí a pomůcek"),
          task("weekly-towels", "Vyměnit ručníky", "Hygiena prostředí a pomůcek"),
          task("weekly-brushes", "Vyčistit hřeben a kartáče", "Hygiena prostředí a pomůcek"),
          task("weekly-razor", "Vyčistit holicí strojek", "Hygiena prostředí a pomůcek"),
          task("monthly-moles", "Kontrola znamének a změn pokožky", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-toenails", "Kontrola a případné stříhání nehtů na nohou", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-razors", "Kontrola stavu žiletek a hygienických pomůcek", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-keyboard", "Důkladnější vyčištění klávesnice a myši", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-supplies", "Kontrola a výměna opotřebovaných hygienických potřeb podle potřeby", "Měsíční péče", { schedule: monthlyFirstSunday }),
        ],
      },
    ],
    records: {},
    manualDates: {},
    lastMaterializedDate: addDaysKey(today, -1),
  };
}

function cleanSchedule(value: unknown): HygieneSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schedule = value as Partial<HygieneSchedule>;
  if (schedule.type === "daily") return { type: "daily" };
  if (schedule.type === "manual") return { type: "manual" };
  if (schedule.type === "days") {
    const weekdays = Array.isArray(schedule.weekdays)
      ? [...new Set(schedule.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    return weekdays.length ? { type: "days", weekdays } : null;
  }
  if (schedule.type === "weekly" && Number.isInteger(schedule.weekday) && Number(schedule.weekday) >= 0 && Number(schedule.weekday) <= 6) {
    return { type: "weekly", weekday: Number(schedule.weekday) };
  }
  if (schedule.type === "interval" && Number.isInteger(schedule.everyDays) && Number(schedule.everyDays) >= 1 && typeof schedule.anchorDate === "string") {
    return { type: "interval", everyDays: Number(schedule.everyDays), anchorDate: schedule.anchorDate };
  }
  if (schedule.type === "monthly" && Number.isInteger(schedule.day) && Number(schedule.day) >= 1 && Number(schedule.day) <= 31) {
    return { type: "monthly", day: Number(schedule.day) };
  }
  if (
    schedule.type === "nth-weekday"
    && Number.isInteger(schedule.week)
    && Number(schedule.week) >= 1
    && Number(schedule.week) <= 5
    && Number.isInteger(schedule.weekday)
    && Number(schedule.weekday) >= 0
    && Number(schedule.weekday) <= 6
  ) {
    return { type: "nth-weekday", week: Number(schedule.week), weekday: Number(schedule.weekday) };
  }
  return null;
}

export function parseHygieneStore(raw: string | null, today: string): { store: HygieneStore; blocked: boolean } {
  if (raw === null) return { store: createDefaultHygieneStore(today), blocked: false };

  try {
    const candidate = JSON.parse(raw) as Partial<HygieneStore>;
    if (
      !candidate
      || candidate.version !== 1
      || !Array.isArray(candidate.routines)
      || !candidate.records
      || typeof candidate.records !== "object"
      || Array.isArray(candidate.records)
      || !candidate.manualDates
      || typeof candidate.manualDates !== "object"
      || Array.isArray(candidate.manualDates)
    ) {
      return { store: createDefaultHygieneStore(today), blocked: true };
    }

    const routines: HygieneRoutineDefinition[] = [];
    const routineIds = new Set<string>();
    for (const rawRoutine of candidate.routines) {
      if (!rawRoutine || typeof rawRoutine !== "object" || Array.isArray(rawRoutine)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      const routine = rawRoutine as Partial<HygieneRoutineDefinition>;
      const schedule = cleanSchedule(routine.schedule);
      if (
        typeof routine.id !== "string"
        || !routine.id
        || routineIds.has(routine.id)
        || typeof routine.title !== "string"
        || !routine.title.trim()
        || typeof routine.active !== "boolean"
        || !Number.isFinite(routine.order)
        || !schedule
        || !Array.isArray(routine.tasks)
      ) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }

      const taskIds = new Set<string>();
      const tasks: HygieneTaskDefinition[] = [];
      for (const rawTask of routine.tasks) {
        if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const item = rawTask as Partial<HygieneTaskDefinition>;
        const taskSchedule = item.schedule === undefined ? undefined : cleanSchedule(item.schedule);
        if (
          typeof item.id !== "string"
          || !item.id
          || taskIds.has(item.id)
          || typeof item.title !== "string"
          || !item.title.trim()
          || typeof item.section !== "string"
          || !item.section.trim()
          || typeof item.active !== "boolean"
          || typeof item.optional !== "boolean"
          || typeof item.allowSkip !== "boolean"
          || (item.schedule !== undefined && !taskSchedule)
        ) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        taskIds.add(item.id);
        tasks.push({
          id: item.id,
          title: item.title.trim(),
          section: item.section.trim(),
          active: item.active,
          optional: item.optional,
          allowSkip: item.allowSkip,
          schedule: taskSchedule ?? undefined,
        });
      }

      routineIds.add(routine.id);
      routines.push({
        id: routine.id,
        title: routine.title.trim(),
        active: routine.active,
        order: Number(routine.order),
        schedule,
        tasks,
      });
    }

    const records: HygieneStore["records"] = {};
    for (const [date, dateRecords] of Object.entries(candidate.records)) {
      if (!dateRecords || typeof dateRecords !== "object" || Array.isArray(dateRecords)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      records[date] = {};
      for (const [routineId, rawRecord] of Object.entries(dateRecords)) {
        if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const record = rawRecord as Partial<HygieneRoutineRecord>;
        if (
          record.date !== date
          || record.routineId !== routineId
          || typeof record.routineTitle !== "string"
          || !Array.isArray(record.scheduledTasks)
          || !record.states
          || typeof record.states !== "object"
          || Array.isArray(record.states)
        ) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const snapshots: HygieneTaskSnapshot[] = [];
        for (const rawSnapshot of record.scheduledTasks) {
          if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          const snapshot = rawSnapshot as Partial<HygieneTaskSnapshot>;
          if (
            typeof snapshot.id !== "string"
            || typeof snapshot.title !== "string"
            || typeof snapshot.section !== "string"
            || typeof snapshot.optional !== "boolean"
            || typeof snapshot.allowSkip !== "boolean"
          ) {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          snapshots.push({
            id: snapshot.id,
            title: snapshot.title,
            section: snapshot.section,
            optional: snapshot.optional,
            allowSkip: snapshot.allowSkip,
          });
        }
        const states: Record<string, HygieneTaskStatus> = {};
        for (const [taskId, state] of Object.entries(record.states)) {
          if (state !== "done" && state !== "skipped") {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          states[taskId] = state;
        }
        records[date][routineId] = {
          date,
          routineId,
          routineTitle: record.routineTitle,
          scheduledTasks: snapshots,
          states,
        };
      }
    }

    const manualDates: Record<string, string[]> = {};
    for (const [date, ids] of Object.entries(candidate.manualDates)) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      manualDates[date] = [...new Set(ids)];
    }

    return {
      store: {
        version: 1,
        routines,
        records,
        manualDates,
        lastMaterializedDate: typeof candidate.lastMaterializedDate === "string" ? candidate.lastMaterializedDate : null,
      },
      blocked: false,
    };
  } catch {
    return { store: createDefaultHygieneStore(today), blocked: true };
  }
}

function dayDiff(from: string, to: string) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

export function scheduleMatches(schedule: HygieneSchedule, dateKey: string) {
  const date = dateFromKey(dateKey);
  const weekday = date.getDay();

  if (schedule.type === "daily") return true;
  if (schedule.type === "days") return schedule.weekdays.includes(weekday);
  if (schedule.type === "weekly") return weekday === schedule.weekday;
  if (schedule.type === "interval") {
    const difference = dayDiff(schedule.anchorDate, dateKey);
    return difference >= 0 && difference % schedule.everyDays === 0;
  }
  if (schedule.type === "monthly") return date.getDate() === schedule.day;
  if (schedule.type === "nth-weekday") {
    return weekday === schedule.weekday && Math.ceil(date.getDate() / 7) === schedule.week;
  }
  return false;
}

export function routineScheduledOnDate(store: HygieneStore, routine: HygieneRoutineDefinition, dateKey: string) {
  if (!routine.active) return false;
  if (routine.schedule.type === "manual") return (store.manualDates[dateKey] ?? []).includes(routine.id);
  return scheduleMatches(routine.schedule, dateKey);
}

export function taskScheduledOnDate(task: HygieneTaskDefinition, dateKey: string) {
  if (!task.active) return false;
  if (!task.schedule) return true;
  if (task.schedule.type === "manual") return false;
  return scheduleMatches(task.schedule, dateKey);
}

function taskSnapshot(task: HygieneTaskDefinition): HygieneTaskSnapshot {
  return {
    id: task.id,
    title: task.title,
    section: task.section,
    optional: task.optional,
    allowSkip: task.allowSkip,
  };
}

export function materializeHygieneDate(store: HygieneStore, dateKey: string, refresh = false): HygieneStore {
  const dateRecords = { ...(store.records[dateKey] ?? {}) };
  let changed = false;

  for (const routine of store.routines) {
    if (!routineScheduledOnDate(store, routine, dateKey)) continue;
    const scheduledTasks = routine.tasks.filter((item) => taskScheduledOnDate(item, dateKey)).map(taskSnapshot);
    if (!scheduledTasks.length) continue;

    const existing = dateRecords[routine.id];
    if (!existing) {
      dateRecords[routine.id] = {
        date: dateKey,
        routineId: routine.id,
        routineTitle: routine.title,
        scheduledTasks,
        states: {},
      };
      changed = true;
      continue;
    }

    if (refresh) {
      const validTaskIds = new Set(scheduledTasks.map((item) => item.id));
      const states = Object.fromEntries(Object.entries(existing.states).filter(([taskId]) => validTaskIds.has(taskId)));
      const next = {
        ...existing,
        routineTitle: routine.title,
        scheduledTasks,
        states,
      };
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        dateRecords[routine.id] = next;
        changed = true;
      }
    }
  }

  if (!changed && store.records[dateKey]) return store;
  return {
    ...store,
    records: {
      ...store.records,
      [dateKey]: dateRecords,
    },
  };
}

export function ensureHygieneHistory(store: HygieneStore, today: string): HygieneStore {
  let next = store;
  let cursor = store.lastMaterializedDate;

  if (!cursor) {
    next = materializeHygieneDate(next, today, true);
    return { ...next, lastMaterializedDate: today };
  }

  if (cursor < today) {
    let date = addDaysKey(cursor, 1);
    while (date <= today) {
      next = materializeHygieneDate(next, date, date === today);
      date = addDaysKey(date, 1);
    }
    next = { ...next, lastMaterializedDate: today };
  } else {
    next = materializeHygieneDate(next, today, true);
  }

  return next;
}

export function refreshHygieneToday(store: HygieneStore, today: string) {
  return materializeHygieneDate(store, today, true);
}

export function loadHygieneStore(today: string): { store: HygieneStore; blocked: boolean } {
  if (typeof window === "undefined") return { store: createDefaultHygieneStore(today), blocked: false };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(HYGIENE_STORAGE_KEY);
  } catch {
    return { store: createDefaultHygieneStore(today), blocked: true };
  }

  const parsed = parseHygieneStore(raw, today);
  if (parsed.blocked) return parsed;
  const ensured = ensureHygieneHistory(parsed.store, today);
  try {
    window.localStorage.setItem(HYGIENE_STORAGE_KEY, JSON.stringify(ensured));
  } catch {
    return { store: parsed.store, blocked: true };
  }
  return { store: ensured, blocked: false };
}

export function saveHygieneStore(store: HygieneStore) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(HYGIENE_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(HYGIENE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

function completionTasks(record: HygieneRoutineRecord) {
  const required = record.scheduledTasks.filter((item) => !item.optional);
  return required.length ? required : record.scheduledTasks;
}

export function routineSummary(
  routine: HygieneRoutineDefinition,
  record: HygieneRoutineRecord,
  today: string,
): HygieneRoutineSummary {
  const base = completionTasks(record);
  const handled = base.filter((item) => record.states[item.id] === "done" || record.states[item.id] === "skipped").length;
  const done = record.scheduledTasks.filter((item) => record.states[item.id] === "done").length;
  const skipped = record.scheduledTasks.filter((item) => record.states[item.id] === "skipped").length;
  const optionalDone = record.scheduledTasks.filter((item) => item.optional && record.states[item.id] === "done").length;
  const allSkipped = base.length > 0 && base.every((item) => record.states[item.id] === "skipped");
  const complete = base.length > 0 && handled === base.length;
  const touched = Object.keys(record.states).length > 0;

  let status: HygieneRoutineStatus = "scheduled";
  if (allSkipped) status = "skipped";
  else if (complete) status = "complete";
  else if (touched) status = "partial";
  else if (record.date < today) status = "missed";

  return {
    routine,
    record,
    status,
    handled,
    total: base.length,
    done,
    skipped,
    optionalDone,
  };
}

export function scheduledRoutineSummaries(store: HygieneStore, dateKey: string, today = dateKey) {
  const dateRecords = store.records[dateKey] ?? {};
  return store.routines
    .filter((routine) => routineScheduledOnDate(store, routine, dateKey))
    .sort((left, right) => left.order - right.order)
    .map((routine) => {
      const record = dateRecords[routine.id];
      return record ? routineSummary(routine, record, today) : null;
    })
    .filter((value): value is HygieneRoutineSummary => Boolean(value));
}

export function setHygieneTaskStatus(
  store: HygieneStore,
  dateKey: string,
  routineId: string,
  taskId: string,
  status: HygieneTaskStatus | null,
) {
  const record = store.records[dateKey]?.[routineId];
  if (!record) return store;
  const states = { ...record.states };
  if (status === null) delete states[taskId];
  else states[taskId] = status;

  return {
    ...store,
    records: {
      ...store.records,
      [dateKey]: {
        ...store.records[dateKey],
        [routineId]: { ...record, states },
      },
    },
  };
}

export function toggleManualRoutine(store: HygieneStore, dateKey: string, routineId: string, enabled: boolean) {
  const current = store.manualDates[dateKey] ?? [];
  const nextIds = enabled
    ? [...new Set([...current, routineId])]
    : current.filter((id) => id !== routineId);
  const next: HygieneStore = {
    ...store,
    manualDates: { ...store.manualDates, [dateKey]: nextIds },
  };
  return refreshHygieneToday(next, dateKey);
}

export function overallHygieneProgress(summaries: HygieneRoutineSummary[]) {
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const handled = summaries.reduce((sum, item) => sum + item.handled, 0);
  return {
    handled,
    total,
    percent: total ? Math.round((handled / total) * 100) : 0,
  };
}

export function routineStats(store: HygieneStore, routineId: string, today: string): HygieneRoutineStats {
  const routine = store.routines.find((item) => item.id === routineId);
  const entries = Object.entries(store.records)
    .filter(([date, records]) => date <= today && Boolean(records[routineId]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, records]) => {
      const record = records[routineId];
      const definition = routine ?? {
        id: routineId,
        title: record.routineTitle,
        active: false,
        order: 999,
        schedule: { type: "manual" } as HygieneSchedule,
        tasks: [],
      };
      return routineSummary(definition, record, today);
    });

  let completedDays = 0;
  let skippedDays = 0;
  let skippedTasks = 0;
  let partialDays = 0;
  let missedDays = 0;
  let longestStreak = 0;
  let running = 0;

  for (const item of entries) {
    skippedTasks += item.skipped;
    if (item.status === "complete") {
      completedDays += 1;
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else if (item.status === "skipped") {
      skippedDays += 1;
    } else {
      if (item.status === "partial") partialDays += 1;
      if (item.status === "missed" || item.status === "scheduled") missedDays += item.record.date < today ? 1 : 0;
      if (item.record.date < today || item.status === "partial") running = 0;
    }
  }

  let currentStreak = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index];
    if (item.record.date === today && item.status !== "complete" && item.status !== "skipped") continue;
    if (item.status === "skipped") continue;
    if (item.status !== "complete") break;
    currentStreak += 1;
  }

  const counted = completedDays + partialDays + missedDays;
  return {
    plannedDays: entries.length,
    completedDays,
    skippedDays,
    skippedTasks,
    partialDays,
    missedDays,
    successRate: counted ? Math.round((completedDays / counted) * 100) : 0,
    currentStreak,
    longestStreak,
  };
}

export function historyStatusForDate(store: HygieneStore, routineId: string, dateKey: string, today: string): HygieneRoutineStatus | "not-scheduled" {
  const record = store.records[dateKey]?.[routineId];
  if (!record) return "not-scheduled";
  const routine = store.routines.find((item) => item.id === routineId) ?? {
    id: routineId,
    title: record.routineTitle,
    active: false,
    order: 999,
    schedule: { type: "manual" } as HygieneSchedule,
    tasks: [],
  };
  return routineSummary(routine, record, today).status;
}

export function scheduleLabel(schedule: HygieneSchedule) {
  const days = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  if (schedule.type === "daily") return "Každý den";
  if (schedule.type === "days") return schedule.weekdays.map((day) => days[day]).join(" · ");
  if (schedule.type === "weekly") return "Každý " + days[schedule.weekday];
  if (schedule.type === "interval") return "Každých " + schedule.everyDays + " dní";
  if (schedule.type === "monthly") return schedule.day + ". den v měsíci";
  if (schedule.type === "nth-weekday") return schedule.week + ". " + days[schedule.weekday] + " v měsíci";
  return "Bez pevné frekvence";
}

export function createRoutineId() {
  return "hygiene-routine-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

export function createTaskId() {
  return "hygiene-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}
