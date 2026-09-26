"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calendarBounds } from "../lib/dayframe-calendar";

type Task = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  requestedStart?: string;
  deadlineTime?: string;
  priority?: "high" | "normal" | "low";
  category?: string;
  completed: boolean;
  source?: "user" | "routine" | "legacy";
  routineId?: string;
  dateLocked?: boolean;
  autoScheduled?: boolean;
  createdAt?: string;
};

type StoredState = {
  schema: number;
  plans: Record<string, Task[]>;
  [key: string]: unknown;
};

type ActiveTarget = { host: HTMLElement; taskId: string };
type FocusTarget = { actionsHost: HTMLElement; clockHost: HTMLElement; taskId: string };
type MissedTarget = { host: HTMLElement; taskId: string };
type CompletionChoice = {
  taskId: string;
  finishMinute: number;
  savedMinutes: number;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
  shortTaskId: string | null;
  shortTaskTitle: string | null;
};

const STATE_KEY = "dayframe-v1";
const EXTEND_MINUTES = 15;
const DAY_START = calendarBounds.dayStart;
const LUNCH_START = 13 * 60;
const LUNCH_END = 14 * 60;
const DAY_END = 22 * 60 + 30;
const WEEK_VIEW_END = 23 * 60;
const SLOT = 15;
const MINUTE_HEIGHT = 0.72;

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

function currentSecond(now = new Date()) {
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
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

function priorityRank(priority?: Task["priority"]) {
  return priority === "high" ? 0 : priority === "low" ? 2 : 1;
}

function shortTask(tasks: Task[], currentId: string, nextId: string | null, savedMinutes: number, originalEnd: number) {
  return tasks
    .filter((task) => task.id !== currentId
      && task.id !== nextId
      && !task.completed
      && task.duration > 0
      && task.duration <= savedMinutes
      && task.source !== "routine"
      && !task.requestedStart
      && task.autoScheduled !== false
      && (!task.start || timeToMinutes(task.start) >= originalEnd))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)
      || b.duration - a.duration
      || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0] ?? null;
}

function sameActiveTarget(a: ActiveTarget | null, b: ActiveTarget | null) {
  return a?.host === b?.host && a?.taskId === b?.taskId;
}

function sameFocusTarget(a: FocusTarget | null, b: FocusTarget | null) {
  return a?.actionsHost === b?.actionsHost && a?.clockHost === b?.clockHost && a?.taskId === b?.taskId;
}

function sameMissedTargets(a: MissedTarget[], b: MissedTarget[]) {
  return a.length === b.length && a.every((item, index) => item.host === b[index]?.host && item.taskId === b[index]?.taskId);
}

function finishTask(taskId: string, finishMinute: number, startTaskId: string | null) {
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

  if (startTaskId) {
    const candidate = updated.find((task) => task.id === startTaskId && !task.completed);
    if (candidate) {
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

    const startMinute = timeToMinutes(task.start);
    const duration = Math.max(1, task.duration || (timeToMinutes(task.end) - startMinute));
    if (startMinute < cursor) {
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

function overlapsLunch(start: number, end: number) {
  return start < LUNCH_END && end > LUNCH_START;
}

function canFit(tasks: Task[], start: number, duration: number) {
  const end = start + duration;
  return !tasks.some((task) => {
    if (!task.start || !task.end) return false;
    const occupiedStart = timeToMinutes(task.start);
    const occupiedEnd = timeToMinutes(task.end);
    return start < occupiedEnd && end > occupiedStart;
  });
}

function findReplanSlot(tasks: Task[], duration: number, floor: number, deadline: number, avoidLunch: boolean) {
  for (let start = floor; start + duration <= deadline; start += SLOT) {
    if (avoidLunch && overlapsLunch(start, start + duration)) continue;
    if (canFit(tasks, start, duration)) return start;
  }
  return null;
}

function isFixedForToday(task: Task) {
  return task.source === "routine" || Boolean(task.requestedStart) || task.autoScheduled === false;
}

function replanRemainingToday(now = new Date()) {
  const state = readState();
  if (!state) return false;
  const date = localDateKey(now);
  const minute = currentMinute(now);
  const floor = Math.max(DAY_START, Math.ceil(minute / SLOT) * SLOT);
  const tasks = [...(state.plans[date] ?? [])];
  const keep: Task[] = [];
  const movable: Task[] = [];

  for (const task of tasks) {
    const start = timeToMinutes(task.start);
    const alreadyStarted = Number.isFinite(start) && start <= minute;
    if (task.completed || alreadyStarted || isFixedForToday(task)) {
      keep.push(task);
    } else {
      movable.push({ ...task, start: undefined, end: undefined });
    }
  }

  movable.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)
    || (a.deadlineTime ?? "22:30").localeCompare(b.deadlineTime ?? "22:30")
    || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  const placed = [...keep];
  for (const task of movable) {
    const parsedDeadline = timeToMinutes(task.deadlineTime);
    const deadline = Math.min(DAY_END, Number.isFinite(parsedDeadline) ? parsedDeadline : DAY_END);
    let slot = findReplanSlot(placed, task.duration, floor, deadline, true);
    if (slot === null) slot = findReplanSlot(placed, task.duration, floor, deadline, false);
    if (slot === null) {
      placed.push(task);
      continue;
    }
    placed.push({
      ...task,
      start: minutesToTime(slot),
      end: minutesToTime(slot + task.duration),
      autoScheduled: true,
    });
  }

  state.plans = {
    ...state.plans,
    [date]: placed.sort((a, b) => {
      if (!a.start && b.start) return -1;
      if (a.start && !b.start) return 1;
      if (!a.start && !b.start) return priorityRank(a.priority) - priorityRank(b.priority);
      return (a.start ?? "").localeCompare(b.start ?? "");
    }),
  };
  writeState(state);
  return true;
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

function remainingFocusSeconds(task: Task, now = new Date()) {
  if (!task.start || !task.end) return Math.max(0, task.duration * 60);
  const startSeconds = timeToMinutes(task.start) * 60;
  const endSeconds = timeToMinutes(task.end) * 60;
  const nowSeconds = currentSecond(now);
  if (nowSeconds < startSeconds) return Math.max(0, task.duration * 60);
  return Math.max(0, endSeconds - nowSeconds);
}

function formatFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function syncCurrentTimeLine(now = new Date()) {
  const body = document.querySelector<HTMLElement>(".df2-week-day.today .df2-time-body");
  if (!body) return;
  let line = body.querySelector<HTMLElement>("[data-current-time-line]");
  if (!line) {
    line = document.createElement("div");
    line.dataset.currentTimeLine = "true";
    line.className = "df2-current-time-line";
    const label = document.createElement("span");
    line.appendChild(label);
    body.appendChild(line);
  }

  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const visible = minute >= DAY_START && minute <= WEEK_VIEW_END;
  line.hidden = !visible;
  if (!visible) return;
  line.style.top = `${(minute - DAY_START) * MINUTE_HEIGHT}px`;
  const label = line.querySelector("span");
  if (label) label.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function ActivityTimeController() {
  const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [missedTargets, setMissedTargets] = useState<MissedTarget[]>([]);
  const [replanHost, setReplanHost] = useState<HTMLElement | null>(null);
  const [completion, setCompletion] = useState<CompletionChoice | null>(null);
  const [error, setError] = useState("");
  const [focusError, setFocusError] = useState("");
  const [focusExtendedBy, setFocusExtendedBy] = useState(0);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [focusRunning, setFocusRunning] = useState(false);
  const focusTaskIdRef = useRef<string | null>(null);
  const completionRef = useRef<CompletionChoice | null>(null);
  completionRef.current = completion;

  useEffect(() => {
    if (!focusTarget || !focusRunning) return;
    const timer = window.setInterval(() => {
      setFocusSeconds((seconds) => {
        if (seconds <= 1) {
          setFocusRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusTarget, focusRunning]);

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

      const todayHeader = document.querySelector<HTMLElement>(".df2-today-view .df2-page-head");
      if (todayHeader) {
        let host = todayHeader.querySelector<HTMLElement>("[data-replan-today]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.replanToday = "true";
          host.className = "df2-replan-host";
          const accent = todayHeader.querySelector<HTMLElement>(".df2-accent-button");
          todayHeader.insertBefore(host, accent ?? null);
        }
        setReplanHost((current) => current === host ? current : host);
      } else {
        setReplanHost((current) => current === null ? current : null);
      }

      const focusView = document.querySelector<HTMLElement>(".df2-focus-view");
      const focusActions = focusView?.querySelector<HTMLElement>(".df2-focus-actions") ?? null;
      const nativeClock = focusView?.querySelector<HTMLElement>(":scope > .df2-focus-clock") ?? null;
      const focusTask = focusTaskForView(tasks, focusView);
      let nextFocus: FocusTarget | null = null;

      if (focusTask && focusActions && nativeClock && focusView) {
        let actionsHost = focusActions.querySelector<HTMLElement>("[data-activity-time-focus]");
        if (!actionsHost) {
          actionsHost = document.createElement("div");
          actionsHost.dataset.activityTimeFocus = "true";
          actionsHost.className = "df2-time-adjust-focus-host";
          focusActions.appendChild(actionsHost);
        }
        let clockHost = focusView.querySelector<HTMLElement>("[data-focus-clock-host]");
        if (!clockHost) {
          clockHost = document.createElement("div");
          clockHost.dataset.focusClockHost = "true";
          clockHost.className = "df2-focus-clock-host";
          nativeClock.insertAdjacentElement("afterend", clockHost);
        }
        nextFocus = { actionsHost, clockHost, taskId: focusTask.id };
      }

      const nextFocusTaskId = nextFocus?.taskId ?? null;
      if (focusTaskIdRef.current !== nextFocusTaskId) {
        focusTaskIdRef.current = nextFocusTaskId;
        setFocusExtendedBy(0);
        setFocusError("");
        setCompletion((current) => current?.taskId === nextFocusTaskId ? current : null);
        if (focusTask && nextFocus) {
          const remaining = remainingFocusSeconds(focusTask, now);
          setFocusSeconds(remaining);
          setFocusRunning(remaining > 0);
        } else {
          setFocusRunning(false);
        }
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
      syncCurrentTimeLine(now);
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
    const originalEnd = timeToMinutes(task.end);
    const savedMinutes = Math.max(0, originalEnd - minute);
    if (savedMinutes <= 0) {
      if (finishTask(taskId, minute, null)) window.location.reload();
      return;
    }
    const next = nextTask(tasks, taskId, minute);
    const short = shortTask(tasks, taskId, next?.id ?? null, savedMinutes, originalEnd);
    setFocusRunning(false);
    setCompletion({
      taskId,
      finishMinute: minute,
      savedMinutes,
      nextTaskId: next?.id ?? null,
      nextTaskTitle: next?.title ?? null,
      shortTaskId: short?.id ?? null,
      shortTaskTitle: short?.title ?? null,
    });
  }

  function chooseCompletion(startTaskId: string | null) {
    const choice = completionRef.current;
    if (!choice) return;
    if (finishTask(choice.taskId, choice.finishMinute, startTaskId)) window.location.reload();
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
    setFocusSeconds((seconds) => seconds + EXTEND_MINUTES * 60);
    setFocusRunning(true);
    setFocusExtendedBy((minutes) => minutes + EXTEND_MINUTES);
  }

  function replanToday() {
    if (replanRemainingToday(new Date())) window.location.reload();
  }

  const activePortal = activeTarget
    ? createPortal(
      completion?.taskId === activeTarget.taskId ? (
        <div className="df2-time-adjust-finish" aria-live="polite">
          <strong>+{completion.savedMinutes} min volných</strong>
          {completion.nextTaskId && <button type="button" onClick={() => chooseCompletion(completion.nextTaskId)}>Začít další</button>}
          {completion.shortTaskId && <button type="button" onClick={() => chooseCompletion(completion.shortTaskId)}>Krátký úkol · {completion.shortTaskTitle}</button>}
          <button type="button" onClick={() => chooseCompletion(null)}>Volno</button>
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

  const focusClockPortal = focusTarget
    ? createPortal(
      <div className="df2-controller-focus-clock" aria-label={`Zbývá ${formatFocusTime(focusSeconds)}`}>{formatFocusTime(focusSeconds)}</div>,
      focusTarget.clockHost,
    )
    : null;

  const focusPortal = focusTarget
    ? createPortal(
      completion?.taskId === focusTarget.taskId ? (
        <div className="df2-time-adjust-focus-completion" aria-live="polite">
          <strong>Hotovo · +{completion.savedMinutes} min volných</strong>
          {completion.nextTaskId && <button type="button" onClick={() => chooseCompletion(completion.nextTaskId)}>Začít další</button>}
          {completion.shortTaskId && <button type="button" onClick={() => chooseCompletion(completion.shortTaskId)}>Krátký úkol · {completion.shortTaskTitle}</button>}
          <button type="button" onClick={() => chooseCompletion(null)}>Volno</button>
        </div>
      ) : (
        <div className="df2-time-adjust-focus-controls">
          <button type="button" className="df2-time-pause" onClick={() => setFocusRunning((running) => !running)}>{focusRunning ? "Pauza" : "Pokračovat"}</button>
          <button type="button" className="df2-time-done" onClick={() => completeEarly(focusTarget.taskId)}>Hotovo</button>
          <button type="button" onClick={() => extendInFocus(focusTarget.taskId)}>+15 min</button>
          {focusExtendedBy > 0 && <small className="df2-time-adjust-focus-added">+{focusExtendedBy} min k aktivitě</small>}
          {focusError && <small className="df2-time-adjust-error">{focusError}</small>}
        </div>
      ),
      focusTarget.actionsHost,
    )
    : null;

  const replanPortal = replanHost
    ? createPortal(<button type="button" className="df2-replan-button" onClick={replanToday}>Přeplánovat zbytek dne</button>, replanHost)
    : null;

  return (
    <>
      {activePortal}
      {focusClockPortal}
      {focusPortal}
      {replanPortal}
      {missedTargets.map(({ host, taskId }) => createPortal(
        <button key={taskId} type="button" onClick={() => extend(taskId)}>Pokračovat +15 min</button>,
        host,
      ))}
    </>
  );
}