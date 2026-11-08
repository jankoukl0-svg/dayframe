/** Read-only totals for completed Dayframe calendar blocks. Never count planned-only time. */
export type ActivityTask = {
  id?: string; title: string; date?: string; duration: number; category?: string;
  completed: boolean; start?: string; actualMinutes?: number;
};
export type ActivityItem = {
  key: string; date: string; title: string; category: string; start: string | null;
  minutes: number; source: "measured" | "scheduled"; id: string;
};
export type ActivityRank = {key: string; title: string; category: string; minutes: number; count: number; share: number};
export type ActivityDay = {date: string; minutes: number; blocks: number; items: ActivityItem[]};
export type ActivityLedger = {
  minutes: number; blocks: number; measured: number; scheduled: number;
  activities: ActivityRank[]; categories: {name: string; minutes: number; share: number}[];
  days: ActivityDay[];
};
export const activityCategory = (category?: string) => category?.trim() || "Ostatní";
export function actualActivityMinutes(task: ActivityTask): number {
  const source = Number.isFinite(task.actualMinutes) && (task.actualMinutes as number) >= 0
    ? task.actualMinutes : task.duration;
  return Number.isFinite(source) ? Math.max(0, Math.round(source as number)) : 0;
}
export function hasMeasuredMinutes(task: ActivityTask): boolean {
  return Number.isFinite(task.actualMinutes) && (task.actualMinutes as number) >= 0;
}
export const activityIdentity = (category: string, title: string) => JSON.stringify([category, title]);
/** A strict range prevents future/completed-looking entries from leaking into activity history. */
export function buildActivityLedger(
  plans: Record<string, ActivityTask[]> | undefined, from: string, to: string, today: string,
): ActivityLedger {
  const empty: ActivityLedger = {minutes: 0, blocks: 0, measured: 0, scheduled: 0, activities: [], categories: [], days: []};
  if (from > to || from > today) return empty;
  const items: ActivityItem[] = [];
  for (const [date, tasks] of Object.entries(plans ?? {})) {
    if (date < from || date > to || date > today || !Array.isArray(tasks)) continue;
    for (const [position, task] of tasks.entries()) {
      if (!task?.completed || activityCategory(task.category) === "Osobní") continue;
      const category = activityCategory(task.category);
      const title = task.title?.trim() || "Bez názvu";
      items.push({
        id: task.id || date + ":" + position,
        key: date + ":" + (task.id || position),
        date, category, title, minutes: actualActivityMinutes(task),
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(task.start ?? "") ? task.start! : null,
        source: hasMeasuredMinutes(task) ? "measured" : "scheduled",
      });
    }
  }
  const groups = new Map<string, {key: string; title: string; category: string; minutes: number; count: number}>();
  const categories = new Map<string, number>();
  const days = new Map<string, ActivityDay>();
  let total = 0, measured = 0;
  for (const item of items) {
    total += item.minutes;
    if (item.source === "measured") measured++;
    const key = activityIdentity(item.category, item.title);
    const entry = groups.get(key) ?? {key, title: item.title, category: item.category, minutes: 0, count: 0};
    entry.minutes += item.minutes; entry.count++;
    groups.set(key, entry);
    categories.set(item.category, (categories.get(item.category) ?? 0) + item.minutes);
    const day = days.get(item.date) ?? {date: item.date, minutes: 0, blocks: 0, items: []};
    day.minutes += item.minutes; day.blocks++; day.items.push(item);
    days.set(item.date, day);
  }
  return {
    minutes: total, blocks: items.length, measured, scheduled: items.length - measured,
    activities: [...groups.values()].map(group => ({
      ...group, share: total ? Math.round(100 * group.minutes / total) : 0,
    })).sort((a,b) => b.minutes - a.minutes || a.title.localeCompare(b.title, "cs") || a.category.localeCompare(b.category,"cs")),
    categories: [...categories].map(([name, minutes]) => ({
      name, minutes, share: total ? Math.round(100 * minutes / total) : 0,
    })).sort((a,b) => b.minutes - a.minutes || a.name.localeCompare(b.name,"cs")),
    days: [...days.values()].sort((a,b) => b.date.localeCompare(a.date)).map(day => ({
      ...day, items: day.items.sort((a,b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.title.localeCompare(b.title,"cs")),
    })),
  };
}
