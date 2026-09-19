"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  milestoneProgress,
  planMilestone,
  saveRoutine,
  routineLabel,
  type Routine,
  setRoutineActive,
  retryBacklog,
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
import { resolveSmartDraft } from "@/lib/dayframe-smart-input";

import { BACKUP_KEY, STORAGE_KEY, decodeBackup, encodeBackup, loadCalendar, saveCalendar } from "@/lib/dayframe-storage";
import { FOCUS_KEY, breakFocus, extendFocus, resumeWork, focusRemaining, pauseFocus, readFocus, type FocusSession } from "@/lib/dayframe-focus";

const MINUTE_HEIGHT = 0.72;
const DROP_MAGNET_RANGE = 60;

type View = "today" | "week" | "add" | "focus" | "milestones" | "settings";

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
  milestoneId: string;
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
  milestoneId: "",
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

function dayLabel(key: string, today: string) {
  if (key === today) return "Dnes";
  if (key === addDaysKey(today, 1)) return "Zítra";
  return shortDate(key);
}

export function DayframeV2() {
  const [calendar, setCalendar] = useState<{ data: DayframeState; history: DayframeState[] }>(() => ({ data: createEmptyState(), history: [] }));
  const data = calendar.data;
  const [pendingImport, setPendingImport] = useState<{ state: DayframeState; name: string } | null>(null);
  const [backupError, setBackupError] = useState("");
  const rawRecovery = useRef<string | null>(null);
  function setData(update: DayframeState | ((current: DayframeState) => DayframeState)) {
    if (storageBlocked) return;
    setCalendar(current => {
      const next = typeof update === "function" ? update(current.data) : update;
      if (next === current.data) return current;
      return { data: next, history: [...current.history, current.data].slice(-20) };
    });
  }
  function setLoadedData(update: DayframeState | ((current: DayframeState) => DayframeState)) {
    setCalendar(current => ({ ...current, data: typeof update === "function" ? update(current.data) : update }));
  }
  function undo() {
    if (storageBlocked) return;
    setCalendar(current => current.history.length ? { data: current.history[current.history.length - 1], history: current.history.slice(0, -1) } : current);
    setEditing(null); setEditingMilestoneId(null); setRoutineDraft(null); setPreparation(null); setNotice("");
  }

  const [storageBlocked, setStorageBlocked] = useState("");
  const [storageError, setStorageError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(new Date());
  const [view, setView] = useState<View>("today");
  const [weekOffset, setWeekOffset] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [manual, setManual] = useState<Partial<Record<"date" | "start" | "duration" | "priority" | "deadlineTime", boolean>>>({});
  const [editing, setEditing] = useState<CalendarTask | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [preparation, setPreparation] = useState<ReturnType<typeof planMilestone> | null>(null);
  const [milestoneError, setMilestoneError] = useState("");
  const [routineDraft, setRoutineDraft] = useState<Routine | null>(null);
  const [routineError, setRoutineError] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const todayKey = localDateKey(now);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const loaded = loadCalendar(window.localStorage);
    const today = localDateKey(new Date());
    rawRecovery.current = loaded.raw;
    setLoadedData(materializeRange(loaded.state, today, addDaysKey(today, 28), new Date()));
    setStorageBlocked(loaded.blocked);
    if (loaded.blocked) { setLoadedData({ ...loaded.state, plans: {}, backlog: [], routines: [], milestones: [] }); setView("settings"); }
    try { setFocus(readFocus(window.localStorage.getItem(FOCUS_KEY))); } catch { /* Calendar recovery remains available. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || storageBlocked) return;
    setStorageError(saveCalendar(window.localStorage, data));
  }, [data, hydrated, storageBlocked]);

  useEffect(() => {
    if (!hydrated) return;
    const monday = addDays(startOfWeek(now), weekOffset * 7);
    const keys = weekKeys(monday);
    setLoadedData((current) => materializeRange(current, keys[0], keys[6], new Date()));
  }, [weekOffset, hydrated, todayKey]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(FOCUS_KEY, JSON.stringify(focus)); }
    catch { setStorageError("Časovač se nepodařilo uložit. Nezavírej stránku během soustředění."); }
  }, [focus, hydrated]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "1") setView("today");
      if (event.key.toLowerCase() === "w") setView("week");
      if (event.key === "2") openAdd();
      if (event.key === "3") setView("focus");
      if (event.key === "4") setView("milestones");
      if (event.key === "5") setView("settings");
      if (event.key === "Escape") {
        setEditing(null);
        setEditingMilestoneId(null);
        setRoutineDraft(null);
        setPreparation(null);
        setPendingImport(null);
      }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  const todayTasks = useMemo(() => getTasksForDate(data, todayKey), [data, todayKey]);
  const scheduledToday = todayTasks.filter((task) => task.start && task.end && !task.completed);
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const activeTask = scheduledToday.find((task) => timeToMinutes(task.start) <= currentMinute && timeToMinutes(task.end) > currentMinute) ?? null;
  const afterActive = scheduledToday.filter(task => timeToMinutes(task.start) > currentMinute).slice(0, 3);
  const effectiveDraft = resolveSmartDraft(draft, manual, todayKey, addDaysKey(todayKey, 1));
  const focusSeconds = focusRemaining(focus, now.getTime());
  const focusRunning = Boolean(focus?.endsAt && focusSeconds > 0);
  const focusTask = focus ? (focus.taskId ? Object.values(data.plans).flat().find(task => task.id === focus.taskId) ?? null : null) : activeTask ?? afterActive[0] ?? null;
  const missed = overdueTasks(data, now);

  const monday = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [weekOffset, todayKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(monday, index)), [monday]);
  const weekLabel = `${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;

  function openAdd(date = "") {
    setDraft({ ...emptyDraft(), date });
    setManual(date ? { date: true } : {});
    setError("");
    setNotice("");
    setView("add");
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!draft.title.trim()) return;
    const resolved = effectiveDraft;
    if (resolved.repeat !== "none" && !resolved.start) { setError("Opakovaný blok potřebuje konkrétní čas."); return; }
    if (resolved.date && resolved.date < todayKey) { setError("Vyber dnešek nebo budoucí den."); return; }
    if (resolved.dueDate && (resolved.dueDate < todayKey || (resolved.date && resolved.dueDate < resolved.date))) { setError("Termín nesmí být před zvoleným dnem."); return; }
    const effective = { ...resolved, date: resolved.date || undefined, start: resolved.start || undefined, dueDate: resolved.dueDate || undefined };
    const result = addTask(data, effective, now);
    setData(result.state);
    setNotice(result.status === "scheduled"
      ? `${effective.title} · ${dayLabel(result.task.date, todayKey)}${result.task.start ? ` · ${result.task.start}–${result.task.end}` : ""}`
      : `${effective.title} je uložený, ale zatím nemá volný čas.`);
    setDraft(emptyDraft());
    setManual({});
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
      milestoneId: String(form.get("milestoneId") || "") || undefined,
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

  function downloadFile(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function readImport(file?: File) {
    if (!file) return;
    setBackupError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Soubor je příliš velký (maximum 10 MB).");
      setPendingImport({ state: decodeBackup(await file.text()), name: file.name });
    } catch (error) { setBackupError(error instanceof Error ? error.message : "Zálohu se nepodařilo načíst."); }
  }

  function confirmImport() {
    if (!pendingImport) return;
    try {
      const previous = window.localStorage.getItem(STORAGE_KEY);
      if (previous) window.localStorage.setItem(storageBlocked ? "dayframe-v1-recovery" : BACKUP_KEY, previous);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingImport.state));
    } catch { setBackupError("Obnovu se nepodařilo uložit. Současná data zůstávají v aplikaci."); return; }
    setCalendar(current => ({ data: pendingImport.state, history: storageBlocked ? [] : [...current.history, current.data].slice(-20) }));
    setFocus(null); setStorageBlocked(""); setStorageError(""); setBackupError(""); setPendingImport(null);
  }

  function startFocus(task: CalendarTask | null) {
    if (focus && focus.taskId === task?.id && focusRemaining(focus, Date.now()) > 0) { setView("focus"); return; }
    const seconds = (task?.duration ?? 50) * 60;
    setFocus({ taskId: task?.id ?? null, title: task?.title ?? "Soustředění", category: task?.category ?? "", totalSeconds: seconds, remainingSeconds: seconds, endsAt: Date.now() + seconds * 1000, mode: "work" });
    setView("focus");
  }

  function completeFocus() {
    if (focusTask && !focusTask.completed) setData(current => toggleTask(current, focusTask.id));
    setFocus(null);
    setView("today");
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
    const hours = Number(form.get("hours"));
    const blockMinutes = Number(form.get("blockMinutes")) || 60;
    if (!Number.isFinite(hours) || hours < 0 || hours > 1000) { setMilestoneError("Zadej 0 až 1000 hodin."); return; }
    const next = { ...data, milestones: data.milestones.map(m => m.id === editingMilestoneId ? { ...m, title, date, note, targetMinutes: Math.round(hours * 60), blockMinutes, category: String(form.get("category") || "Studium") } : m).sort((a,b) => a.date.localeCompare(b.date)) };
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    if (intent === "plan") {
      const proposed = planMilestone(next, editingMilestoneId, now);
      if (proposed.error) { setMilestoneError(proposed.error); return; }
      setPreparation(proposed);
      return;
    }
    setData(next);
    setEditingMilestoneId(null);
  }

  function removeMilestone(id: string) {
    setData((current) => ({ ...current, milestones: current.milestones.filter((milestone) => milestone.id !== id), plans: Object.fromEntries(Object.entries(current.plans).map(([date, tasks]) => [date, tasks.map(t => t.milestoneId === id ? { ...t, milestoneId: undefined } : t)])), backlog: current.backlog.map(t => t.milestoneId === id ? { ...t, milestoneId: undefined } : t) }));
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
            <NavButton active={view === "week"} onClick={() => { setNotice(""); setView("week"); }} label="Týden" shortcut="W" />
            <NavButton active={view === "add"} onClick={() => openAdd()} label="Přidat úkol" shortcut="2" />
            <NavButton active={view === "focus"} onClick={() => setView("focus")} label="Soustředění" shortcut="3" />
            <NavButton active={view === "milestones"} onClick={() => setView("milestones")} label="Milníky" shortcut="4" />
            <NavButton active={view === "settings"} onClick={() => setView("settings")} label="Nastavení" shortcut="5" />
          </nav>
          <div className="df2-sidebar-bottom"><span>Den končí</span><strong>00:30</strong><button type="button" className="df2-undo" onClick={undo} disabled={!calendar.history.length || Boolean(storageBlocked)}>Vrátit zpět</button></div>
        </aside>

        <section className="df2-main">
          {calendar.history.length > 0 && !storageBlocked && <button type="button" className="df2-mobile-undo" onClick={undo}>Vrátit zpět</button>}
          {(storageBlocked || storageError) && <p role="alert" className="df2-error">{storageBlocked || storageError}</p>}
          {view === "today" && (
            <TodayView
              now={now}
              tasks={todayTasks}
              activeTask={activeTask}
              nextTasks={afterActive}
              missed={missed}
              milestones={data.milestones}
              onAdd={() => openAdd(todayKey)}
              onEdit={setEditing}
              onDone={(id) => setData((current) => toggleTask(current, id))}
              onTomorrow={(id) => setData((current) => moveTaskToTomorrow(current, id, now))}
              onDelete={(id) => setData((current) => deleteTask(current, id))}
              onFocus={startFocus}
              onMilestones={() => setView("milestones")}
            />
          )}

          {view === "week" && (
            <section className="df2-week-view">
              <header className="df2-page-head">
                <div><p>{weekLabel}</p><h1>Týden</h1></div>
                <div className="df2-week-controls">
                  <button onClick={() => setWeekOffset((value) => value - 1)}>←</button>
                  <button onClick={() => setWeekOffset(0)}>Tento týden</button>
                  <button onClick={() => setWeekOffset((value) => value + 1)}>→</button>
                  <button className="df2-accent-button" disabled={weekKeys(monday)[6] < todayKey} onClick={() => setData((current) => replanWeek(current, monday, now))}>Přepočítat týden</button>
                </div>
              </header>
              {notice && <div className="df2-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
              <div className="df2-week-scroll">
                <div className="df2-week-grid">
                  {days.map((day) => {
                    const key = localDateKey(day);
                    const isPast = key < todayKey;
                    const tasks = getTasksForDate(data, key).filter(task => !isPast || task.completed);
                    const unscheduled = tasks.filter((task) => !task.start);
                    const scheduled = tasks.filter((task) => task.start && task.end);
                    return (
                      <article className={`df2-week-day ${key === todayKey ? "today" : ""}`} key={key}>
                        <header className="df2-week-day-head" onClick={() => key >= todayKey && openAdd(key)}>
                          <div><span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(day).replace(".", "")}</span><strong>{day.getDate()}</strong></div>
                          <button disabled={key < todayKey} onClick={(event) => { event.stopPropagation(); openAdd(key); }}>+</button>
                        </header>
                        <div className="df2-day-summary"><span>{tasks.length} bloků</span><span>{Math.floor(totalMinutes(tasks) / 60)} h {totalMinutes(tasks) % 60 || ""}</span></div>
                        <div className="df2-unscheduled">
                          {unscheduled.map((task) => <button key={task.id} onClick={() => setEditing(task)}>{task.title}<small>bez času</small></button>)}
                        </div>
                        <div
                          className={`df2-time-body ${dropPreview?.date === key ? "drop-active" : ""}`}
                          onDragOver={(event) => !isPast && onDragOver(event, key)}
                          onDrop={(event) => !isPast && onDrop(event, key)}
                        >
                          {Array.from({ length: 14 }, (_, index) => <span className="df2-hour-line" key={index} style={{ top: `${index * 60 * MINUTE_HEIGHT}px` }}><em>{10 + index}:00</em></span>)}
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
                                disabled={isPast}
                                draggable={!isPast && !task.completed}
                                onDragStart={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const grabPixels = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                                  const grabOffsetMinutes = Math.max(0, Math.min(task.duration, grabPixels / MINUTE_HEIGHT));
                                  event.dataTransfer.effectAllowed = "move";
                                  setDragging({ id: task.id, date: key, duration: task.duration, grabOffsetMinutes });
                                  setDropPreview({ date: key, start: task.start ?? minutesToTime(calendarBounds.dayStart), duration: task.duration, valid: true });
                                }}
                                onDragEnd={() => { setDragging(null); setDropPreview(null); }}
                                onClick={() => !isPast && setEditing(task)}
                                title="Přetáhni blok na jiný čas"
                              >
                                <span>{task.start}–{task.end}</span>
                                <strong>{task.title}</strong>
                                <small>{task.category}</small>
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
              <footer className="df2-week-help">Přetažení drží místo, kde blok chytíš, a zarovná nový čas po 15 minutách. Po puštění zůstane blok na zvoleném místě.</footer>
            </section>
          )}

          {view === "add" && (
            <section className="df2-add-view">
              <header className="df2-page-head"><div><p>Rychlé plánování</p><h1>Přidat úkol</h1></div></header>
              <form className="df2-add-form" onSubmit={submitDraft}>
                <label className="df2-title-input"><span>Co potřebuješ udělat?</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Např. zeměpis 20 min" /></label>
                <div className="df2-chips" aria-label="Rychlá nastavení">
                  <label><span>Den</span><input type="date" value={effectiveDraft.date} min={todayKey} onChange={(event) => { setManual(m => ({ ...m, date: true })); setDraft({ ...draft, date: event.target.value }); }} /></label>
                  <label><span>Délka</span><select aria-label="Délka" value={effectiveDraft.duration} onChange={(event) => { setManual(m => ({ ...m, duration: true })); setDraft({ ...draft, duration: Number(event.target.value) }); }}>{![20,30,45,60,90,120].includes(effectiveDraft.duration) && <option value={effectiveDraft.duration}>{effectiveDraft.duration} min</option>}<option value={20}>20 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
                  <label><span>Začít v</span><input type="time" value={effectiveDraft.start} onChange={(event) => { setManual(m => ({ ...m, start: true })); setDraft({ ...draft, start: event.target.value }); }} /></label>
                  <label><span>Priorita</span><select aria-label="Priorita" value={effectiveDraft.priority} onChange={(event) => { setManual(m => ({ ...m, priority: true })); setDraft({ ...draft, priority: event.target.value as Priority }); }}><option value="normal">Běžná</option><option value="high">Vysoká</option><option value="low">Nízká</option></select></label>
                </div>
                <details className="df2-details">
                  <summary>Další podrobnosti</summary>
                  <div className="df2-details-grid">
                    <label>Dokončit do<input type="date" value={draft.dueDate} min={todayKey} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                    <label>Nejpozději v<input type="time" value={effectiveDraft.deadlineTime} onChange={(event) => { setManual(m => ({ ...m, deadlineTime: true })); setDraft({ ...draft, deadlineTime: event.target.value }); }} /></label>
                    <label>Oblast<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                    <label>Milník<select value={draft.milestoneId} onChange={event => setDraft({ ...draft, milestoneId: event.target.value })}><option value="">Bez milníku</option>{data.milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label>Opakování<select value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value as RepeatRule })}><option value="none">Neopakovat</option><option value="daily">Každý den</option><option value="weekly">Každý týden</option><option value="alternate">Obden</option></select></label>
                  </div>
                </details>
                {draft.title.trim() && <div className="df2-understood"><span>Dayframe rozumí:</span><strong>{effectiveDraft.title}</strong><small>{effectiveDraft.date ? shortDate(effectiveDraft.date) : "nejlepší čas během týdne"} · {effectiveDraft.duration} min{effectiveDraft.start ? ` · ${effectiveDraft.start}` : " · čas automaticky"}</small></div>}
                {error && <p className="df2-error">{error}</p>}
                <button className="df2-primary" type="submit" disabled={!hydrated || !draft.title.trim()}>Naplánovat</button>
              </form>
              {notice && <div className="df2-result"><span>Uloženo</span><strong>{notice}</strong><button onClick={() => { setNotice(""); setView("week"); }}>Ukázat v týdnu</button></div>}
              {data.backlog.length > 0 && <section className="df2-backlog"><h2>Bez místa</h2>{data.backlog.map((task) => <article key={task.id}><div><strong>{task.title}</strong><small>{task.duration} min · {task.priority === "high" ? "vysoká priorita" : "čeká na čas"}</small></div><button onClick={() => setData((current) => retryBacklog(current, now, now, task.id))}>Zkusit naplánovat</button></article>)}</section>}
            </section>
          )}

          {view === "focus" && (
            <section className="df2-focus-view">
              <p>{focus?.mode === "break" ? "Přestávka" : focusTask?.category ?? "Soustředění"}</p>
              <h1>{focus?.title ?? focusTask?.title ?? "Soustředění"}</h1>
              <div className="df2-focus-clock" role="timer">{String(Math.floor((focus ? focusSeconds : (focusTask?.duration ?? 50) * 60) / 60)).padStart(2, "0")}:{String((focus ? focusSeconds : 0) % 60).padStart(2, "0")}</div>
              {focus && focusSeconds === 0 && <p role="status">{focus.mode === "break" ? "Přestávka skončila." : "Čas bloku uplynul."}</p>}
              <div className="df2-focus-actions">
                {(!focus || focusSeconds > 0) && <button onClick={() => { if (!focus) startFocus(focusTask); else setFocus(focusRunning ? pauseFocus(focus, Date.now()) : { ...focus, endsAt: Date.now() + focus.remainingSeconds * 1000 }); }}>{focusRunning ? "Pozastavit" : focus ? "Pokračovat" : "Spustit"}</button>}
                {focus?.mode !== "break" && focusTask && <button onClick={completeFocus}>Hotovo</button>}
                {focus && focus.mode === "work" && <button onClick={() => setFocus(breakFocus(focus, Date.now()))}>Pauza 5 min</button>}
                {focus && <button onClick={() => setFocus(focus.mode === "break" ? resumeWork(focus, Date.now()) : extendFocus(focus, Date.now()))}>{focus.mode === "break" ? "Zpět k úkolu" : "+10 min"}</button>}
                {focus && <button onClick={() => { setFocus(null); setView("today"); }}>Ukončit</button>}
              </div>
            </section>
          )}

          {view === "milestones" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><p>Důležité termíny</p><h1>Milníky</h1></div></header>
              <form className="df2-inline-form" onSubmit={addNewMilestone}><input placeholder="Nový milník" value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} /><input type="date" value={milestoneDate} onChange={(event) => setMilestoneDate(event.target.value)} /><button>Přidat</button></form>
              <div className="df2-milestones">{[...data.milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone) => <article key={milestone.id} role="button" tabIndex={0} title="Upravit milník" onClick={() => { setMilestoneError(""); setEditingMilestoneId(milestone.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingMilestoneId(milestone.id); } }}><div><span>{milestone.note}</span><strong>{milestone.title}</strong>{Boolean(milestone.targetMinutes) && <small>{Math.round(milestoneProgress(data, milestone.id, now).completed / 6) / 10} / {milestone.targetMinutes! / 60} h hotovo · {Math.round(milestoneProgress(data, milestone.id, now).planned / 6) / 10} h v plánu</small>}</div><div className="df2-milestone-remaining"><strong>{daysUntilDate(milestone.date, now)}</strong><span>dní</span></div><time>{longDate(milestone.date)}</time></article>)}</div>
            </section>
          )}

          {view === "settings" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><p>Chování Dayframe</p><h1>Nastavení</h1></div></header>
              <div className="df2-settings-card"><div><strong>Pracovní den</strong><span>10:00–22:30 · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>Den končí v 00:30</span></div><div><strong>Auto-plánování</strong><span>Celý týden · 15min sloty · respektuje ručně zadaný den a čas</span></div><div><strong>Ukládání</strong><span>Uloženo v tomto prohlížeči</span></div></div>
              <section className="df2-backup"><h2>Záloha dat</h2><p>Pro přenos do jiného prohlížeče nebo zařízení.</p>
                <div className="df2-backup-actions"><button disabled={Boolean(storageBlocked)} onClick={() => downloadFile(encodeBackup(data), `Dayframe-${todayKey}.json`)}>Stáhnout zálohu</button>
                  <label className="df2-file-button">Obnovit ze souboru<input aria-label="Obnovit ze souboru" type="file" accept=".json,application/json" onChange={e => { void readImport(e.target.files?.[0]); e.target.value = ""; }} /></label>
                  <button onClick={() => { try { const raw = window.localStorage.getItem(BACKUP_KEY); if (!raw) throw new Error("Automatická záloha zatím neexistuje."); setPendingImport({ state: decodeBackup(raw), name: "Poslední automatická záloha" }); setBackupError(""); } catch (e) { setBackupError(e instanceof Error ? e.message : "Záloha není dostupná."); } }}>Poslední záloha</button>
                  {storageBlocked && rawRecovery.current && <button onClick={() => downloadFile(rawRecovery.current!, `Dayframe-puvodni-${todayKey}.json`)}>Stáhnout původní data</button>}
                </div>{backupError && <p role="alert" className="df2-error">{backupError}</p>}
              </section>
              <section className="df2-routines"><div className="df2-section-head"><h2>Rutiny</h2><button onClick={() => { setRoutineError(""); setRoutineDraft({ id: "", title: "", duration: 30, start: "17:00", category: "Studium", priority: "normal", frequency: "weekly", weekdays: [now.getDay()], startsOn: todayKey, active: true, createdAt: now.toISOString() }); }}>+ Nová rutina</button></div>
                {data.routines.map((routine) => <article key={routine.id}>
                  <button className="df2-routine-edit" onClick={() => { setRoutineError(""); setRoutineDraft({ ...routine, startsOn: routine.startsOn && routine.startsOn >= todayKey ? routine.startsOn : todayKey }); }}><strong>{routine.title}</strong><small>{routineLabel(routine)} · {routine.start} · {routine.duration} min</small></button>
                  <label><input type="checkbox" aria-label={`Aktivní ${routine.title} ${routineLabel(routine)}`} checked={routine.active} onChange={event => { const active = event.target.checked; setData(current => setRoutineActive(current, routine.id, active, now)); }} /> aktivní</label>
                </article>)}
              </section>
            </section>
          )}
        </section>
      </div>

      {pendingImport && <div className="df2-modal-backdrop"><section className="df2-modal" role="dialog" aria-modal="true" aria-labelledby="restore-heading"><header><h2 id="restore-heading">Obnovit zálohu?</h2><button aria-label="Zavřít" onClick={() => setPendingImport(null)}>×</button></header><p>{pendingImport.name}</p><p>{Object.values(pendingImport.state.plans).flat().length + pendingImport.state.backlog.length} úkolů · {pendingImport.state.milestones.length} milníků</p><p>Nahradí současná data. Předchozí verze zůstane uložená jako záloha.</p>{backupError && <p role="alert" className="df2-error">{backupError}</p>}<div className="df2-modal-actions"><button className="df2-primary" onClick={confirmImport}>Nahradit data</button><button onClick={() => setPendingImport(null)}>Zrušit</button></div></section></div>}
      {routineDraft && <div className="df2-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setRoutineDraft(null); }}>
        <form className="df2-modal" role="dialog" aria-modal="true" aria-labelledby="routine-heading" onSubmit={event => { event.preventDefault(); const result = saveRoutine(data, routineDraft, now); if (result.error) { setRoutineError(result.error); return; } setData(result.state); setRoutineDraft(null); }}>
          <header><h2 id="routine-heading">{routineDraft.id ? "Upravit rutinu" : "Nová rutina"}</h2><button type="button" aria-label="Zavřít" onClick={() => setRoutineDraft(null)}>×</button></header>
          <label>Název<input autoFocus required value={routineDraft.title} onChange={e => setRoutineDraft({ ...routineDraft, title: e.target.value })} /></label>
          <div className="df2-form-grid"><label>Začátek<input type="time" required value={routineDraft.start} onChange={e => setRoutineDraft({ ...routineDraft, start: e.target.value })} /></label><label>Délka (min)<input type="number" min="15" max="360" required value={routineDraft.duration} onChange={e => setRoutineDraft({ ...routineDraft, duration: Number(e.target.value) })} /></label></div>
          <div className="df2-form-grid"><label>Opakování<select aria-label="Opakování" value={routineDraft.frequency} onChange={e => setRoutineDraft({ ...routineDraft, frequency: e.target.value as Routine["frequency"] })}><option value="weekly">Vybrané dny</option><option value="daily">Každý den</option><option value="alternate">Obden</option></select></label><label>Od data<input type="date" min={todayKey} required value={routineDraft.startsOn} onChange={e => setRoutineDraft({ ...routineDraft, startsOn: e.target.value })} /></label></div>
          {routineDraft.frequency === "weekly" && <fieldset className="df2-weekdays"><legend>Dny</legend>{[1,2,3,4,5,6,0].map(day => <label key={day}><input type="checkbox" checked={routineDraft.weekdays?.includes(day) ?? false} onChange={e => setRoutineDraft({ ...routineDraft, weekdays: e.target.checked ? [...(routineDraft.weekdays ?? []), day] : routineDraft.weekdays?.filter(d => d !== day) })} />{["Ne","Po","Út","St","Čt","Pá","So"][day]}</label>)}</fieldset>}
          <label>Oblast<select value={routineDraft.category} onChange={e => setRoutineDraft({ ...routineDraft, category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <small>Změny platí pro budoucí bloky. Historie zůstane zachovaná.</small>
          {routineError && <p role="alert" className="df2-error">{routineError}</p>}
          <div className="df2-modal-actions"><button className="df2-primary">Uložit rutinu</button>{routineDraft.id && <button type="button" className="danger" onClick={() => { setData(current => deleteRoutine(current, routineDraft.id, now)); setRoutineDraft(null); }}>Smazat rutinu</button>}</div>
        </form>
      </div>}

      {preparation && <div className="df2-modal-backdrop">
        <section className="df2-modal" role="dialog" aria-modal="true" aria-labelledby="preparation-title"><header><h2 id="preparation-title">Návrh přípravy</h2><button aria-label="Zavřít návrh" onClick={() => setPreparation(null)}>×</button></header>
          <p>{preparation.tasks.length ? `${preparation.tasks.length} bloků do volných časů` : "Žádné další bloky se nepodařilo přidat."}</p>
          {Boolean(preparation.remaining) && <p className="df2-error">Zbývá umístit {preparation.remaining} min. Uvolni čas nebo uprav termín.</p>}
          <div className="df2-preparation-list">{preparation.tasks.map(t => <div key={t.id}><span>{shortDate(t.date)}</span><strong>{t.start}–{t.end}</strong></div>)}</div>
          <div className="df2-modal-actions"><button className="df2-primary" onClick={() => { setData(preparation.state); setPreparation(null); setEditingMilestoneId(null); }}>Použít plán</button><button onClick={() => setPreparation(null)}>Zpět</button></div>
        </section></div>}
      {editingMilestone && !preparation && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingMilestoneId(null); }}>
          <form className="df2-modal" role="dialog" aria-modal="true" aria-label="Upravit milník" onSubmit={saveMilestoneEdit}>
            <header><div><span>Milník</span><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>
            <label>Název<input name="title" autoFocus defaultValue={editingMilestone.title} /></label>
            <div className="df2-form-grid"><label>Datum<input name="date" type="date" defaultValue={editingMilestone.date} /></label><label>Popisek<input name="note" defaultValue={editingMilestone.note} placeholder="Např. hlavní termín" /></label></div>
            <div className="df2-form-grid"><label>Celkem hodin přípravy<input name="hours" type="number" min="0" max="1000" step="0.25" defaultValue={(editingMilestone.targetMinutes ?? 0) / 60} /></label><label>Délka bloku<select name="blockMinutes" defaultValue={editingMilestone.blockMinutes ?? 60}>{[15,30,45,60,90,120].map(n => <option key={n} value={n}>{n} min</option>)}</select></label></div>
            <label>Oblast<select name="category" defaultValue={editingMilestone.category ?? "Studium"}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
            {milestoneProgress(data, editingMilestone.id, now).waiting > 0 && <small>Některé bloky přípravy čekají na rozhodnutí. Nový návrh je nebude duplikovat.</small>}
            {milestoneError && <p role="alert" className="df2-error">{milestoneError}</p>}
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="submit" value="plan">Navrhnout přípravu</button><button type="button" className="danger" onClick={() => removeMilestone(editingMilestone.id)}>Smazat milník</button></div>
          </form>
        </div>
      )}

      {editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <form className="df2-modal" role="dialog" aria-modal="true" aria-label="Upravit úkol" onSubmit={saveEdit}>
            <header><div><span>Úkol</span><h2>Upravit</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
            <label>Název<input name="title" defaultValue={editing.title} /></label>
            <div className="df2-form-grid"><label>Den<input name="date" type="date" defaultValue={editing.date} /></label><label>Délka<input name="duration" type="number" min="15" step="5" defaultValue={editing.duration} /></label></div>
            <label>Začátek<input name="start" type="time" defaultValue={editing.start ?? ""} /><small>Prázdné = Dayframe najde volný čas automaticky.</small></label>
            <div className="df2-form-grid"><label>Priorita<select name="priority" defaultValue={editing.priority}><option value="high">Vysoká</option><option value="normal">Běžná</option><option value="low">Nízká</option></select></label><label>Oblast<select name="category" defaultValue={editing.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
            <div className="df2-form-grid"><label>Dokončit do<input name="dueDate" type="date" defaultValue={editing.dueDate ?? ""} /></label><label>Nejpozději v<input name="deadlineTime" type="time" defaultValue={editing.deadlineTime ?? "22:30"} /></label></div>
            <label>Milník<select name="milestoneId" defaultValue={editing.milestoneId ?? ""}><option value="">Bez milníku</option>{data.milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
            {error && <p className="df2-error">{error}</p>}
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="button" onClick={() => { setData((current) => toggleTask(current, editing.id)); setEditing(null); }}>{editing.completed ? "Vrátit jako nesplněné" : "Označit hotovo"}</button><button type="button" className="danger" onClick={() => { setData((current) => deleteTask(current, editing.id)); setEditing(null); }}>Smazat</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

function NavButton({ active, onClick, label, shortcut }: { active: boolean; onClick: () => void; label: string; shortcut: string }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{label}</span><kbd>{shortcut}</kbd></button>;
}

function TodayView({
  now, tasks, activeTask, nextTasks, missed, milestones, onAdd, onEdit, onDone, onTomorrow, onDelete, onFocus, onMilestones,
}: {
  now: Date;
  tasks: CalendarTask[];
  activeTask: CalendarTask | null;
  nextTasks: CalendarTask[];
  missed: CalendarTask[];
  milestones: DayframeState["milestones"];
  onAdd: () => void;
  onEdit: (task: CalendarTask) => void;
  onDone: (id: string) => void;
  onTomorrow: (id: string) => void;
  onDelete: (id: string) => void;
  onFocus: (task: CalendarTask | null) => void;
  onMilestones: () => void;
}) {
  const completed = tasks.filter((task) => task.completed).length;
  const unscheduled = tasks.filter((task) => !task.start && !task.completed).length;
  const countdown = getDayCountdown(now);
  const today = localDateKey(now);
  const nextMilestone = [...milestones]
    .filter((milestone) => milestone.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const countdownText = `${String(countdown.hours).padStart(2, "0")}:${String(countdown.minutes).padStart(2, "0")}`;

  return (
    <section className="df2-today-view">
      <header className="df2-page-head"><div><p>{formatDay(now)}</p><h1>Dnes</h1></div><button className="df2-accent-button" onClick={onAdd}>+ Nový úkol</button></header>

      <div className="df2-motivation-grid">
        <section className="df2-day-ruler" aria-label="Odpočet do konce dne">
          <div className="df2-day-ruler-copy">
            <span>Do konce dne</span>
            <strong aria-label={`${countdown.hours} hodin ${countdown.minutes} minut ${countdown.seconds} sekund`}>{countdownText}<em>:{String(countdown.seconds).padStart(2, "0")}</em></strong>
            <span>Konec 00:30</span>
          </div>
          <div className="df2-day-track" aria-hidden="true"><span style={{ width: `${countdown.progressPercent}%` }} /><i style={{ left: `${countdown.progressPercent}%` }} /></div>
          <div className="df2-day-scale" aria-hidden="true"><span>09</span><span>12</span><span>15</span><span>18</span><span>21</span><span>00:30</span></div>
        </section>

        <button type="button" className="df2-event-countdown" onClick={onMilestones} aria-label={nextMilestone ? `Nejbližší termín ${nextMilestone.title}, zbývá ${daysUntilDate(nextMilestone.date, now)} dní` : "Přidat důležitý termín"}>
          <span>Nejbližší termín</span>
          {nextMilestone ? <><strong>{daysUntilDate(nextMilestone.date, now)}<em>dní</em></strong><b>{nextMilestone.title}</b><small>{longDate(nextMilestone.date)}</small></> : <><strong>—</strong><b>Žádný termín</b><small>Přidej milník</small></>}
        </button>
      </div>

      <section className="df2-now-card">
        <div className="df2-now-label"><span>{activeTask ? "Teď" : "Volno"}</span><small>{activeTask?.start && activeTask.end ? `${activeTask.start}–${activeTask.end}` : "volno"}</small></div>
        {activeTask ? <><div><h2>{activeTask.title}</h2><p>{activeTask.category} · {activeTask.duration} min</p></div><div className="df2-now-actions"><button onClick={() => onFocus(activeTask)}>Zahájit blok</button><button onClick={() => onDone(activeTask.id)}>Hotovo</button><button onClick={() => onEdit(activeTask)}>Upravit</button></div></> : <div><h2>{tasks.length > 0 && tasks.every(task => task.completed) ? "Dnes máš hotovo" : "Teď máš volno"}</h2><p>{nextTasks[0] ? `Další blok začíná v ${nextTasks[0].start}.` : "Můžeš si odpočinout."}</p></div>}
      </section>
      {missed.length > 0 && <section className="df2-missed"><header><span>Vyžaduje rozhodnutí</span><strong>{missed.length} {missed.length === 1 ? "nedokončený blok" : "nedokončené bloky"}</strong></header>{missed.map((task) => <article key={task.id}><div><strong>{task.title}</strong><small>měl skončit v {task.end}</small></div><div><button onClick={() => onDone(task.id)}>Hotovo</button><button onClick={() => onTomorrow(task.id)}>Na zítra</button><button onClick={() => onDelete(task.id)}>Zrušit</button></div></article>)}</section>}
      <section className="df2-next"><div className="df2-section-head"><h2>Co následuje</h2><span>{completed}/{tasks.length} hotovo{unscheduled ? ` · ${unscheduled} bez času` : ""}</span></div>{nextTasks.length ? nextTasks.map((task) => <button key={task.id} onClick={() => onEdit(task)}><time>{task.start}</time><span><strong>{task.title}</strong><small>{task.category} · {task.duration} min</small></span></button>) : <div className="df2-empty">Žádný další blok.</div>}</section>
      <footer className="df2-today-status"><span className={missed.length ? "warning" : "ok"} />{missed.length ? "Plán potřebuje rozhodnutí u minulých bloků." : ""}</footer>
    </section>
  );
}