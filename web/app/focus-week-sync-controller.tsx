"use client";

import { useEffect } from "react";
import { planningDateKey, planningMinute, timeToMinutes } from "../lib/dayframe-calendar";

const STATE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";

type FocusTask = {
  id: string;
  title: string;
  start?: string;
  end?: string;
  category?: string;
  completed?: boolean;
  actualRunningSince?: string;
};

type StoredState = {
  plans?: Record<string, FocusTask[]>;
};

function readState() {
  try {
    return JSON.parse(window.localStorage.getItem(STATE_KEY) || "null") as StoredState | null;
  } catch {
    return null;
  }
}

function focusTaskFromCurrentPlan(now = new Date()) {
  const state = readState();
  const tasks = state?.plans?.[planningDateKey(now)] ?? [];
  const incomplete = tasks.filter((task) => !task.completed);

  const running = incomplete
    .filter((task) => Boolean(task.actualRunningSince))
    .sort((a, b) => String(b.actualRunningSince).localeCompare(String(a.actualRunningSince)))[0];
  if (running) return running;

  const minute = planningMinute(now);
  const scheduled = incomplete
    .filter((task) => task.start && task.end)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return scheduled.find((task) => timeToMinutes(task.start) <= minute && timeToMinutes(task.end) > minute)
    ?? scheduled.find((task) => timeToMinutes(task.start) > minute)
    ?? incomplete[0]
    ?? null;
}

function syncFocusCopy() {
  const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
  if (!focusView) return;

  const task = focusTaskFromCurrentPlan();
  const title = focusView.querySelector<HTMLElement>("h1");
  const meta = focusView.querySelector<HTMLElement>(":scope > p");
  if (!title || !meta) return;

  const nextTitle = task?.title ?? "Soustředění";
  const nextMeta = task
    ? [task.start, task.category].filter(Boolean).join(" · ") || "Focus blok"
    : "Focus blok";

  if (title.textContent?.trim() !== nextTitle) title.textContent = nextTitle;
  if (meta.textContent?.trim() !== nextMeta) meta.textContent = nextMeta;
}

export function FocusWeekSyncController() {
  useEffect(() => {
    const sync = () => syncFocusCopy();

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (!target) return;

      if (target.closest(".df2-time-adjust-focus-controls") && target.textContent?.trim() === "+15 min") {
        window.setTimeout(() => {
          window.dispatchEvent(new Event(STATE_SYNC_EVENT));
          sync();
        }, 0);
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = window.setInterval(sync, 180);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
