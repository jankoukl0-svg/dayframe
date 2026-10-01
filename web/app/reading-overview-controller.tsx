"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type PeriodMode = "week" | "month" | "year";
type PeriodRange = { start: Date; end: Date };
type Task = {
  id: string;
  title: string;
  date: string;
  duration: number;
  category?: string;
  completed?: boolean;
};
type StoredState = { plans?: Record<string, Task[]> };
type ReadingSummary = {
  minutes: number;
  days: number;
  blocks: number;
  averageMinutes: number;
  longestStreak: number;
};
type ReadingSnapshot = ReadingSummary & {
  previousMinutes: number;
  mode: PeriodMode;
  rangeKey: string;
};

const STORAGE_KEY = "dayframe-v1";
const EMPTY_SUMMARY: ReadingSummary = { minutes: 0, days: 0, blocks: 0, averageMinutes: 0, longestStreak: 0 };

function atNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = atNoon(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isReadingTask(task: Task) {
  const title = normalize(task.title || "");
  const category = normalize(task.category || "");
  return category === "cteni"
    || category === "reading"
    || title === "cteni"
    || title === "cteni knihy"
    || title.startsWith("cteni ")
    || title === "reading"
    || title.startsWith("reading ");
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function parseRange(view: HTMLElement): { mode: PeriodMode; range: PeriodRange } | null {
  const mode = view.dataset.historyMode as PeriodMode | undefined;
  if (mode !== "week" && mode !== "month" && mode !== "year") return null;
  const label = view.querySelector<HTMLElement>(".df2-history-period-nav > strong")?.textContent?.trim() || "";
  if (!label) return null;

  if (mode === "year") {
    const year = Number(label.match(/\d{4}/)?.[0]);
    if (!year) return null;
    return {
      mode,
      range: {
        start: new Date(year, 0, 1, 12),
        end: new Date(year, 11, 31, 12),
      },
    };
  }

  if (mode === "month") {
    const normalized = normalize(label);
    const year = Number(normalized.match(/\d{4}/)?.[0]);
    if (!year) return null;
    const monthNames = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
    const month = monthNames.findIndex((name) => normalized.startsWith(name));
    if (month < 0) return null;
    return {
      mode,
      range: {
        start: new Date(year, month, 1, 12),
        end: new Date(year, month + 1, 0, 12),
      },
    };
  }

  const dates = [...label.matchAll(/(\d{1,2})\.\s*(\d{1,2})\./g)];
  const year = Number(label.match(/\d{4}/)?.[0]);
  if (dates.length < 2 || !year) return null;
  const startDay = Number(dates[0][1]);
  const startMonth = Number(dates[0][2]);
  const endDay = Number(dates[1][1]);
  const endMonth = Number(dates[1][2]);
  const startYear = startMonth > endMonth ? year - 1 : year;
  return {
    mode,
    range: {
      start: new Date(startYear, startMonth - 1, startDay, 12),
      end: new Date(year, endMonth - 1, endDay, 12),
    },
  };
}

function summarizeReading(state: StoredState, range: PeriodRange, now: Date): ReadingSummary {
  const today = atNoon(now);
  if (range.start.getTime() > today.getTime()) return EMPTY_SUMMARY;
  const effectiveEnd = range.end.getTime() < today.getTime() ? range.end : today;
  let minutes = 0;
  let days = 0;
  let blocks = 0;
  let streak = 0;
  let longestStreak = 0;

  for (let date = atNoon(range.start); date.getTime() <= effectiveEnd.getTime(); date = addDays(date, 1)) {
    const readingTasks = (state.plans?.[localDateKey(date)] ?? [])
      .filter((task) => task.completed && isReadingTask(task));
    const dayMinutes = readingTasks.reduce((sum, task) => sum + Math.max(0, Number(task.duration) || 0), 0);
    blocks += readingTasks.length;
    minutes += dayMinutes;
    if (dayMinutes > 0) {
      days += 1;
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }

  return {
    minutes,
    days,
    blocks,
    averageMinutes: days ? Math.round(minutes / days) : 0,
    longestStreak,
  };
}

function previousRange(mode: PeriodMode, range: PeriodRange, now: Date): PeriodRange {
  let start: Date;
  let end: Date;
  if (mode === "week") {
    start = addDays(range.start, -7);
    end = addDays(range.end, -7);
  } else if (mode === "month") {
    start = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1, 12);
    end = new Date(range.start.getFullYear(), range.start.getMonth(), 0, 12);
  } else {
    start = new Date(range.start.getFullYear() - 1, 0, 1, 12);
    end = new Date(range.start.getFullYear() - 1, 11, 31, 12);
  }

  const today = atNoon(now);
  const isCurrent = today.getTime() >= range.start.getTime() && today.getTime() <= range.end.getTime();
  if (!isCurrent) return { start, end };
  const elapsedDays = Math.max(0, Math.round((today.getTime() - range.start.getTime()) / 86_400_000));
  const comparableEnd = addDays(start, elapsedDays);
  return { start, end: comparableEnd.getTime() < end.getTime() ? comparableEnd : end };
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "Nové období" : "Bez změny";
  const delta = Math.round(((current - previous) / previous) * 100);
  if (!delta) return "Stejně jako minule";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} % oproti minule`;
}

function sameSnapshot(left: ReadingSnapshot | null, right: ReadingSnapshot) {
  return Boolean(left)
    && left?.minutes === right.minutes
    && left?.days === right.days
    && left?.blocks === right.blocks
    && left?.averageMinutes === right.averageMinutes
    && left?.longestStreak === right.longestStreak
    && left?.previousMinutes === right.previousMinutes
    && left?.mode === right.mode
    && left?.rangeKey === right.rangeKey;
}

export function ReadingOverviewController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<ReadingSnapshot | null>(null);

  useEffect(() => {
    const sync = () => {
      const view = document.querySelector<HTMLElement>(".df2-history-view");
      const trend = view?.querySelector<HTMLElement>(".df2-history-trend") ?? null;
      if (!view || !trend) {
        setHost((current) => current === null ? current : null);
        return;
      }

      let nextHost = view.querySelector<HTMLElement>("[data-reading-overview-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.readingOverviewHost = "true";
        nextHost.className = "df2-reading-overview-host";
        trend.insertAdjacentElement("afterend", nextHost);
      }
      setHost((current) => current === nextHost ? current : nextHost);

      const parsed = parseRange(view);
      if (!parsed) return;
      const now = new Date();
      const state = readState();
      const current = summarizeReading(state, parsed.range, now);
      const previous = summarizeReading(state, previousRange(parsed.mode, parsed.range, now), now);
      const nextSnapshot: ReadingSnapshot = {
        ...current,
        previousMinutes: previous.minutes,
        mode: parsed.mode,
        rangeKey: `${localDateKey(parsed.range.start)}:${localDateKey(parsed.range.end)}`,
      };
      setSnapshot((existing) => sameSnapshot(existing, nextSnapshot) ? existing : nextSnapshot);
    };

    sync();
    const timer = window.setInterval(sync, 350);
    window.addEventListener("dayframe-state-sync", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dayframe-state-sync", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!host || !snapshot) return null;

  return createPortal(
    <section className="df2-reading-card" aria-label="Čtení">
      <div className="df2-overview-section-head">
        <h2>Čtení</h2>
      </div>
      <div className="df2-reading-card-grid">
        <div className="df2-reading-primary">
          <strong>{formatMinutes(snapshot.minutes)}</strong>
          <small>{deltaLabel(snapshot.minutes, snapshot.previousMinutes)}</small>
        </div>
        <div className="df2-reading-stat">
          <strong>{snapshot.days}</strong>
          <span>dní čtení</span>
        </div>
        <div className="df2-reading-stat">
          <strong>{formatMinutes(snapshot.averageMinutes)}</strong>
          <span>průměr / den</span>
        </div>
        <div className="df2-reading-stat">
          <strong>{snapshot.longestStreak}</strong>
          <span>dní nejdelší série</span>
        </div>
      </div>
    </section>,
    host,
  );
}
