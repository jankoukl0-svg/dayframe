import { calendarBounds, dateFromKey, timeToMinutes } from "./dayframe-calendar";
import { routineScheduledOnDate, routineSummary, taskScheduledOnDate, type HygieneStore } from "./dayframe-hygiene";

/** Calendar time reservations only; completion always belongs to Hygiene records. */
export const WEEK_CARE_STORAGE_KEY = "dayframe-week-care-v1";
export const WEEK_CARE_SYNC_EVENT = "dayframe-week-care-sync";
export type SundayCareId = "hygiene-day" | "cleaning-sunday";
export type WeekCareTimes = Record<string, Partial<Record<SundayCareId, string>>>;
export type WeekCareBlock = {
  id: SundayCareId;
  title: string;
  start: string;
  duration: 30;
  completed: boolean;
};

const DEFAULTS: Array<{ id: SundayCareId; title: string; start: string }> = [
  { id: "hygiene-day", title: "Nedělní hygiena", start: "10:00" },
  { id: "cleaning-sunday", title: "Nedělní úklid", start: "10:30" },
];

function validTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const minute = timeToMinutes(value);
  const [hour, part] = value.split(":").map(Number);
  return hour < 24 && part < 60 && Number.isFinite(minute)
    && minute % 15 === 0 && minute >= calendarBounds.dayStart
    && minute + 30 <= calendarBounds.dayEnd;
}

function sundayDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(dateFromKey(date).getTime())
    && dateFromKey(date).getDay() === 0;
}

/** Malformed or inaccessible saved positions must never be overwritten. */
export function readWeekCareTimes(): { times: WeekCareTimes; blocked: boolean } {
  if (typeof window === "undefined") return { times: {}, blocked: false };
  try {
    const raw = window.localStorage.getItem(WEEK_CARE_STORAGE_KEY);
    if (!raw) return { times: {}, blocked: false };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.times || typeof data.times !== "object" || Array.isArray(data.times)) {
      return { times: {}, blocked: true };
    }
    const times: WeekCareTimes = {};
    for (const [date, values] of Object.entries(data.times)) {
      if (!sundayDate(date) || !values || typeof values !== "object" || Array.isArray(values)) {
        return { times: {}, blocked: true };
      }
      const found: Partial<Record<SundayCareId, string>> = {};
      for (const [id, value] of Object.entries(values)) {
        if ((id !== "hygiene-day" && id !== "cleaning-sunday") || !validTime(value)) {
          return { times: {}, blocked: true };
        }
        found[id as SundayCareId] = value as string;
      }
      times[date] = found;
    }
    return { times, blocked: false };
  } catch {
    return { times: {}, blocked: true };
  }
}

export function saveWeekCareTime(date: string, id: SundayCareId, start: string): boolean {
  if (!sundayDate(date) || !DEFAULTS.some(item => item.id === id) || !validTime(start)) return false;
  const current = readWeekCareTimes();
  if (current.blocked || typeof window === "undefined") return false;
  try {
    const times = { ...current.times, [date]: { ...(current.times[date] ?? {}), [id]: start } };
    window.localStorage.setItem(WEEK_CARE_STORAGE_KEY, JSON.stringify({ version: 1, times }));
    window.dispatchEvent(new Event(WEEK_CARE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Pure week projection. Never creates tasks, checkmarks or historical routine records. */
export function sundayCareBlocks(store: HygieneStore | null, date: string, today: string, times: WeekCareTimes): WeekCareBlock[] {
  if (!store || date < today || !sundayDate(date)) return [];
  return DEFAULTS.flatMap(config => {
    const routine = store.routines.find(item => item.id === config.id);
    if (!routine || !routineScheduledOnDate(store, routine, date)) return [];
    if (!routine.tasks.some(task => taskScheduledOnDate(task, date, true))) return [];
    const record = store.records[date]?.[config.id];
    const completed = record ? routineSummary(routine, record, today).status === "complete" : false;
    return [{
      id: config.id, title: config.title, start: times[date]?.[config.id] ?? config.start,
      duration: 30 as const, completed,
    }];
  });
}
