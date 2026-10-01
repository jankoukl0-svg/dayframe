"use client";

import { useEffect } from "react";
import {
  getTasksForDate,
  overdueTasks,
  planningDateKey,
  planningMinute,
  timeToMinutes,
  type CalendarTask,
  type DayframeState,
} from "@/lib/dayframe-calendar";
import { daysUntilDate } from "@/lib/dayframe-countdown";

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";

type BriefingModel = {
  greeting: string;
  summary: string;
  priority: string;
  plan: string;
  progress: string;
  nextLabel: string;
  nextValue: string;
  contextLabel: string;
  contextValue: string;
};

function readState(): DayframeState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DayframeState;
    if (!parsed || typeof parsed !== "object" || !parsed.plans || !Array.isArray(parsed.milestones)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "0 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function greetingFor(now: Date) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Dobré ráno.";
  if (hour >= 12 && hour < 18) return "Dobré odpoledne.";
  return "Dobrý večer.";
}

function byStart(a: CalendarTask, b: CalendarTask) {
  const aMinute = Number.isFinite(timeToMinutes(a.start)) ? timeToMinutes(a.start) : Number.POSITIVE_INFINITY;
  const bMinute = Number.isFinite(timeToMinutes(b.start)) ? timeToMinutes(b.start) : Number.POSITIVE_INFINITY;
  return aMinute - bMinute;
}

function taskSummary(tasks: CalendarTask[], mainTask: CalendarTask | null, missedCount: number, plannedMinutes: number) {
  if (!tasks.length) return "Dnešek je zatím otevřený. Nemáte naplánovaný žádný blok.";
  const completed = tasks.filter((task) => task.completed).length;
  if (completed === tasks.length) return `Dnešní plán je hotový. Dokončeno ${completed} z ${tasks.length} bloků.`;

  const planCopy = plannedMinutes > 0
    ? `Na dnešek je naplánováno ${formatDuration(plannedMinutes)}.`
    : `Na dnešek máte ${tasks.length} ${tasks.length === 1 ? "úkol" : "úkolů"}.`;
  const mainCopy = mainTask
    ? ` Hlavní blok je ${mainTask.title}${mainTask.start ? ` v ${mainTask.start}` : ""}.`
    : "";
  const missedCopy = missedCount > 0
    ? ` Z dřívějška ${missedCount === 1 ? "zůstává 1 rest" : `zůstávají ${missedCount} resty`}.`
    : "";
  return `${planCopy}${mainCopy}${missedCopy}`;
}

function buildModel(state: DayframeState, now: Date): BriefingModel {
  const today = planningDateKey(now);
  const tasks = getTasksForDate(state, today);
  const scheduled = tasks.filter((task) => task.start && task.end).sort(byStart);
  const unfinished = tasks.filter((task) => !task.completed);
  const unfinishedScheduled = scheduled.filter((task) => !task.completed);
  const currentMinute = planningMinute(now);
  const current = unfinishedScheduled.find((task) => timeToMinutes(task.start) <= currentMinute && timeToMinutes(task.end) > currentMinute) ?? null;
  const upcoming = unfinishedScheduled.find((task) => timeToMinutes(task.start) > currentMinute) ?? null;
  const highPriority = [...unfinished].filter((task) => task.priority === "high").sort(byStart)[0] ?? null;
  const mainTask = highPriority ?? current ?? upcoming ?? [...unfinished].sort(byStart)[0] ?? null;
  const completed = tasks.filter((task) => task.completed).length;
  const plannedMinutes = scheduled.reduce((sum, task) => sum + task.duration, 0);
  const missed = overdueTasks(state, now);
  const nextMilestone = [...state.milestones]
    .filter((milestone) => milestone.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  let nextLabel = "Další blok";
  let nextValue = "Volno";
  if (current) {
    nextLabel = "Právě teď";
    nextValue = current.title;
  } else if (upcoming) {
    nextValue = `${upcoming.start} · ${upcoming.title}`;
  } else if (unfinished.length) {
    nextLabel = "Bez času";
    nextValue = `${unfinished.length} ${unfinished.length === 1 ? "úkol" : "úkoly"}`;
  } else if (tasks.length) {
    nextLabel = "Stav";
    nextValue = "Dnes hotovo";
  }

  let contextLabel = "Milník";
  let contextValue = nextMilestone ? `${daysUntilDate(nextMilestone.date, now)} dní` : "Žádný";
  if (missed.length) {
    contextLabel = "Resty";
    contextValue = String(missed.length);
  }

  return {
    greeting: greetingFor(now),
    summary: taskSummary(tasks, mainTask, missed.length, plannedMinutes),
    priority: mainTask?.title ?? "Bez hlavní priority",
    plan: formatDuration(plannedMinutes),
    progress: `${completed}/${tasks.length}`,
    nextLabel,
    nextValue,
    contextLabel,
    contextValue,
  };
}

function addText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderBriefing(host: HTMLElement, model: BriefingModel) {
  const signature = JSON.stringify(model);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.replaceChildren();

  const copy = document.createElement("div");
  copy.className = "df2-briefing-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "df2-briefing-eyebrow";
  const pulse = document.createElement("span");
  pulse.setAttribute("aria-hidden", "true");
  eyebrow.appendChild(pulse);
  addText(eyebrow, "strong", "Briefing");
  copy.appendChild(eyebrow);
  addText(copy, "h2", model.greeting);
  addText(copy, "p", model.summary);

  const priority = document.createElement("div");
  priority.className = "df2-briefing-priority";
  addText(priority, "span", "Priorita");
  addText(priority, "strong", model.priority);
  copy.appendChild(priority);
  host.appendChild(copy);

  const signals = document.createElement("div");
  signals.className = "df2-briefing-signals";
  const items = [
    ["Plán", model.plan],
    ["Hotovo", model.progress],
    [model.nextLabel, model.nextValue],
    [model.contextLabel, model.contextValue],
  ];
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    addText(item, "span", label);
    addText(item, "strong", value);
    signals.appendChild(item);
  });
  host.appendChild(signals);
}

function syncBriefing() {
  const todayView = document.querySelector(".df2-today-view");
  if (!(todayView instanceof HTMLElement)) return;

  let host = todayView.querySelector<HTMLElement>("[data-today-briefing]");
  if (!host) {
    const created = document.createElement("section");
    created.className = "df2-today-briefing";
    created.dataset.todayBriefing = "true";
    created.setAttribute("aria-label", "Denní briefing");
    const anchor = todayView.querySelector(".df2-motivation-grid");
    if (anchor) todayView.insertBefore(created, anchor);
    else todayView.querySelector(".df2-page-head")?.insertAdjacentElement("afterend", created);
    host = created;
  }

  const state = readState();
  if (!state) return;
  renderBriefing(host, buildModel(state, new Date()));
}

export function TodayBriefingController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncBriefing();
      });
    };

    sync();
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 30_000);

    return () => {
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
