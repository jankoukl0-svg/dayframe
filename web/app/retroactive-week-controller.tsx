"use client";

import { useEffect } from "react";

const DAY_END_HOUR = 2;

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

export function RetroactiveWeekController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncPastDays();
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
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "min", "class"] });
    const timer = window.setInterval(sync, 750);
    return () => {
      document.removeEventListener("click", onPastHeaderClick, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
