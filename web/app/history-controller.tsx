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
type PeriodMode = "week" | "month" | "year";

type BarSegment = {
  category: string;
  color: string;
  minutes: number;
};

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
  elapsedDays: number;
  averagePerActiveDay: number;
  longestStreak: number;
  strongestDay: { key: string; minutes: number } | null;
  categories: [string, number][];
};

type TrendBucket = {
  key: string;
  label: string;
  planned: number;
  completed: number;
  minutes: number;
  segments: BarSegment[];
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

function parseDateKey(key: string) {
  return new Date(`${key}T12:00:00`);
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

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((atNoon(end).getTime() - atNoon(start).getTime()) / 86_400_000));
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
    return {
      planned: 0,
      completed: 0,
      minutes: 0,
      completionRate: 0,
      activeDays: 0,
      elapsedDays: 0,
      averagePerActiveDay: 0,
      longestStreak: 0,
      strongestDay: null,
      categories: [],
    };
  }

  let planned = 0;
  let completed = 0;
  let minutes = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let strongestDay: { key: string; minutes: number } | null = null;
  const categories = new Map<string, number>();

  for (const date of eachDay(range.start, effectiveEnd)) {
    const key = localDateKey(date);
    const tasks = state.plans?.[key] ?? [];
    const completedTasks = tasks.filter((task) => task.completed);
    const dayMinutes = completedTasks.reduce((sum, task) => sum + completedBlockDuration(task), 0);

    planned += tasks.length;
    completed += completedTasks.length;
    minutes += dayMinutes;

    if (completedTasks.length) {
      activeDays += 1;
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }

    if (dayMinutes > 0 && (!strongestDay || dayMinutes > strongestDay.minutes)) {
      strongestDay = { key, minutes: dayMinutes };
    }

    for (const task of completedTasks) {
      const category = task.category?.trim() || "Ostatní";
      categories.set(category, (categories.get(category) ?? 0) + completedBlockDuration(task));
    }
  }

  const sortedCategories = [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs"));
  const elapsedDays = daysBetween(range.start, effectiveEnd) + 1;

  return {
    planned,
    completed,
    minutes,
    completionRate: planned ? Math.round((completed / planned) * 100) : 0,
    activeDays,
    elapsedDays,
    averagePerActiveDay: activeDays ? Math.round(minutes / activeDays) : 0,
    longestStreak,
    strongestDay,
    categories: sortedCategories,
  };
}

function comparablePreviousRange(mode: PeriodMode, range: PeriodRange, now: Date): PeriodRange {
  const effectiveEnd = minDate(range.end, atNoon(now));
  const span = Math.max(1, daysBetween(range.start, effectiveEnd) + 1);
  const previous = periodRange(mode, shiftPeriod(range.start, mode, -1));
  return { start: previous.start, end: minDate(previous.end, addDays(previous.start, span - 1)) };
}

function buildSegments(summary: PeriodSummary, colors: Record<string, string>) {
  return summary.categories.map(([category, minutes]) => ({
    category,
    minutes,
    color: colorForCategory(category, colors),
  }));
}

function buildTrendBuckets(
  mode: PeriodMode,
  state: StoredState,
  range: PeriodRange,
  now: Date,
  colors: Record<string, string>,
): TrendBucket[] {
  if (mode === "year") {
    return Array.from({ length: 12 }, (_, month) => {
      const start = new Date(range.start.getFullYear(), month, 1, 12);
      const monthRange = { start, end: endOfMonth(start) };
      const summary = summarizeRange(state, monthRange, now);
      return {
        key: localDateKey(start),
        label: new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(start).replace(".", ""),
        planned: summary.planned,
        completed: summary.completed,
        minutes: summary.minutes,
        segments: buildSegments(summary, colors),
      };
    });
  }

  return eachDay(range.start, range.end).map((date) => {
    const dayRange = { start: date, end: date };
    const summary = summarizeRange(state, dayRange, now);
    return {
      key: localDateKey(date),
      label: mode === "week"
        ? new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date).replace(".", "")
        : String(date.getDate()),
      planned: summary.planned,
      completed: summary.completed,
      minutes: summary.minutes,
      segments: buildSegments(summary, colors),
    };
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

function modeNoun(mode: PeriodMode) {
  if (mode === "week") return "týdne";
  if (mode === "month") return "měsíce";
  return "roku";
}

function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "nově oproti minule" : "bez změny";
  const delta = Math.round(((current - previous) / previous) * 100);
  if (!delta) return "stejně jako minule";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} % vs. minule`;
}

function allTimeStats(state: StoredState, now: Date) {
  const todayKey = localDateKey(now);
  let minutes = 0;
  let completed = 0;
  for (const [key, tasks] of Object.entries(state.plans ?? {})) {
    if (key > todayKey) continue;
    for (const task of tasks) {
      if (!task.completed) continue;
      completed += 1;
      minutes += completedBlockDuration(task);
    }
  }
  return { minutes, completed };
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
  const buckets = useMemo(() => buildTrendBuckets(mode, state, range, now, labelColors), [mode, state, range, now, labelColors]);
  const maxBucketMinutes = Math.max(1, ...buckets.map((bucket) => bucket.minutes));
  const isCurrent = samePeriod(mode, anchor, now);
  const total = useMemo(() => allTimeStats(state, now), [state, now]);

  const historyPeriods = useMemo(() => {
    const count = mode === "year" ? 5 : 8;
    return Array.from({ length: count }, (_, index) => {
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
      <section className="df2-history-view" data-history-mode={mode}>
        <header className="df2-page-head df2-history-head">
          <div>
            <p>{isCurrent ? `Tento ${mode === "week" ? "týden" : mode === "month" ? "měsíc" : "rok"}` : `Historie ${modeNoun(mode)}`}</p>
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
          <div>
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
          <span>Od začátku <strong>{formatMinutes(total.minutes)}</strong> · {total.completed} bloků</span>
        </div>

        <div className="df2-history-metrics">
          <article>
            <span>Hotovo</span>
            <strong>{summary.completed}<small> / {summary.planned}</small></strong>
            <small>{summary.planned ? `${summary.completionRate} % plánovaných bloků` : "Zatím bez bloků"}</small>
          </article>
          <article>
            <span>Dokončení</span>
            <strong>{summary.completionRate}<small>%</small></strong>
            <small>{deltaLabel(summary.completionRate, previousSummary.completionRate)}</small>
          </article>
          <article>
            <span>Odpracováno</span>
            <strong>{formatMinutes(summary.minutes)}</strong>
            <small>{deltaLabel(summary.minutes, previousSummary.minutes)}</small>
          </article>
          <article>
            <span>Aktivní dny</span>
            <strong>{summary.activeDays}<small> / {summary.elapsedDays}</small></strong>
            <small>{summary.activeDays ? `průměr ${formatMinutes(summary.averagePerActiveDay)} / aktivní den` : "Zatím bez dokončeného bloku"}</small>
          </article>
        </div>

        <section className="df2-history-week df2-history-trend" aria-label={`Studijní trend ${modeNoun(mode)}`}>
          <div className="df2-section-head">
            <h2>Studijní trend</h2>
            <span>Délka dokončených bloků · ne Focus timer</span>
          </div>
          <div
            className="df2-history-bars"
            data-mode={mode}
            style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(${mode === "month" ? 22 : 48}px, 1fr))` }}
          >
            {buckets.map((bucket) => {
              const height = bucket.minutes ? Math.max(8, Math.round((bucket.minutes / maxBucketMinutes) * 100)) : 0;
              return (
                <article key={bucket.key} title={`${bucket.label} · ${formatMinutes(bucket.minutes)} · ${bucket.completed}/${bucket.planned} hotovo`}>
                  <div>
                    <i className="df2-history-bar" style={{ height: `${height}%` }}>
                      {bucket.segments.map((segment) => (
                        <span
                          key={segment.category}
                          data-category={segment.category}
                          title={`${segment.category} · ${formatMinutes(segment.minutes)}`}
                          style={{ flexGrow: segment.minutes, backgroundColor: segment.color }}
                        />
                      ))}
                    </i>
                  </div>
                  <strong>{bucket.label}</strong>
                  <small>{mode === "month" ? (bucket.minutes ? `${Math.round(bucket.minutes / 60 * 10) / 10}h` : "—") : formatMinutes(bucket.minutes)}</small>
                </article>
              );
            })}
          </div>
        </section>

        <section className="df2-history-insights">
          <div className="df2-section-head">
            <h2>Jak se učíš</h2>
            <span>Z dokončených bloků v tomto období</span>
          </div>
          <div className="df2-history-insight-grid">
            <article>
              <span>Průměr / aktivní den</span>
              <strong>{formatMinutes(summary.averagePerActiveDay)}</strong>
            </article>
            <article>
              <span>Nejsilnější den</span>
              <strong>
                {summary.strongestDay
                  ? new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" }).format(parseDateKey(summary.strongestDay.key))
                  : "—"}
              </strong>
              <small>{summary.strongestDay ? formatMinutes(summary.strongestDay.minutes) : "bez dat"}</small>
            </article>
            <article>
              <span>Nejsilnější oblast</span>
              <strong>{summary.categories[0]?.[0] ?? "—"}</strong>
              <small>{summary.categories[0] ? formatMinutes(summary.categories[0][1]) : "bez dat"}</small>
            </article>
            <article>
              <span>Nejdelší série</span>
              <strong>{summary.longestStreak}<small> dní</small></strong>
            </article>
          </div>
        </section>

        <section className="df2-history-categories">
          <div className="df2-section-head">
            <h2>Čas podle oblasti</h2>
            <span>{summary.categories.length ? `${summary.categories.length} oblastí` : "Bez dokončených bloků"}</span>
          </div>
          {summary.categories.length ? summary.categories.slice(0, 8).map(([category, minutes]) => {
            const percentage = summary.minutes ? Math.round((minutes / summary.minutes) * 100) : 0;
            return (
              <article key={category} data-category={category}>
                <div className="df2-history-category-row">
                  <strong className="df2-history-category-label">
                    <i
                      className="df2-history-category-swatch"
                      aria-hidden="true"
                      style={{ backgroundColor: colorForCategory(category, labelColors) }}
                    />
                    {category}
                  </strong>
                  <span>{formatMinutes(minutes)} · {percentage} %</span>
                </div>
                <div className="df2-history-category-meter" aria-hidden="true">
                  <i style={{ width: `${percentage}%`, backgroundColor: colorForCategory(category, labelColors) }} />
                </div>
              </article>
            );
          }) : <p>Zatím tu nejsou dokončené bloky.</p>}
        </section>

        <section className="df2-history-period-history">
          <div className="df2-section-head">
            <h2>Historie {modeNoun(mode)}</h2>
            <span>Kliknutím otevřeš celé období</span>
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
                  <small>{period.summary.completionRate} % hotovo · {period.summary.activeDays} aktivních dní</small>
                </button>
              );
            })}
          </div>
        </section>
      </section>
    ) : null,
    screenHost,
  ) : null;

  return <>{navPortal}{screenPortal}</>;
}
