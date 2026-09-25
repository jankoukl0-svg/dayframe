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
  plannedStart?: string;
  plannedEnd?: string;
  plannedDuration?: number;
  actualStartedAt?: string;
  actualEndedAt?: string;
  actualMinutes?: number;
};

type StoredState = { plans?: Record<string, Task[]> };

type BarSegment = {
  category: string;
  color: string;
  minutes: number;
};

type DaySummary = {
  key: string;
  label: string;
  planned: number;
  completed: number;
  completedMinutes: number;
  segments: BarSegment[];
};

const STORAGE_KEY = "dayframe-v1";
const LABEL_COLORS_STORAGE_KEY = "dayframe-label-colors-v1";
const DEFAULT_LABEL_COLOR = "#c85b32";

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

function normalizeHex(value: string) {
  const next = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(next) ? next : DEFAULT_LABEL_COLOR;
}

function readLabelColors(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LABEL_COLORS_STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([category, color]) => [category, normalizeHex(color)]),
    );
  } catch {
    return {};
  }
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function actualDuration(task: Task) {
  return Number.isFinite(task.actualMinutes) && (task.actualMinutes ?? 0) > 0
    ? Math.max(1, task.actualMinutes ?? 0)
    : Math.max(0, task.duration || 0);
}

function plannedDuration(task: Task) {
  return Math.max(0, task.plannedDuration ?? task.duration ?? 0);
}

function colorForCategory(category: string, colors: Record<string, string>) {
  return normalizeHex(colors[category] ?? DEFAULT_LABEL_COLOR);
}

function buildSegments(tasks: Task[], colors: Record<string, string>) {
  const minutesByCategory = new Map<string, number>();
  for (const task of tasks) {
    const category = task.category?.trim() || "Ostatní";
    minutesByCategory.set(category, (minutesByCategory.get(category) ?? 0) + actualDuration(task));
  }
  return [...minutesByCategory.entries()]
    .map(([category, minutes]) => ({ category, minutes, color: colorForCategory(category, colors) }))
    .sort((a, b) => b.minutes - a.minutes || a.category.localeCompare(b.category, "cs"));
}

function computeDays(state: StoredState, now: Date, colors: Record<string, string>): DaySummary[] {
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
      completedMinutes: completedTasks.reduce((sum, task) => sum + actualDuration(task), 0),
      segments: buildSegments(completedTasks, colors),
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
  const [labelColors, setLabelColors] = useState<Record<string, string>>({});
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
      setLabelColors(readLabelColors());
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

  const days = useMemo(() => computeDays(state, now, labelColors), [state, now, labelColors]);
  const due = days.reduce((sum, day) => sum + day.planned, 0);
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  const completedMinutes = days.reduce((sum, day) => sum + day.completedMinutes, 0);
  const completionRate = due ? Math.round((completed / due) * 100) : 0;
  const streak = computeStreak(state, now);
  const mondayKey = localDateKey(startOfWeek(now));
  const todayKey = localDateKey(now);

  const completedTasks = useMemo(() => Object.entries(state.plans ?? {})
    .filter(([key]) => key >= mondayKey && key <= todayKey)
    .flatMap(([, tasks]) => tasks)
    .filter((task) => task.completed), [state, mondayKey, todayKey]);

  const measuredTasks = completedTasks
    .filter((task) => Number.isFinite(task.actualMinutes) && (task.actualMinutes ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.actualEndedAt ?? "").localeCompare(a.actualEndedAt ?? ""))
    .slice(0, 8);

  const categories = useMemo(() => {
    const minutes = new Map<string, number>();
    for (const task of completedTasks) {
      const category = task.category || "Ostatní";
      minutes.set(category, (minutes.get(category) ?? 0) + actualDuration(task));
    }
    return [...minutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [completedTasks]);

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
          <article><span>Odpracováno</span><strong>{formatMinutes(completedMinutes)}</strong></article>
          <article><span>Streak</span><strong>{streak}<small> dní</small></strong></article>
        </div>

        <section className="df2-history-week" aria-label="Průběh tohoto týdne">
          <div className="df2-section-head"><h2>Týden</h2></div>
          <div className="df2-history-bars">
            {days.map((day) => {
              const rate = day.planned ? Math.round((day.completed / day.planned) * 100) : 0;
              return <article key={day.key} title={`${day.completed}/${day.planned} hotovo`}>
                <div>
                  <i className="df2-history-bar" style={{ height: `${Math.max(day.completed ? 8 : 0, rate)}%` }}>
                    {day.segments.map((segment) => (
                      <span
                        key={segment.category}
                        data-category={segment.category}
                        title={`${segment.category} · ${formatMinutes(segment.minutes)}`}
                        style={{ flexGrow: segment.minutes, backgroundColor: segment.color }}
                      />
                    ))}
                  </i>
                </div>
                <strong>{day.label}</strong>
                <small>{day.planned ? `${day.completed}/${day.planned}` : "—"}</small>
              </article>;
            })}
          </div>
        </section>

        <section className="df2-history-actual">
          <div className="df2-section-head"><h2>Plán vs skutečnost</h2><span>{measuredTasks.length ? "Focus bloky" : "Data se začnou ukládat při Focusu"}</span></div>
          {measuredTasks.length ? measuredTasks.map((task) => {
            const plan = plannedDuration(task);
            const actual = actualDuration(task);
            const delta = actual - plan;
            return <article key={task.id}>
              <strong>{task.title}</strong>
              <span>plán {formatMinutes(plan)}</span>
              <span>skutečnost {formatMinutes(actual)}</span>
              <em>{delta === 0 ? "±0 min" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} min`}</em>
            </article>;
          }) : <p>Spusť blok přes „Zahájit blok“ a Dayframe začne měřit skutečně odpracovaný čas.</p>}
        </section>

        <section className="df2-history-categories">
          <div className="df2-section-head"><h2>Čas podle oblasti</h2></div>
          {categories.length ? categories.map(([category, minutes]) => (
            <article key={category} data-category={category}>
              <strong className="df2-history-category-label">
                <i
                  className="df2-history-category-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: colorForCategory(category, labelColors) }}
                />
                {category}
              </strong>
              <span>{formatMinutes(minutes)}</span>
            </article>
          )) : <p>Zatím tu nejsou dokončené bloky.</p>}
        </section>
      </section>
    ) : null,
    screenHost,
  ) : null;

  return <>{navPortal}{screenPortal}</>;
}
