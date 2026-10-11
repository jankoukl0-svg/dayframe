import { addDaysKey } from "./dayframe-calendar.ts";

export const SLEEP_STORAGE_KEY = "dayframe-sleep-v1";
export const SLEEP_SYNC_EVENT = "dayframe-sleep-sync";

export type SleepQuality = 1 | 2 | 3 | 4 | 5;
export type SleepEntry = {
  date: string; // Morning/wake date (not bedtime date)
  bedtime: string;
  wakeTime: string;
  quality: SleepQuality | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
export type SleepStore = {
  version: 1;
  entries: SleepEntry[];
  checkInEnabled: boolean;
  goalMinutes: number | null;
};

export function emptySleepStore(): SleepStore {
  return { version: 1, entries: [], checkInEnabled: false, goalMinutes: null };
}

/** Local calendar date, intentionally independent of Dayframe's 02:00 planning rollover. */
export function sleepCalendarDateKey(now: Date): string {
  return String(now.getFullYear()).padStart(4, "0") + "-"
    + String(now.getMonth() + 1).padStart(2, "0") + "-"
    + String(now.getDate()).padStart(2, "0");
}
export function validSleepDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00");
  return !Number.isNaN(date.valueOf()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10));
}
const validTime = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validText = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const validQuality = (value: unknown): value is SleepQuality | null =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5);

/** Calculate elapsed real time using local dates. Crossing midnight and DST both count correctly. */
export function sleepDurationMinutes(date: string, bedtime: string, wakeTime: string): number | null {
  if (!validSleepDate(date) || !validTime(bedtime) || !validTime(wakeTime) || bedtime === wakeTime) return null;
  const startDate = bedtime > wakeTime ? addDaysKey(date, -1) : date;
  const start = new Date(startDate + "T" + bedtime + ":00");
  const end = new Date(date + "T" + wakeTime + ":00");
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  return Number.isFinite(minutes) && minutes >= 30 && minutes <= 1440 ? minutes : null;
}

export function validSleepEntry(value: unknown): value is SleepEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as SleepEntry;
  return validSleepDate(e.date) && validTime(e.bedtime) && validTime(e.wakeTime)
    && sleepDurationMinutes(e.date, e.bedtime, e.wakeTime) !== null
    && validQuality(e.quality) && validText(e.note, 1000)
    && validText(e.createdAt, 80) && validText(e.updatedAt, 80);
}

export function validSleepStore(value: unknown): value is SleepStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as SleepStore;
  return s.version === 1 && Array.isArray(s.entries)
    && typeof s.checkInEnabled === "boolean"
    && (s.goalMinutes === null || (Number.isInteger(s.goalMinutes) && s.goalMinutes >= 180 && s.goalMinutes <= 840))
    && s.entries.every(validSleepEntry)
    && new Set(s.entries.map(e => e.date)).size === s.entries.length;
}

export function parseSleepStore(raw: string | null): { store: SleepStore; blocked: boolean } {
  if (raw === null) return { store: emptySleepStore(), blocked: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    return validSleepStore(parsed) ? { store: parsed, blocked: false } : { store: emptySleepStore(), blocked: true };
  } catch {
    return { store: emptySleepStore(), blocked: true };
  }
}
export function readSleepStore(): { store: SleepStore; blocked: boolean } {
  if (typeof window === "undefined") return { store: emptySleepStore(), blocked: false };
  try { return parseSleepStore(window.localStorage.getItem(SLEEP_STORAGE_KEY)); }
  catch { return { store: emptySleepStore(), blocked: true }; }
}
export function saveSleepStore(store: SleepStore): boolean {
  if (typeof window === "undefined" || !validSleepStore(store)) return false;
  try {
    window.localStorage.setItem(SLEEP_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(SLEEP_SYNC_EVENT));
    return true;
  } catch { return false; }
}
export function sleepEntryForDate(store: SleepStore, date: string): SleepEntry | null {
  return store.entries.find(e => e.date === date) ?? null;
}
export function upsertSleepEntry(store: SleepStore, entry: SleepEntry): SleepStore {
  if (!validSleepEntry(entry)) return store;
  const old = sleepEntryForDate(store, entry.date);
  return {
    ...store,
    entries: [...store.entries.filter(e => e.date !== entry.date), {
      ...entry, createdAt: old?.createdAt ?? entry.createdAt,
    }].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function sleepCheckInStatus(store: SleepStore, date: string) {
  return { due: store.checkInEnabled && validSleepDate(date), complete: sleepEntryForDate(store, date) !== null };
}
export function sleepSeries(store: SleepStore, through: string, days: number | null) {
  const start = days === null ? null : addDaysKey(through, -(days - 1));
  return store.entries.filter(e => e.date <= through && (start === null || e.date >= start))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ date: e.date, minutes: sleepDurationMinutes(e.date, e.bedtime, e.wakeTime)!, quality: e.quality }));
}
export function sleepAverageMinutes(store: SleepStore, through: string, days: number | null): number | null {
  const series = sleepSeries(store, through, days);
  return series.length ? Math.round(series.reduce((sum, e) => sum + e.minutes, 0) / series.length) : null;
}
export function formatSleepDuration(minutes: number): string {
  return Math.floor(minutes / 60) + " h " + String(Math.round(minutes % 60)).padStart(2, "0") + " min";
}
