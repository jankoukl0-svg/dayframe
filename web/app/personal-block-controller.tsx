"use client";

import { useEffect } from "react";

const PERSONAL_CATEGORY = "Osobní";
const LABELS_STORAGE_KEY = "dayframe-labels-v1";
const LABELS_SYNC_EVENT = "dayframe-labels-sync";

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function ensurePersonalLabel() {
  try {
    const raw = window.localStorage.getItem(LABELS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const labels = parsed.filter((item): item is string => typeof item === "string");
    if (labels.some((label) => label.trim().toLocaleLowerCase("cs-CZ") === PERSONAL_CATEGORY.toLocaleLowerCase("cs-CZ"))) return;
    window.localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify([...labels, PERSONAL_CATEGORY]));
    window.dispatchEvent(new Event(LABELS_SYNC_EVENT));
  } catch {
    // Keep the existing label state if storage is malformed.
  }
}

function findCategorySelect(form: HTMLElement) {
  const selects = Array.from(form.querySelectorAll("select"));
  return selects.find((select) => Array.from(select.options).some((option) => option.value === PERSONAL_CATEGORY)) ?? null;
}

function fallbackCategory(select: HTMLSelectElement, preferred?: string) {
  const options = Array.from(select.options).map((option) => option.value).filter((value) => value && value !== PERSONAL_CATEGORY);
  if (preferred && options.includes(preferred)) return preferred;
  return options[0] ?? "";
}

function protectPersonalSettingsRow() {
  const row = document.querySelector('[data-label-color-row="Osobní"]');
  if (!(row instanceof HTMLElement)) return;
  const actions = row.querySelectorAll(".df2-label-row-actions button");
  actions.forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    const label = node.textContent?.trim();
    if (label !== "Upravit" && label !== "Smazat") return;
    node.disabled = true;
    node.title = "Osobní je systémový štítek pro bloky mimo Přehled.";
  });
}

function syncPersonalToggle() {
  ensurePersonalLabel();
  protectPersonalSettingsRow();

  document.querySelectorAll(".df2-add-form").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const chips = node.querySelector(".df2-chips");
    const categorySelect = findCategorySelect(node);
    if (!(chips instanceof HTMLElement) || !categorySelect) return;

    const existing = chips.querySelector("[data-personal-block-toggle]");
    let button = existing instanceof HTMLButtonElement ? existing : null;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.personalBlockToggle = "true";
      button.className = "df2-personal-block-toggle";
      button.innerHTML = "<span>Osobní</span><small>mimo Přehled</small>";
      button.title = "Osobní blok zabírá čas v Týdnu, ale nezapočítává se do Přehledu.";
      chips.appendChild(button);

      button.addEventListener("click", () => {
        if (categorySelect.value === PERSONAL_CATEGORY) {
          const next = fallbackCategory(categorySelect, button?.dataset.previousCategory);
          if (next) setSelectValue(categorySelect, next);
        } else {
          button!.dataset.previousCategory = categorySelect.value;
          setSelectValue(categorySelect, PERSONAL_CATEGORY);
        }
        syncPersonalToggle();
      });
    }

    const active = categorySelect.value === PERSONAL_CATEGORY;
    if (!active && categorySelect.value) button.dataset.previousCategory = categorySelect.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

export function PersonalBlockController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncPersonalToggle();
      });
    };

    sync();
    document.addEventListener("change", sync, true);
    window.addEventListener(LABELS_SYNC_EVENT, sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 750);

    return () => {
      document.removeEventListener("change", sync, true);
      window.removeEventListener(LABELS_SYNC_EVENT, sync);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
