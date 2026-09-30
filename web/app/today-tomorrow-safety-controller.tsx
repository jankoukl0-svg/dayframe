"use client";

import { useEffect } from "react";

type StoredTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  requestedStart?: string;
  deadlineTime?: string;
  priority?: string;
  category?: string;
  mode?: string;
  completed?: boolean;
  source?: "user" | "routine" | "legacy";
  routineId?: string;
  dateLocked?: boolean;
  autoScheduled?: boolean;
  [key: string]: unknown;
};

type StoredState = {
  plans: Record<string, StoredTask[]>;
  routineSkips?: string[];
  [key: string]: unknown;
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const DAY_START = 8 * 60;
const LUNCH_START = 13 * 60;
const LUNCH_END = 14 * 60;
const DEFAULT_DEADLINE = 22 * 60 + 30;
const SLOT = 15;

function readState(): StoredState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    return parsed?.plans ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(STATE_SYNC_EVENT));
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function planningDateKey(now = new Date()) {
  const date = new Date(now);
  if (date.getHours() < 2) date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function planningMinute(now = new Date()) {
  const minute = now.getHours() * 60 + now.getMinutes();
  return minute < 2 * 60 ? minute + 24 * 60 : minute;
}

function timeToMinutes(value?: string) {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  const minute = hours * 60 + minutes;
  return hours < DAY_START / 60 ? minute + 24 * 60 : minute;
}

function minutesToTime(value: number) {
  const minute = Math.round(value) % (24 * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function canPlace(tasks: StoredTask[], start: number, duration: number, ignoreId: string) {
  const end = start + duration;
  return !tasks.some((task) => {
    if (task.id === ignoreId || !task.start || !task.end) return false;
    const occupiedStart = timeToMinutes(task.start);
    const occupiedEnd = timeToMinutes(task.end);
    return start < occupiedEnd && end > occupiedStart;
  });
}

function findTomorrowSlot(tasks: StoredTask[], task: StoredTask) {
  const parsedDeadline = timeToMinutes(task.deadlineTime);
  const deadline = Number.isFinite(parsedDeadline) ? parsedDeadline : DEFAULT_DEADLINE;
  for (let start = DAY_START; start + task.duration <= deadline; start += SLOT) {
    if (start < LUNCH_END && start + task.duration > LUNCH_START) continue;
    if (canPlace(tasks, start, task.duration, task.id)) return start;
  }
  return null;
}

function sortTasks(tasks: StoredTask[]) {
  return [...tasks].sort((a, b) => {
    const aStart = timeToMinutes(a.start);
    const bStart = timeToMinutes(b.start);
    if (!Number.isFinite(aStart) && Number.isFinite(bStart)) return -1;
    if (Number.isFinite(aStart) && !Number.isFinite(bStart)) return 1;
    if (!Number.isFinite(aStart) && !Number.isFinite(bStart)) return a.title.localeCompare(b.title, "cs");
    return aStart - bStart || a.title.localeCompare(b.title, "cs");
  });
}

function moveMissedTaskToTomorrow(state: StoredState, task: StoredTask, fromDate: string) {
  const tomorrow = addDaysKey(fromDate, 1);
  const source = state.plans[fromDate] ?? [];
  const destination = [...(state.plans[tomorrow] ?? [])];
  const movedId = task.source === "routine"
    ? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : task.id;
  const slot = findTomorrowSlot(destination, task);

  const moved: StoredTask = {
    ...task,
    id: movedId,
    date: tomorrow,
    start: slot == null ? undefined : minutesToTime(slot),
    end: slot == null ? undefined : minutesToTime(slot + task.duration),
    requestedStart: undefined,
    mode: "flexible",
    completed: false,
    source: task.source === "routine" ? "user" : task.source,
    routineId: task.source === "routine" ? undefined : task.routineId,
    dateLocked: true,
    autoScheduled: true,
  };

  state.plans = { ...state.plans };
  state.plans[fromDate] = source.filter((item) => item.id !== task.id);
  state.plans[tomorrow] = sortTasks([
    ...destination.filter((item) => item.id !== task.id && item.id !== movedId),
    moved,
  ]);
  if (task.routineId) {
    state.routineSkips = [...new Set([...(state.routineSkips ?? []), `${task.routineId}:${fromDate}`])];
  }
  return true;
}

export function TodayTomorrowSafetyController() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".df2-missed article button") : null;
      if (!button || button.textContent?.trim() !== "Na zítra") return;
      const article = button.closest<HTMLElement>(".df2-missed article");
      const container = article?.parentElement;
      if (!article || !container) return;
      const articles = [...container.querySelectorAll<HTMLElement>("article")];
      const index = articles.indexOf(article);
      if (index < 0) return;

      const state = readState();
      if (!state) return;
      const now = new Date();
      const today = planningDateKey(now);
      const minute = planningMinute(now);
      const missed = (state.plans[today] ?? []).filter((task) => !task.completed
        && task.end
        && timeToMinutes(task.end) <= minute);
      const task = missed[index];
      if (!task) return;

      event.preventDefault();
      event.stopPropagation();
      if (moveMissedTaskToTomorrow(state, task, today)) writeState(state);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
