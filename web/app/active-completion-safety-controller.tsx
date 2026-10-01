"use client";

import { useEffect, useRef } from "react";
import { planningDateKey, planningMinute, timeToMinutes, minutesToTime } from "../lib/dayframe-calendar";

type StoredTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  completed?: boolean;
  plannedStart?: string;
  plannedEnd?: string;
  plannedDuration?: number;
  [key: string]: unknown;
};

type StoredState = {
  plans?: Record<string, StoredTask[]>;
  [key: string]: unknown;
};

type PendingCompletion = {
  taskId: string;
  date: string;
  finishMinute: number;
  timer: number;
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const AUTO_COMMIT_DELAY_MS = 1000;

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

function commitIfStillPending(taskId: string, date: string, finishMinute: number) {
  const state = readState();
  if (!state) return;
  const tasks = state.plans?.[date];
  if (!tasks) return;
  const target = tasks.find((task) => task.id === taskId);
  if (!target || target.completed || !target.start || !target.end) return;

  const start = timeToMinutes(target.start);
  const plannedEnd = timeToMinutes(target.end);
  if (!Number.isFinite(start) || !Number.isFinite(plannedEnd)) return;
  if (finishMinute < start || finishMinute >= plannedEnd) return;

  const actualEnd = Math.max(start + 1, finishMinute);
  state.plans = {
    ...state.plans,
    [date]: tasks.map((task) => task.id === taskId
      ? {
        ...task,
        plannedStart: task.plannedStart ?? task.start,
        plannedEnd: task.plannedEnd ?? task.end,
        plannedDuration: task.plannedDuration ?? task.duration,
        completed: true,
        end: minutesToTime(actualEnd),
        duration: actualEnd - start,
      }
      : task),
  };
  writeState(state);
}

export function ActiveCompletionSafetyController() {
  const pendingRef = useRef<PendingCompletion | null>(null);

  useEffect(() => {
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
      const end = timeToMinutes(found.task.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || finishMinute < start || finishMinute >= end) return;

      if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
      const timer = window.setTimeout(() => {
        commitIfStillPending(found.task.id, found.date, finishMinute);
        if (pendingRef.current?.taskId === found.task.id) pendingRef.current = null;
      }, AUTO_COMMIT_DELAY_MS);
      pendingRef.current = { taskId: found.task.id, date: found.date, finishMinute, timer };
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
    };
  }, []);

  return null;
}
