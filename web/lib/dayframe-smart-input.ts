import type { Priority } from "./dayframe-planning";

export type SmartTaskDetails = {
  title: string;
  duration?: number;
  day?: "today" | "tomorrow";
  targetDate?: string;
  start?: string;
  deadline?: string;
  priority?: Priority;
};

function validClock(hours: number, minutes: number) {
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function toClock(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function clockFromMatch(hours: string, minutes?: string) {
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes ?? "00");
  return validClock(parsedHours, parsedMinutes) ? toClock(parsedHours, parsedMinutes) : undefined;
}

function clockMinutes(clock: string) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return normalized === value;
}

/**
 * Reads optional Czech/English scheduling hints from a task title.
 * Plain titles stay plain; all hints are optional and manual controls can override them.
 */
export function parseSmartTaskInput(input: string): SmartTaskDetails {
  let remaining = input.trim();
  let duration: number | undefined;
  let day: "today" | "tomorrow" | undefined;
  let targetDate: string | undefined;
  let start: string | undefined;
  let deadline: string | undefined;
  let priority: Priority | undefined;

  // Internal tokens are used by manual controls. They are removed before the user-facing title is saved.
  const manualDates = [...remaining.matchAll(/\[\[date:(\d{4}-\d{2}-\d{2})\]\]/gi)];
  const manualDate = manualDates.at(-1)?.[1];
  if (manualDate && validDateKey(manualDate)) targetDate = manualDate;
  remaining = remaining.replace(/\s*\[\[date:\d{4}-\d{2}-\d{2}\]\]\s*/gi, " ");

  const manualStarts = [...remaining.matchAll(/\[\[start:(\d{1,2}):(\d{2})\]\]/gi)];
  const manualStart = manualStarts.at(-1);
  if (manualStart) start = clockFromMatch(manualStart[1], manualStart[2]);
  remaining = remaining.replace(/\s*\[\[start:\d{1,2}:\d{2}\]\]\s*/gi, " ");

  // "od 17:30 do 18:30" supplies both exact start and duration.
  const range = remaining.match(/(?:^|\s)od\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:do|[-–—])\s*(\d{1,2})(?:[:.](\d{2}))?(?=\s|$|[,;])/i);
  if (range) {
    const rangeStart = clockFromMatch(range[1], range[2]);
    const rangeEnd = clockFromMatch(range[3], range[4]);
    if (!start && rangeStart) start = rangeStart;
    if (rangeStart && rangeEnd) {
      const length = clockMinutes(rangeEnd) - clockMinutes(rangeStart);
      if (length >= 15 && length <= 360) duration = length;
    }
    remaining = remaining.replace(range[0], " ");
  }

  const halfHour = remaining.match(/(?:^|\s)(?:na\s+)?p[uů]l\s+hod(?:iny|inu)?(?=\s|$|[,;])/i);
  const oneHour = remaining.match(/(?:^|\s)(?:na\s+)?(?:jednu\s+)?hodinu(?=\s|$|[,;])/i);
  if (!duration && halfHour) {
    duration = 30;
    remaining = remaining.replace(halfHour[0], " ");
  } else if (!duration && oneHour) {
    duration = 60;
    remaining = remaining.replace(oneHour[0], " ");
  } else {
    const durationMinutes = remaining.match(/(?:^|\s)(?:na\s+)?(\d{1,3})\s*(?:min(?:ut(?:u|a|y)?)?|mins?|minutes?)(?=\s|$|[,;])/i);
    if (durationMinutes) {
      const parsed = Number(durationMinutes[1]);
      if (parsed >= 15 && parsed <= 360) duration = parsed;
      remaining = remaining.replace(durationMinutes[0], " ");
    } else {
      const durationHours = remaining.match(/(?:^|\s)(?:na\s+)?(\d+(?:[.,]\d+)?)\s*(?:h|hod(?:in(?:u|a|y)?)?|hours?)(?=\s|$|[,;])/i);
      if (durationHours) {
        const parsed = Math.round(Number(durationHours[1].replace(",", ".")) * 60);
        if (parsed >= 15 && parsed <= 360) duration = parsed;
        remaining = remaining.replace(durationHours[0], " ");
      }
    }
  }

  const tomorrow = remaining.match(/(?:^|\s)(zítra|zitra|tomorrow)(?=\s|$|[,;])/i);
  const today = remaining.match(/(?:^|\s)(dnes|today)(?=\s|$|[,;])/i);
  if (tomorrow) {
    day = "tomorrow";
    remaining = remaining.replace(tomorrow[0], " ");
  } else if (today) {
    day = "today";
    remaining = remaining.replace(today[0], " ");
  }

  const deadlineMatch = remaining.match(/(?:^|\s)(?:do|nejpozd[eě]ji(?:\s+v)?|by)\s*(\d{1,2})(?:[:.](\d{2}))?(?=\s|$|[,;])/i);
  if (deadlineMatch) {
    deadline = clockFromMatch(deadlineMatch[1], deadlineMatch[2]);
    remaining = remaining.replace(deadlineMatch[0], " ");
  }

  const startMatch = remaining.match(/(?:^|\s)(?:v|ve|od)\s*(\d{1,2})(?:[:.](\d{2}))?(?=\s|$|[,;])/i);
  if (startMatch) {
    if (!start) start = clockFromMatch(startMatch[1], startMatch[2]);
    remaining = remaining.replace(startMatch[0], " ");
  } else {
    // A bare HH:MM is unambiguous enough to be treated as a start time.
    const bareStart = remaining.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?=\s|$|[,;])/i);
    if (bareStart) {
      if (!start) start = clockFromMatch(bareStart[1], bareStart[2]);
      remaining = remaining.replace(bareStart[0], " ");
    }
  }

  const highPriority = remaining.match(/(?:^|\s)(d[uů]le[zž]it[eé]|urgentn[ií]|urgent|vysok[aá]\s+priorita)(?=\s|$|[,;])/i);
  const lowPriority = remaining.match(/(?:^|\s)(nesp[eě]ch[aá]|n[ií]zk[aá]\s+priorita)(?=\s|$|[,;])/i);
  if (highPriority) {
    priority = "high";
    remaining = remaining.replace(highPriority[0], " ");
  } else if (lowPriority) {
    priority = "low";
    remaining = remaining.replace(lowPriority[0], " ");
  }

  const title = remaining
    .replace(/\s*[,;]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    title: title || input.trim(),
    duration,
    day,
    targetDate,
    start,
    deadline,
    priority,
  };
}

/** One resolved value feeds both visible controls and the saved task. */
export function resolveSmartDraft<T extends { title: string; date: string; start: string; duration: number; priority: Priority; deadlineTime: string }>(draft: T, manual: Partial<Record<"date" | "start" | "duration" | "priority" | "deadlineTime", boolean>>, today: string, tomorrow: string): T {
  const parsed = parseSmartTaskInput(draft.title);
  return {
    ...draft,
    title: parsed.title,
    date: manual.date ? draft.date : draft.date || parsed.targetDate || (parsed.day === "today" ? today : parsed.day === "tomorrow" ? tomorrow : ""),
    start: manual.start ? draft.start : parsed.start ?? draft.start,
    duration: manual.duration ? draft.duration : parsed.duration ?? draft.duration,
    priority: manual.priority ? draft.priority : parsed.priority ?? draft.priority,
    deadlineTime: manual.deadlineTime ? draft.deadlineTime : parsed.deadline ?? draft.deadlineTime,
  };
}
