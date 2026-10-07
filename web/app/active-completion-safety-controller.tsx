"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calendarBounds, minutesToTime, planningDateKey, planningMinute, timeToMinutes } from "../lib/dayframe-calendar";

type StoredTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  completed?: boolean;
  priority?: "high" | "normal" | "low";
  source?: "user" | "routine" | "legacy";
  requestedStart?: string;
  autoScheduled?: boolean;
  createdAt?: string;
  plannedStart?: string;
  plannedEnd?: string;
  plannedDuration?: number;
  actualStartedAt?: string;
  actualEndedAt?: string;
  actualAccumulatedSeconds?: number;
  actualRunningSince?: string;
  actualMinutes?: number;
  [key: string]: unknown;
};

type StoredState = {
  plans?: Record<string, StoredTask[]>;
  [key: string]: unknown;
};

type CompletionChoice = {
  date: string;
  taskId: string;
  taskTitle: string;
  originalTask: StoredTask;
  finishMinute: number;
  savedMinutes: number;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
  shortTaskId: string | null;
  shortTaskTitle: string | null;
  focus: boolean;
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";

function readState(): StoredState | null {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as StoredState | null;
  } catch {
    return null;
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(STATE_SYNC_EVENT));
}

function elapsedSeconds(from: string | undefined, until: Date) {
  if (!from) return 0;
  const started = new Date(from).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((until.getTime() - started) / 1000));
}

function findClickedTask(button: HTMLButtonElement, state: StoredState, now: Date) {
  const date = planningDateKey(now);
  const tasks = state.plans?.[date] ?? [];
  const focusView = button.closest<HTMLElement>(".df2-focus-view");
  const focusTaskId = focusView?.dataset.focusTaskId;
  if (focusTaskId) {
    const exact = tasks.find((task) => !task.completed && task.id === focusTaskId);
    if (exact) return { task: exact, date };
  }

  const nowCard = button.closest<HTMLElement>(".df2-now-card");
  const title = focusView?.querySelector("h1")?.textContent?.trim()
    || nowCard?.querySelector("h2")?.textContent?.trim();
  if (!title) return null;

  const matching = tasks.filter((task) => !task.completed && task.title === title);
  if (!matching.length) return null;
  if (matching.length === 1) return { task: matching[0], date };

  const minute = planningMinute(now);
  const task = matching
    .sort((left, right) => Math.abs(timeToMinutes(left.start) - minute) - Math.abs(timeToMinutes(right.start) - minute))[0];
  return task ? { task, date } : null;
}

function priorityRank(priority?: StoredTask["priority"]) {
  return priority === "high" ? 0 : priority === "low" ? 2 : 1;
}

function nextTask(tasks: StoredTask[], currentId: string, minute: number) {
  return tasks
    .filter((task) => task.id !== currentId && !task.completed && task.start && task.end && timeToMinutes(task.start) >= minute)
    .sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start))[0] ?? null;
}

function shortTask(tasks: StoredTask[], currentId: string, nextId: string | null, savedMinutes: number, originalEnd: number) {
  return tasks
    .filter((task) => task.id !== currentId
      && task.id !== nextId
      && !task.completed
      && task.duration > 0
      && task.duration <= savedMinutes
      && task.source !== "routine"
      && !task.requestedStart
      && task.autoScheduled !== false
      && (!task.start || timeToMinutes(task.start) >= originalEnd))
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
      || right.duration - left.duration
      || (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))[0] ?? null;
}

function finishImmediately(state: StoredState, date: string, task: StoredTask, finishMinute: number, now: Date) {
  const tasks = state.plans?.[date];
  if (!tasks || !task.start || !task.end) return false;
  const start = timeToMinutes(task.start);
  const originalEnd = timeToMinutes(task.end);
  if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || finishMinute < start || finishMinute >= originalEnd) return false;

  const actualEnd = Math.max(start + 1, finishMinute);
  const totalSeconds = (task.actualAccumulatedSeconds ?? 0) + elapsedSeconds(task.actualRunningSince, now);
  state.plans = {
    ...state.plans,
    [date]: tasks.map((item) => item.id === task.id
      ? {
        ...item,
        plannedStart: item.plannedStart ?? item.start,
        plannedEnd: item.plannedEnd ?? item.end,
        plannedDuration: item.plannedDuration ?? item.duration,
        completed: true,
        end: minutesToTime(actualEnd),
        duration: actualEnd - start,
        actualEndedAt: now.toISOString(),
        actualAccumulatedSeconds: totalSeconds,
        actualRunningSince: undefined,
        actualMinutes: item.actualStartedAt ? Math.max(1, Math.round(totalSeconds / 60)) : item.actualMinutes,
      }
      : item),
  };
  writeState(state);
  return true;
}

function startFreedTimeTask(choice: CompletionChoice, taskId: string | null) {
  if (!taskId) {
    window.location.reload();
    return;
  }

  const state = readState();
  const tasks = state?.plans?.[choice.date];
  if (!state || !tasks) {
    window.location.reload();
    return;
  }
  const candidate = tasks.find((task) => task.id === taskId && !task.completed);
  if (!candidate) {
    window.location.reload();
    return;
  }

  const candidateDuration = Math.max(1, candidate.duration || (timeToMinutes(candidate.end) - timeToMinutes(candidate.start)));
  const candidateEnd = choice.finishMinute + candidateDuration;
  if (candidateEnd <= calendarBounds.dayEnd) {
    state.plans = {
      ...state.plans,
      [choice.date]: tasks.map((task) => task.id === candidate.id
        ? {
          ...task,
          start: minutesToTime(choice.finishMinute),
          end: minutesToTime(candidateEnd),
          requestedStart: minutesToTime(choice.finishMinute),
          dateLocked: true,
          autoScheduled: false,
        }
        : task),
    };
    writeState(state);
  }
  window.location.reload();
}

export function ActiveCompletionSafetyController() {
  const [completion, setCompletion] = useState<CompletionChoice | null>(null);
  const preClickTaskRef = useRef<{ date: string; task: StoredTask; capturedAt: number } | null>(null);

  useEffect(() => {
    const captureOriginalTask = (target: EventTarget | null) => {
      const button = target instanceof Element
        ? target.closest<HTMLButtonElement>("button.df2-time-done")
        : null;
      if (!button) return;
      const state = readState();
      if (!state) return;
      const found = findClickedTask(button, state, new Date());
      if (!found) return;
      preClickTaskRef.current = {
        date: found.date,
        task: { ...found.task },
        capturedAt: Date.now(),
      };
    };

    const onPointerDown = (event: PointerEvent) => captureOriginalTask(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") captureOriginalTask(event.target);
    };

    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button.df2-time-done")
        : null;
      if (!button) return;

      const now = new Date();
      const state = readState();
      if (!state) return;
      const found = findClickedTask(button, state, now);
      if (!found?.task.start || !found.task.end) return;

      const finishMinute = planningMinute(now);
      const start = timeToMinutes(found.task.start);
      const originalEnd = timeToMinutes(found.task.end);
      if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || finishMinute < start || finishMinute >= originalEnd) return;

      const originalSnapshot = preClickTaskRef.current;
      const originalTask = originalSnapshot
        && originalSnapshot.date === found.date
        && originalSnapshot.task.id === found.task.id
        && Date.now() - originalSnapshot.capturedAt < 5000
        ? originalSnapshot.task
        : { ...found.task };
      preClickTaskRef.current = null;

      const tasks = state.plans?.[found.date] ?? [];
      const savedMinutes = originalEnd - finishMinute;
      const next = nextTask(tasks, found.task.id, finishMinute);
      const short = shortTask(tasks, found.task.id, next?.id ?? null, savedMinutes, originalEnd);
      const focus = Boolean(button.closest(".df2-focus-view"));

      if (!finishImmediately(state, found.date, found.task, finishMinute, now)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      setCompletion({
        date: found.date,
        taskId: found.task.id,
        taskTitle: originalTask.title,
        originalTask: { ...originalTask },
        finishMinute,
        savedMinutes,
        nextTaskId: next?.id ?? null,
        nextTaskTitle: next?.title ?? null,
        shortTaskId: short?.id ?? null,
        shortTaskTitle: short?.title ?? null,
        focus,
      });
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const undoCompletion = () => {
    const state = readState();
    const tasks = state?.plans?.[completion?.date ?? ""];
    if (!state || !tasks || !completion) return;
    state.plans = {
      ...state.plans,
      [completion.date]: tasks.map((task) => task.id === completion.taskId ? { ...completion.originalTask } : task),
    };
    writeState(state);
    setCompletion(null);
  };

  if (!completion) return null;

  return createPortal(
    <div className={`df2-active-completion-floating ${completion.focus ? "is-focus" : ""}`} aria-live="polite">
      <span className="df2-completion-mark" aria-hidden="true">✓</span>
      <div className="df2-active-completion-copy">
        <strong>Úkol dokončen</strong>
        <small>{completion.taskTitle}</small>
      </div>
      <div className={completion.focus ? "df2-time-adjust-focus-completion" : "df2-time-adjust-finish"}>
        <strong>+{completion.savedMinutes} min volných</strong>
        {completion.nextTaskId && (
          <button type="button" onClick={() => startFreedTimeTask(completion, completion.nextTaskId)}>Začít další</button>
        )}
        {completion.shortTaskId && (
          <button type="button" onClick={() => startFreedTimeTask(completion, completion.shortTaskId)}>Krátký úkol · {completion.shortTaskTitle}</button>
        )}
        <button type="button" onClick={() => { setCompletion(null); window.location.reload(); }}>Volno</button>
        <button type="button" className="df2-completion-undo" onClick={undoCompletion}>Vrátit</button>
      </div>
    </div>,
    document.body,
  );
}
