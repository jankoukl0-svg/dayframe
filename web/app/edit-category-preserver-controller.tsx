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

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as StoredState;
  } catch {
    return {};
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
}

function syncEditCategory() {
  const selects = document.querySelectorAll<HTMLSelectElement>('.df2-modal select[name="category"]');
  for (const select of selects) ensureOriginalCategory(select);
}

export function EditCategoryPreserverController() {
  useEffect(() => {
    syncEditCategory();
    const observer = new MutationObserver(syncEditCategory);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
