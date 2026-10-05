"use client";

import { useEffect } from "react";

type Milestone = {
  id: string;
  title: string;
  date: string;
};

type StoredState = {
  milestones?: Milestone[];
};

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readMilestones() {
  try {
    const state = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
    return Array.isArray(state.milestones)
      ? state.milestones
        .filter((milestone): milestone is Milestone => Boolean(milestone?.id && milestone?.title && milestone?.date))
        .sort((left, right) => left.date.localeCompare(right.date))
      : [];
  } catch {
    return [];
  }
}

function daysAgo(dateKey: string, todayKey: string) {
  const target = new Date(`${dateKey}T12:00:00`);
  const today = new Date(`${todayKey}T12:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return 0;
  return Math.max(0, Math.round((today.getTime() - target.getTime()) / 86_400_000));
}

function agoLabel(days: number) {
  return days === 1 ? "před 1 dnem" : `před ${days} dny`;
}

function syncMilestoneList(milestones: Milestone[], today: string) {
  const list = document.querySelector<HTMLElement>(".df2-milestones");
  if (!list) return;
  const articles = [...list.querySelectorAll<HTMLElement>(":scope > article")];

  articles.forEach((article, index) => {
    const milestone = milestones[index];
    const shouldHide = Boolean(milestone && milestone.date < today);
    if (shouldHide) {
      article.dataset.milestoneHistoryHidden = "true";
      article.hidden = true;
    } else {
      delete article.dataset.milestoneHistoryHidden;
      article.hidden = false;
    }
  });
}

function syncCalendar(milestones: Milestone[], today: string) {
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  document.querySelectorAll<HTMLElement>(".df2-month-milestone[data-milestone-id]").forEach((button) => {
    const milestone = byId.get(button.dataset.milestoneId || "");
    const existing = button.querySelector<HTMLElement>(".df2-month-milestone-past-label");

    if (!milestone || milestone.date >= today) {
      existing?.remove();
      button.classList.remove("is-past");
      return;
    }

    const label = existing ?? document.createElement("span");
    label.className = "df2-month-milestone-past-label";
    label.textContent = agoLabel(daysAgo(milestone.date, today));
    if (!existing) button.appendChild(label);
    button.classList.add("is-past");
  });
}

export function MilestoneHistoryController() {
  useEffect(() => {
    const sync = () => {
      const milestones = readMilestones();
      const today = localDateKey(new Date());
      syncMilestoneList(milestones, today);
      syncCalendar(milestones, today);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 30_000);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return null;
}
