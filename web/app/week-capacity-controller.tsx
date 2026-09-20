"use client";

import { useEffect } from "react";

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function capacityForDay(day: HTMLElement) {
  let total = 0;
  for (const task of day.querySelectorAll<HTMLElement>(".df2-week-task")) {
    const text = task.querySelector("span")?.textContent?.trim() ?? "";
    const match = text.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
    if (!match) continue;
    const start = timeToMinutes(match[1]);
    const end = timeToMinutes(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start;
  }
  return total;
}

export function WeekCapacityController() {
  useEffect(() => {
    const sync = () => {
      for (const day of document.querySelectorAll<HTMLElement>(".df2-week-day")) {
        const headerCopy = day.querySelector<HTMLElement>(".df2-week-day-head > div");
        if (!headerCopy) continue;
        let label = headerCopy.querySelector<HTMLElement>("[data-week-capacity]");
        if (!label) {
          label = document.createElement("small");
          label.dataset.weekCapacity = "true";
          label.className = "df2-week-capacity";
          headerCopy.appendChild(label);
        }
        const minutes = capacityForDay(day);
        label.textContent = minutes ? formatMinutes(minutes) : "volno";
        label.setAttribute("aria-label", `Naplánováno ${minutes ? formatMinutes(minutes) : "0 minut"}`);
      }
    };

    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
