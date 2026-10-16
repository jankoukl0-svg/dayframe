import { calendarBounds, dateFromKey, localDateKey, timeToMinutes } from "./dayframe-calendar";
import { routineDomain, routineHasScheduledWorkOnDate, routineSummary, type HygieneStore, type HygieneRoutineDefinition } from "./dayframe-hygiene";

/** Calendar time reservations only; completion always belongs to Hygiene records. */
export const WEEK_CARE_STORAGE_KEY = "dayframe-week-care-v1";
export const WEEK_CARE_SYNC_EVENT = "dayframe-week-care-sync";
export type WeekCareId = "morning" | "evening" | "cleaning-daily" | "hygiene-day" | "cleaning-sunday" | `rolling:${string}`;
export type WeekCareTimes = Record<string, Partial<Record<WeekCareId, string>>>;
export type WeekCareHidden = Record<string, WeekCareId[]>;
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

/** Malformed or inaccessible saved positions must never be overwritten. */
export function readWeekCareTimes(): { times: WeekCareTimes; hidden: WeekCareHidden; blocked: boolean } {
  if (typeof window === "undefined") return { times: {}, hidden: {}, blocked: false };
  try {
    const raw = window.localStorage.getItem(WEEK_CARE_STORAGE_KEY);
    if (!raw) return { times: {}, hidden: {}, blocked: false };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.times || typeof data.times !== "object" || Array.isArray(data.times)) {
      return { times: {}, hidden: {}, blocked: true };
    }
    const times: WeekCareTimes = {};
    for (const [date, values] of Object.entries(data.times)) {
      if (!calendarDate(date) || !values || typeof values !== "object" || Array.isArray(values)) {
        return { times: {}, hidden: {}, blocked: true };
      }
      const found: Partial<Record<WeekCareId, string>> = {};
      for (const [id, value] of Object.entries(values)) {
        const config = careDefinition(id);
        if (!config || !validCareDate(date, config) || !validTime(value, config.duration)) {
          return { times: {}, hidden: {}, blocked: true };
        }
        found[config.id] = value as string;
      }
      times[date] = found;
    }
    const hidden: WeekCareHidden = {};
    if (data.hidden !== undefined) {
      if (!data.hidden || typeof data.hidden !== "object" || Array.isArray(data.hidden)) {
        return { times: {}, hidden: {}, blocked: true };
      }
      for (const [date, ids] of Object.entries(data.hidden)) {
        if (!calendarDate(date) || !Array.isArray(ids)) return { times: {}, hidden: {}, blocked: true };
        const validated: WeekCareId[] = [];
        for (const id of ids) {
          const config = careDefinition(id);
          if (!config || !validCareDate(date, config)) return { times: {}, hidden: {}, blocked: true };
          if (!validated.includes(config.id)) validated.push(config.id);
        }
        hidden[date] = validated;
      }
    }
    return { times, hidden, blocked: false };
  } catch {
    return { times: {}, hidden: {}, blocked: true };
  }
}

export function saveWeekCareTime(date: string, id: WeekCareId, start: string): boolean {
  const config = careDefinition(id);
  if (!config || !validCareDate(date, config) || !validTime(start, config.duration)) return false;
  const current = readWeekCareTimes();
  if (current.blocked || typeof window === "undefined") return false;
  try {
    const times = { ...current.times, [date]: { ...(current.times[date] ?? {}), [id]: start } };
    window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, JSON.stringify({ version: 1, times, hidden: current.hidden }));
    window.dispatchEvent(new Event(WEEK_CARE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Hide or restore a single calendar projection without altering any Hygiene tasks. */
export function saveWeekCareHidden(date: string, id: WeekCareId, hide: boolean): boolean {
  const config = careDefinition(id);
  if (!config || !validCareDate(date, config) || typeof window === "undefined") return false;
  const current = readWeekCareTimes();
  if (current.blocked) return false;
  const previous = current.hidden[date] ?? [];
  const next = hide ? [...new Set([...previous, id])] : previous.filter(item => item !== id);
  const hidden = { ...current.hidden };
  if (next.length) hidden[date] = next;
  else delete hidden[date];
  try {
    window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, JSON.stringify({ version: 1, times: current.times, hidden }));
    window.dispatchEvent(new Event(WEEK_CARE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Pure week projection. Never creates tasks, checkmarks or historical routine records. */
export function weekCareBlocks(store: HygieneStore | null, date: string, today: string, times: WeekCareTimes, hidden: WeekCareHidden = {}): WeekCareBlock[] {
  if (!store || date < today || !calendarDate(date)) return [];
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
    if (!validCareDate(date, config) || hidden[date]?.includes(config.id)) return [];
    const routine = store.routines.find(item => item.id === config.routineId);
    if (!routine || !routineHasScheduledWorkOnDate(store, routine, date)) return [];
    const record = store.records[date]?.[config.routineId];
    const completed = record ? routineSummary(routine, record, today).status === "complete" : false;
    return [{
      id: config.id, routineId: config.routineId,
      title: config.id === "cleaning-daily" ? routine.title : config.title,
      start: times[date]?.[config.id] ?? config.start,
      duration: config.duration, completed,
    }];
  });
}

