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
};

type StoredState = { plans?: Record<string, Task[]> };
type PeriodMode = "week" | "month" | "year";

type PeriodRange = {
  start: Date;
  end: Date;
};

type PeriodSummary = {
  planned: number;
  completed: number;
  minutes: number;
  completionRate: number;
  activeDays: number;
  categories: [string, number][];
};

type TrendBucket = {
  key: string;
  label: string;
  planned: number;
  completed: number;
  minutes: number;
  categories: [string, number][];
};

const STORAGE_KEY = "dayframe-v1";
const LABEL_COLORS_STORAGE_KEY = "dayframe-label-colors-v1";
const DEFAULT_LABEL_COLOR = "#c85b32";

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

function startOfWeek(date: Date) {
  const next = atNoon(date);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 12);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31, 12);
}

function periodRange(mode: PeriodMode, anchor: Date): PeriodRange {
  if (mode === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (mode === "month") return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  return { start: startOfYear(anchor), end: endOfYear(anchor) };
}

function shiftPeriod(anchor: Date, mode: PeriodMode, amount: number) {
  if (mode === "week") return addDays(startOfWeek(anchor), amount * 7);
  if (mode === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1, 12);
  return new Date(anchor.getFullYear() + amount, 0, 1, 12);
}

function samePeriod(mode: PeriodMode, left: Date, right: Date) {
  return localDateKey(periodRange(mode, left).start) === localDateKey(periodRange(mode, right).start);
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function eachDay(start: Date, end: Date) {
  const dates: Date[] = [];
  for (let date = atNoon(start); date.getTime() <= end.getTime(); date = addDays(date, 1)) dates.push(date);
  return dates;
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

function completedBlockDuration(task: Task) {
  return Math.max(0, task.duration || 0);
}

function colorForCategory(category: string, colors: Record<string, string>) {
  return normalizeHex(colors[category] ?? DEFAULT_LABEL_COLOR);
}

function summarizeRange(state: StoredState, range: PeriodRange, now: Date): PeriodSummary {
  const todayKey = localDateKey(now);
  const rangeStartKey = localDateKey(range.start);
  const effectiveEnd = minDate(range.end, atNoon(now));

  if (rangeStartKey > todayKey) {
    return { planned: 0, completed: 0, minutes: 0, completionRate: 0, activeDays: 0, categories: [] };
  }

  let planned = 0;
  let completed = 0;
  let minutes = 0;
  let activeDays = 0;
  const categories = new Map<string, number>();

  for (const date of eachDay(range.start, effectiveEnd)) {
    const key = localDateKey(date);
    const tasks = state.plans?.[key] ?? [];
    const completedTasks = tasks.filter((task) => task.completed);
    planned += tasks.length;
    completed += completedTasks.length;

    if (completedTasks.length) activeDays += 1;

    for (const task of completedTasks) {
      const duration = completedBlockDuration(task);
      minutes += duration;
      const category = task.category?.trim() || "Ostatní";
      categories.set(category, (categories.get(category) ?? 0) + duration);
    }
  }

  return {
    planned,
    completed,
    minutes,
    completionRate: planned ? Math.round((completed / planned) * 100) : 0,
    activeDays,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs")),
  };
}

function comparablePreviousRange(mode: PeriodMode, range: PeriodRange, now: Date): PeriodRange {
  const previous = periodRange(mode, shiftPeriod(range.start, mode, -1));
  if (!samePeriod(mode, range.start, now)) return previous;

  const elapsed = Math.max(0, Math.round((atNoon(now).getTime() - range.start.getTime()) / 86_400_000));
  return { start: previous.start, end: minDate(previous.end, addDays(previous.start, elapsed)) };
}

function toTrendBucket(key: string, label: string, summary: PeriodSummary): TrendBucket {
  return {
    key,
    label,
    planned: summary.planned,
    completed: summary.completed,
    minutes: summary.minutes,
    categories: summary.categories,
  };
}

function buildTrendBuckets(mode: PeriodMode, state: StoredState, range: PeriodRange, now: Date): TrendBucket[] {
  if (mode === "year") {
    return Array.from({ length: 12 }, (_, month) => {
      const start = new Date(range.start.getFullYear(), month, 1, 12);
      const summary = summarizeRange(state, { start, end: endOfMonth(start) }, now);
      return toTrendBucket(
        localDateKey(start),
        new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(start).replace(".", ""),
        summary,
      );
    });
  }

  if (mode === "month") {
    const days = eachDay(range.start, range.end);
    const buckets: TrendBucket[] = [];
    for (let index = 0; index < days.length; index += 7) {
      const start = days[index];
      const end = days[Math.min(index + 6, days.length - 1)];
      const summary = summarizeRange(state, { start, end }, now);
      buckets.push(toTrendBucket(localDateKey(start), `${start.getDate()}–${end.getDate()}`, summary));
    }
    return buckets;
  }

  return eachDay(range.start, range.end).map((date) => {
    const summary = summarizeRange(state, { start: date, end: date }, now);
    return toTrendBucket(
      localDateKey(date),
      new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date).replace(".", ""),
      summary,
    );
  });
}

function periodLabel(mode: PeriodMode, range: PeriodRange) {
  if (mode === "month") return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(range.start);
  if (mode === "year") return String(range.start.getFullYear());
  const start = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(range.start);
  const end = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(range.end);
  return `${start} – ${end}`;
}

function compactPeriodLabel(mode: PeriodMode, range: PeriodRange) {
  if (mode === "month") return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(range.start);
  if (mode === "year") return String(range.start.getFullYear());
  const start = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(range.start);
  const end = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(range.end);
  return `${start}–${end}`;
}

function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "Nové období" : "Bez změny";
  const delta = Math.round(((current - previous) / previous) * 100);
  if (!delta) return "Stejně jako minule";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} % oproti minule`;
}

export function HistoryController() {
  const [navHost, setNavHost] = useState<HTMLElement | null>(null);
  const [screenHost, setScreenHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<StoredState>({});
  const [labelColors, setLabelColors] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<PeriodMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());

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

  const range = useMemo(() => periodRange(mode, anchor), [mode, anchor]);
  const summary = useMemo(() => summarizeRange(state, range, now), [state, range, now]);
  const previousRange = useMemo(() => comparablePreviousRange(mode, range, now), [mode, range, now]);
  const previousSummary = useMemo(() => summarizeRange(state, previousRange, now), [state, previousRange, now]);
  const buckets = useMemo(() => buildTrendBuckets(mode, state, range, now), [mode, state, range, now]);
  const maxBucketMinutes = Math.max(1, ...buckets.map((bucket) => bucket.minutes));
  const isCurrent = samePeriod(mode, anchor, now);

  const historyPeriods = useMemo(() => {
    return Array.from({ length: 4 }, (_, index) => {
      const periodAnchor = shiftPeriod(now, mode, -index);
      const period = periodRange(mode, periodAnchor);
      return {
        anchor: periodAnchor,
        range: period,
        summary: summarizeRange(state, period, now),
      };
    });
  }, [mode, now, state]);

  const navPortal = navHost ? createPortal(
    <button className={active ? "active" : ""} type="button" onClick={() => setActive(true)}>
      <span>Přehled</span><kbd>H</kbd>
    </button>,
    navHost,
  ) : null;

  const screenPortal = screenHost ? createPortal(
    active ? (
      <section className="df2-history-view df2-overview-simple" data-history-mode={mode}>
        <header className="df2-history-head">
          <div>
            <h1>Přehled</h1>
            <span>{periodLabel(mode, range)}</span>
          </div>
          <div className="df2-history-period-switch" role="group" aria-label="Rozsah přehledu">
            {(["week", "month", "year"] as PeriodMode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "active" : ""}
                onClick={() => {
                  setMode(value);
                  setAnchor(now);
                }}
              >
                {value === "week" ? "Týden" : value === "month" ? "Měsíc" : "Rok"}
              </button>
            ))}
          </div>
        </header>

        <div className="df2-history-period-nav">
          <button type="button" aria-label="Předchozí období" onClick={() => setAnchor((current) => shiftPeriod(current, mode, -1))}>‹</button>
          <strong>{periodLabel(mode, range)}</strong>
          <button
            type="button"
            aria-label="Následující období"
            disabled={isCurrent}
            onClick={() => setAnchor((current) => shiftPeriod(current, mode, 1))}
          >
            ›
          </button>
          {!isCurrent && <button type="button" className="df2-history-today" onClick={() => setAnchor(now)}>Dnes</button>}
        </div>

        <section className="df2-overview-summary" aria-label="Souhrn období">
          <span>Odpracováno</span>
          <strong>{formatMinutes(summary.minutes)}</strong>
          <p>{summary.completed} z {summary.planned} bloků · {summary.completionRate} % dokončeno</p>
          <small>{deltaLabel(summary.minutes, previousSummary.minutes)}</small>
        </section>

        <section className="df2-history-trend" aria-label="Aktivita">
          <div className="df2-overview-section-head">
            <h2>Aktivita</h2>
          </div>
          <div
            className="df2-history-bars"
            data-mode={mode}
            style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(${mode === "year" ? 42 : 52}px, 1fr))` }}
          >
            {buckets.map((bucket) => {
              const height = bucket.minutes ? Math.max(8, Math.round((bucket.minutes / maxBucketMinutes) * 100)) : 0;
              const categorySummary = bucket.categories.map(([category, minutes]) => `${category} ${formatMinutes(minutes)}`).join(", ");
              return (
                <article
                  key={bucket.key}
                  aria-label={`${bucket.label}: ${formatMinutes(bucket.minutes)}, ${bucket.completed} z ${bucket.planned} bloků hotovo${categorySummary ? `, ${categorySummary}` : ""}`}
                >
                  <div>
                    <i
                      className="df2-history-bar"
                      style={{
                        height: `${height}%`,
                        display: "flex",
                        flexDirection: "column-reverse",
                        overflow: "hidden",
                      }}
                    >
                      {bucket.categories.map(([category, minutes]) => (
                        <span
                          key={category}
                          data-category={category}
                          title={`${category} · ${formatMinutes(minutes)}`}
                          style={{
                            display: "block",
                            width: "100%",
                            minHeight: 0,
                            flexBasis: 0,
                            flexGrow: minutes,
                            backgroundColor: colorForCategory(category, labelColors),
                          }}
                        />
                      ))}
                    </i>
                  </div>
                  <strong>{bucket.label}</strong>
                  <small>{bucket.minutes ? formatMinutes(bucket.minutes) : "—"}</small>
                </article>
              );
            })}
          </div>
        </section>

        <div className="df2-overview-bottom-grid">
          <section className="df2-history-categories">
            <div className="df2-overview-section-head">
              <h2>Oblasti</h2>
            </div>
            <div className="df2-overview-list">
              {summary.categories.length ? summary.categories.slice(0, 3).map(([category, minutes]) => (
                <div className="df2-overview-list-row" key={category} data-category={category}>
                  <span>
                    <i aria-hidden="true" style={{ backgroundColor: colorForCategory(category, labelColors) }} />
                    {category}
                  </span>
                  <strong>{formatMinutes(minutes)}</strong>
                </div>
              )) : <p className="df2-overview-empty">Zatím bez dokončených bloků.</p>}
            </div>
          </section>

          <section className="df2-history-period-history">
            <div className="df2-overview-section-head">
              <h2>Historie</h2>
            </div>
            <div className="df2-history-period-grid">
              {historyPeriods.map((period) => {
                const selected = samePeriod(mode, anchor, period.anchor);
                return (
                  <button
                    key={localDateKey(period.range.start)}
                    type="button"
                    className={selected ? "active" : ""}
                    onClick={() => setAnchor(period.anchor)}
                  >
                    <span>{compactPeriodLabel(mode, period.range)}</span>
                    <strong>{formatMinutes(period.summary.minutes)}</strong>
                    <i aria-hidden="true">›</i>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    ) : null,
    screenHost,
  ) : null;

  return <>{navPortal}{screenPortal}</>;
}
