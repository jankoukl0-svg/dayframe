"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { localDateKey, planCapturedTasks, type InboxTask, type Task } from "@/lib/dayframe-planning";

type SavedDayframe = {
  schema?: number;
  date?: string;
  tasks?: Task[];
  inboxTasks?: InboxTask[];
  tomorrowDate?: string;
  tomorrowTasks?: Task[];
  milestones?: unknown[];
  dismissedOverdueKeys?: string[];
};

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function tomorrowKey(now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDateKey(tomorrow);
}

function readSaved() {
  try {
    const raw = window.localStorage.getItem("dayframe-v1");
    return raw ? JSON.parse(raw) as SavedDayframe : null;
  } catch {
    return null;
  }
}

function writeSaved(saved: SavedDayframe) {
  window.localStorage.setItem("dayframe-v1", JSON.stringify(saved));
  window.location.reload();
}

export function MissedTaskActions() {
  const [target, setTarget] = useState<Element | null>(null);
  const [missed, setMissed] = useState<Task[]>([]);

  const refresh = useCallback(() => {
    setTarget(document.querySelector(".planner-strip.needs-attention"));
    const saved = readSaved();
    const now = new Date();
    if (!saved || saved.date !== localDateKey(now) || !Array.isArray(saved.tasks)) {
      setMissed([]);
      return;
    }
    const minute = now.getHours() * 60 + now.getMinutes();
    setMissed(saved.tasks.filter((task) => !task.completed && timeToMinutes(task.end) <= minute));
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, [refresh]);

  function markDone(task: Task) {
    const saved = readSaved();
    if (!saved?.tasks) return;
    saved.tasks = saved.tasks.map((item) => item.id === task.id ? { ...item, completed: true } : item);
    writeSaved(saved);
  }

  function moveToTomorrow(task: Task) {
    const saved = readSaved();
    if (!saved?.tasks || !Array.isArray(saved.tomorrowTasks)) return;
    const now = new Date();
    const remainingToday = saved.tasks.filter((item) => item.id !== task.id);
    const moved: InboxTask = {
      id: task.id,
      title: task.title,
      duration: task.duration ?? Math.max(15, timeToMinutes(task.end) - timeToMinutes(task.start)),
      priority: task.priority ?? "normal",
      category: task.category,
      createdAt: now.toISOString(),
      deadline: task.deadline ?? "22:30",
      targetDate: tomorrowKey(now),
    };
    const result = planCapturedTasks(
      remainingToday,
      saved.tomorrowTasks,
      [...(saved.inboxTasks ?? []).filter((item) => item.id !== task.id), moved],
      now,
    );
    saved.tasks = result.today;
    saved.tomorrowTasks = result.tomorrow;
    saved.inboxTasks = result.pending;
    saved.tomorrowDate = tomorrowKey(now);
    saved.dismissedOverdueKeys = (saved.dismissedOverdueKeys ?? []).filter((key) => !key.startsWith(`${task.id}:`));
    writeSaved(saved);
  }

  function cancelTask(task: Task) {
    if (!window.confirm(`Zrušit úkol „${task.title}“?`)) return;
    const saved = readSaved();
    if (!saved?.tasks) return;
    saved.tasks = saved.tasks.filter((item) => item.id !== task.id);
    saved.inboxTasks = (saved.inboxTasks ?? []).filter((item) => item.id !== task.id);
    saved.dismissedOverdueKeys = (saved.dismissedOverdueKeys ?? []).filter((key) => !key.startsWith(`${task.id}:`));
    writeSaved(saved);
  }

  if (!target || missed.length === 0) return null;

  const visible = missed.slice(0, 3);
  return createPortal(
    <div className="missed-task-actions" aria-label="Co udělat s nestihnutými úkoly">
      {visible.map((task) => (
        <div className="missed-task-row" key={task.id}>
          <strong>{task.title}</strong>
          <div>
            <button type="button" onClick={() => markDone(task)}>Hotovo</button>
            <button type="button" onClick={() => moveToTomorrow(task)}>Přesunout na zítra</button>
            <button type="button" onClick={() => cancelTask(task)}>Zrušit</button>
          </div>
        </div>
      ))}
      {missed.length > visible.length && <small>+ {missed.length - visible.length} další</small>}
    </div>,
    target,
  );
}
