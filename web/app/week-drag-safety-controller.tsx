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

type DragInfo = {
  task: StoredTask;
  fromDate: string;
  grabOffsetMinutes: number;
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const DAY_START = 8 * 60;
const DAY_END = 26 * 60;
const MINUTE_HEIGHT = 0.72;
const SLOT = 15;
const BASE_MAGNET_RANGE = 60;

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

function parseWeekStart() {
  const label = document.querySelector<HTMLElement>(".df2-week-view .df2-page-head p")?.textContent ?? "";
  const values = (label.match(/\d+/g) ?? []).map(Number);
  if (values.length < 5) return null;
  const [startDay, startMonth, , endMonth, endYear] = values;
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return new Date(startYear, startMonth - 1, startDay, 12, 0, 0, 0);
}

function dateForWeekDay(day: HTMLElement) {
  const columns = [...document.querySelectorAll<HTMLElement>(".df2-week-day")];
  const index = columns.indexOf(day);
  const start = parseWeekStart();
  if (index < 0 || !start) return null;
  const date = new Date(start);
  date.setDate(date.getDate() + index);
  return localDateKey(date);
}

function timeToMinutes(value?: string) {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  const clockMinute = hours * 60 + minutes;
  return hours < DAY_START / 60 ? clockMinute + 24 * 60 : clockMinute;
}

function minutesToTime(value: number) {
  const safe = Math.max(0, Math.min(DAY_END, Math.round(value)));
  const clockMinute = safe % (24 * 60);
  return `${String(Math.floor(clockMinute / 60)).padStart(2, "0")}:${String(clockMinute % 60).padStart(2, "0")}`;
}

function normalizedTitle(value?: string) {
  return (value ?? "").trim().toLocaleLowerCase("cs-CZ");
}

function isReadingTask(task: StoredTask) {
  const title = normalizedTitle(task.title);
  return task.routineId === "read" || title === "čtení knihy" || title.includes("čtení");
}

function taskFromButton(state: StoredState, date: string, button: HTMLElement) {
  const title = button.querySelector("strong")?.textContent?.trim() ?? "";
  const range = button.querySelector("span")?.textContent?.trim() ?? "";
  const start = range.split("–")[0]?.trim();
  const tasks = state.plans[date] ?? [];
  return tasks.find((task) => task.title === title && task.start === start && !task.completed)
    ?? tasks.find((task) => task.title === title && !task.completed)
    ?? null;
}

function canPlace(state: StoredState, date: string, taskId: string, start: number, duration: number) {
  const end = start + duration;
  if (start < DAY_START || end > DAY_END) return false;
  return !(state.plans[date] ?? []).some((task) => {
    if (task.id === taskId || !task.start || !task.end) return false;
    const occupiedStart = timeToMinutes(task.start);
    const occupiedEnd = timeToMinutes(task.end);
    return start < occupiedEnd && end > occupiedStart;
  });
}

function desiredStart(body: HTMLElement, clientY: number, drag: DragInfo) {
  const rect = body.getBoundingClientRect();
  const pointerMinute = DAY_START + (clientY - rect.top) / MINUTE_HEIGHT;
  const raw = pointerMinute - drag.grabOffsetMinutes;
  const max = DAY_END - drag.task.duration;
  return Math.max(DAY_START, Math.min(max, Math.round(raw / SLOT) * SLOT));
}

function nearestOpen(state: StoredState, date: string, drag: DragInfo, desired: number, maxDistance?: number) {
  const maxStart = DAY_END - drag.task.duration;
  const candidates: number[] = [];
  for (let candidate = DAY_START; candidate <= maxStart; candidate += SLOT) {
    if (maxDistance != null && Math.abs(candidate - desired) > maxDistance) continue;
    candidates.push(candidate);
  }
  candidates.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b);
  return candidates.find((candidate) => canPlace(state, date, drag.task.id, candidate, drag.task.duration)) ?? null;
}

function clearFallbackPreview() {
  document.querySelectorAll(".df2-cross-day-drop-preview").forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>(".df2-drop-preview:not(.df2-cross-day-drop-preview)")
    .forEach((node) => node.style.removeProperty("visibility"));
}

function renderFallbackPreview(body: HTMLElement, start: number, duration: number) {
  clearFallbackPreview();
  document.querySelectorAll<HTMLElement>(".df2-drop-preview:not(.df2-cross-day-drop-preview)")
    .forEach((node) => { node.style.visibility = "hidden"; });
  const preview = document.createElement("div");
  preview.className = "df2-drop-preview valid df2-cross-day-drop-preview";
  preview.style.top = `${(start - DAY_START) * MINUTE_HEIGHT}px`;
  preview.style.height = `${duration * MINUTE_HEIGHT}px`;
  const label = document.createElement("strong");
  label.textContent = minutesToTime(start);
  preview.appendChild(label);
  body.appendChild(preview);
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

function moveAcrossDays(state: StoredState, drag: DragInfo, toDate: string, start: number) {
  if (toDate === drag.fromDate) return false;
  const source = state.plans[drag.fromDate] ?? [];
  const task = source.find((item) => item.id === drag.task.id);
  if (!task || !canPlace(state, toDate, task.id, start, task.duration)) return false;

  const moved: StoredTask = {
    ...task,
    id: task.source === "routine" ? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : task.id,
    date: toDate,
    start: minutesToTime(start),
    end: minutesToTime(start + task.duration),
    requestedStart: minutesToTime(start),
    mode: "flexible",
    source: task.source === "routine" ? "user" : task.source,
    routineId: task.source === "routine" ? undefined : task.routineId,
    dateLocked: true,
    autoScheduled: false,
  };

  const plans = { ...state.plans };
  plans[drag.fromDate] = source.filter((item) => item.id !== task.id);
  plans[toDate] = sortTasks([...(plans[toDate] ?? []).filter((item) => item.id !== task.id), moved]);
  state.plans = plans;
  if (task.routineId) {
    state.routineSkips = [...new Set([...(state.routineSkips ?? []), `${task.routineId}:${drag.fromDate}`])];
  }
  return true;
}

function restoreMissingUserTask(drag: DragInfo) {
  if (drag.task.source === "routine") return;
  const state = readState();
  if (!state) return;
  const exists = Object.values(state.plans).some((tasks) => tasks.some((task) => task.id === drag.task.id));
  if (exists) return;
  state.plans = { ...state.plans };
  state.plans[drag.fromDate] = sortTasks([
    ...(state.plans[drag.fromDate] ?? []).filter((task) => task.id !== drag.task.id),
    { ...drag.task },
  ]);
  writeState(state);
}

export function WeekDragSafetyController() {
  useEffect(() => {
    let drag: DragInfo | null = null;
    let fallbackTarget: { date: string; start: number } | null = null;

    const onDragStart = (event: DragEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-week-task") : null;
      if (!button) return;
      const day = button.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      const state = readState();
      if (!date || !state) return;
      const task = taskFromButton(state, date, button);
      if (!task) return;
      const rect = button.getBoundingClientRect();
      const grabPixels = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      drag = {
        task: { ...task },
        fromDate: date,
        grabOffsetMinutes: Math.max(0, Math.min(task.duration, grabPixels / MINUTE_HEIGHT)),
      };
      fallbackTarget = null;
    };

    const onDragOver = (event: DragEvent) => {
      if (!drag || isReadingTask(drag.task)) return;
      const body = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-time-body") : null;
      const day = body?.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      if (!body || !date || date === drag.fromDate) {
        fallbackTarget = null;
        clearFallbackPreview();
        return;
      }
      const state = readState();
      if (!state) return;
      const desired = desiredStart(body, event.clientY, drag);
      const nearby = nearestOpen(state, date, drag, desired, BASE_MAGNET_RANGE);
      if (nearby != null) {
        fallbackTarget = null;
        clearFallbackPreview();
        return;
      }
      const fallback = nearestOpen(state, date, drag, desired);
      if (fallback == null) {
        fallbackTarget = null;
        clearFallbackPreview();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      fallbackTarget = { date, start: fallback };
      renderFallbackPreview(body, fallback, drag.task.duration);
    };

    const onDrop = (event: DragEvent) => {
      if (!drag || !fallbackTarget || isReadingTask(drag.task)) return;
      const body = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-time-body") : null;
      const day = body?.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      if (!body || !date || date !== fallbackTarget.date) return;

      event.preventDefault();
      event.stopPropagation();
      const state = readState();
      if (state && moveAcrossDays(state, drag, date, fallbackTarget.start)) writeState(state);
      clearFallbackPreview();
      fallbackTarget = null;
    };

    const onDragEnd = () => {
      const finishedDrag = drag;
      clearFallbackPreview();
      fallbackTarget = null;
      drag = null;
      if (finishedDrag) window.setTimeout(() => restoreMissingUserTask(finishedDrag), 150);
    };

    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      clearFallbackPreview();
    };
  }, []);

  return null;
}
