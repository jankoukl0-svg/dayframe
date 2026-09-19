import { createEmptyState, migrateStoredState, type DayframeState } from "./dayframe-calendar.ts";

export const STORAGE_KEY = "dayframe-v1";
export const BACKUP_KEY = "dayframe-v1-backup";
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = (value: unknown) => value === undefined || value === "" || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

export function decodeBackup(text: string): DayframeState {
  const parsed = JSON.parse(text);
  const raw = parsed?.format === "dayframe-backup" ? parsed.data : parsed;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Soubor neobsahuje data Dayframe.");
  if (raw.schema === 5) {
    if (!raw.plans || typeof raw.plans !== "object" || Array.isArray(raw.plans) || !Array.isArray(raw.backlog) || !Array.isArray(raw.routines) || !Array.isArray(raw.milestones)) throw new Error("Záloha není úplná.");
    const validTask = (t: any) => t && typeof t.id === "string" && typeof t.title === "string" && (t.date === "" || validDate(t.date)) && Number.isFinite(t.duration) && t.duration >= 15 && typeof t.completed === "boolean" && typeof t.createdAt === "string" && typeof t.category === "string" && [t.start, t.end, t.requestedStart, t.deadlineTime].every(validTime) && (!t.dueDate || validDate(t.dueDate));
    if (Object.entries(raw.plans).some(([date, tasks]) => !validDate(date) || !Array.isArray(tasks) || tasks.some(t => !validTask(t) || t.date !== date)) || raw.backlog.some((t: any) => !validTask(t))) throw new Error("Některé úkoly v záloze nejsou platné.");
    if (raw.routines.some((r: any) => !r || typeof r.id !== "string" || typeof r.title !== "string" || !Number.isFinite(r.duration) || r.duration < 15 || !["daily", "weekly", "alternate"].includes(r.frequency) || !validTime(r.start) || (r.startsOn && !validDate(r.startsOn)) || (r.weekdays !== undefined && (!Array.isArray(r.weekdays) || r.weekdays.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6))))) throw new Error("Rutiny v záloze nejsou platné.");
    if (raw.milestones.some((m: any) => !m || typeof m.id !== "string" || typeof m.title !== "string" || !validDate(m.date))) throw new Error("Milníky v záloze nejsou platné.");
  } else if (raw.schema !== 4 || !Array.isArray(raw.tasks)) {
    throw new Error("Nepodporovaný formát zálohy.");
  }
  return migrateStoredState(raw);
}

export function loadCalendar(storage: StorageLike): { state: DayframeState; blocked: string; raw: string | null } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: createEmptyState(), blocked: "", raw };
    return { state: decodeBackup(raw), blocked: "", raw };
  } catch {
    // Never overwrite unreadable data with a default plan.
    return { state: createEmptyState(), blocked: "Uložená data se nepodařilo načíst. Původní obsah zůstává zachovaný. Obnov zálohu v Nastavení.", raw };
  }
}

export function saveCalendar(storage: StorageLike, state: DayframeState) {
  try {
    const previous = storage.getItem(STORAGE_KEY);
    const encoded = JSON.stringify(state);
    if (previous === encoded) return "";
    if (previous) {
      decodeBackup(previous);
      storage.setItem(BACKUP_KEY, previous);
    }
    storage.setItem(STORAGE_KEY, encoded);
    return "";
  } catch {
    return "Změny se nepodařilo uložit. Stáhni zálohu v Nastavení, než zavřeš stránku.";
  }
}

export function encodeBackup(state: DayframeState) {
  return JSON.stringify({ format: "dayframe-backup", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
}
