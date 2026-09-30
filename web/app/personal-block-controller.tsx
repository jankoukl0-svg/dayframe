"use client";

import { useEffect } from "react";

const PERSONAL_CATEGORY = "Osobní";
const DEFAULT_CATEGORY = "Studium";

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function findCategorySelect(form: HTMLElement) {
  return [...form.querySelectorAll<HTMLSelectElement>("select")]
    .find((select) => [...select.options].some((option) => option.value === PERSONAL_CATEGORY)) ?? null;
}

function syncPersonalToggle() {
  document.querySelectorAll<HTMLElement>(".df2-add-form").forEach((form) => {
    const chips = form.querySelector<HTMLElement>(".df2-chips");
    const categorySelect = findCategorySelect(form);
    if (!chips || !categorySelect) return;

    let button = chips.querySelector<HTMLButtonElement>("[data-personal-block-toggle]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.personalBlockToggle = "true";
      button.className = "df2-personal-block-toggle";
      button.innerHTML = "<span>Osobní</span><small>mimo Přehled</small>";
      button.title = "Osobní blok zabírá čas v Týdnu, ale nezapočítává se do Přehledu.";
      chips.appendChild(button);

      button.addEventListener("click", () => {
        const next = categorySelect.value === PERSONAL_CATEGORY ? DEFAULT_CATEGORY : PERSONAL_CATEGORY;
        setSelectValue(categorySelect, next);
        syncPersonalToggle();
      });
    }

    const active = categorySelect.value === PERSONAL_CATEGORY;
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
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("change", sync, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
