import type { Priority } from "./dayframe-planning";

export type SmartTaskDetails = {
  title: string;
  duration?: number;
  day?: "today" | "tomorrow";
  deadline?: string;
  priority?: Priority;
};

function validClock(hours: number, minutes: number) {
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function toClock(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Reads optional Czech/English scheduling hints from a task title.
 * The feature is deliberately conservative: plain titles remain untouched.
 */
export function parseSmartTaskInput(input: string): SmartTaskDetails {
  let remaining = input.trim();
  let duration: number | undefined;
  let day: "today" | "tomorrow" | undefined;
  let deadline: string | undefined;
  let priority: Priority | undefined;

  const durationMinutes = remaining.match(/(?:^|\s)(\d{1,3})\s*(?:min(?:ut(?:a|y)?)?|mins?|minutes?)(?=\s|$|[,;])/i);
  if (durationMinutes) {
    const parsed = Number(durationMinutes[1]);
    if (parsed >= 15 && parsed <= 360) duration = parsed;
    remaining = remaining.replace(durationMinutes[0], " ");
  } else {
    const durationHours = remaining.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:h|hod(?:in(?:a|y)?)?|hours?)(?=\s|$|[,;])/i);
    if (durationHours) {
      const parsed = Math.round(Number(durationHours[1].replace(",", ".")) * 60);
      if (parsed >= 15 && parsed <= 360) duration = parsed;
      remaining = remaining.replace(durationHours[0], " ");
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
    const hours = Number(deadlineMatch[1]);
    const minutes = Number(deadlineMatch[2] ?? "00");
    if (validClock(hours, minutes)) deadline = toClock(hours, minutes);
    remaining = remaining.replace(deadlineMatch[0], " ");
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
    deadline,
    priority,
  };
}
