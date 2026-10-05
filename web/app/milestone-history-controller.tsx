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

function syncMilestoneList() {
  const list = document.querySelector<HTMLElement>(".df2-milestones");
  if (!list) return;

  const milestones = readMilestones();
  const today = localDateKey(new Date());
  const articles = [...list.querySelectorAll<HTMLElement>(":scope > article")];

  articles.forEach((article, index) => {
    const milestone = milestones[index];
    const shouldHide = Boolean(milestone && milestone.date < today);
    const hiddenByHistory = article.dataset.milestoneHistoryHidden === "true";

    if (shouldHide && !hiddenByHistory) {
      article.dataset.milestoneHistoryHidden = "true";
      article.hidden = true;
      return;
    }

    if (!shouldHide && hiddenByHistory) {
      delete article.dataset.milestoneHistoryHidden;
      article.hidden = false;
    }
  });
}

export function MilestoneHistoryController() {
  useEffect(() => {
    const sync = () => syncMilestoneList();
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
