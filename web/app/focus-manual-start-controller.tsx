"use client";

import { useEffect } from "react";
import { planningDateKey, planningMinute, timeToMinutes } from "../lib/dayframe-calendar";

type FocusTask = {
  id: string;
  title: string;
  start?: string;
  completed?: boolean;
  actualStartedAt?: string;
  actualRunningSince?: string;
};

type StoredState = {
  plans?: Record<string, FocusTask[]>;
};

const STATE_KEY = "dayframe-v1";
const AUTO_PAUSE_ATTRIBUTE = "focusManualAutoPause";
const START_ATTRIBUTE = "focusManualStart";

function currentFocusTask() {
  const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
  const title = focusView?.querySelector("h1")?.textContent?.trim();
  if (!title || title === "Soustředění") return null;

  let state: StoredState | null = null;
  try {
    state = JSON.parse(window.localStorage.getItem(STATE_KEY) || "null") as StoredState | null;
  } catch {
    return null;
  }
  if (!state?.plans) return null;

  const now = new Date();
  const tasks = state.plans[planningDateKey(now)] ?? [];
  const matching = tasks.filter((task) => !task.completed && task.title === title);
  if (matching.length <= 1) return matching[0] ?? null;

  const minute = planningMinute(now);
  return matching
    .sort((a, b) => Math.abs(timeToMinutes(a.start) - minute) - Math.abs(timeToMinutes(b.start) - minute))[0] ?? null;
}

export function FocusManualStartController() {
  useEffect(() => {
    const sync = () => {
      const controls = document.querySelector<HTMLElement>(".df2-time-adjust-focus-controls");
      const button = controls?.querySelector<HTMLButtonElement>(".df2-time-pause") ?? null;
      const task = currentFocusTask();
      if (!controls || !button || !task) return;

      const text = button.textContent?.trim() ?? "";
      const isRunning = Boolean(task.actualRunningSince);
      const hasStarted = Boolean(task.actualStartedAt);

      // Once the user has explicitly started the block, leaving Focus must not
      // pause it. ActivityTimeController restores a running Focus as "Pauza";
      // in that state we intentionally do nothing.
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
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(sync, 120);
    sync();

    return () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
