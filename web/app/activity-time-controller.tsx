"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Task = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  requestedStart?: string;
  completed: boolean;
  dateLocked?: boolean;
  autoScheduled?: boolean;
};

type StoredState = {
  schema: number;
  plans: Record<string, Task[]>;
  [key: string]: unknown;
};

type ActiveTarget = { host: HTMLElement; taskId: string };
type FocusTarget = { host: HTMLElement; taskId: string };
type MissedTarget = { host: HTMLElement; taskId: string };
type CompletionChoice = {
  taskId: string;
  finishMinute: number;
  savedMinutes: number;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
};

const STATE_KEY = "dayframe-v1";
const EXTEND_MINUTES = 15;

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeToMinutes(time?: string) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function readState(): StoredState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed || typeof parsed !== "object" || !parsed.plans || typeof parsed.plans !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function todayTasks(state: StoredState | null, now = new Date()) {
  if (!state) return [];
  return state.plans[localDateKey(now)] ?? [];
}

function currentMinute(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function liveTask(tasks: Task[], minute: number) {
  return tasks
    .filter((task) => !task.completed && task.start && task.end)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
    .find((task) => timeToMinutes(task.start) <= minute && timeToMinutes(task.end) > minute) ?? null;
}

function missedTasks(tasks: Task[], minute: number) {
  return tasks
    .filter((task) => !task.completed && task.end && timeToMinutes(task.end) <= minute)
    .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));
}

function nextTask(tasks: Task[], currentId: string, minute: number) {
  return tasks
    .filter((task) => task.id !== currentId && !task.completed && task.start && task.end && timeToMinutes(task.start) >= minute)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))[0] ?? null;
}

function sameActiveTarget(a: ActiveTarget | null, b: ActiveTarget | null) {
  return a?.host === b?.host && a?.taskId === b?.taskId;
}

function sameFocusTarget(a: FocusTarget | null, b: FocusTarget | null) {
  return a?.host === b?.host && a?.taskId === b?.taskId;
}

function sameMissedTargets(a: MissedTarget[], b: MissedTarget[]) {
  return a.length === b.length && a.every((item, index) => item.host === b[index]?.host && item.taskId === b[index]?.taskId);
}

function finishTask(taskId: string, finishMinute: number, startNext: boolean) {
  const state = readState();
  if (!state) return false;
  const date = localDateKey(new Date());
  const tasks = [...(state.plans[date] ?? [])];
  const target = tasks.find((task) => task.id === taskId);
  if (!target?.start) return false;

  const start = timeToMinutes(target.start);
  const actualEnd = Math.max(start + 1, finishMinute);
  const updated = tasks.map((task) => task.id === taskId
    ? {
      ...task,
      completed: true,
      end: minutesToTime(actualEnd),
      duration: actualEnd - start,
    }
    : task);

  if (startNext) {
    const candidate = nextTask(updated, taskId, actualEnd);
    if (candidate?.start) {
      const candidateDuration = Math.max(1, candidate.duration || (timeToMinutes(candidate.end) - timeToMinutes(candidate.start)));
      const candidateEnd = actualEnd + candidateDuration;
      if (candidateEnd <= 23 * 60 + 59) {
        const index = updated.findIndex((task) => task.id === candidate.id);
        updated[index] = {
          ...candidate,
          start: minutesToTime(actualEnd),
          end: minutesToTime(candidateEnd),
          requestedStart: minutesToTime(actualEnd),
          dateLocked: true,
          autoScheduled: false,
        };
      }
    }
  }

  state.plans = { ...state.plans, [date]: updated };
  writeState(state);
  return true;
}

function extendTask(taskId: string, now = new Date()) {
  const state = readState();
  if (!state) return { ok: false, error: "Plán se nepodařilo načíst." };
  const date = localDateKey(now);
  const tasks = [...(state.plans[date] ?? [])];
  const target = tasks.find((task) => task.id === taskId);
  if (!target?.start || !target.end) return { ok: false, error: "Blok nemá konkrétní čas." };

  const targetStart = timeToMinutes(target.start);
  const oldEnd = timeToMinutes(target.end);
  const extendedEnd = Math.max(oldEnd, currentMinute(now)) + EXTEND_MINUTES;
  if (extendedEnd > 23 * 60 + 59) return { ok: false, error: "Dnes už není další prostor." };

  const sorted = tasks
    .map((task) => ({ ...task }))
    .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
  let cursor = extendedEnd;
  let seenTarget = false;

  for (const task of sorted) {
    if (task.id === taskId) {
      task.end = minutesToTime(extendedEnd);
      task.duration = extendedEnd - targetStart;
      seenTarget = true;
      continue;
    }
    if (!seenTarget || task.completed || !task.start || !task.end) continue;

    const start = timeToMinutes(task.start);
    const duration = Math.max(1, task.duration || (timeToMinutes(task.end) - start));
    if (start < cursor) {
      const shiftedEnd = cursor + duration;
      if (shiftedEnd > 23 * 60 + 59) return { ok: false, error: "Navazující bloky už se dnes nevejdou." };
      task.start = minutesToTime(cursor);
      task.end = minutesToTime(shiftedEnd);
      task.requestedStart = task.start;
      task.dateLocked = true;
      task.autoScheduled = false;
      cursor = shiftedEnd;
    } else {
      cursor = timeToMinutes(task.end);
    }
  }

  const byId = new Map(sorted.map((task) => [task.id, task]));
  state.plans = { ...state.plans, [date]: tasks.map((task) => byId.get(task.id) ?? task) };
  writeState(state);
  return { ok: true, error: "" };
}

function focusTaskForView(tasks: Task[], focusView: HTMLElement | null) {
  const title = focusView?.querySelector("h1")?.textContent?.trim();
  if (!title || title === "Soustředění") return null;
  const matching = tasks.filter((task) => !task.completed && task.title === title);
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) {
    return matching
      .sort((a, b) => Math.abs(timeToMinutes(a.start) - currentMinute()) - Math.abs(timeToMinutes(b.start) - currentMinute()))[0] ?? null;
  }
  return null;
}

export function ActivityTimeController() {
  const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [missedTargets, setMissedTargets] = useState<MissedTarget[]>([]);
  const [completion, setCompletion] = useState<CompletionChoice | null>(null);
  const [error, setError] = useState("");
  const [focusError, setFocusError] = useState("");
  const [focusExtendedBy, setFocusExtendedBy] = useState(0);
  const focusTaskIdRef = useRef<string | null>(null);
  const completionRef = useRef<CompletionChoice | null>(null);
  completionRef.current = completion;

  useEffect(() => {
    const sync = () => {
      const now = new Date();
      const minute = currentMinute(now);
      const tasks = todayTasks(readState(), now);
      const active = liveTask(tasks, minute);
      const actions = document.querySelector<HTMLElement>(".df2-now-actions");
      let nextActive: ActiveTarget | null = null;

      if (active && actions) {
        let host = actions.querySelector<HTMLElement>("[data-activity-time-active]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.activityTimeActive = "true";
          host.className = "df2-time-adjust-host";
          actions.appendChild(host);
        }
        nextActive = { host, taskId: active.id };
      }

      setActiveTarget((current) => sameActiveTarget(current, nextActive) ? current : nextActive);

      const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
      const focusActions = focusView?.querySelector<HTMLElement>(".df2-focus-actions") ?? null;
      const focusTask = focusTaskForView(tasks, focusView);
      let nextFocus: FocusTarget | null = null;

      if (focusTask && focusActions) {
        let host = focusActions.querySelector<HTMLElement>("[data-activity-time-focus]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.activityTimeFocus = "true";
          host.className = "df2-time-adjust-focus-host";
          focusActions.appendChild(host);
        }
        nextFocus = { host, taskId: focusTask.id };
      }

      if (focusTaskIdRef.current !== nextFocus?.taskId) {
        focusTaskIdRef.current = nextFocus?.taskId ?? null;
        setFocusExtendedBy(0);
        setFocusError("");
        setCompletion((current) => current?.taskId === nextFocus?.taskId ? current : null);
      }
      setFocusTarget((current) => sameFocusTarget(current, nextFocus) ? current : nextFocus);

      const missed = missedTasks(tasks, minute);
      const articles = [...document.querySelectorAll<HTMLElement>(".df2-missed article")];
      const nextMissed: MissedTarget[] = [];
      const used = new Set<string>();

      for (const article of articles) {
        const title = article.querySelector("strong")?.textContent?.trim();
        const task = missed.find((item) => !used.has(item.id) && item.title === title);
        const actionRow = article.querySelector<HTMLElement>(":scope > div:last-child");
        if (!task || !actionRow) continue;
        used.add(task.id);
        let host = actionRow.querySelector<HTMLElement>("[data-activity-time-missed]");
        if (!host) {
          host = document.createElement("span");
          host.dataset.activityTimeMissed = "true";
          host.className = "df2-time-adjust-missed-host";
          actionRow.appendChild(host);
        }
        nextMissed.push({ host, taskId: task.id });
      }

      setMissedTargets((current) => sameMissedTargets(current, nextMissed) ? current : nextMissed);
    };

    sync();
    const timer = window.setInterval(sync, 180);
    return () => window.clearInterval(timer);
  }, []);

  function completeEarly(taskId: string) {
    setError("");
    setFocusError("");
    const now = new Date();
    const minute = currentMinute(now);
    const tasks = todayTasks(readState(), now);
    const task = tasks.find((item) => item.id === taskId);
    if (!task?.start || !task.end) return;
    const savedMinutes = Math.max(0, timeToMinutes(task.end) - minute);
    if (savedMinutes <= 0) {
      if (finishTask(taskId, minute, false)) window.location.reload();
      return;
    }
    const next = nextTask(tasks, taskId, minute);
    setCompletion({
      taskId,
      finishMinute: minute,
      savedMinutes,
      nextTaskId: next?.id ?? null,
      nextTaskTitle: next?.title ?? null,
    });
  }

  function chooseCompletion(startNext: boolean) {
    const choice = completionRef.current;
    if (!choice) return;
    if (finishTask(choice.taskId, choice.finishMinute, startNext)) window.location.reload();
  }

  function extend(taskId: string) {
    setError("");
    const result = extendTask(taskId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.reload();
  }

  function extendInFocus(taskId: string) {
    setFocusError("");
    const result = extendTask(taskId);
    if (!result.ok) {
      setFocusError(result.error);
      return;
    }
    setFocusExtendedBy((minutes) => minutes + EXTEND_MINUTES);
  }

  const activePortal = activeTarget
    ? createPortal(
      completion?.taskId === activeTarget.taskId ? (
        <div className="df2-time-adjust-finish" aria-live="polite">
          <strong>+{completion.savedMinutes} min volných</strong>
          {completion.nextTaskId && <button type="button" onClick={() => chooseCompletion(true)}>Začít další</button>}
          <button type="button" onClick={() => chooseCompletion(false)}>Volno</button>
        </div>
      ) : (
        <>
          <button type="button" className="df2-time-done" onClick={() => completeEarly(activeTarget.taskId)}>Hotovo</button>
          <button type="button" onClick={() => extend(activeTarget.taskId)}>Pokračovat +15 min</button>
          {error && <small className="df2-time-adjust-error">{error}</small>}
        </>
      ),
      activeTarget.host,
    )
    : null;

  const focusPortal = focusTarget
    ? createPortal(
      completion?.taskId === focusTarget.taskId ? (
        <div className="df2-time-adjust-focus-completion" aria-live="polite">
          <strong>Hotovo · +{completion.savedMinutes} min volných</strong>
          {completion.nextTaskId && <button type="button" onClick={() => chooseCompletion(true)}>Začít další</button>}
          <button type="button" onClick={() => chooseCompletion(false)}>Ukončit blok</button>
        </div>
      ) : (
        <div className="df2-time-adjust-focus-controls">
          <button type="button" className="df2-time-done" onClick={() => completeEarly(focusTarget.taskId)}>Hotovo</button>
          <button type="button" onClick={() => extendInFocus(focusTarget.taskId)}>Pokračovat +15 min</button>
          {focusExtendedBy > 0 && <small className="df2-time-adjust-focus-added">+{focusExtendedBy} min k aktivitě</small>}
          {focusError && <small className="df2-time-adjust-error">{focusError}</small>}
        </div>
      ),
      focusTarget.host,
    )
    : null;

  return (
    <>
      {activePortal}
      {focusPortal}
      {missedTargets.map(({ host, taskId }) => createPortal(
        <button key={taskId} type="button" onClick={() => extend(taskId)}>Pokračovat +15 min</button>,
        host,
      ))}
    </>
  );
}
