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
const CELEBRATION_MS = 2400;

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

function decorateCompletionActions() {
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const label = button.textContent?.trim() ?? "";
    const completesTask = label === "Hotovo" || label === "Označit hotovo";
    button.classList.toggle("df2-completion-action", completesTask);
  });
}

function accentCompletedTask(title: string) {
  window.requestAnimationFrame(() => {
    const matches = [...document.querySelectorAll<HTMLElement>(".df2-week-task.done")];
    const target = matches.find((item) => item.querySelector("strong")?.textContent?.trim() === title);
    if (!target) return;
    target.classList.add("df2-just-completed");
    window.setTimeout(() => target.classList.remove("df2-just-completed"), 950);
  });
}

export function CompletionExperienceController() {
  const [completion, setCompletion] = useState<CompletionEvent | null>(null);
  const previousRef = useRef<Map<string, boolean> | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const tasks = readTasks();
      const next = snapshot(tasks);
      const previous = previousRef.current;

      if (previous) {
        const newlyCompleted = tasks
          .filter((task) => Boolean(task.completed) && previous.get(task.id) === false)
          .sort((left, right) => (left.priority === "high" ? -1 : 0) - (right.priority === "high" ? -1 : 0));
        const task = newlyCompleted[0];
        if (task) {
          const event = {
            id: task.id,
            title: task.title,
            priority: task.priority === "high" || task.priority === "low" ? task.priority : "normal",
          } satisfies CompletionEvent;
          setCompletion(event);
          accentCompletedTask(task.title);
          if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
          clearTimerRef.current = window.setTimeout(() => setCompletion(null), CELEBRATION_MS);
        }
      }

      previousRef.current = next;
      decorateCompletionActions();
    };

    sync();
    const interval = window.setInterval(sync, 240);
    const observer = new MutationObserver(decorateCompletionActions);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.clearInterval(interval);
      observer.disconnect();
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
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
