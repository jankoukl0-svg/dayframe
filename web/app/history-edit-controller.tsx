"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { calendarBounds, minutesToTime, timeToMinutes } from "../lib/dayframe-calendar";

type HistoryTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  category?: string;
  routineId?: string;
  completed: boolean;
  actualMinutes?: number;
  [key: string]: unknown;
};

type StoredState = {
  plans?: Record<string, HistoryTask[]>;
  [key: string]: unknown;
};

const STORAGE_KEY = "dayframe-v1";
const READING_SESSIONS_KEY = "dayframe-reading-sessions-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";

type RecordedReading = { bookTitle: string; pages: number };

function isReadingTask(task: HistoryTask) {
  if (task.routineId === "read") return true;
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const category = normalize(task.category ?? "");
  const title = normalize(task.title);
  return category === "cteni" || category === "reading"
    || title === "cteni" || title === "cteni knihy" || title.startsWith("cteni ")
    || title === "reading" || title.startsWith("reading ");
}

function readRecordedReading(task: HistoryTask): RecordedReading | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(READING_SESSIONS_KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entries = (raw as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return null;
    const matching = entries.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object" && !Array.isArray(entry)
        && (entry as Record<string, unknown>).taskId === task.id));
    // Prefer the exact block/date. Task IDs are stable when the date of a
    // completed block is corrected in history; retain its original reading log.
    const entry = matching.find((item) => item.date === task.date) ?? matching[0];
    if (!entry || typeof entry.bookTitle !== "string" || !entry.bookTitle.trim()
      || !Number.isSafeInteger(entry.pages) || (entry.pages as number) < 1) return null;
    return { bookTitle: entry.bookTitle.trim(), pages: entry.pages as number };
  } catch {
    return null;
  }
}

function readState(): StoredState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed as StoredState : {};
  } catch {
    return {};
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(STATE_SYNC_EVENT));
}

function weekdayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short" })
    .format(new Date(`${dateKey}T12:00:00`))
    .replace(".", "")
    .toLowerCase();
}

function resolveTask(button: HTMLButtonElement) {
  const title = button.querySelector("strong")?.textContent?.trim() ?? "";
  const timeText = button.querySelector("span")?.textContent?.trim() ?? "";
  const [start, end] = timeText.split("–");
  const day = button.closest(".df2-week-day");
  const dayNumber = Number(day?.querySelector(".df2-week-day-head strong")?.textContent?.trim());
  const weekday = day?.querySelector(".df2-week-day-head span")?.textContent?.trim().toLowerCase() ?? "";
  const state = readState();
  const candidates = Object.entries(state.plans ?? {})
    .flatMap(([date, tasks]) => tasks.map((task) => ({ task, date })))
    .filter(({ task }) => task.completed && task.title === title && task.start === start && task.end === end)
    .filter(({ date }) => {
      const parsed = new Date(`${date}T12:00:00`);
      return parsed.getDate() === dayNumber && weekdayLabel(date) === weekday;
    });
  return candidates[0]?.task ?? null;
}

function actualDefault(task: HistoryTask) {
  return Number.isFinite(task.actualMinutes) && (task.actualMinutes ?? 0) > 0
    ? Math.round(task.actualMinutes ?? task.duration)
    : Math.max(1, Math.round(task.duration || 1));
}

function defaultEnd(task: HistoryTask) {
  if (task.end) return task.end;
  if (!task.start) return "";
  const start = timeToMinutes(task.start);
  return Number.isFinite(start) ? minutesToTime(start + Math.max(1, task.duration || 1)) : "";
}

export function HistoryEditController() {
  const [editing, setEditing] = useState<HistoryTask | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.historyEditStyles = "true";
    style.textContent = `
      .df2-week-day:has(.df2-week-day-head > button:disabled) .df2-time-body { pointer-events: auto !important; }
      .df2-week-day:has(.df2-week-day-head > button:disabled) .df2-week-task.done { pointer-events: auto !important; cursor: pointer; }
      .df2-week-day:has(.df2-week-day-head > button:disabled) .df2-week-task.done:hover,
      .df2-week-day:has(.df2-week-day-head > button:disabled) .df2-week-task.done:focus-visible { border-color: #8f9389; background: #fffdfa; }
      .df2-history-edit-note { margin: -2px 0 2px; color: var(--muted); font-size: 11px; line-height: 1.4; }
      .df2-history-reading-detail { padding: 12px 14px; background: #f4f2ee; border: 1px solid #e9e5dd; border-radius: 10px; }
      .df2-history-reading-detail > strong { display: block; margin-bottom: 8px; font-size: 12px; }
      .df2-history-reading-values { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
      .df2-history-reading-values > div { min-width: 0; }
      .df2-history-reading-values small { display: block; color: var(--muted); font-size: 11px; margin-bottom: 2px; }
      .df2-history-reading-values span { display: block; font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
      .df2-history-reading-detail p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    `;
    document.head.appendChild(style);

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".df2-week-task.done") : null;
      if (!target) return;
      const task = resolveTask(target);
      if (!task) return;
      event.preventDefault();
      event.stopPropagation();
      setError("");
      setEditing(task);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      style.remove();
    };
  }, []);

  const originalDate = editing?.date ?? "";
  const actualMinutes = useMemo(() => editing ? actualDefault(editing) : 1, [editing]);
  const recordedReading = useMemo(() => editing && isReadingTask(editing) ? readRecordedReading(editing) : null, [editing]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || editing.title).trim();
    const date = String(form.get("date") || editing.date);
    const start = String(form.get("start") || "");
    const submittedEnd = String(form.get("end") || "");
    const actual = Number(form.get("actualMinutes"));
    if (!title || !date || !start || !submittedEnd || !Number.isFinite(actual) || actual < 1) {
      setError("Vyplň platný čas a skutečně odpracované minuty.");
      return;
    }

    const startMinute = timeToMinutes(start);
    const submittedEndMinute = timeToMinutes(submittedEnd);
    if (!Number.isFinite(startMinute) || !Number.isFinite(submittedEndMinute)) {
      setError("Vyplň platný začátek a konec.");
      return;
    }

    const roundedActual = Math.max(1, Math.round(actual));
    const initialActual = actualDefault(editing);
    const initialEnd = defaultEnd(editing);
    const actualChanged = roundedActual !== initialActual;
    const endChanged = submittedEnd !== initialEnd;

    let correctedEnd = submittedEnd;
    let correctedEndMinute = submittedEndMinute;
    let correctedDuration = correctedEndMinute - startMinute;

    // For a completed block, editing only “Skutečně odpracováno” is a duration
    // correction. Keep the start fixed and move the end so the Week card and
    // Overview use the same corrected duration instead of leaving stale geometry.
    if (actualChanged && !endChanged) {
      correctedDuration = roundedActual;
      correctedEndMinute = startMinute + correctedDuration;
      if (correctedEndMinute > calendarBounds.dayEnd) {
        setError("Opravený blok by přesáhl konec Dayframe dne ve 02:00.");
        return;
      }
      correctedEnd = minutesToTime(correctedEndMinute);
    }

    if (correctedEndMinute <= startMinute || correctedDuration < 1) {
      setError("Konec musí být později než začátek.");
      return;
    }

    const state = readState();
    const plans = { ...(state.plans ?? {}) };
    let found: HistoryTask | null = null;
    let fromDate = originalDate;
    for (const [key, tasks] of Object.entries(plans)) {
      const match = tasks.find((task) => task.id === editing.id);
      if (match) {
        found = match;
        fromDate = key;
        break;
      }
    }
    if (!found) {
      setError("Záznam už nebyl nalezen.");
      return;
    }

    plans[fromDate] = (plans[fromDate] ?? []).filter((task) => task.id !== editing.id);
    const corrected: HistoryTask = {
      ...found,
      title,
      date,
      start,
      end: correctedEnd,
      duration: correctedDuration,
      actualMinutes: roundedActual,
      completed: true,
    };
    plans[date] = [...(plans[date] ?? []).filter((task) => task.id !== editing.id), corrected]
      .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
    writeState({ ...state, plans });
    setEditing(null);
  }

  function remove() {
    if (!editing) return;
    const state = readState();
    const plans = Object.fromEntries(Object.entries(state.plans ?? {}).map(([date, tasks]) => [
      date,
      tasks.filter((task) => task.id !== editing.id),
    ]));
    writeState({ ...state, plans });
    setEditing(null);
  }

  if (!editing) return null;

  return (
    <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <form className="df2-modal df2-history-edit-modal" onSubmit={save}>
        <header><div><h2>Opravit záznam</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
        <p className="df2-history-edit-note">Dokončený blok zůstane v historii jako hotový. Můžeš opravit jeho čas i skutečně odpracovanou dobu.</p>
        {isReadingTask(editing) && (
          <section className="df2-history-reading-detail" aria-label="Záznam čtení">
            <strong>Záznam čtení</strong>
            {recordedReading ? (
              <div className="df2-history-reading-values">
                <div><small>Kniha</small><span>{recordedReading.bookTitle}</span></div>
                <div><small>Přečteno</small><span>{recordedReading.pages} {recordedReading.pages === 1 ? "strana" : recordedReading.pages >= 2 && recordedReading.pages <= 4 ? "strany" : "stran"}</span></div>
              </div>
            ) : <p>U tohoto bloku není uložen název knihy ani počet přečtených stran.</p>}
          </section>
        )}
        <label>Název<input name="title" defaultValue={editing.title} /></label>
        <div className="df2-form-grid">
          <label>Datum<input name="date" type="date" defaultValue={editing.date} /></label>
          <label>Skutečně odpracováno<input name="actualMinutes" type="number" min="1" step="1" defaultValue={actualMinutes} /></label>
        </div>
        <div className="df2-form-grid">
          <label>Začátek<input name="start" type="time" defaultValue={editing.start ?? ""} /></label>
          <label>Konec<input name="end" type="time" defaultValue={defaultEnd(editing)} /></label>
        </div>
        {error && <p className="df2-error">{error}</p>}
        <div className="df2-modal-actions">
          <button className="df2-primary">Uložit opravu</button>
          <button type="button" className="danger" onClick={remove}>Smazat záznam</button>
        </div>
      </form>
    </div>
  );
}
