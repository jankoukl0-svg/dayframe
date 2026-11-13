import { calendarBounds, dateFromKey, localDateKey, timeToMinutes } from "./dayframe-calendar";
import { materializeHygieneDate, routineDomain, routineHasScheduledWorkOnDate, routineSummary, setHygieneTaskStatus, type HygieneStore, type HygieneRoutineDefinition } from "./dayframe-hygiene";

/** Calendar time reservations only; completion always belongs to Hygiene records. */
export const WEEK_CARE_STORAGE_KEY = "dayframe-week-care-v1";
export const WEEK_CARE_SYNC_EVENT = "dayframe-week-care-sync";
export type WeekCareId = "morning" | "evening" | "cleaning-daily" | "hygiene-day" | "cleaning-sunday" | `rolling:${string}`;
export type WeekCareTimes = Record<string, Partial<Record<WeekCareId, string>>>;
export type WeekCareHidden = Record<string, WeekCareId[]>;
/** Optional origin-to-destination trace, needed to validate rescheduled Sunday blocks. */
export type WeekCareMoves = Record<string, Partial<Record<WeekCareId, string>>>;
/** Durable origin proof for legitimate additional Hygiene destinations. */
export type WeekCareProvenance = Record<string, Partial<Record<WeekCareId, string>>>;
export type WeekCareBlock = {
  id: WeekCareId;
  routineId: string;
  title: string;
  start: string;
  duration: 20 | 30;
  completed: boolean;
};

const DEFAULTS: Array<{ id: WeekCareId; title: string; start: string; duration: 20 | 30; sundayOnly: boolean }> = [
  { id: "morning", title: "Ranní hygiena", start: "09:00", duration: 20, sundayOnly: false },
  { id: "cleaning-daily", title: "Denní úklid", start: "09:30", duration: 20, sundayOnly: false },
  { id: "evening", title: "Večerní hygiena", start: "21:30", duration: 20, sundayOnly: false },
  { id: "hygiene-day", title: "Nedělní hygiena", start: "10:00", duration: 30, sundayOnly: true },
  { id: "cleaning-sunday", title: "Nedělní úklid", start: "10:30", duration: 30, sundayOnly: true },
];

/** Personal rolling routines stay in Hygiene; Week stores only per-date placements. */
const ROLLING_PREFIX = "rolling:";
const ROLLING_CARE_ID = /^rolling:hygiene-routine-[a-z0-9-]{1,100}$/;
const ROLLING_DEFAULT = { start: "20:30", duration: 30 as const, sundayOnly: false };

function eligibleRollingRoutine(routine: HygieneRoutineDefinition): boolean {
  return routineDomain(routine) === "hygiene"
    && routine.schedule.type === "rolling"
    && routine.schedule.everyDays === 3
    && routine.schedule.unit === "days"
    && ROLLING_CARE_ID.test(ROLLING_PREFIX + routine.id);
}

function careDefinition(id: string) {
  const builtIn = DEFAULTS.find(item => item.id === id);
  if (builtIn) return builtIn;
  if (ROLLING_CARE_ID.test(id)) return {
    id: id as WeekCareId, title: "Opakovaná rutina", ...ROLLING_DEFAULT,
  };
  return null;
}

function calendarDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = dateFromKey(date);
  return !Number.isNaN(parsed.getTime()) && localDateKey(parsed) === date;
}

function validTime(value: unknown, duration: number) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const minute = timeToMinutes(value);
  const [hour, part] = value.split(":").map(Number);
  return hour < 24 && part < 60 && Number.isFinite(minute)
    && minute % 15 === 0 && minute >= calendarBounds.dayStart
    && minute + duration <= calendarBounds.dayEnd;
}

function validCareDate(date: string, config: (typeof DEFAULTS)[number]) {
  return calendarDate(date) && (!config.sundayOnly || dateFromKey(date).getDay() === 0);
}

/** Accept additional weekday projections traced by Hygiene's authoritative
 * task reschedules; Week's moves map represents only one destination.
 */
function hygieneShiftOrigin(store: HygieneStore | null | undefined, date: string, id: WeekCareId): string | undefined {
  if (!store || !calendarDate(date)) return undefined;
  const config = careDefinition(id);
  if (!config) return undefined;
  const routineId = id.startsWith(ROLLING_PREFIX) ? id.slice(ROLLING_PREFIX.length) : id;
  const routine = store.routines.find(item => item.id === routineId);
  const recorded = store.records[date]?.[routineId];
  // A paused routine can still own a genuine moved historical occurrence.
  if (!routine || (!routine.active && !recorded?.scheduledTasks.length)) return undefined;
  const ids = new Set([
    ...routine.tasks.map(task => task.id),
    ...(recorded?.scheduledTasks.map(task => task.id) ?? []),
  ]);
  for (const [key, destination] of Object.entries(store.taskReschedules)) {
    if (destination !== date) continue;
    const [origin, owner, taskId, extra] = key.split("|");
    if (extra === undefined && owner === routineId && ids.has(taskId)
      && validCareDate(origin,config)) return origin;
  }
  return undefined;
}

function hygieneShiftedTo(store: HygieneStore | null | undefined, date: string, id: WeekCareId): boolean {
  const origin = hygieneShiftOrigin(store,date,id);
  if (!origin || !store) return false;
  const routineId = id.startsWith(ROLLING_PREFIX) ? id.slice(ROLLING_PREFIX.length) : id;
  const routine = store.routines.find(item => item.id === routineId);
  const recorded = store.records[date]?.[routineId];
  return Boolean(routine && !(store.suppressedDates[date] ?? []).includes(routineId)
    && ((routine.active && routineHasScheduledWorkOnDate(store,routine,date))
      || recorded?.scheduledTasks.length));
}

/** Malformed or inaccessible saved positions must never be overwritten. */
export function readWeekCareTimes(hygiene?: HygieneStore | null): { times: WeekCareTimes; hidden: WeekCareHidden; moves: WeekCareMoves; provenance?: WeekCareProvenance; blocked: boolean } {
  if (typeof window === "undefined") return { times: {}, hidden: {}, moves: {}, blocked: false };
  try {
    const raw = window.localStorage.getItem(WEEK_CARE_STORAGE_KEY);
    if (!raw) return { times: {}, hidden: {}, moves: {}, blocked: false };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.times || typeof data.times !== "object" || Array.isArray(data.times)) {
      return { times: {}, hidden: {}, moves: {}, blocked: true };
    }
    const moves: WeekCareMoves = {};
    if (data.moves !== undefined) {
      if (!data.moves || typeof data.moves !== "object" || Array.isArray(data.moves)) {
        return { times: {}, hidden: {}, moves: {}, blocked: true };
      }
      for (const [source, byId] of Object.entries(data.moves)) {
        if (!calendarDate(source) || !byId || typeof byId !== "object" || Array.isArray(byId)) {
          return { times: {}, hidden: {}, moves: {}, blocked: true };
        }
        const validated: Partial<Record<WeekCareId,string>> = {};
        for (const [id,destination] of Object.entries(byId)) {
          const config = careDefinition(id);
          if (!config || !validCareDate(source,config) || !calendarDate(destination as string)
            || source === destination) return { times: {}, hidden: {}, moves: {}, blocked: true };
          validated[config.id] = destination as string;
        }
        moves[source] = validated;
      }
    }
    const provenance: WeekCareProvenance = {};
    if (data.provenance !== undefined) {
      if (!data.provenance || typeof data.provenance !== "object" || Array.isArray(data.provenance))
        return { times: {}, hidden: {}, moves: {}, blocked: true };
      for (const [destination, values] of Object.entries(data.provenance)) {
        if (!calendarDate(destination) || !values || typeof values !== "object" || Array.isArray(values))
          return { times: {}, hidden: {}, moves: {}, blocked: true };
        const origins: Partial<Record<WeekCareId,string>> = {};
        for (const [id, source] of Object.entries(values)) {
          const config = careDefinition(id);
          if (!config || typeof source !== "string" || !validCareDate(source,config) || source === destination)
            return { times: {}, hidden: {}, moves: {}, blocked: true };
          origins[config.id] = source;
        }
        provenance[destination] = origins;
      }
    }
    const shiftedTo = (date:string,id:WeekCareId) =>
      Object.values(moves).some(byId=>byId[id]===date)
      || hygieneShiftedTo(hygiene,date,id)
      || Boolean(provenance[date]?.[id]);
    const times: WeekCareTimes = {};
    for (const [date, values] of Object.entries(data.times)) {
      if (!calendarDate(date) || !values || typeof values !== "object" || Array.isArray(values)) {
        return { times: {}, hidden: {}, moves: {}, blocked: true };
      }
      const found: Partial<Record<WeekCareId, string>> = {};
      for (const [id, value] of Object.entries(values)) {
        const config = careDefinition(id);
        if (!config || !(validCareDate(date,config) || shiftedTo(date,config.id)) || !validTime(value, config.duration)) {
          return { times: {}, hidden: {}, moves: {}, blocked: true };
        }
        found[config.id] = value as string;
      }
      times[date] = found;
    }
    const hidden: WeekCareHidden = {};
    if (data.hidden !== undefined) {
      if (!data.hidden || typeof data.hidden !== "object" || Array.isArray(data.hidden)) {
        return { times: {}, hidden: {}, moves: {}, blocked: true };
      }
      for (const [date, ids] of Object.entries(data.hidden)) {
        if (!calendarDate(date) || !Array.isArray(ids)) return { times: {}, hidden: {}, moves: {}, blocked: true };
        const validated: WeekCareId[] = [];
        for (const id of ids) {
          const config = careDefinition(id);
          if (!config || !(validCareDate(date,config) || shiftedTo(date,config.id))) return { times: {}, hidden: {}, moves: {}, blocked: true };
          if (!validated.includes(config.id)) validated.push(config.id);
        }
        hidden[date] = validated;
      }
    }
    return { times, hidden, moves, provenance, blocked: false };
  } catch {
    return { times: {}, hidden: {}, moves: {}, blocked: true };
  }
}

export function saveWeekCareTime(date: string, id: WeekCareId, start: string, fromDate?: string,
  hygiene?: HygieneStore | null, nextHygiene?: HygieneStore | null): boolean {
  const config = careDefinition(id);
  if (!config || !calendarDate(date) || !validTime(start, config.duration)) return false;
  const current = readWeekCareTimes(hygiene);
  if (current.blocked || typeof window === "undefined") return false;
  try {
    const moves: WeekCareMoves = { ...current.moves };
    const hidden: WeekCareHidden = { ...current.hidden };
    const provenance: WeekCareProvenance = { ...(current.provenance ?? {}) };
    const times: WeekCareTimes = { ...current.times, [date]: { ...(current.times[date] ?? {}), [id]: start } };
    if (fromDate && date !== fromDate) {
      const originInWeek = Object.keys(moves).find(source => moves[source]?.[id] === fromDate);
      const origin = originInWeek ?? fromDate;
      if (validCareDate(origin,config)) {
        if (origin === date) {
          const original = { ...(moves[origin] ?? {}) };
          delete original[id];
          if (Object.keys(original).length) moves[origin] = original;
          else delete moves[origin];
        } else {
          moves[origin] = { ...(moves[origin] ?? {}), [id]: date };
        }
      } else if (!hygieneShiftedTo(hygiene,fromDate,id) && !provenance[fromDate]?.[id]) {
        // Hygiene can postpone only some steps, retaining the Week move trace
        // for the remaining steps at their existing destination.
        return false;
      }
      if (!validCareDate(date,config)
        && !Object.values(moves).some(byId => byId[id] === date)
        && !hygieneShiftedTo(nextHygiene ?? hygiene,date,id)) return false;
      if (hidden[fromDate]?.includes(id)) {
        const rest = hidden[fromDate].filter(item => item !== id);
        if (rest.length) hidden[fromDate] = rest;
        else delete hidden[fromDate];
      }
      if (times[fromDate]) {
        times[fromDate] = { ...times[fromDate] };
        delete times[fromDate][id];
        if (!Object.keys(times[fromDate]).length) delete times[fromDate];
      }
    } else if (!validCareDate(date,config)
      && !Object.values(moves).some(byId => byId[id] === date)
      && !hygieneShiftedTo(hygiene,date,id)
      && !provenance[date]?.[id]) {
      return false;
    }
    // Retain the verified original date even after a later postponement
    // makes this particular weekday decoration an inert historical preference.
    if (!validCareDate(date,config)
      && !Object.values(moves).some(byId => byId[id] === date)
      && hygieneShiftedTo(nextHygiene ?? hygiene,date,id)) {
      const source = hygieneShiftOrigin(nextHygiene ?? hygiene,date,id) ?? (fromDate ? provenance[fromDate]?.[id] : undefined);
      if (!source) return false;
      provenance[date] = { ...(provenance[date] ?? {}), [id]: source };
    }
    const previous = window.localStorage.getItem(WEEK_CARE_STORAGE_KEY);
    window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, JSON.stringify({ version: 1, times, hidden, moves, provenance }));
    if (readWeekCareTimes(nextHygiene ?? hygiene).blocked) {
      if (previous === null) window.localStorage.removeItem(WEEK_CARE_STORAGE_KEY);
      else window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, previous);
      return false;
    }
    window.dispatchEvent(new Event(WEEK_CARE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Hide or restore a single calendar projection without altering any Hygiene tasks. */
export function saveWeekCareHidden(date: string, id: WeekCareId, hide: boolean,
  hygiene?: HygieneStore | null): boolean {
  const config = careDefinition(id);
  if (!config || !calendarDate(date) || typeof window === "undefined") return false;
  const current = readWeekCareTimes(hygiene);
  if (current.blocked || !(validCareDate(date,config)
    || Object.values(current.moves).some(byId=>byId[id]===date)
    || hygieneShiftedTo(hygiene,date,id)
    || current.provenance?.[date]?.[id])) return false;
  const previous = current.hidden[date] ?? [];
  const next = hide ? [...new Set([...previous, id])] : previous.filter(item => item !== id);
  const hidden = { ...current.hidden };
  if (next.length) hidden[date] = next;
  else delete hidden[date];
  const provenance: WeekCareProvenance = { ...(current.provenance ?? {}) };
  if (!validCareDate(date,config)
    && !Object.values(current.moves).some(byId => byId[id] === date)
    && hygieneShiftedTo(hygiene,date,id)) {
    const source = hygieneShiftOrigin(hygiene,date,id);
    if (!source) return false;
    provenance[date] = { ...(provenance[date] ?? {}), [id]: source };
  }
  try {
    window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, JSON.stringify({ version: 1, times: current.times, hidden, moves: current.moves, provenance }));
    window.dispatchEvent(new Event(WEEK_CARE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Pure week projection. Never creates tasks, checkmarks or historical routine records. */
export function weekCareBlocks(store: HygieneStore | null, date: string, today: string, times: WeekCareTimes, hidden: WeekCareHidden = {}): WeekCareBlock[] {
  if (!store || !calendarDate(date)) return [];
  const configs = [
    ...DEFAULTS.map(config => ({ ...config, routineId: config.id })),
    ...store.routines.filter(routine => eligibleRollingRoutine(routine)
      || (store.fixedRepeatRoutineId === routine.id && routineDomain(routine) === "hygiene")).map(routine => ({
      id: (ROLLING_PREFIX + routine.id) as WeekCareId,
      routineId: routine.id,
      title: routine.title,
      ...ROLLING_DEFAULT,
    })),
  ];
  return configs.flatMap(config => {
    if (!calendarDate(date) || hidden[date]?.includes(config.id)) return [];
    const routine = store.routines.find(item => item.id === config.routineId);
    if (!routine) return [];
    const shiftedHere = Object.entries(store.taskReschedules).some(([key,target]) =>
      target === date && key.split("|")[1] === config.routineId);
    if (!validCareDate(date,config) && !shiftedHere) return [];
    // Rescheduled source days are deliberately suppressed, even when a prior
    // empty materialized record exists on that date.
    if ((store.suppressedDates[date] ?? []).includes(config.routineId)) return [];
    const record = store.records[date]?.[config.routineId];
    // A historical occurrence with an authoritative snapshot must survive
    // later schedule edits. Missing records can still represent a missed day.
    // Rolling cadence may advance immediately after completing a step,
    // so a handled record is a historical occurrence even on TODAY.
    // Archived snapshots may still be displayed; they are read-only unless
    // the original active rolling schedule can be safely restored.
    if (!routineHasScheduledWorkOnDate(store, routine, date)
      && !(date <= today && record && Object.keys(record.states).length > 0)
      && !(date < today && record && !record.archived)) return [];
    const completed = record ? routineSummary(routine, record, today).status === "complete" : false;
    return [{
      id: config.id, routineId: config.routineId,
      title: config.id === "cleaning-daily" ? routine.title : config.title,
      start: times[date]?.[config.id] ?? config.start,
      duration: config.duration, completed,
    }];
  });
}


/**
 * Record a past/today occurrence in Hygiene's authoritative per-date history.
 * Never create a second checklist or change future recurrence dates.
 * Without a snapshot, materialize only the selected day and only on action.
 */
export function toggleWeekCareCompletion(store: HygieneStore, date: string, routineId: string, taskId?: string): HygieneStore {
  if (!calendarDate(date)) return store;
  const routine = store.routines.find(item => item.id === routineId && item.active);
  if (!routine) return store;
  const existing = store.records[date]?.[routineId];
  if (!existing && !routineHasScheduledWorkOnDate(store, routine, date)) return store;
  const next = existing ? store : materializeHygieneDate(store, date);
  const record = next.records[date]?.[routineId];
  if (!record) return store;
  const canRestoreRolling = Boolean(record.archived && routine.schedule.type === "rolling"
    && record.scheduledTasks.some(task => task.scheduleType === "rolling"
      && Boolean(record.states[task.id])));
  if (record.archived && !canRestoreRolling) return store;
  const writable = canRestoreRolling
    ? { ...next, records: { ...next.records, [date]: {
        ...next.records[date], [routineId]: { ...record, archived: undefined },
      } } }
    : next;
  const savedRecord = writable.records[date][routineId];

  if (taskId !== undefined) {
    const task = savedRecord.scheduledTasks.find(item => item.id === taskId);
    if (!task) return store;
    return setHygieneTaskStatus(writable, date, routineId, taskId,
      savedRecord.states[taskId] === "done" ? null : "done", date);
  }

  const required = savedRecord.scheduledTasks.filter(item => !item.optional);
  if (!required.length) return store;
  const allDone = required.every(item => savedRecord.states[item.id] === "done");
  let updated = writable;
  // Bulk action means "actually performed", not "skipped". Individual
  // checkboxes remain available for partial routines and corrections.
  for (const task of required) {
    const current = updated.records[date]?.[routineId]?.states[task.id];
    if (allDone ? current === "done" : current !== "done") {
      updated = setHygieneTaskStatus(updated, date, routineId, task.id,
        allDone ? null : "done", date);
    }
  }
  return updated;
}
