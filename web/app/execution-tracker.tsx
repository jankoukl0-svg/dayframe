"use client";

import { useEffect } from "react";

type TrackedTask = {
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
  actualStartedAt?: string;
  actualEndedAt?: string;
  actualAccumulatedSeconds?: number;
  actualRunningSince?: string;
  actualMinutes?: number;
  [key: string]: unknown;
};

type StoredState = { plans?: Record<string, TrackedTask[]>; [key: string]: unknown };

const STORAGE_KEY = "dayframe-v1";

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readState(): StoredState | null {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as StoredState | null;
  } catch {
    return null;
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function findTaskForElement(element: HTMLElement, state: StoredState) {
  const tasks = state.plans?.[localDateKey()] ?? [];
  const focusView = element.closest(".df2-focus-view") as HTMLElement | null;
  const nowCard = element.closest(".df2-now-card") as HTMLElement | null;
  const missedArticle = element.closest(".df2-missed article") as HTMLElement | null;
  const title = focusView?.querySelector("h1")?.textContent?.trim()
    || nowCard?.querySelector("h2")?.textContent?.trim()
    || missedArticle?.querySelector("strong")?.textContent?.trim();
  if (!title) return null;
  const matching = tasks.filter((task) => !task.completed && task.title === title);
  if (matching.length <= 1) return matching[0] ?? null;
  const minute = new Date().getHours() * 60 + new Date().getMinutes();
  return matching.sort((a, b) => Math.abs(timeToMinutes(a.start) - minute) - Math.abs(timeToMinutes(b.start) - minute))[0] ?? null;
}

function updateTask(taskId: string, updater: (task: TrackedTask) => TrackedTask) {
  const state = readState();
  if (!state) return;
  const date = localDateKey();
  const tasks = state.plans?.[date];
  if (!tasks) return;
  state.plans = {
    ...state.plans,
    [date]: tasks.map((task) => task.id === taskId ? updater(task) : task),
  };
  writeState(state);
}

function withPlan(task: TrackedTask) {
  return {
    ...task,
    plannedStart: task.plannedStart ?? task.start,
    plannedEnd: task.plannedEnd ?? task.end,
    plannedDuration: task.plannedDuration ?? task.duration,
  };
}

function elapsedSeconds(from?: string, until = new Date()) {
  if (!from) return 0;
  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((until.getTime() - start) / 1000));
}

function startExecution(taskId: string) {
  const now = new Date();
  updateTask(taskId, (task) => ({
    ...withPlan(task),
    actualStartedAt: task.actualStartedAt ?? now.toISOString(),
    actualAccumulatedSeconds: task.actualAccumulatedSeconds ?? 0,
    actualRunningSince: task.actualRunningSince ?? now.toISOString(),
  }));
}

function pauseExecution(taskId: string) {
  const now = new Date();
  updateTask(taskId, (task) => {
    const accumulated = (task.actualAccumulatedSeconds ?? 0) + elapsedSeconds(task.actualRunningSince, now);
    return {
      ...withPlan(task),
      actualAccumulatedSeconds: accumulated,
      actualRunningSince: undefined,
    };
  });
}

function resumeExecution(taskId: string) {
  const now = new Date();
  updateTask(taskId, (task) => ({
    ...withPlan(task),
    actualStartedAt: task.actualStartedAt ?? now.toISOString(),
    actualAccumulatedSeconds: task.actualAccumulatedSeconds ?? 0,
    actualRunningSince: now.toISOString(),
  }));
}

function completeExecution(taskId: string) {
  const now = new Date();
  updateTask(taskId, (task) => {
    const totalSeconds = (task.actualAccumulatedSeconds ?? 0) + elapsedSeconds(task.actualRunningSince, now);
    return {
      ...withPlan(task),
      actualEndedAt: now.toISOString(),
      actualAccumulatedSeconds: totalSeconds,
      actualRunningSince: undefined,
      actualMinutes: task.actualStartedAt ? Math.max(1, Math.round(totalSeconds / 60)) : task.actualMinutes,
    };
  });
}

function preservePlan(taskId: string) {
  updateTask(taskId, withPlan);
}

export function ExecutionTracker() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button") as HTMLButtonElement | null;
      if (!button) return;
      const text = button.textContent?.trim() ?? "";
      const state = readState();
      if (!state) return;
      const task = findTaskForElement(button, state);
      if (!task) return;

      if (text === "Zahájit blok") {
        startExecution(task.id);
        return;
      }

      if (button.closest(".df2-time-adjust-focus-controls")) {
        if (text === "Pauza") pauseExecution(task.id);
        else if (text === "Pokračovat") resumeExecution(task.id);
        else if (text === "Hotovo") completeExecution(task.id);
        else if (text.includes("+15 min")) preservePlan(task.id);
        return;
      }

      if (button.classList.contains("df2-time-done")) {
        completeExecution(task.id);
        return;
      }

      if (text.includes("Pokračovat +15 min")) preservePlan(task.id);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
