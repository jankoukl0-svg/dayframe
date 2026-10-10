"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, HeartPulse } from "lucide-react";
import {
  addDays,
  addDaysKey,
  addMilestone,
  addTask,
  calendarBounds,
  canPlaceAt,
  createEmptyState,
  dateFromKey,
  deleteRoutine,
  deleteTask,
  durationBetween,
  getTasksForDate,
  localDateKey,
  planningDateKey,
  planningMinute,
  materializeRange,
  migrateStoredState,
  minutesToTime,
  moveTask,
  moveTaskToTomorrow,
  overdueTasks,
  replanWeek,
  startOfWeek,
  timeToMinutes,
  toggleTask,
  updateTask,
  weekKeys,
  type CalendarTask,
  type DayframeState,
  type Priority,
  type RepeatRule,
} from "@/lib/dayframe-calendar";
import { daysUntilDate, getDayCountdown } from "@/lib/dayframe-countdown";
import { parseSmartTaskInput } from "@/lib/dayframe-smart-input";
import { DailyChecklist } from "./daily-checklist";
import { HygienePage } from "./hygiene-page";
import { HealthPage } from "./health-page";
import { useGymStore } from "./use-gym-store";
import { assignmentsOnDate } from "@/lib/dayframe-gym";

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const MINUTE_HEIGHT = 0.72;
const DROP_MAGNET_RANGE = 60;
const COMPLETION_HOLD_MS = 680;
const COMPLETION_TOAST_MS = 5000;

type View = "today" | "week" | "focus" | "milestones" | "hygiene" | "health" | "settings";

type Draft = {
  title: string;
  date: string;
  duration: number;
  start: string;
  dueDate: string;
  deadlineTime: string;
  priority: Priority;
  category: string;
  repeat: RepeatRule;
};

type DragState = {
  id: string;
  date: string;
  duration: number;
  grabOffsetMinutes: number;
};

type DropPreview = {
  date: string;
  start: string;
  duration: number;
  valid: boolean;
};

type TaskCompletionToast = {
  id: string;
  title: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  date: "",
  duration: 45,
  start: "",
  dueDate: "",
  deadlineTime: "22:30",
  priority: "normal",
  category: "Studium",
  repeat: "none",
});

const categories = ["Studium", "Finance", "Matika", "Angličtina", "VŠE AJ", "Ekonomie", "Opakování", "Plánování", "Rutina", "Osobní"];

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function shortDate(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(dateFromKey(key));
}

function longDate(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(dateFromKey(key));
}

function totalMinutes(items: CalendarTask[]) {
  return items.filter((task) => task.start && task.end).reduce((sum, task) => sum + task.duration, 0);
}

function taskById(state: DayframeState, id: string) {
  for (const tasks of Object.values(state.plans)) {
    const task = tasks.find((item) => item.id === id);
    if (task) return task;
  }
  return null;
}

function cleanSmartTitle(value: string) {
  return parseSmartTaskInput(value).title || value.trim();
}

function dayLabel(key: string, today: string) {
  if (key === today) return "Dnes";
  if (key === addDaysKey(today, 1)) return "Zítra";
  return shortDate(key);
}

export function DayframeV2() {
  const [data, setData] = useState<DayframeState>(() => createEmptyState());
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(new Date());
  const [view, setView] = useState<View>("today");
  const [weekOffset, setWeekOffset] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [addingTask, setAddingTask] = useState(false);
  const [editing, setEditing] = useState<CalendarTask | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [focusTask, setFocusTask] = useState<CalendarTask | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(50 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(() => new Set());
  const [completingTaskSnapshots, setCompletingTaskSnapshots] = useState<Map<string, CalendarTask>>(() => new Map());
  const [completionToasts, setCompletionToasts] = useState<TaskCompletionToast[]>([]);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [hygieneRoutineFocus, setHygieneRoutineFocus] = useState<string | null>(null);
  const [healthRoutineFocus, setHealthRoutineFocus] = useState<string | null>(null);
  const [gymFocus, setGymFocus] = useState<{ key:string; date:string } | null>(null);
  const gym = useGymStore();
  const focusTimer = useRef<number | null>(null);
  const completionTimers = useRef<Map<string, number>>(new Map());
  const completionToastTimers = useRef<Map<string, number>>(new Map());
  const todayKey = planningDateKey(now);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => () => {
    completionTimers.current.forEach((timer) => window.clearTimeout(timer));
    completionToastTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const migrated = migrateStoredState(raw ? JSON.parse(raw) : null, new Date());
      const reference = new Date();
      const today = planningDateKey(reference);
      const ready = materializeRange(migrated, addDaysKey(today, -7), addDaysKey(today, 28), reference);
      setData(ready);
    } catch {
      const fresh = createEmptyState();
      const reference = new Date();
      const today = planningDateKey(reference);
      setData(materializeRange(fresh, addDaysKey(today, -7), addDaysKey(today, 28), reference));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const reference = new Date();
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const migrated = migrateStoredState(raw ? JSON.parse(raw) : null, reference);
        const today = planningDateKey(reference);
        const visibleMonday = addDays(startOfWeek(dateFromKey(today)), weekOffset * 7);
        const visibleKeys = weekKeys(visibleMonday);
        const rangeStart = visibleKeys[0] < addDaysKey(today, -7) ? visibleKeys[0] : addDaysKey(today, -7);
        const rangeEnd = visibleKeys[6] > addDaysKey(today, 28) ? visibleKeys[6] : addDaysKey(today, 28);
        setData(materializeRange(migrated, rangeStart, rangeEnd, reference));
      } catch {
        // Keep the current in-memory state if external storage is malformed.
      }
    };
    window.addEventListener(STATE_SYNC_EVENT, syncFromStorage);
    return () => window.removeEventListener(STATE_SYNC_EVENT, syncFromStorage);
  }, [weekOffset]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const monday = addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7);
    const keys = weekKeys(monday);
    setData((current) => materializeRange(current, keys[0], keys[6], new Date()));
  }, [weekOffset, hydrated, todayKey]);

  useEffect(() => {
    if (!focusRunning) return;
    focusTimer.current = window.setInterval(() => {
      setFocusSeconds((seconds) => {
        if (seconds <= 1) {
          setFocusRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => { if (focusTimer.current) window.clearInterval(focusTimer.current); };
  }, [focusRunning]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setAddingTask(false);
        setEditing(null);
        setEditingMilestoneId(null);
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "1") setView("today");
      if (event.key.toLowerCase() === "w") setView("week");
      if (event.key === "2") openAdd();
      if (event.key === "3") setView("focus");
      if (event.key === "4") setView("milestones");
      if (event.key === "5") setView("settings");
      if (event.key === "6") setView("hygiene");
      if (event.key === "7") setView("health");
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  const todayTasks = useMemo(() => getTasksForDate(data, todayKey), [data, todayKey]);
  const visualTodayTasks = useMemo(
    () => todayTasks.map((task) => completingTaskSnapshots.get(task.id) ?? task),
    [todayTasks, completingTaskSnapshots],
  );
  const scheduledToday = visualTodayTasks.filter((task) => task.start && task.end && !task.completed);
  const currentMinute = planningMinute(now);
  const activeTask = scheduledToday.find((task) =>
    timeToMinutes(task.start) <= currentMinute && timeToMinutes(task.end) > currentMinute,
  ) ?? null;
  const missed = visualTodayTasks.filter((task) => !task.completed && task.end && timeToMinutes(task.end) <= currentMinute);
  const missedIds = new Set(missed.map((task) => task.id));
  const afterActive = visualTodayTasks
    .filter((task) => !task.completed && task.id !== activeTask?.id && !missedIds.has(task.id))
    .sort((left, right) => {
      if (left.start && right.start) return timeToMinutes(left.start) - timeToMinutes(right.start);
      if (left.start) return -1;
      if (right.start) return 1;
      return left.title.localeCompare(right.title, "cs");
    });

  const nextPlannedTask = useMemo(() => Object.entries(data.plans)
    .flatMap(([date, tasks]) => tasks
      .filter((task) => !task.completed && task.start && date > todayKey)
      .map((task) => ({ ...task, date })))
    .sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date);
      return dateOrder || timeToMinutes(left.start) - timeToMinutes(right.start);
    })[0] ?? null, [data.plans, todayKey]);

  const monday = useMemo(() => addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7), [weekOffset, todayKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(monday, index)), [monday]);
  const weekLabel = `${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;

  function openAdd(date = "", start = "") {
    setDraft({ ...emptyDraft(), date, start });
    setError("");
    setNotice("");
    setAddingTask(true);
  }

  function closeAdd() {
    setAddingTask(false);
    setDraft(emptyDraft());
    setError("");
  }

  function requestTaskCompletion(id: string) {
    const task = taskById(data, id);
    if (!task) return;

    if (task.completed) {
      setData((current) => toggleTask(current, id));
      setEditing(null);
      return;
    }

    const existing = completionTimers.current.get(id);
    if (existing) window.clearTimeout(existing);

    setCompletingTaskIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setCompletingTaskSnapshots((current) => {
      const next = new Map(current);
      next.set(id, { ...task });
      return next;
    });

    // Persist the completion immediately. The visual hold below only keeps a
    // temporary ghost/modal on screen; it must never be responsible for data durability.
    setData((current) => {
      const currentTask = taskById(current, id);
      return currentTask && !currentTask.completed ? toggleTask(current, id) : current;
    });

    const oldToastTimer = completionToastTimers.current.get(id);
    if (oldToastTimer) window.clearTimeout(oldToastTimer);
    setCompletionToasts((current) => [...current.filter((item) => item.id !== id), { id, title: task.title }]);
    const toastTimer = window.setTimeout(() => {
      setCompletionToasts((current) => current.filter((item) => item.id !== id));
      completionToastTimers.current.delete(id);
    }, COMPLETION_TOAST_MS);
    completionToastTimers.current.set(id, toastTimer);

    const timer = window.setTimeout(() => {
      setCompletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setCompletingTaskSnapshots((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      completionTimers.current.delete(id);
      setEditing((current) => current?.id === id ? null : current);
    }, COMPLETION_HOLD_MS);

    completionTimers.current.set(id, timer);
  }

  function undoTaskCompletion(id: string) {
    const pending = completionTimers.current.get(id);
    if (pending) {
      window.clearTimeout(pending);
      completionTimers.current.delete(id);
    }

    setData((current) => {
      const task = taskById(current, id);
      return task?.completed ? toggleTask(current, id) : current;
    });

    setCompletingTaskIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setCompletingTaskSnapshots((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setCompletionToasts((current) => current.filter((item) => item.id !== id));
    const toastTimer = completionToastTimers.current.get(id);
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      completionToastTimers.current.delete(id);
    }
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!draft.title.trim()) return;
    const parsed = parseSmartTaskInput(draft.title);
    const parsedDate = parsed.day === "today" ? todayKey : parsed.day === "tomorrow" ? addDaysKey(todayKey, 1) : "";
    const start = draft.start || parsed.start || "";
    if (draft.repeat !== "none" && !start) {
      setError("Opakovaný blok potřebuje konkrétní čas.");
      return;
    }
    const effective = {
      title: parsed.title || draft.title.trim(),
      date: draft.date || parsedDate || undefined,
      duration: draft.duration === 45 && parsed.duration ? parsed.duration : draft.duration,
      start: start || undefined,
      dueDate: draft.dueDate || undefined,
      deadlineTime: draft.deadlineTime === "22:30" && parsed.deadline ? parsed.deadline : draft.deadlineTime,
      priority: draft.priority === "normal" && parsed.priority ? parsed.priority : draft.priority,
      category: draft.category,
      repeat: draft.repeat,
    };
    const result = addTask(data, effective, now);
    setData(result.state);
    setNotice(result.status === "scheduled"
      ? `${effective.title} · ${dayLabel(result.task.date, todayKey)}${result.task.start ? ` · ${result.task.start}–${result.task.end}` : ""}`
      : `${effective.title} je uložený, ale zatím nemá volný čas.`);
    setDraft(emptyDraft());
    setAddingTask(false);
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") || editing.date);
    const duration = Number(form.get("duration")) || editing.duration;
    const start = String(form.get("start") || "");
    const result = updateTask(data, editing.id, {
      title: String(form.get("title") || editing.title).trim(),
      date,
      duration,
      start: start || undefined,
      end: start ? minutesToTime(timeToMinutes(start) + duration) : undefined,
      mode: "flexible",
      requestedStart: start || undefined,
      dateLocked: true,
      priority: String(form.get("priority")) as Priority,
      category: String(form.get("category") || editing.category),
      dueDate: String(form.get("dueDate") || "") || undefined,
      deadlineTime: String(form.get("deadlineTime") || "22:30"),
      autoScheduled: !start,
    }, now);
    if (result.error) {
      setError(result.error);
      return;
    }
    setData(result.state);
    setEditing(null);
  }

  function nearestOpenDrop(date: string, desiredStart: number, duration: number, id: string) {
    const min = calendarBounds.dayStart;
    const max = calendarBounds.dayEnd - duration;
    const rounded = Math.max(min, Math.min(max, Math.round(desiredStart / calendarBounds.slot) * calendarBounds.slot));
    const destination = getTasksForDate(data, date).filter((task) => task.id !== id);
    const offsets = [0, -15, 15, -30, 30, -45, 45, -60, 60];
    for (const offset of offsets) {
      if (Math.abs(offset) > DROP_MAGNET_RANGE) continue;
      const candidate = rounded + offset;
      if (candidate < min || candidate > max) continue;
      if (canPlaceAt(destination, candidate, duration)) return candidate;
    }
    return null;
  }

  function previewForPointer(event: React.DragEvent<HTMLDivElement>, date: string): DropPreview | null {
    if (!dragging) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerMinute = calendarBounds.dayStart + (event.clientY - rect.top) / MINUTE_HEIGHT;
    const desiredStart = pointerMinute - dragging.grabOffsetMinutes;
    const fallback = Math.max(
      calendarBounds.dayStart,
      Math.min(calendarBounds.dayEnd - dragging.duration, Math.round(desiredStart / calendarBounds.slot) * calendarBounds.slot),
    );
    const snapped = nearestOpenDrop(date, desiredStart, dragging.duration, dragging.id);
    return {
      date,
      start: minutesToTime(snapped ?? fallback),
      duration: dragging.duration,
      valid: snapped !== null,
    };
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const preview = previewForPointer(event, date);
    if (!preview) return;
    setDropPreview((current) => current?.date === preview.date
      && current.start === preview.start
      && current.valid === preview.valid
      && current.duration === preview.duration
      ? current
      : preview);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    if (!dragging) return;
    const preview = previewForPointer(event, date);
    if (!preview?.valid) {
      setDragging(null);
      setDropPreview(null);
      setNotice("Tady není volný 15min slot poblíž. Blok zůstal na původním místě.");
      return;
    }
    const result = moveTask(data, dragging.id, date, preview.start);
    setDragging(null);
    setDropPreview(null);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    setData(result.state);
  }

  function startFocus(task: CalendarTask | null) {
    setFocusTask(task);
    setFocusSeconds(50 * 60);
    setFocusRunning(true);
    setView("focus");
  }

  function addNewMilestone(event: React.FormEvent) {
    event.preventDefault();
    if (!milestoneTitle.trim() || !milestoneDate) return;
    setData((current) => addMilestone(current, milestoneTitle, milestoneDate));
    setMilestoneTitle("");
    setMilestoneDate("");
  }

  function saveMilestoneEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMilestoneId) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const date = String(form.get("date") || "");
    const note = String(form.get("note") || "").trim();
    if (!title || !date) return;
    setData((current) => ({
      ...current,
      milestones: current.milestones
        .map((milestone) => milestone.id === editingMilestoneId
          ? { ...milestone, title, date, note: note || "Vlastní termín" }
          : milestone)
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setEditingMilestoneId(null);
  }

  function removeMilestone(id: string) {
    setData((current) => ({ ...current, milestones: current.milestones.filter((milestone) => milestone.id !== id) }));
    setEditingMilestoneId(null);
  }

  const editingMilestone = editingMilestoneId
    ? data.milestones.find((milestone) => milestone.id === editingMilestoneId) ?? null
    : null;

  return (
    <main className={`df2-root ${view === "focus" ? "df2-focus-mode" : ""}`}>
      <div className="df2-shell">
        <aside className="df2-sidebar">
          <button className="df2-brand" onClick={() => setView("today")}><span>D</span><strong>Dayframe</strong></button>
          <nav>
            <NavButton active={view === "today"} onClick={() => setView("today")} label="Dnes" shortcut="1" />
            <NavButton active={view === "week"} onClick={() => setView("week")} label="Týden" shortcut="W" />
            <NavButton active={view === "milestones"} onClick={() => setView("milestones")} label="Milníky" shortcut="4" />
            <NavButton active={view === "hygiene"} onClick={() => { setHygieneRoutineFocus(null); setView("hygiene"); }} label="Hygiena" shortcut="6" icon={<Droplets size={14} aria-hidden="true" />} />
            <NavButton active={view === "health"} onClick={() => { setHealthRoutineFocus(null); setView("health"); }} label="Zdraví" shortcut="7" icon={<HeartPulse size={14} aria-hidden="true" />} />
            <NavButton active={view === "settings"} onClick={() => setView("settings")} label="Nastavení" shortcut="5" />
          </nav>
          <div className="df2-sidebar-bottom"><span>Den končí</span><strong>02:00</strong></div>
        </aside>

        <section className="df2-main">
          {view === "today" && (
            <TodayView
              now={now}
              tasks={todayTasks}
              activeTask={activeTask}
              nextTasks={afterActive}
              nextPlannedTask={nextPlannedTask}
              missed={missed}
              milestones={data.milestones}
              onAdd={() => openAdd(todayKey)}
              onEdit={setEditing}
              onDone={requestTaskCompletion}
              completingTaskIds={completingTaskIds}
              onTomorrow={(id) => setData((current) => moveTaskToTomorrow(current, id, now))}
              onDelete={(id) => setData((current) => deleteTask(current, id))}
              onFocus={startFocus}
              onMilestones={() => setView("milestones")}
              onOpenHygiene={(routineId) => {
                setHygieneRoutineFocus(routineId);
                setView("hygiene");
              }}
              onOpenHealth={(routineId) => {
                setHealthRoutineFocus(routineId);
                setView("health");
              }}
              onOpenGym={(key,date) => { setGymFocus({key,date}); setView("health"); }}
            />
          )}

          {view === "hygiene" && (
            <HygienePage
              planningKey={todayKey}
              focusRoutineId={hygieneRoutineFocus}
              onFocusHandled={() => setHygieneRoutineFocus(null)}
            />
          )}

          {view === "health" && (
            <HealthPage planningKey={todayKey} focusRoutineId={healthRoutineFocus}
              onFocusHandled={() => setHealthRoutineFocus(null)} focusGymKey={gymFocus?.key} focusGymDate={gymFocus?.date} />
          )}

          {view === "week" && (
            <section className="df2-week-view">
              <header className="df2-page-head">
                <div><p>{weekLabel}</p><h1>Týden</h1></div>
                <div className="df2-week-controls">
                  <button onClick={() => setWeekOffset((value) => value - 1)}>←</button>
                  <button onClick={() => setWeekOffset(0)}>Tento týden</button>
                  <button onClick={() => setWeekOffset((value) => value + 1)}>→</button>
                  <button className="df2-accent-button" onClick={() => setData((current) => replanWeek(current, monday, now))}>Přepočítat týden</button>
                </div>
              </header>
              {notice && <div className="df2-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
              <div className="df2-week-scroll">
                <div className="df2-week-grid">
                  {days.map((day) => {
                    const key = localDateKey(day);
                    const tasks = getTasksForDate(data, key);
                    const unscheduled = tasks.filter((task) => !task.start);
                    const scheduled = tasks.filter((task) => task.start && task.end);
                    return (
                      <article className={`df2-week-day ${key === todayKey ? "today" : ""}`} key={key}>
                        <header className="df2-week-day-head" onClick={() => key >= todayKey && openAdd(key)}>
                          <div><span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(day).replace(".", "")}</span><strong>{day.getDate()}</strong></div>
                          <button disabled={key < todayKey} onClick={(event) => { event.stopPropagation(); openAdd(key); }}>+</button>
                        </header>
                        <div className="df2-unscheduled">
                          {unscheduled.map((task) => <button key={task.id} onClick={() => setEditing(task)}>{task.title}<small>bez času</small></button>)}
                          {assignmentsOnDate(gym.store,key).map(occ => (
                            <button type="button" key={occ.key} data-week-gym={occ.key} className="df2-week-gym"
                              onClick={()=>{setGymFocus({key:occ.key,date:key});setView("health");}}>
                              <strong>{occ.name}</strong><small>{occ.completed?"✓ Gym · Hotovo":occ.session?"Gym · Rozpracováno":"Gym · bez času"}</small>
                            </button>
                          ))}
                        </div>
                        <div
                          className={`df2-time-body ${dropPreview?.date === key ? "drop-active" : ""}`}
                          style={{ height: `${(calendarBounds.dayEnd - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}
                          onDragOver={(event) => onDragOver(event, key)}
                          onDrop={(event) => onDrop(event, key)}
                        >
                          {Array.from({ length: Math.floor((calendarBounds.dayEnd - calendarBounds.dayStart) / 60) + 1 }, (_, index) => {
                            const minute = calendarBounds.dayStart + index * 60;
                            return <span className="df2-hour-line" key={minute} style={{ top: `${index * 60 * MINUTE_HEIGHT}px` }}><em>{minutesToTime(minute)}</em></span>;
                          })}
                          <div className="df2-lunch" style={{ top: `${(calendarBounds.lunchStart - calendarBounds.dayStart) * MINUTE_HEIGHT}px`, height: `${60 * MINUTE_HEIGHT}px` }}><span>oběd</span></div>
                          {dropPreview?.date === key && (
                            <div
                              className={`df2-drop-preview ${dropPreview.valid ? "valid" : "invalid"}`}
                              style={{
                                top: `${(timeToMinutes(dropPreview.start) - calendarBounds.dayStart) * MINUTE_HEIGHT}px`,
                                height: `${dropPreview.duration * MINUTE_HEIGHT}px`,
                              }}
                              aria-hidden="true"
                            >
                              <strong>{dropPreview.valid ? dropPreview.start : "není místo"}</strong>
                            </div>
                          )}
                          {scheduled.map((task) => {
                            const top = (timeToMinutes(task.start) - calendarBounds.dayStart) * MINUTE_HEIGHT;
                            const height = task.duration * MINUTE_HEIGHT;
                            return (
                              <button
                                key={task.id}
                                className={`df2-week-task ${task.completed ? "done" : ""}`}
                                style={{ top: `${top}px`, height: `${height}px` }}
                                draggable={!task.completed}
                                onDragStart={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const grabPixels = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                                  const grabOffsetMinutes = Math.max(0, Math.min(task.duration, grabPixels / MINUTE_HEIGHT));
                                  event.dataTransfer.effectAllowed = "move";
                                  setDragging({ id: task.id, date: key, duration: task.duration, grabOffsetMinutes });
                                  setDropPreview({ date: key, start: task.start ?? minutesToTime(calendarBounds.dayStart), duration: task.duration, valid: true });
                                }}
                                onDragEnd={() => { setDragging(null); setDropPreview(null); }}
                                onClick={() => setEditing(task)}
                                title="Přetáhni blok na jiný čas"
                              >
                                <span>{task.start}–{task.end}</span>
                                <strong>{task.title}</strong>
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {view === "focus" && (
            <section className="df2-focus-view">
              <p>{focusTask ? `${focusTask.start ?? ""} · ${focusTask.category}` : "Focus blok"}</p>
              <h1>{focusTask?.title ?? activeTask?.title ?? "Soustředění"}</h1>
              <div className="df2-focus-clock">{String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:{String(focusSeconds % 60).padStart(2, "0")}</div>
              <div className="df2-focus-actions"><button onClick={() => setFocusRunning((value) => !value)}>{focusRunning ? "Pozastavit" : "Spustit"}</button><button onClick={() => { setFocusSeconds(50 * 60); setFocusRunning(false); }}>Začít znovu</button></div>
            </section>
          )}

          {view === "milestones" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><h1>Milníky</h1></div></header>
              <form className="df2-inline-form" onSubmit={addNewMilestone}><input placeholder="Nový milník" value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} /><input type="date" value={milestoneDate} onChange={(event) => setMilestoneDate(event.target.value)} /><button>Přidat</button></form>
              <div className="df2-milestones">{[...data.milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone) => <article key={milestone.id} role="button" tabIndex={0} title="Upravit milník" onClick={() => setEditingMilestoneId(milestone.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingMilestoneId(milestone.id); } }}><div>{milestone.note !== "Vlastní termín" && <span>{milestone.note}</span>}<strong>{milestone.title}</strong></div><div className="df2-milestone-remaining"><strong>{daysUntilDate(milestone.date, now)}</strong><span>dní</span></div><time>{longDate(milestone.date)}</time></article>)}</div>
            </section>
          )}

          {view === "settings" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><h1>Nastavení</h1></div></header>
              <div className="df2-settings-card"><div><strong>Pracovní den</strong><span>{minutesToTime(calendarBounds.dayStart)}–{minutesToTime(calendarBounds.dayEnd)} · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>02:00</span></div><div><strong>Auto-plánování</strong><span>Týden · 15 min · standardně do 22:30</span></div></div>
              <section className="df2-routines"><div className="df2-section-head"><h2>Opakující se rutiny</h2><button onClick={() => openAdd()}>+ Nová rutina</button></div>{data.routines.map((routine) => <article key={routine.id}><div><strong>{routine.title}</strong><small>{routine.frequency === "daily" ? "každý den" : "každý týden"}{routine.start ? ` · ${routine.start}` : ""} · {routine.duration} min</small></div><label><input type="checkbox" checked={routine.active} onChange={(event) => setData((current) => ({ ...current, routines: current.routines.map((item) => item.id === routine.id ? { ...item, active: event.target.checked } : item) }))} /> aktivní</label><button onClick={() => setData((current) => deleteRoutine(current, routine.id))}>Smazat</button></article>)}</section>
            </section>
          )}
        </section>
      </div>

      {addingTask && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdd(); }}>
          <form className="df2-modal df2-add-modal df2-add-form" role="dialog" aria-modal="true" aria-labelledby="df2-add-task-title" onSubmit={submitDraft}>
            <header><div><h2 id="df2-add-task-title">Přidat úkol</h2></div><button type="button" aria-label="Zavřít" onClick={closeAdd}>×</button></header>
            <label className="df2-title-input"><span>Úkol</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Např. zeměpis 20 min" /></label>
            <div className="df2-chips" aria-label="Rychlá nastavení">
              <label><span>Den</span><input type="date" value={draft.date} min={todayKey} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
              <label><span>Délka</span><select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })}><option value={20}>20 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
              <label><span>Začít v</span><input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
              <label><span>Priorita</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="normal">Běžná</option><option value="high">Vysoká</option><option value="low">Nízká</option></select></label>
            </div>
            <details className="df2-details">
              <summary>Podrobnosti</summary>
              <div className="df2-details-grid">
                <label>Dokončit do<input type="date" value={draft.dueDate} min={todayKey} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                <label>Nejpozději v<input type="time" value={draft.deadlineTime} onChange={(event) => setDraft({ ...draft, deadlineTime: event.target.value })} /></label>
                <label>Oblast<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label>Opakování<select value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value as RepeatRule })}><option value="none">Neopakovat</option><option value="daily">Každý den</option><option value="weekly">Každý týden</option></select></label>
              </div>
            </details>
            {draft.title.trim() && <div className="df2-understood"><strong>{cleanSmartTitle(draft.title)}</strong><small>{draft.date ? shortDate(draft.date) : "Tento týden"} · {draft.duration} min{draft.start ? ` · ${draft.start}` : " · automaticky"}</small></div>}
            {error && <p className="df2-error">{error}</p>}
            <div className="df2-modal-actions"><button className="df2-primary" type="submit" disabled={!hydrated || !draft.title.trim()}>Naplánovat</button><button type="button" onClick={closeAdd}>Zrušit</button></div>
          </form>
        </div>
      )}

      {editingMilestone && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingMilestoneId(null); }}>
          <form className="df2-modal" onSubmit={saveMilestoneEdit}>
            <header><div><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>
            <label>Název<input name="title" autoFocus defaultValue={editingMilestone.title} /></label>
            <div className="df2-form-grid"><label>Datum<input name="date" type="date" defaultValue={editingMilestone.date} /></label><label>Popisek<input name="note" defaultValue={editingMilestone.note} placeholder="Např. hlavní termín" /></label></div>
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="button" className="danger" onClick={() => removeMilestone(editingMilestone.id)}>Smazat milník</button></div>
          </form>
        </div>
      )}

      {editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <form className="df2-modal" onSubmit={saveEdit}>
            <header><div><h2>Upravit</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
            <label>Název<input name="title" defaultValue={editing.title} /></label>
            <div className="df2-form-grid"><label>Den<input name="date" type="date" defaultValue={editing.date} /></label><label>Délka<input name="duration" type="number" min="15" step="5" defaultValue={editing.duration} /></label></div>
            <label>Začátek<input name="start" type="time" defaultValue={editing.start ?? ""} /><small>Prázdné = Dayframe najde volný čas automaticky.</small></label>
            <div className="df2-form-grid"><label>Priorita<select name="priority" defaultValue={editing.priority}><option value="high">Vysoká</option><option value="normal">Běžná</option><option value="low">Nízká</option></select></label><label>Oblast<select name="category" defaultValue={editing.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
            <div className="df2-form-grid"><label>Dokončit do<input name="dueDate" type="date" defaultValue={editing.dueDate ?? ""} /></label><label>Nejpozději v<input name="deadlineTime" type="time" defaultValue={editing.deadlineTime ?? "22:30"} /></label></div>
            {error && <p className="df2-error">{error}</p>}
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button
                type="button"
                className={`df2-completion-action ${completingTaskIds.has(editing.id) ? "is-completing" : ""}`}
                disabled={completingTaskIds.has(editing.id)}
                onClick={() => requestTaskCompletion(editing.id)}
              >
                {editing.completed ? "Vrátit jako nesplněné" : completingTaskIds.has(editing.id) ? "✓ Hotovo" : "Označit hotovo"}
              </button><button type="button" className="danger" onClick={() => { setData((current) => deleteTask(current, editing.id)); setEditing(null); }}>Smazat</button></div>
          </form>
        </div>
      )}
      {completionToasts.length > 0 && (
        <div className="df2-completion-toast-stack" aria-label="Nedávno dokončené úkoly">
          {completionToasts.map((toast) => (
            <div className="df2-completion-toast" role="status" aria-live="polite" key={toast.id}>
              <span className="df2-completion-mark" aria-hidden="true">✓</span>
              <div>
                <strong>Úkol dokončen</strong>
                <small>{toast.title}</small>
              </div>
              <button type="button" onClick={() => undoTaskCompletion(toast.id)}>Vrátit</button>
            </div>
          ))}
        </div>
      )}

    </main>
  );
}

function NavButton({ active, onClick, label, shortcut, icon }: { active: boolean; onClick: () => void; label: string; shortcut: string; icon?: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}{label}</span><kbd>{shortcut}</kbd></button>;
}

function TodayView({
  now, tasks, activeTask, nextTasks, nextPlannedTask, missed, milestones, onAdd, onEdit, onDone, onTomorrow, onDelete, onFocus, onMilestones, onOpenHygiene, onOpenHealth, onOpenGym, completingTaskIds,
}: {
  now: Date;
  tasks: CalendarTask[];
  activeTask: CalendarTask | null;
  nextTasks: CalendarTask[];
  nextPlannedTask: CalendarTask | null;
  missed: CalendarTask[];
  milestones: DayframeState["milestones"];
  onAdd: () => void;
  onEdit: (task: CalendarTask) => void;
  onDone: (id: string) => void;
  onTomorrow: (id: string) => void;
  onDelete: (id: string) => void;
  onFocus: (task: CalendarTask | null) => void;
  onMilestones: () => void;
  onOpenHygiene: (routineId: string) => void;
  onOpenHealth: (routineId: string) => void;
  onOpenGym: (key: string,date:string) => void;
  completingTaskIds: ReadonlySet<string>;
}) {
  const [checklistSummary, setChecklistSummary] = useState({ planningKey: "", completed: 0, total: 0, hydrated: false, blocked: false });
  const completed = tasks.filter((task) => task.completed).length;
  const unscheduled = tasks.filter((task) => !task.start && !task.completed).length;
  const taskProgress = tasks.length ? (completed / tasks.length) * 100 : 0;
  const checklistDone = checklistSummary.total === 0 || checklistSummary.completed === checklistSummary.total;
  const today = planningDateKey(now);
  const dayComplete = checklistSummary.hydrated
    && checklistSummary.planningKey === today
    && !checklistSummary.blocked
    && completingTaskIds.size === 0
    && missed.length === 0
    && (tasks.length > 0 || checklistSummary.total > 0)
    && completed === tasks.length
    && checklistDone;
  const countdown = getDayCountdown(now);
  const nextMilestone = [...milestones]
    .filter((milestone) => milestone.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const countdownText = `${String(countdown.hours).padStart(2, "0")}:${String(countdown.minutes).padStart(2, "0")}`;
  const futureTaskText = nextPlannedTask?.start
    ? `Další blok: ${dayLabel(nextPlannedTask.date, today)} v ${nextPlannedTask.start} · ${nextPlannedTask.title}`
    : "";

  const emptyState = activeTask
    ? {
        title: "Po tomto bloku máš volno.",
        detail: futureTaskText || "Další naplánovaný blok dnes nemáš.",
        kind: "free",
      }
    : missed.length > 0
      ? {
          title: "Další dnešní bloky nejsou.",
          detail: `Nedokončené úkoly: ${missed.length}.`,
          kind: "missed",
        }
      : tasks.length > 0 && completed === tasks.length
        ? {
            title: "Dnes máš hotovo.",
            detail: futureTaskText || "Zbytek dne je volný.",
            kind: "done",
          }
        : tasks.length === 0
          ? {
              title: "Dnes nemáš nic naplánováno.",
              detail: futureTaskText || "Můžeš si nechat den volný nebo přidat nový úkol.",
              kind: "free",
            }
          : {
              title: "Zbytek dne je volný.",
              detail: futureTaskText || "Další naplánovaný blok dnes nemáš.",
              kind: "free",
            };

  return (
    <section className={`df2-today-view ${dayComplete ? "is-complete" : ""}`}>
      <header className="df2-page-head"><div><p>{formatDay(dateFromKey(today))}</p><h1>Dnes</h1></div><button className="df2-accent-button" onClick={onAdd}>+ Nový úkol</button></header>

      <div className="df2-motivation-grid">
        <section className="df2-day-ruler" aria-label="Odpočet do konce dne">
          <div className="df2-day-ruler-copy">
            <span>Do konce dne</span>
            <strong aria-label={`${countdown.hours} hodin ${countdown.minutes} minut ${countdown.seconds} sekund`}>{countdownText}<em>:{String(countdown.seconds).padStart(2, "0")}</em></strong>
          </div>
          <div className="df2-day-track" aria-hidden="true"><span style={{ width: `${countdown.progressPercent}%` }} /><i style={{ left: `${countdown.progressPercent}%` }} /></div>
          <div className="df2-day-scale" aria-hidden="true"><span>08</span><span>12</span><span>16</span><span>20</span><span>00</span><span>02</span></div>
        </section>

        <button type="button" className="df2-event-countdown" onClick={onMilestones} aria-label={nextMilestone ? `Nejbližší termín ${nextMilestone.title}, zbývá ${daysUntilDate(nextMilestone.date, now)} dní` : "Přidat důležitý termín"}>
          <span>Nejbližší termín</span>
          {nextMilestone ? <><strong>{daysUntilDate(nextMilestone.date, now)}<em>dní</em></strong><b>{nextMilestone.title}</b><small>{longDate(nextMilestone.date)}</small></> : <><strong>—</strong><b>Přidat milník</b></>}
        </button>
      </div>

      <section className={`df2-now-card ${activeTask && completingTaskIds.has(activeTask.id) ? "is-completing" : ""}`}>
        <div className="df2-now-main">
          <div className="df2-now-label">
            <span>Teď</span>
            <small>{activeTask?.start && activeTask.end ? `${activeTask.start}–${activeTask.end}` : "volno"}</small>
          </div>
          {activeTask ? (
            <div className="df2-now-copy">
              <h2>{activeTask.title}</h2>
              <p>{activeTask.duration} min</p>
            </div>
          ) : (
            <div className="df2-now-copy">
              <h2>Volno</h2>
              <p>Žádný aktivní blok</p>
            </div>
          )}
        </div>
        {activeTask && (
          <div className="df2-now-actions">
            {completingTaskIds.has(activeTask.id)
              ? <span className="df2-now-completing">✓ Hotovo</span>
              : <button className="df2-now-edit" onClick={() => onEdit(activeTask)}>Upravit</button>}
          </div>
        )}
      </section>
      <DailyChecklist planningKey={today} onSummaryChange={setChecklistSummary} onOpenHygiene={onOpenHygiene} onOpenHealth={onOpenHealth} onOpenGym={onOpenGym} />

      {dayComplete && (
        <section className="df2-day-complete" aria-live="polite">
          <span className="df2-completion-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Dnešek hotový</strong>
            <small>{completed} úkolů · checklist {checklistSummary.completed}/{checklistSummary.total}</small>
          </div>
        </section>
      )}

      <section className="df2-next df2-today-plan">
        <div className="df2-section-head">
          <div>
            <h2>Dnes</h2>
            <div
              className="df2-section-progress"
              role="progressbar"
              aria-label="Dokončené dnešní úkoly"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={completed}
            >
              <span style={{ width: `${taskProgress}%` }} />
            </div>
          </div>
          <span>{completed}/{tasks.length} úkolů{unscheduled ? ` · ${unscheduled} bez času` : ""}</span>
        </div>
        {nextTasks.length ? nextTasks.map((task) => (
          <button
            key={task.id}
            className={completingTaskIds.has(task.id) ? "is-completing" : ""}
            onClick={() => onEdit(task)}
          >
            <time>{task.start ?? "—"}</time>
            <span>
              <strong>{task.title}</strong>
              <small>{task.duration} min{task.start ? "" : " · bez času"}</small>
            </span>
          </button>
        )) : (
          <div className={`df2-empty df2-empty-state is-${emptyState.kind}`} role="status">
            <strong>{emptyState.title}</strong>
            <span>{emptyState.detail}</span>
          </div>
        )}
      </section>

      {missed.length > 0 && (
        <section className="df2-missed">
          <header><strong>Nedokončeno · {missed.length}</strong></header>
          {missed.map((task) => (
            <article key={task.id} className={completingTaskIds.has(task.id) ? "is-completing" : ""}>
              <div><strong>{task.title}</strong><small>do {task.end}</small></div>
              <div>
                <button
                  className={`df2-missed-complete ${completingTaskIds.has(task.id) ? "is-completing" : ""}`}
                  disabled={completingTaskIds.has(task.id)}
                  onClick={() => onDone(task.id)}
                >
                  {completingTaskIds.has(task.id) ? "✓ Hotovo" : "Hotovo"}
                </button>
                <button onClick={() => onTomorrow(task.id)}>Na zítra</button>
                <button onClick={() => onDelete(task.id)}>Zrušit</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}