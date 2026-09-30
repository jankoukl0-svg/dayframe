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

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "min", "class"] });
    const timer = window.setInterval(sync, 750);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
