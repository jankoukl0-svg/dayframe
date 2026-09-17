"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type CalendarTask = {
  id: number;
  title: string;
  start: string;
  end: string;
  category: string;
  completed?: boolean;
  fixed?: boolean;
};

type WaitingTask = {
  id: number;
  title: string;
  duration: number;
  category: string;
  targetDate?: string;
  requestedStart?: string;
};

type DisplayTask = CalendarTask & {
  pending?: boolean;
  source: "live" | "template" | "waiting";
};

type SavedDayframe = {
  date?: string;
  tasks?: CalendarTask[];
  inboxTasks?: WaitingTask[];
  tomorrowDate?: string;
  tomorrowTasks?: CalendarTask[];
};

type Seed = Omit<CalendarTask, "id">;

const templates: Record<number, Seed[]> = {
  0: [
    { title: "Naplánovat další týden", start: "14:00", end: "14:30", category: "Plánování" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  1: [
    { title: "CFI / Excel", start: "10:00", end: "11:30", category: "Finance" },
    { title: "Matematika", start: "12:00", end: "13:00", category: "Matika" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  2: [
    { title: "Ekonomie z učebnice", start: "10:00", end: "11:30", category: "Ekonomie" },
    { title: "Běžná angličtina", start: "12:00", end: "13:00", category: "Angličtina" },
    { title: "CFI / Excel", start: "14:00", end: "15:00", category: "Finance" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  3: [
    { title: "Matematika", start: "10:00", end: "11:30", category: "Matika" },
    { title: "CFI / Excel", start: "12:00", end: "13:00", category: "Finance" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  4: [
    { title: "Ekonomie z učebnice", start: "10:00", end: "11:30", category: "Ekonomie" },
    { title: "Matematika", start: "12:00", end: "13:00", category: "Matika" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  5: [
    { title: "CFI / Excel", start: "10:00", end: "11:30", category: "Finance" },
    { title: "Ekonomie z učebnice", start: "12:00", end: "13:00", category: "Ekonomie" },
    { title: "Opakování týdne", start: "14:00", end: "15:00", category: "Opakování" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  6: [
    { title: "Dohnat resty týdne", start: "10:00", end: "11:00", category: "Flex blok" },
    { title: "Běžná angličtina", start: "12:00", end: "13:00", category: "Angličtina" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(reference: Date) {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  return eh * 60 + em - (sh * 60 + sm);
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.MAX_SAFE_INTEGER;
  return hours * 60 + minutes;
}

function addMinutes(time: string, duration: number) {
  const total = timeToMinutes(time) + duration;
  if (!Number.isFinite(total) || total >= 24 * 60) return time;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function sortTasksChronologically(items: DisplayTask[]) {
  return [...items].sort((a, b) => {
    const startDifference = timeToMinutes(a.start) - timeToMinutes(b.start);
    if (startDifference) return startDifference;
    if (a.pending !== b.pending) return a.pending ? 1 : -1;
    const endDifference = timeToMinutes(a.end) - timeToMinutes(b.end);
    if (endDifference) return endDifference;
    return a.title.localeCompare(b.title, "cs");
  });
}

function templateTasks(date: Date): DisplayTask[] {
  return (templates[date.getDay()] ?? []).map((task, index) => ({
    ...task,
    id: Number(`${date.getFullYear()}${date.getMonth() + 1}${date.getDate()}${index}`),
    source: "template",
  }));
}

function readSaved(): SavedDayframe {
  try {
    const raw = window.localStorage.getItem("dayframe-v1");
    return raw ? JSON.parse(raw) as SavedDayframe : {};
  } catch {
    return {};
  }
}

function findNavigationButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".side-panel nav > button"))
    .find((button) => button.textContent?.includes(label));
}

function afterRender(callback: () => void) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
}

export function WeekCalendar() {
  const [open, setOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [saved, setSaved] = useState<SavedDayframe>({});
  const [sideHost, setSideHost] = useState<HTMLElement | null>(null);
  const [mobileHost, setMobileHost] = useState<HTMLElement | null>(null);
  const [mainHost, setMainHost] = useState<HTMLElement | null>(null);

  function showWeek() {
    setWeekOffset(0);
    const todayButton = document.querySelector<HTMLButtonElement>(".side-panel nav > button");
    todayButton?.click();
    window.requestAnimationFrame(() => setOpen(true));
  }

  function openCaptureForDate(dateKey: string) {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("dayframe:capture-date", { detail: { date: dateKey } }));
    findNavigationButton("Přidat úkol")?.click();
    afterRender(() => document.querySelector<HTMLInputElement>("#capture-task-name")?.focus());
  }

  function openWaitingTask(task: DisplayTask, dateKey: string) {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("dayframe:capture-date", { detail: { date: dateKey } }));
    findNavigationButton("Přidat úkol")?.click();
    afterRender(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(".waiting-row")).find((candidate) =>
        candidate.querySelector(".planning-copy strong")?.textContent?.trim() === task.title,
      );
      const edit = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.trim() === "Upravit");
      edit?.click();
    });
  }

  function openLiveTask(task: DisplayTask, dateKey: string) {
    const todayKey = localDateKey(new Date());
    setOpen(false);
    if (dateKey === todayKey) {
      afterRender(() => {
        const row = Array.from(document.querySelectorAll<HTMLElement>(".timeline-row")).find((candidate) =>
          candidate.querySelector(".task-copy strong")?.textContent?.trim() === task.title
          && candidate.querySelector(".task-time strong")?.textContent?.trim() === task.start,
        );
        row?.querySelector<HTMLButtonElement>(".task-open")?.click();
      });
      return;
    }

    findNavigationButton("Přidat úkol")?.click();
    afterRender(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(".tomorrow-row")).find((candidate) =>
        candidate.querySelector(".planning-copy strong")?.textContent?.trim() === task.title
        && candidate.querySelector(".tomorrow-time strong")?.textContent?.trim() === task.start,
      );
      const edit = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.trim() === "Upravit");
      edit?.click();
    });
  }

  function openTask(task: DisplayTask, dateKey: string) {
    if (task.source === "waiting") {
      openWaitingTask(task, dateKey);
      return;
    }
    if (task.source === "live") openLiveTask(task, dateKey);
  }

  useEffect(() => {
    const sideNav = document.querySelector<HTMLElement>(".side-panel nav");
    const mobileNav = document.querySelector<HTMLElement>(".mobile-nav");
    const mainColumn = document.querySelector<HTMLElement>(".main-column");

    const side = document.createElement("span");
    side.className = "week-nav-host";
    side.style.display = "contents";
    const mobile = document.createElement("span");
    mobile.className = "week-mobile-nav-host";
    mobile.style.display = "contents";

    const firstSideButton = sideNav?.querySelector("button");
    const firstMobileButton = mobileNav?.querySelector("button");
    if (sideNav) firstSideButton?.after(side);
    if (mobileNav) firstMobileButton?.after(mobile);

    setSideHost(sideNav ? side : null);
    setMobileHost(mobileNav ? mobile : null);
    setMainHost(mainColumn);

    const closeWeek = () => setOpen(false);
    const nativeNavButtons = [
      ...Array.from(sideNav?.querySelectorAll(":scope > button") ?? []),
      ...Array.from(mobileNav?.querySelectorAll(":scope > button") ?? []),
    ];
    nativeNavButtons.forEach((button) => button.addEventListener("click", closeWeek));
    const wordmark = document.querySelector(".wordmark");
    wordmark?.addEventListener("click", closeWeek);

    return () => {
      nativeNavButtons.forEach((button) => button.removeEventListener("click", closeWeek));
      wordmark?.removeEventListener("click", closeWeek);
      side.remove();
      mobile.remove();
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector(".dayframe-root");
    root?.classList.toggle("week-calendar-active", open);
    if (open) setSaved(readSaved());
    return () => root?.classList.remove("week-calendar-active");
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "w") showWeek();
      if (event.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const now = new Date();
  const todayKey = localDateKey(now);
  const baseMonday = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [weekOffset, todayKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(baseMonday, index)), [baseMonday]);
  const weekLabel = `${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;

  const tasksForDate = (date: Date) => {
    const key = localDateKey(date);
    let base: DisplayTask[];
    let live = false;
    if (saved.date === key && Array.isArray(saved.tasks)) {
      base = saved.tasks.map((task) => ({ ...task, source: "live" as const }));
      live = true;
    } else if (saved.tomorrowDate === key && Array.isArray(saved.tomorrowTasks)) {
      base = saved.tomorrowTasks.map((task) => ({ ...task, source: "live" as const }));
      live = true;
    } else {
      base = templateTasks(date);
    }

    const waiting: DisplayTask[] = (saved.inboxTasks ?? [])
      .filter((task) => task.targetDate === key)
      .map((task) => ({
        id: task.id,
        title: task.title,
        start: task.requestedStart ?? "99:99",
        end: task.requestedStart ? addMinutes(task.requestedStart, task.duration) : "99:99",
        category: task.category,
        fixed: Boolean(task.requestedStart),
        pending: true,
        source: "waiting" as const,
      }));

    return { tasks: sortTasksChronologically([...base, ...waiting]), live };
  };

  const navButton = (
    <button
      type="button"
      className={`week-nav-button ${open ? "active" : ""}`}
      onClick={showWeek}
      aria-current={open ? "page" : undefined}
    >
      <span className="nav-label">Týden</span><kbd>W</kbd>
    </button>
  );

  const mobileButton = (
    <button type="button" className={open ? "active" : ""} onClick={showWeek}>Týden</button>
  );

  return (
    <>
      {sideHost && createPortal(navButton, sideHost)}
      {mobileHost && createPortal(mobileButton, mobileHost)}
      {open && mainHost && createPortal(
        <section className="week-calendar-page" aria-label="Týdenní kalendář">
          <header className="week-calendar-header">
            <div>
              <p>{weekLabel}</p>
              <h1>Týden</h1>
            </div>
            <div className="week-calendar-controls" aria-label="Pohyb mezi týdny">
              <button type="button" onClick={() => setWeekOffset((value) => value - 1)} aria-label="Předchozí týden">←</button>
              <button type="button" className="week-today-button" onClick={() => setWeekOffset(0)}>Tento týden</button>
              <button type="button" onClick={() => setWeekOffset((value) => value + 1)} aria-label="Další týden">→</button>
            </div>
          </header>

          <div className="week-calendar-grid">
            {days.map((date) => {
              const key = localDateKey(date);
              const isToday = key === todayKey;
              const isPast = key < todayKey;
              const { tasks: dayTasks, live } = tasksForDate(date);
              const plannedMinutes = dayTasks
                .filter((task) => !task.pending)
                .reduce((sum, task) => sum + Math.max(0, minutesBetween(task.start, task.end)), 0);
              const blockCount = dayTasks.filter((task) => !task.pending).length;
              return (
                <article className={`week-day ${isToday ? "today" : ""}`} key={key}>
                  <button
                    type="button"
                    className="week-day-header"
                    disabled={isPast}
                    onClick={() => openCaptureForDate(key)}
                    aria-label={isPast ? undefined : `Přidat úkol na ${new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(date)}`}
                  >
                    <div>
                      <span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date).replace(".", "")}</span>
                      <strong>{date.getDate()}</strong>
                    </div>
                    <span className="week-day-header-meta">
                      <small>{isToday ? "Dnes" : live ? "Plán" : "Šablona"}</small>
                      {!isPast && <em>+ Úkol</em>}
                    </span>
                  </button>

                  <div className="week-day-load">
                    <span>{blockCount} {blockCount === 1 ? "blok" : blockCount >= 2 && blockCount <= 4 ? "bloky" : "bloků"}</span>
                    <span>{Math.floor(plannedMinutes / 60)} h {plannedMinutes % 60 ? `${plannedMinutes % 60} min` : ""}</span>
                  </div>

                  <div className="week-day-tasks">
                    {dayTasks.length ? dayTasks.map((task) => {
                      const editable = task.source !== "template";
                      const content = (
                        <>
                          <span className="week-task-time">{task.pending && task.start === "99:99" ? "Čas doplní Dayframe" : `${task.start}–${task.end}`}</span>
                          <strong>{task.title}</strong>
                          <small>{task.pending ? `${task.category} · čeká` : task.category}</small>
                        </>
                      );
                      const className = `week-task ${task.fixed ? "week-task-fixed" : ""} ${task.completed ? "done" : ""} ${task.pending ? "pending" : ""} ${editable ? "editable" : ""}`;
                      return editable ? (
                        <button type="button" className={className} key={`${key}-${task.id}-${task.start}`} onClick={() => openTask(task, key)} aria-label={`Upravit úkol ${task.title}`}>
                          {content}
                        </button>
                      ) : (
                        <div className={className} key={`${key}-${task.id}-${task.start}`} title="Šablonový blok zatím není editovatelný">
                          {content}
                        </div>
                      );
                    }) : <p className="week-empty">Volno</p>}
                  </div>
                </article>
              );
            })}
          </div>

          <footer className="week-calendar-note">
            <span className="week-note-dot" />
            <p>Klikni na den pro nový úkol. Dnešek a zítřek jsou skutečný plán; ostatní bloky jsou zatím šablona.</p>
          </footer>
        </section>,
        mainHost,
      )}
    </>
  );
}
