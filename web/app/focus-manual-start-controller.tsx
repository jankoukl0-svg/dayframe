"use client";

import { useEffect } from "react";
import { planningDateKey, planningMinute, timeToMinutes } from "../lib/dayframe-calendar";

type FocusTask = {
  id: string;
  title: string;
  category?: string;
  duration?: number;
  start?: string;
  end?: string;
  completed?: boolean;
  actualStartedAt?: string;
  actualAccumulatedSeconds?: number;
  actualRunningSince?: string;
};

type StoredState = {
  plans?: Record<string, FocusTask[]>;
};

const STATE_KEY = "dayframe-v1";
const AUTO_PAUSE_ATTRIBUTE = "focusManualAutoPause";
const START_ATTRIBUTE = "focusManualStart";

function readCurrentTasks() {
  let state: StoredState | null = null;
  try {
    state = JSON.parse(window.localStorage.getItem(STATE_KEY) || "null") as StoredState | null;
  } catch {
    return [];
  }
  if (!state?.plans) return [];
  return state.plans[planningDateKey(new Date())] ?? [];
}

function currentFocusTask() {
  const tasks = readCurrentTasks();
  if (!tasks.length) return null;

  // A focus session that is actually running remains the source of truth even
  // if the underlying schedule is edited while the user is focused.
  const running = tasks.find((task) => !task.completed && Boolean(task.actualRunningSince));
  if (running) return running;

  const minute = planningMinute(new Date());
  const scheduled = tasks
    .filter((task) => !task.completed && task.start && task.end)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return scheduled.find((task) => timeToMinutes(task.start) <= minute && timeToMinutes(task.end) > minute)
    ?? scheduled.find((task) => timeToMinutes(task.start) > minute)
    ?? tasks.find((task) => !task.completed)
    ?? null;
}

function syncFocusIdentity(task: FocusTask | null) {
  const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
  if (!focusView) return;

  const title = focusView.querySelector<HTMLElement>(":scope > h1");
  const meta = focusView.querySelector<HTMLElement>(":scope > p");

  if (!task) {
    delete focusView.dataset.focusTaskId;
    if (title && title.textContent !== "Soustředění") title.textContent = "Soustředění";
    if (meta && meta.textContent !== "Focus blok") meta.textContent = "Focus blok";
    return;
  }

  focusView.dataset.focusTaskId = task.id;
  if (title && title.textContent !== task.title) title.textContent = task.title;
  const metaText = [task.start, task.category].filter(Boolean).join(" · ") || "Focus blok";
  if (meta && meta.textContent !== metaText) meta.textContent = metaText;
}

function scheduledRemainingAt(task: FocusTask, at: Date) {
  if (!task.start || !task.end) return Math.max(0, (task.duration ?? 0) * 60);
  const startSeconds = timeToMinutes(task.start) * 60;
  const endSeconds = timeToMinutes(task.end) * 60;
  const atSeconds = planningMinute(at) * 60 + at.getSeconds();
  if (atSeconds < startSeconds) return Math.max(0, (task.duration ?? 0) * 60);
  return Math.max(0, endSeconds - atSeconds);
}

function elapsedExecutionSeconds(task: FocusTask, now: Date) {
  let elapsed = Math.max(0, task.actualAccumulatedSeconds ?? 0);
  if (!task.actualRunningSince) return elapsed;

  const runningSince = new Date(task.actualRunningSince).getTime();
  if (!Number.isFinite(runningSince)) return elapsed;
  elapsed += Math.max(0, Math.floor((now.getTime() - runningSince) / 1000));
  return elapsed;
}

function persistedRemainingSeconds(task: FocusTask, now = new Date()) {
  if (!task.actualStartedAt) return null;
  const startedAt = new Date(task.actualStartedAt);
  if (!Number.isFinite(startedAt.getTime())) return null;

  const initialBudget = scheduledRemainingAt(task, startedAt);
  return Math.max(0, initialBudget - elapsedExecutionSeconds(task, now));
}

function formatFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function syncPersistedClock(task: FocusTask) {
  const clock = document.querySelector<HTMLElement>(".df2-controller-focus-clock");
  if (!clock) return;
  const remaining = persistedRemainingSeconds(task);
  if (remaining === null) return;

  const text = formatFocusTime(remaining);
  if (clock.textContent !== text) clock.textContent = text;
  const label = `Zbývá ${text}`;
  if (clock.getAttribute("aria-label") !== label) clock.setAttribute("aria-label", label);
}

export function FocusManualStartController() {
  useEffect(() => {
    const sync = () => {
      const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
      if (!focusView) return;

      const task = currentFocusTask();
      syncFocusIdentity(task);

      const controls = document.querySelector<HTMLElement>(".df2-time-adjust-focus-controls");
      const button = controls?.querySelector<HTMLButtonElement>(".df2-time-pause") ?? null;
      if (!controls || !button || !task) return;

      syncPersistedClock(task);

      const text = button.textContent?.trim() ?? "";
      const isRunning = Boolean(task.actualRunningSince);
      const hasStarted = Boolean(task.actualStartedAt);

      // Once Start has been pressed, the persisted execution timestamp is the
      // source of truth. Leaving the tab or Focus view must not pause the run.
      if (isRunning) {
        delete button.dataset[START_ATTRIBUTE];
        return;
      }

      // A never-started or explicitly paused block must be visually paused on
      // entry. This click only synchronizes the React timer state; the execution
      // tracker ignores it unless a persisted run actually exists.
      if (text === "Pauza") {
        button.dataset[AUTO_PAUSE_ATTRIBUTE] = "true";
        button.click();
        window.setTimeout(() => {
          delete button.dataset[AUTO_PAUSE_ATTRIBUTE];
          sync();
        }, 0);
        return;
      }

      if (!hasStarted && text === "Pokračovat") {
        button.textContent = "Start";
        button.dataset[START_ATTRIBUTE] = "true";
        return;
      }

      if (hasStarted && text === "Start") {
        button.textContent = "Pokračovat";
        delete button.dataset[START_ATTRIBUTE];
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(".df2-time-adjust-focus-controls .df2-time-pause");
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset[AUTO_PAUSE_ATTRIBUTE] === "true") return;
      if (button.textContent?.trim() === "Start") delete button.dataset[START_ATTRIBUTE];
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(sync, 120);
    sync();

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
