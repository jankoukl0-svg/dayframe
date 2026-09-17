const DAY_WINDOW_MS = 15.5 * 60 * 60 * 1000;

export function remainingFocusSeconds(endsAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export type DayCountdown = {
  hours: number;
  minutes: number;
  seconds: number;
  progressPercent: number;
  end: Date;
};

export function getDayCountdown(now: Date): DayCountdown {
  const end = new Date(now);
  end.setHours(0, 30, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);

  const remainingMs = Math.max(0, end.getTime() - now.getTime());
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  const remainingPercent = Math.min(100, Math.max(0, (remainingMs / DAY_WINDOW_MS) * 100));

  return {
    hours,
    minutes,
    seconds,
    progressPercent: 100 - remainingPercent,
    end,
  };
}

export function daysUntilDate(date: string, now: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((target - today) / 86_400_000));
}
