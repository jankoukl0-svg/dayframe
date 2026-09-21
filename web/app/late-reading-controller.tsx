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
  taskId: string;
  fromDate: string;
  duration: number;
  grabOffsetMinutes: number;
  reading: boolean;
};

const STORAGE_KEY = "dayframe-v1";
const DAY_START = 10 * 60;
const NORMAL_DAY_END = 23 * 60;
const LATE_END = 24 * 60;
const MINUTE_HEIGHT = 0.72;
const SNAP = 5;

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

function normalizedTitle(value?: string) {
  return (value ?? "").trim().toLocaleLowerCase("cs-CZ");
}

function isReadingTask(task: StoredTask | null | undefined) {
  return task?.routineId === "read" || normalizedTitle(task?.title) === "čtení knihy";
}

function timeToMinutes(value?: string) {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const safe = Math.max(0, Math.min(LATE_END, Math.round(value)));
  if (safe === LATE_END) return "24:00";
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
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

function rawTargetStart(body: HTMLElement, clientY: number, drag: DragInfo) {
  const rect = body.getBoundingClientRect();
  const pointerMinute = DAY_START + (clientY - rect.top) / MINUTE_HEIGHT;
  return pointerMinute - drag.grabOffsetMinutes;
}

function targetStart(body: HTMLElement, clientY: number, drag: DragInfo) {
  const rawStart = rawTargetStart(body, clientY, drag);
  const minStart = Math.max(DAY_START, NORMAL_DAY_END - drag.duration);
  const maxStart = LATE_END - drag.duration;
  const snapped = Math.round(rawStart / SNAP) * SNAP;
  return Math.max(minStart, Math.min(maxStart, snapped));
}

function usesLateLane(body: HTMLElement, clientY: number, drag: DragInfo) {
  return rawTargetStart(body, clientY, drag) + drag.duration > NORMAL_DAY_END;
}

function canPlace(state: StoredState, date: string, taskId: string, start: number, duration: number) {
  const end = start + duration;
  if (start < DAY_START || end > LATE_END) return false;
  return !(state.plans[date] ?? []).some((task) => {
    if (task.id === taskId || !task.start || !task.end) return false;
    const occupiedStart = timeToMinutes(task.start);
    const occupiedEnd = timeToMinutes(task.end);
    return start < occupiedEnd && end > occupiedStart;
  });
}

function clearPreview() {
  document.querySelectorAll(".df2-reading-late-preview").forEach((node) => node.remove());
  document.querySelector(".df2-week-view")?.classList.remove("df2-reading-late-active");
}

function renderPreview(body: HTMLElement, start: number, duration: number, valid: boolean) {
  clearPreview();
  document.querySelector(".df2-week-view")?.classList.add("df2-reading-late-active");
  const preview = document.createElement("div");
  preview.className = `df2-reading-late-preview ${valid ? "valid" : "invalid"}`;
  preview.style.top = `${(start - DAY_START) * MINUTE_HEIGHT}px`;
  preview.style.height = `${duration * MINUTE_HEIGHT}px`;
  preview.textContent = valid ? `${minutesToTime(start)}–${minutesToTime(start + duration)}` : "není místo";
  body.appendChild(preview);
}

function moveReading(state: StoredState, drag: DragInfo, toDate: string, start: number) {
  const fromTasks = [...(state.plans[drag.fromDate] ?? [])];
  const task = fromTasks.find((item) => item.id === drag.taskId);
  if (!task || !isReadingTask(task)) return false;
  if (!canPlace(state, toDate, task.id, start, task.duration)) return false;

  const end = start + task.duration;
  const moved: StoredTask = {
    ...task,
    id: task.source === "routine" ? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : task.id,
    date: toDate,
    start: minutesToTime(start),
    end: minutesToTime(end),
    requestedStart: minutesToTime(start),
    deadlineTime: minutesToTime(end),
    mode: "flexible",
    source: task.source === "routine" ? "user" : task.source,
    routineId: task.source === "routine" ? undefined : task.routineId,
    dateLocked: true,
    autoScheduled: false,
  };

  state.plans = { ...state.plans };
  state.plans[drag.fromDate] = fromTasks.filter((item) => item.id !== task.id);
  state.plans[toDate] = [...(state.plans[toDate] ?? []).filter((item) => item.id !== task.id), moved]
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  if (task.routineId) {
    state.routineSkips = [...new Set([...(state.routineSkips ?? []), `${task.routineId}:${drag.fromDate}`])];
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return true;
}

export function LateReadingController() {
  useEffect(() => {
    let drag: DragInfo | null = null;

    const onDragStart = (event: DragEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-week-task") : null;
      if (!target) return;
      const day = target.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      const state = readState();
      if (!date || !state) return;
      const task = taskFromButton(state, date, target);
      if (!task) return;
      const rect = target.getBoundingClientRect();
      const grabPixels = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      drag = {
        taskId: task.id,
        fromDate: date,
        duration: task.duration,
        grabOffsetMinutes: Math.max(0, Math.min(task.duration, grabPixels / MINUTE_HEIGHT)),
        reading: isReadingTask(task),
      };
    };

    const onDragOver = (event: DragEvent) => {
      if (!drag) return;
      const body = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-time-body") : null;
      if (!body) return;
      if (!usesLateLane(body, event.clientY, drag)) {
        clearPreview();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!drag.reading) {
        clearPreview();
        return;
      }

      const day = body.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      const state = readState();
      if (!date || !state) return;
      const start = targetStart(body, event.clientY, drag);
      renderPreview(body, start, drag.duration, canPlace(state, date, drag.taskId, start, drag.duration));
    };

    const onDrop = (event: DragEvent) => {
      if (!drag) return;
      const body = event.target instanceof Element ? event.target.closest<HTMLElement>(".df2-time-body") : null;
      if (!body || !usesLateLane(body, event.clientY, drag)) return;

      event.preventDefault();
      event.stopPropagation();

      if (!drag.reading) {
        clearPreview();
        drag = null;
        return;
      }

      const day = body.closest<HTMLElement>(".df2-week-day");
      const date = day ? dateForWeekDay(day) : null;
      const state = readState();
      if (!date || !state) {
        clearPreview();
        drag = null;
        return;
      }

      const start = targetStart(body, event.clientY, drag);
      const moved = moveReading(state, drag, date, start);
      clearPreview();
      drag = null;
      if (moved) window.setTimeout(() => window.location.reload(), 0);
    };

    const onDragEnd = () => {
      clearPreview();
      drag = null;
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
      clearPreview();
    };
  }, []);

  return null;
}
