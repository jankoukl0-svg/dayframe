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
  start?: string;
  end?: string;
};

type StoredState = { plans?: Record<string, Task[]> };

type DaySummary = {
  key: string;
  label: string;
  planned: number;
  completed: number;
  completedMinutes: number;
};

const STORAGE_KEY = "dayframe-v1";

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function computeDays(state: StoredState, now: Date): DaySummary[] {
  const monday = startOfWeek(now);
  const today = localDateKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const key = localDateKey(date);
    const tasks = state.plans?.[key] ?? [];
    const dueTasks = key <= today ? tasks : [];
    const completedTasks = dueTasks.filter((task) => task.completed);
    return {
      key,
      label: new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date).replace(".", ""),
      planned: dueTasks.length,
      completed: completedTasks.length,
      completedMinutes: completedTasks.reduce((sum, task) => sum + Math.max(0, task.duration || 0), 0),
    };
  });
}

function computeStreak(state: StoredState, now: Date) {
  let streak = 0;
  for (let offset = 0; offset < 366; offset += 1) {
    const key = localDateKey(addDays(now, -offset));
    const tasks = state.plans?.[key] ?? [];
    if (!tasks.some((task) => task.completed)) break;
    streak += 1;
  }
  return streak;
}

export function HistoryController() {
  const [navHost, setNavHost] = useState<HTMLElement | null>(null);
  const [screenHost, setScreenHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<StoredState>({});
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const syncHosts = () => {
      const nav = document.querySelector<HTMLElement>(".df2-sidebar nav");
      const main = document.querySelector<HTMLElement>(".df2-main");
      if (nav) {
        let host = nav.querySelector<HTMLElement>("[data-history-nav-host]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.historyNavHost = "true";
          host.className = "df2-history-nav-host";
          const settingsButton = [...nav.querySelectorAll<HTMLButtonElement>(":scope > button")]
            .find((button) => button.textContent?.includes("Nastavení"));
          nav.insertBefore(host, settingsButton ?? null);
        }
        setNavHost((current) => current === host ? current : host);
      }
      if (main) {
        let host = main.querySelector<HTMLElement>("[data-history-screen-host]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.historyScreenHost = "true";
          host.className = "df2-history-screen-host";
          main.appendChild(host);
        }
        setScreenHost((current) => current === host ? current : host);
      }
    };
    syncHosts();
    const timer = window.setInterval(syncHosts, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".df2-root");
    root?.classList.toggle("df2-history-active", active);
    if (!active) return;
    const sync = () => {
      setState(readState());
      setNow(new Date());
    };
    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>(".df2-sidebar nav");
    const onSidebarClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-history-nav-host]") && target?.closest("button")) setActive(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "h") setActive(true);
      if (event.key === "Escape") setActive(false);
    };
    sidebar?.addEventListener("click", onSidebarClick);
    window.addEventListener("keydown", onKey);
    return () => {
      sidebar?.removeEventListener("click", onSidebarClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [navHost]);

  const days = useMemo(() => computeDays(state, now), [state, now]);
  const due = days.reduce((sum, day) => sum + day.planned, 0);
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  const completedMinutes = days.reduce((sum, day) => sum + day.completedMinutes, 0);
  const completionRate = due ? Math.round((completed / due) * 100) : 0;
  const streak = computeStreak(state, now);

  const categories = useMemo(() => {
    const monday = localDateKey(startOfWeek(now));
    const today = localDateKey(now);
    const minutes = new Map<string, number>();
    for (const [key, tasks] of Object.entries(state.plans ?? {})) {
      if (key < monday || key > today) continue;
      for (const task of tasks) {
        if (!task.completed) continue;
        const category = task.category || "Ostatní";
        minutes.set(category, (minutes.get(category) ?? 0) + Math.max(0, task.duration || 0));
      }
    }
    return [...minutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [state, now]);

  const navPortal = navHost ? createPortal(
    <button className={active ? "active" : ""} type="button" onClick={() => setActive(true)}>
      <span>Přehled</span><kbd>H</kbd>
    </button>,
    navHost,
  ) : null;

  const screenPortal = screenHost ? createPortal(
    active ? (
      <section className="df2-history-view">
        <header className="df2-page-head">
          <div><p>Tento týden</p><h1>Přehled</h1></div>
        </header>

        <div className="df2-history-metrics">
          <article><span>Hotovo</span><strong>{completed}<small> / {due}</small></strong></article>
          <article><span>Dokončení</span><strong>{completionRate}<small>%</small></strong></article>
          <article><span>Hotový čas</span><strong>{formatMinutes(completedMinutes)}</strong></article>
          <article><span>Streak</span><strong>{streak}<small> dní</small></strong></article>
        </div>

        <section className="df2-history-week" aria-label="Průběh tohoto týdne">
          <div className="df2-section-head"><h2>Týden</h2></div>
          <div className="df2-history-bars">
            {days.map((day) => {
              const rate = day.planned ? Math.round((day.completed / day.planned) * 100) : 0;
              return <article key={day.key} title={`${day.completed}/${day.planned} hotovo`}>
                <div><i style={{ height: `${Math.max(day.completed ? 8 : 0, rate)}%` }} /></div>
                <strong>{day.label}</strong>
                <small>{day.planned ? `${day.completed}/${day.planned}` : "—"}</small>
              </article>;
            })}
          </div>
        </section>

        <section className="df2-history-categories">
          <div className="df2-section-head"><h2>Čas podle oblasti</h2></div>
          {categories.length ? categories.map(([category, minutes]) => (
            <article key={category}><strong>{category}</strong><span>{formatMinutes(minutes)}</span></article>
          )) : <p>Zatím tu nejsou dokončené bloky.</p>}
        </section>
      </section>
    ) : null,
    screenHost,
  ) : null;

  return <>{navPortal}{screenPortal}</>;
}
