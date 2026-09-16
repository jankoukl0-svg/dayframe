import { parseSmartTaskInput } from "./dayframe-smart-input";

export type Priority = "high" | "normal" | "low";
export type Task = {
  id: number;
  title: string;
  start: string;
  end: string;
  category: string;
  completed: boolean;
  fixed?: boolean;
  duration?: number;
  deadline?: string;
  priority?: Priority;
  autoScheduled?: boolean;
  late?: boolean;
  notBefore?: string;
};

// The old storage key is retained so existing captured tasks migrate safely.
export type InboxTask = {
  id: number;
  title: string;
  duration: number;
  priority: Priority;
  category: string;
  createdAt: string;
  targetDate?: string;
  deadline?: string;
};

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function time(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function rank(priority: Priority) {
  return priority === "high" ? 0 : priority === "low" ? 2 : 1;
}

function nextLocalDate(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function normalizeSmartCapture(item: InboxTask) {
  const parsed = parseSmartTaskInput(item.title);
  const created = new Date(item.createdAt);
  const reference = Number.isNaN(created.getTime()) ? new Date() : created;
  const parsedTargetDate = parsed.day === "today"
    ? localDateKey(reference)
    : parsed.day === "tomorrow"
      ? localDateKey(nextLocalDate(reference))
      : undefined;

  return {
    ...item,
    title: parsed.title,
    // Manual controls keep priority. Smart hints only fill untouched defaults.
    duration: item.duration === 45 && parsed.duration ? parsed.duration : item.duration,
    priority: item.priority === "normal" && parsed.priority ? parsed.priority : item.priority,
    deadline: (item.deadline ?? "22:30") === "22:30" && parsed.deadline
      ? parsed.deadline
      : item.deadline,
    targetDate: item.targetDate ?? parsedTargetDate,
  } satisfies InboxTask;
}

function findSpace(item: InboxTask, tasks: Task[], from: number) {
  const duration = Number(item.duration);
  const deadline = minutes(item.deadline ?? "22:30");
  if (!Number.isFinite(duration) || duration < 15 || !Number.isFinite(deadline)) return null;
  // Preserve every existing block. Breakfast and lunch are also unavailable.
  const occupied = [{ start: 13 * 60, end: 14 * 60 }, ...tasks.map((task) => ({
    start: minutes(task.start), end: minutes(task.end),
  }))];
  const cutoff = Math.min(22 * 60 + 30, deadline);
  for (let start = Math.max(10 * 60, Math.ceil(from / 15) * 15); start + duration <= cutoff; start += 15) {
    if (!occupied.some((block) => start < block.end && start + duration > block.start)) {
      return { start: time(start), end: time(start + duration) };
    }
  }
  return null;
}

/** Place waiting tasks without moving or overlapping already planned work. */
export function planCapturedTasks(todayTasks: Task[], tomorrowTasks: Task[], waiting: InboxTask[], now: Date) {
  const today = [...todayTasks];
  const tomorrow = [...tomorrowTasks];
  const pending: InboxTask[] = [];
  const placements: Array<{ id: number; title: string; day: "today" | "tomorrow"; start: string; end: string }> = [];
  const todayKey = localDateKey(now);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  const tomorrowKey = localDateKey(next);
  const occupiedIds = new Set([...today, ...tomorrow].map((task) => task.id));
  const queue = waiting.map(normalizeSmartCapture).sort((a, b) =>
    (a.targetDate ?? tomorrowKey).localeCompare(b.targetDate ?? tomorrowKey)
    || rank(a.priority) - rank(b.priority)
    || (a.deadline ?? "22:30").localeCompare(b.deadline ?? "22:30")
    || a.createdAt.localeCompare(b.createdAt),
  );

  for (const item of queue) {
    if (occupiedIds.has(item.id)) continue;

    // An unfinished task from an earlier day must not snowball into a new day by itself.
    // It stays pending until the user explicitly chooses today or tomorrow.
    const createdDate = new Date(item.createdAt);
    const staleWithoutChosenDay = !item.targetDate
      && !Number.isNaN(createdDate.getTime())
      && localDateKey(createdDate) < todayKey;
    if (staleWithoutChosenDay) {
      pending.push(item);
      continue;
    }

    const todayAllowed = !item.targetDate || item.targetDate === todayKey;
    const tomorrowAllowed = !item.targetDate || item.targetDate === tomorrowKey;
    let day: "today" | "tomorrow" = "today";
    let slot = todayAllowed ? findSpace(item, today, now.getHours() * 60 + now.getMinutes()) : null;
    if (!slot && tomorrowAllowed) {
      day = "tomorrow";
      slot = findSpace(item, tomorrow, 10 * 60);
    }
    if (!slot) {
      pending.push(item);
      continue;
    }
    const task: Task = {
      id: item.id, title: item.title, category: item.category,
      duration: item.duration, priority: item.priority, deadline: item.deadline ?? "22:30",
      completed: false, fixed: false, autoScheduled: true, late: false, ...slot,
    };
    (day === "today" ? today : tomorrow).push(task);
    occupiedIds.add(item.id);
    placements.push({ id: item.id, title: item.title, day, ...slot });
  }

  return {
    today: today.sort((a, b) => a.start.localeCompare(b.start)),
    tomorrow: tomorrow.sort((a, b) => a.start.localeCompare(b.start)),
    pending,
    placements,
  };
}
