"use client";

import { useEffect } from "react";

const STATE_KEY = "dayframe-v1";

type StoredTask = {
  id?: string;
  title?: string;
  date?: string;
  start?: string;
  duration?: number;
  category?: string;
};

type StoredState = {
  plans?: Record<string, StoredTask[]>;
};

type PendingSelection =
  | { kind: "unscheduled"; index: number }
  | { kind: "scheduled"; title: string; start: string }
  | { kind: "today"; title: string; start: string };

let pendingSelection: PendingSelection | null = null;

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function rememberSelection(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const unscheduled = target.closest(".df2-unscheduled > button");
  if (unscheduled instanceof HTMLButtonElement) {
    const parent = unscheduled.parentElement;
    const siblings = parent ? [...parent.children].filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement) : [];
    const index = siblings.indexOf(unscheduled);
    if (index >= 0) pendingSelection = { kind: "unscheduled", index };
    return;
  }

  const scheduled = target.closest(".df2-week-task");
  if (scheduled instanceof HTMLButtonElement) {
    const title = scheduled.querySelector("strong")?.textContent?.trim() ?? "";
    const start = scheduled.querySelector("span")?.textContent?.split("–")[0]?.trim() ?? "";
    pendingSelection = { kind: "scheduled", title, start };
    return;
  }

  const next = target.closest(".df2-next > button");
  if (next instanceof HTMLButtonElement) {
    const title = next.querySelector("strong")?.textContent?.trim() ?? "";
    const start = next.querySelector("time")?.textContent?.trim() ?? "";
    pendingSelection = { kind: "scheduled", title, start };
    return;
  }

  const action = target.closest(".df2-now-actions button");
  if (action instanceof HTMLButtonElement && action.textContent?.trim() === "Upravit") {
    const card = action.closest(".df2-now-card");
    const title = card?.querySelector("h2")?.textContent?.trim() ?? "";
    const startText = card?.querySelector(".df2-now-label small")?.textContent?.trim() ?? "";
    const start = startText.includes("–") ? startText.split("–")[0]?.trim() ?? "" : "";
    pendingSelection = { kind: "today", title, start };
  }
}

function findEditedTask(form: HTMLFormElement): StoredTask | null {
  const title = (form.elements.namedItem("title") as HTMLInputElement | null)?.value.trim() ?? "";
  const date = (form.elements.namedItem("date") as HTMLInputElement | null)?.value ?? "";
  const start = (form.elements.namedItem("start") as HTMLInputElement | null)?.value ?? "";
  const duration = Number((form.elements.namedItem("duration") as HTMLInputElement | null)?.value ?? "");
  const state = readState();
  const dated = date ? state.plans?.[date] ?? [] : [];
  const all = Object.values(state.plans ?? {}).flat();
  const candidates = dated.length ? dated : all;
  const selection = pendingSelection;

  if (selection?.kind === "unscheduled") {
    const task = dated.filter((item) => !item.start)[selection.index];
    if (task) return task;
  }

  if (selection?.kind === "scheduled" || selection?.kind === "today") {
    const task = dated.find((item) => item.title === selection.title && (item.start ?? "") === selection.start);
    if (task) return task;
  }

  return candidates.find((task) =>
    task.title === title
    && (task.start ?? "") === start
    && (!Number.isFinite(duration) || task.duration === duration)
  )
    ?? candidates.find((task) => task.title === title && (task.start ?? "") === start)
    ?? candidates.find((task) => task.title === title)
    ?? null;
}

function ensureOriginalCategory(select: HTMLSelectElement) {
  if (select.dataset.editCategoryInitialized === "true") return;
  const form = select.form;
  if (!form) return;
  const heading = form.querySelector("h2")?.textContent?.trim();
  if (heading !== "Upravit") return;

  const task = findEditedTask(form);
  const category = task?.category?.trim();
  if (!category) {
    select.dataset.editCategoryInitialized = "true";
    pendingSelection = null;
    return;
  }

  if (![...select.options].some((option) => option.value === category)) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.insertBefore(option, select.firstChild);
  }

  select.value = category;
  select.dataset.editCategoryInitialized = "true";
  select.dataset.originalCategory = category;
  if (task?.id) select.dataset.taskId = task.id;
  pendingSelection = null;
}

function syncEditCategory() {
  const nodes = document.querySelectorAll('.df2-modal select[name="category"]');
  for (const node of Array.from(nodes)) {
    if (node instanceof HTMLSelectElement) ensureOriginalCategory(node);
  }
}

export function EditCategoryPreserverController() {
  useEffect(() => {
    document.addEventListener("click", rememberSelection, true);
    syncEditCategory();
    const observer = new MutationObserver(syncEditCategory);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("click", rememberSelection, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
