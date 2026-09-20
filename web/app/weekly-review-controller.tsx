"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Task = {
  id: string;
  date: string;
  title: string;
  duration: number;
  category?: string;
  completed: boolean;
  actualMinutes?: number;
};

type StoredState = { plans?: Record<string, Task[]> };

const STORAGE_KEY = "dayframe-v1";

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function actualMinutes(task: Task) {
  return Number.isFinite(task.actualMinutes) && (task.actualMinutes ?? 0) > 0
    ? task.actualMinutes ?? 0
    : Math.max(0, task.duration || 0);
}

function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

export function WeeklyReviewController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<StoredState>({});
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const sync = () => {
      const view = document.querySelector<HTMLElement>(".df2-history-view");
      if (!view) {
        setHost((current) => current === null ? current : null);
        return;
      }
      let next = view.querySelector<HTMLElement>("[data-weekly-review-host]");
      if (!next) {
        next = document.createElement("div");
        next.dataset.weeklyReviewHost = "true";
        next.className = "df2-weekly-review-host";
        view.appendChild(next);
      }
      setHost((current) => current === next ? current : next);
      setState(readState());
      setNow(new Date());
    };
    sync();
    const timer = window.setInterval(sync, 700);
    return () => window.clearInterval(timer);
  }, []);

  const review = useMemo(() => {
    const monday = startOfWeek(now);
    const today = localDateKey(now);
    const dayRows = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(monday, index);
      const key = localDateKey(date);
      const tasks = key <= today ? state.plans?.[key] ?? [] : [];
      const completed = tasks.filter((task) => task.completed);
      return {
        key,
        date,
        planned: tasks.length,
        completed: completed.length,
        minutes: completed.reduce((sum, task) => sum + actualMinutes(task), 0),
        tasks: completed,
      };
    });

    const planned = dayRows.reduce((sum, day) => sum + day.planned, 0);
    const completed = dayRows.reduce((sum, day) => sum + day.completed, 0);
    const minutes = dayRows.reduce((sum, day) => sum + day.minutes, 0);
    const strongestDay = dayRows.filter((day) => day.minutes > 0).sort((a, b) => b.minutes - a.minutes)[0] ?? null;
    const categories = new Map<string, number>();
    for (const day of dayRows) {
      for (const task of day.tasks) {
        const category = task.category || "Ostatní";
        categories.set(category, (categories.get(category) ?? 0) + actualMinutes(task));
      }
    }
    const strongestCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return { planned, completed, minutes, strongestDay, strongestCategory };
  }, [state, now]);

  if (!host) return null;

  return createPortal(
    <section className="df2-weekly-review">
      <div className="df2-section-head"><h2>Týdenní review</h2><span>{now.getDay() === 0 ? "Uzavření týdne" : "Průběžný stav"}</span></div>
      <div className="df2-weekly-review-grid">
        <article><span>Bloky</span><strong>{review.completed} / {review.planned}</strong></article>
        <article><span>Odpracováno</span><strong>{formatMinutes(review.minutes)}</strong></article>
        <article><span>Nejsilnější den</span><strong>{review.strongestDay ? new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(review.strongestDay.date) : "—"}</strong></article>
        <article><span>Nejsilnější oblast</span><strong>{review.strongestCategory?.[0] ?? "—"}</strong></article>
      </div>
    </section>,
    host,
  );
}
