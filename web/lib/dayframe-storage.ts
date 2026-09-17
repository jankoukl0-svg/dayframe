import { createEmptyState, migrateStoredState, type DayframeState } from "./dayframe-calendar.ts";

export const STORAGE_KEY = "dayframe-v1";
export const MIGRATION_BACKUP_KEY = "dayframe-v1-before-schema-5";

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadDayframe(storage: Store, now = new Date()): DayframeState {
  const original = storage.getItem(STORAGE_KEY);
  if (original === null) return createEmptyState();
  const raw = JSON.parse(original);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid saved state");
  if (raw.schema !== undefined && raw.schema !== 4 && raw.schema !== 5) throw new Error("Unsupported saved version");
  if (raw.schema === 5 && (!raw.plans || typeof raw.plans !== "object" || Array.isArray(raw.plans) || Object.values(raw.plans).some((day) => !Array.isArray(day)))) throw new Error("Invalid saved calendar");
  const migrated = migrateStoredState(raw, now);
  const tasks = [...Object.values(migrated.plans).flat(), ...migrated.backlog];
  if (tasks.some((task) => !task || typeof task.id !== "string" || typeof task.title !== "string" || !Number.isFinite(task.duration))) throw new Error("Invalid saved task");
  if (migrated.milestones.some((milestone) => !milestone || typeof milestone.title !== "string" || typeof milestone.date !== "string" || Number.isNaN(new Date(`${milestone.date}T12:00:00`).getTime()))) throw new Error("Invalid saved milestone");
  // Never overwrite the only copy when upgrading the calendar.
  if (raw.schema !== 5 && storage.getItem(MIGRATION_BACKUP_KEY) === null) storage.setItem(MIGRATION_BACKUP_KEY, original);
  return migrated;
}

export function saveDayframe(storage: Store, state: DayframeState) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
