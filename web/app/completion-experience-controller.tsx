"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StoredTask = {
  id: string;
  title: string;
  completed?: boolean;
  priority?: "high" | "normal" | "low";
};

type StoredState = {
  plans?: Record<string, StoredTask[]>;
};

type CompletionEvent = {
  id: string;
  title: string;
  priority: "high" | "normal" | "low";
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const PENDING_COMPLETION_KEY = "dayframe-completion-pending-v1";
const CELEBRATION_MS = 2400;
const PENDING_MAX_AGE_MS = 15_000;

function readTasks() {
  try {
    const state = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as StoredState | null;
    if (!state?.plans) return [];
    return Object.values(state.plans).flat().filter((task): task is StoredTask => Boolean(task?.id && task?.title));
  } catch {
    return [];
  }
}

function snapshot(tasks: StoredTask[]) {
  return new Map(tasks.map((task) => [task.id, Boolean(task.completed)]));
}

function completionRank(task: StoredTask) {
  return task.priority === "high" ? 0 : task.priority === "normal" ? 1 : 2;
}

function completionEvent(task: StoredTask): CompletionEvent {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority === "high" || task.priority === "low" ? task.priority : "normal",
  };
}

function newlyCompletedTask(tasks: StoredTask[], previous: Map<string, boolean>) {
  return tasks
    .filter((task) => Boolean(task.completed) && previous.get(task.id) === false)
    .sort((left, right) => completionRank(left) - completionRank(right))[0] ?? null;
}

function rememberPendingCompletion(task: StoredTask) {
  try {
    window.sessionStorage.setItem(PENDING_COMPLETION_KEY, JSON.stringify({
      id: task.id,
      completedAt: Date.now(),
    }));
  } catch {
    // The normal in-page feedback path still works when sessionStorage is unavailable.
  }
}

function consumePendingCompletion(tasks: StoredTask[]) {
  try {
    const raw = window.sessionStorage.getItem(PENDING_COMPLETION_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_COMPLETION_KEY);
    const pending = JSON.parse(raw) as { id?: string; completedAt?: number };
    if (!pending.id || !Number.isFinite(pending.completedAt)) return null;
    const age = Date.now() - Number(pending.completedAt);
    if (age < 0 || age > PENDING_MAX_AGE_MS) return null;
    const task = tasks.find((item) => item.id === pending.id && item.completed);
    return task ? completionEvent(task) : null;
  } catch {
    return null;
  }
}

function decorateCompletionActions() {
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const label = button.textContent?.trim() ?? "";
    const completesTask = label === "Hotovo" || label === "Označit hotovo";
    button.classList.toggle("df2-completion-action", completesTask);
  });
}

function accentCompletedTask(title: string, attempt = 0) {
  window.requestAnimationFrame(() => {
    const matches = [...document.querySelectorAll<HTMLElement>(".df2-week-task.done")];
    const target = matches.find((item) => item.querySelector("strong")?.textContent?.trim() === title);
    if (!target) {
      if (attempt < 4) window.setTimeout(() => accentCompletedTask(title, attempt + 1), 70);
      return;
    }
    target.classList.add("df2-just-completed");
    window.setTimeout(() => target.classList.remove("df2-just-completed"), 950);
  });
}

export function CompletionExperienceController() {
  const [completion, setCompletion] = useState<CompletionEvent | null>(null);
  const previousRef = useRef<Map<string, boolean> | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const present = (event: CompletionEvent) => {
      setCompletion(event);
      accentCompletedTask(event.title);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setCompletion(null), CELEBRATION_MS);
    };

    const sync = () => {
      const tasks = readTasks();
      const next = snapshot(tasks);
      const previous = previousRef.current;

      if (previous) {
        const task = newlyCompletedTask(tasks, previous);
        if (task) present(completionEvent(task));
      } else {
        const pending = consumePendingCompletion(tasks);
        if (pending) present(pending);
      }

      previousRef.current = next;
      decorateCompletionActions();
    };

    const captureBeforeReload = () => {
      const previous = previousRef.current;
      if (!previous) return;
      const task = newlyCompletedTask(readTasks(), previous);
      if (task) rememberPendingCompletion(task);
    };

    sync();
    const interval = window.setInterval(sync, 240);
    const observer = new MutationObserver(decorateCompletionActions);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("beforeunload", captureBeforeReload);

    return () => {
      window.clearInterval(interval);
      observer.disconnect();
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("beforeunload", captureBeforeReload);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  if (!completion) return null;
  const important = completion.priority === "high";

  return createPortal(
    <div
      className={`df2-completion-experience${important ? " important" : ""}`}
      data-completion-experience="true"
      data-completion-task-id={completion.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="df2-completion-check" aria-hidden="true">✓</span>
      <div className="df2-completion-copy">
        <small>{important ? "Jarvis" : "Hotovo"}</small>
        <strong>{important ? "Hlavní priorita splněna" : completion.title}</strong>
        {important && <span>{completion.title}</span>}
      </div>
    </div>,
    document.body,
  );
}
