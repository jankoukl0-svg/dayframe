"use client";

import { useEffect } from "react";

type Milestone = {
  id?: string;
  date?: string;
};

type StoredState = {
  milestones?: Milestone[];
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const DAY_MS = 86_400_000;

function readMilestoneDates() {
  try {
    const state = JSON.parse(window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "{}") as StoredState;
    return new Map(
      (state.milestones ?? [])
        .filter((milestone): milestone is Milestone & { id: string; date: string } => typeof milestone.id === "string" && typeof milestone.date === "string")
        .map((milestone) => [milestone.id, milestone.date]),
    );
  } catch {
    return new Map<string, string>();
  }
}

function daysFromToday(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [, year, month, day] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

function countdownLabel(days: number) {
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  if (days > 1) return `za ${days} ${days <= 4 ? "dny" : "dní"}`;
  if (days === -1) return "včera";
  return `před ${Math.abs(days)} dny`;
}

function styleCountdown(element: HTMLElement) {
  element.style.display = "block";
  element.style.minWidth = "0";
  element.style.marginTop = "2px";
  element.style.paddingLeft = "12px";
  element.style.color = "var(--muted)";
  element.style.fontFamily = '"Cascadia Mono", monospace';
  element.style.fontSize = "9px";
  element.style.fontWeight = "700";
  element.style.lineHeight = "1.2";
  element.style.letterSpacing = ".01em";
}

export function MonthCalendarCountdownController() {
  useEffect(() => {
    const sync = () => {
      const dates = readMilestoneDates();
      document.querySelectorAll<HTMLElement>(".df2-month-milestone[data-milestone-id]").forEach((card) => {
        const id = card.dataset.milestoneId;
        if (!id) return;
        const date = dates.get(id);
        const days = date ? daysFromToday(date) : null;
        if (days === null) return;

        let countdown = card.querySelector<HTMLElement>(".df2-month-countdown");
        if (!countdown) {
          countdown = document.createElement("span");
          countdown.className = "df2-month-countdown";
          styleCountdown(countdown);
          const title = card.querySelector("strong");
          if (title?.nextSibling) card.insertBefore(countdown, title.nextSibling);
          else if (title) title.after(countdown);
          else card.prepend(countdown);
        }
        countdown.dataset.days = String(days);
        countdown.textContent = countdownLabel(days);
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 60_000);

    return () => {
      observer.disconnect();
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
