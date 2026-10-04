"use client";

import { useEffect } from "react";
import {
  getTasksForDate,
  migrateStoredState,
  minutesToTime,
  timeToMinutes,
  toggleTask,
  updateTask,
  type CalendarTask,
  type DayframeState,
  type Priority,
} from "../lib/dayframe-calendar";

const DAY_END_HOUR = 2;
const DAY_START_MINUTE = 8 * 60;
const MINUTE_HEIGHT = 0.72;
const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const TASK_ID_ATTR = "dayframeTaskId";

type EditingTaskRef = {
  id: string;
  date: string;
  title: string;
  start: string;
  duration: number;
};

let editingTaskRef: EditingTaskRef | null = null;

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function planningDateKey(now = new Date()) {
  const date = new Date(now);
  if (date.getHours() < DAY_END_HOUR) date.setDate(date.getDate() - 1);
  return localDateKey(date);
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
  const weekStart = parseWeekStart();
  const days = [...document.querySelectorAll<HTMLElement>(".df2-week-day")];
  const index = days.indexOf(day);
  if (!weekStart || index < 0) return null;
  const date = new Date(weekStart);
  date.setDate(date.getDate() + index);
  return localDateKey(date);
}

function readState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return migrateStoredState(raw ? JSON.parse(raw) : null, new Date());
  } catch {
    return null;
  }
}

function writeState(state: DayframeState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(STATE_SYNC_EVENT));
}

function findTask(state: DayframeState, id: string) {
  for (const tasks of Object.values(state.plans)) {
    const task = tasks.find((item) => item.id === id);
    if (task) return task;
  }
  return state.backlog.find((item) => item.id === id) ?? null;
}

function syncPastDays() {
  const weekStart = parseWeekStart();
  if (!weekStart) return;
  const today = planningDateKey();
  const days = [...document.querySelectorAll<HTMLElement>(".df2-week-day")];

  days.forEach((day, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const isPast = localDateKey(date) < today;
    day.classList.toggle("df2-week-past-editable", isPast);

    const addButton = day.querySelector<HTMLButtonElement>(".df2-week-day-head > button");
    if (isPast && addButton?.disabled) addButton.disabled = false;
  });
}

function scheduledButtonSignature(button: HTMLButtonElement) {
  const title = button.querySelector("strong")?.textContent?.trim() ?? "";
  const time = button.querySelector("span")?.textContent?.trim() ?? "";
  const [start = "", end = ""] = time.split("–").map((value) => value.trim());
  return { title, start, end };
}

function unscheduledButtonTitle(button: HTMLButtonElement) {
  const marker = button.querySelector("small")?.textContent?.trim() ?? "";
  const full = button.textContent?.trim() ?? "";
  return marker && full.endsWith(marker) ? full.slice(0, -marker.length).trim() : full;
}

function claimScheduledTask(button: HTMLButtonElement, remaining: CalendarTask[]) {
  const signature = scheduledButtonSignature(button);
  const currentId = button.dataset[TASK_ID_ATTR];
  let index = currentId ? remaining.findIndex((task) => task.id === currentId) : -1;

  if (index >= 0) {
    const current = remaining[index];
    const domIsCurrent = current.title === signature.title
      && (current.start ?? "") === signature.start
      && (current.end ?? "") === signature.end;
    if (!domIsCurrent) return null;
  } else {
    index = remaining.findIndex((task) => task.title === signature.title
      && (task.start ?? "") === signature.start
      && (task.end ?? "") === signature.end);
  }

  return index >= 0 ? remaining.splice(index, 1)[0] : null;
}

function claimUnscheduledTask(button: HTMLButtonElement, remaining: CalendarTask[]) {
  const currentId = button.dataset[TASK_ID_ATTR];
  let index = currentId ? remaining.findIndex((task) => task.id === currentId) : -1;
  const title = unscheduledButtonTitle(button);

  if (index >= 0 && remaining[index].title !== title) return null;
  if (index < 0) index = remaining.findIndex((task) => task.title === title);
  return index >= 0 ? remaining.splice(index, 1)[0] : null;
}

function syncTaskIds() {
  const state = readState();
  if (!state) return;

  document.querySelectorAll<HTMLElement>(".df2-week-day").forEach((day) => {
    const date = dateForWeekDay(day);
    if (!date) return;
    const tasks = getTasksForDate(state, date);
    const scheduled = tasks.filter((task) => task.start && task.end);
    const unscheduled = tasks.filter((task) => !task.start);
    const remainingScheduled = [...scheduled];
    const remainingUnscheduled = [...unscheduled];

    day.querySelectorAll<HTMLButtonElement>(".df2-time-body .df2-week-task").forEach((button) => {
      const task = claimScheduledTask(button, remainingScheduled);
      if (task) {
        button.dataset[TASK_ID_ATTR] = task.id;
        const start = timeToMinutes(task.start);
        const end = timeToMinutes(task.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          button.style.top = `${(start - DAY_START_MINUTE) * MINUTE_HEIGHT}px`;
          button.style.height = `${(end - start) * MINUTE_HEIGHT}px`;
        }
      } else {
        delete button.dataset[TASK_ID_ATTR];
      }
    });

    day.querySelectorAll<HTMLButtonElement>(".df2-unscheduled > button").forEach((button) => {
      const task = claimUnscheduledTask(button, remainingUnscheduled);
      if (task) button.dataset[TASK_ID_ATTR] = task.id;
      else delete button.dataset[TASK_ID_ATTR];
    });
  });
}

function relaxPastDateInputs() {
  document.querySelectorAll<HTMLInputElement>(".df2-add-form input[type='date']")
    .forEach((input) => input.removeAttribute("min"));
}

function setControlledDate(input: HTMLInputElement, date: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, date);
  else input.value = date;
  input.removeAttribute("min");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function openPastAdd(date: string) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true }));
  let attempts = 0;
  const applyDate = () => {
    const input = document.querySelector<HTMLInputElement>(".df2-add-form .df2-chips input[type='date']");
    if (input) {
      setControlledDate(input, date);
      return;
    }
    attempts += 1;
    if (attempts < 30) window.requestAnimationFrame(applyDate);
  };
  window.requestAnimationFrame(applyDate);
}

function rememberWeekTask(event: MouseEvent) {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>(".df2-week-task, .df2-unscheduled > button")
    : null;
  if (!target) return;

  syncTaskIds();
  const id = target.dataset[TASK_ID_ATTR];
  if (!id) return;
  const state = readState();
  const task = state ? findTask(state, id) : null;
  if (!task) return;
  editingTaskRef = {
    id: task.id,
    date: task.date,
    title: task.title,
    start: task.start ?? "",
    duration: task.duration,
  };
}

function formStillMatchesTask(form: HTMLFormElement, task: CalendarTask, reference: EditingTaskRef) {
  const title = form.querySelector<HTMLInputElement>("input[name='title']");
  const date = form.querySelector<HTMLInputElement>("input[name='date']");
  const duration = form.querySelector<HTMLInputElement>("input[name='duration']");
  const start = form.querySelector<HTMLInputElement>("input[name='start']");
  return Boolean(
    title && date && duration && start
      && reference.id === task.id
      && reference.date === task.date
      && reference.title === task.title
      && reference.start === (task.start ?? "")
      && reference.duration === task.duration
      && title.defaultValue === task.title
      && date.defaultValue === task.date
      && duration.defaultValue === String(task.duration)
      && start.defaultValue === (task.start ?? ""),
  );
}

function showEditError(form: HTMLFormElement, message: string) {
  let error = form.querySelector<HTMLElement>(".df2-error[data-retroactive-edit-error]");
  if (!error) {
    error = document.createElement("p");
    error.className = "df2-error";
    error.dataset.retroactiveEditError = "true";
    form.querySelector(".df2-modal-actions")?.insertAdjacentElement("beforebegin", error);
  }
  error.textContent = message;
}

function updateFromEditForm(state: DayframeState, original: CalendarTask, form: HTMLFormElement) {
  if (!form.reportValidity()) return null;

  const values = new FormData(form);
  const date = String(values.get("date") || original.date);
  const parsedDuration = Number(values.get("duration"));
  const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : original.duration;
  const start = String(values.get("start") || "");
  const startMinute = start ? timeToMinutes(start) : Number.NaN;
  if (start && !Number.isFinite(startMinute)) {
    showEditError(form, "Neplatný čas začátku.");
    return null;
  }

  const result = updateTask(state, original.id, {
    title: String(values.get("title") || original.title).trim(),
    date,
    duration,
    start: start || undefined,
    end: start ? minutesToTime(startMinute + duration) : undefined,
    mode: "flexible",
    requestedStart: start || undefined,
    dateLocked: true,
    priority: String(values.get("priority") || original.priority) as Priority,
    category: String(values.get("category") || original.category),
    dueDate: String(values.get("dueDate") || "") || undefined,
    deadlineTime: String(values.get("deadlineTime") || "22:30"),
    autoScheduled: !start,
  }, new Date());

  if (result.error) {
    showEditError(form, result.error);
    return null;
  }
  return result;
}

function closeEditModal() {
  editingTaskRef = null;
  window.setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }, 0);
}

function saveCompletedEdit(event: SubmitEvent) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  const heading = form?.querySelector("h2")?.textContent?.trim();
  const reference = editingTaskRef;
  if (!form?.matches("form.df2-modal") || heading !== "Upravit" || !reference) return;

  const state = readState();
  const original = state ? findTask(state, reference.id) : null;
  if (!state || !original?.completed || !formStillMatchesTask(form, original, reference)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const result = updateFromEditForm(state, original, form);
  if (!result) return;

  writeState(result.state);
  closeEditModal();
}

function saveThenSetCompletion(event: MouseEvent) {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>(".df2-modal-actions button[type='button']")
    : null;
  const label = button?.textContent?.trim() ?? "";
  if (!button || (label !== "Označit hotovo" && label !== "Vrátit jako nesplněné")) return;

  const form = button.closest<HTMLFormElement>("form.df2-modal");
  const heading = form?.querySelector("h2")?.textContent?.trim();
  const reference = editingTaskRef;
  if (!form || heading !== "Upravit" || !reference || reference.date >= planningDateKey()) return;

  const state = readState();
  const original = state ? findTask(state, reference.id) : null;
  if (!state || !original || !formStillMatchesTask(form, original, reference)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const result = updateFromEditForm(state, original, form);
  if (!result) return;

  const desiredCompleted = label === "Označit hotovo";
  const updated = findTask(result.state, original.id);
  const finalState = updated && updated.completed !== desiredCompleted
    ? toggleTask(result.state, original.id)
    : result.state;

  writeState(finalState);
  closeEditModal();
}

export function RetroactiveWeekController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncPastDays();
        syncTaskIds();
        relaxPastDateInputs();
      });
    };

    const onPastHeaderClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const header = target?.closest<HTMLElement>(".df2-week-day.df2-week-past-editable .df2-week-day-head");
      const day = header?.closest<HTMLElement>(".df2-week-day");
      if (!header || !day) return;
      const date = dateForWeekDay(day);
      if (!date || date >= planningDateKey()) return;

      event.preventDefault();
      event.stopPropagation();
      openPastAdd(date);
    };

    sync();
    document.addEventListener("click", onPastHeaderClick, true);
    document.addEventListener("click", rememberWeekTask, true);
    document.addEventListener("click", saveThenSetCompletion, true);
    document.addEventListener("submit", saveCompletedEdit, true);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "min", "class"] });
    const timer = window.setInterval(sync, 750);
    return () => {
      document.removeEventListener("click", onPastHeaderClick, true);
      document.removeEventListener("click", rememberWeekTask, true);
      document.removeEventListener("click", saveThenSetCompletion, true);
      document.removeEventListener("submit", saveCompletedEdit, true);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      observer.disconnect();
      window.clearInterval(timer);
      editingTaskRef = null;
    };
  }, []);

  return null;
}
