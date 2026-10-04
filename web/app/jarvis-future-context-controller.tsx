"use client";

import { useEffect } from "react";
import {
  addDaysKey,
  getTasksForDate,
  planningDateKey,
  timeToMinutes,
  type CalendarTask,
  type DayframeState,
} from "@/lib/dayframe-calendar";
import { daysUntilDate } from "@/lib/dayframe-countdown";

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const CONTEXT_SIGNATURE = "jarvisFutureContextSignature";

const GENERIC_MILESTONE_TERMS = new Set([
  "test", "zkouska", "zkousky", "termin", "deadline", "prijimacky", "prijimaci", "nanecisto",
  "zapis", "pohovor", "interview", "prezentace", "case", "study", "projekt", "soutez", "finale",
  "exam", "meeting", "schuzka", "udalost", "event", "den", "deadline", "odevzdani",
]);

const PREP_HINT_TERMS = new Set([
  "test", "zkouska", "zkousky", "prijimacky", "prijimaci", "nanecisto", "pohovor", "interview",
  "prezentace", "case", "study", "projekt", "soutez", "finale", "exam", "odevzdani",
]);

const PREP_ALIASES = [
  {
    milestone: ["vse", "fph", "ffu"],
    task: ["vse", "fph", "ffu", "matika", "matematika", "anglictina", "english"],
  },
  {
    milestone: ["cambridge", "c1", "cae"],
    task: ["cambridge", "c1", "cae", "anglictina", "english"],
  },
  {
    milestone: ["scio", "osp", "zsv"],
    task: ["scio", "osp", "zsv"],
  },
  {
    milestone: ["investomanie", "econet"],
    task: ["investomanie", "econet", "investice", "investicni", "akcie", "stock", "finance"],
  },
  {
    milestone: ["ki", "investoru", "asset"],
    task: ["ki", "klub", "investoru", "asset", "akcie", "investice", "investicni", "finance"],
  },
];

type MilestonePrep = {
  tracked: boolean;
  tone: "active" | "warning" | "neutral";
  label: string;
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

function formatDateKey(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${key}T12:00:00`));
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function terms(value: string) {
  return normalize(value).split(/\s+/).filter((term) => term.length >= 2);
}

function milestoneMatcher(title: string, note?: string) {
  const rawTerms = new Set(terms(`${title} ${note ?? ""}`));
  const specificTerms = [...rawTerms].filter((term) => !GENERIC_MILESTONE_TERMS.has(term));
  const aliasGroups = PREP_ALIASES.filter((group) => group.milestone.some((term) => rawTerms.has(term)));
  const explicitPrep = [...rawTerms].some((term) => PREP_HINT_TERMS.has(term));

  const matches = (task: CalendarTask) => {
    const taskTerms = new Set(terms(`${task.title} ${task.category ?? ""}`));
    if (specificTerms.some((term) => taskTerms.has(term))) return true;
    return aliasGroups.some((group) => group.task.some((term) => taskTerms.has(term)));
  };

  return { matches, explicitPrep, hasAlias: aliasGroups.length > 0, hasSpecificTerms: specificTerms.length > 0 };
}

function prepForMilestone(state: DayframeState, milestone: DayframeState["milestones"][number], now: Date): MilestonePrep {
  const today = planningDateKey(now);
  const lookback = addDaysKey(today, -7);
  const matcher = milestoneMatcher(milestone.title, milestone.note);
  const related = Object.entries(state.plans)
    .filter(([date]) => date >= lookback && date <= milestone.date)
    .flatMap(([date, tasks]) => tasks.map((task) => ({ date, task })))
    .filter(({ task }) => matcher.matches(task));

  const shouldTrack = matcher.explicitPrep || matcher.hasAlias || (matcher.hasSpecificTerms && related.length > 0);
  if (!shouldTrack) {
    return { tracked: false, tone: "neutral", label: "Bez nutné přípravy" };
  }

  const completed = related.filter(({ date, task }) => date <= today && task.completed);
  const planned = related.filter(({ date, task }) => date >= today && !task.completed);
  const completedMinutes = completed.reduce((sum, { task }) => sum + Math.max(0, task.duration || 0), 0);
  const plannedMinutes = planned.reduce((sum, { task }) => sum + Math.max(0, task.duration || 0), 0);
  const days = daysUntilDate(milestone.date, now);

  if (completedMinutes > 0 && plannedMinutes > 0) {
    return {
      tracked: true,
      tone: "active",
      label: `Příprava aktivní · ${formatDuration(completedMinutes)} hotovo · ${formatDuration(plannedMinutes)} v plánu`,
    };
  }
  if (plannedMinutes > 0) {
    return {
      tracked: true,
      tone: "active",
      label: `Příprava v plánu · ${formatDuration(plannedMinutes)} · ${planned.length} ${planned.length === 1 ? "blok" : planned.length < 5 ? "bloky" : "bloků"}`,
    };
  }
  if (completedMinutes > 0) {
    return {
      tracked: true,
      tone: days <= 14 ? "warning" : "active",
      label: `${formatDuration(completedMinutes)} přípravy hotovo · nic dalšího v plánu`,
    };
  }
  return {
    tracked: true,
    tone: days <= 14 ? "warning" : "neutral",
    label: days <= 14 ? "Bez přípravy v plánu" : "Příprava zatím není naplánovaná",
  };
}

function byStart(a: CalendarTask, b: CalendarTask) {
  const aStart = timeToMinutes(a.start);
  const bStart = timeToMinutes(b.start);
  if (!Number.isFinite(aStart) && Number.isFinite(bStart)) return 1;
  if (Number.isFinite(aStart) && !Number.isFinite(bStart)) return -1;
  if (!Number.isFinite(aStart) && !Number.isFinite(bStart)) return a.title.localeCompare(b.title, "cs");
  return aStart - bStart;
}

function renderTomorrow(host: HTMLElement, state: DayframeState, now: Date) {
  const planningToday = planningDateKey(now);
  const tomorrow = addDaysKey(planningToday, 1);
  const tasks = getTasksForDate(state, tomorrow)
    .filter((task) => !task.completed)
    .sort(byStart);
  const minutes = tasks.reduce((sum, task) => sum + Math.max(0, task.duration || 0), 0);
  const first = tasks.find((task) => task.start) ?? tasks[0] ?? null;
  const label = now.getHours() < 2 ? "Po probuzení" : "Zítra";

  const card = document.createElement("section");
  card.className = "df2-jarvis-tomorrow";
  card.dataset.jarvisTomorrow = "true";

  const head = document.createElement("div");
  head.className = "df2-jarvis-card-head";
  const heading = document.createElement("span");
  heading.textContent = label;
  head.appendChild(heading);
  const date = document.createElement("small");
  date.textContent = formatDateKey(tomorrow);
  head.appendChild(date);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "df2-jarvis-tomorrow-body";
  const summary = document.createElement("div");
  summary.className = "df2-jarvis-tomorrow-summary";
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = tasks.length ? "Plán dalšího dne" : "Další den";
  summary.appendChild(summaryLabel);
  const summaryValue = document.createElement("strong");
  summaryValue.textContent = tasks.length
    ? `${formatDuration(minutes)} · ${tasks.length} ${tasks.length === 1 ? "blok" : tasks.length < 5 ? "bloky" : "bloků"}`
    : "Zatím volno";
  summary.appendChild(summaryValue);
  const firstCopy = document.createElement("small");
  firstCopy.textContent = first
    ? `První: ${first.start ? `${first.start} · ` : ""}${first.title}`
    : "Žádný úkol ani pevný blok.";
  summary.appendChild(firstCopy);
  body.appendChild(summary);

  const list = document.createElement("div");
  list.className = "df2-jarvis-tomorrow-list";
  tasks.slice(0, 3).forEach((task) => {
    const row = document.createElement("div");
    const time = document.createElement("time");
    time.textContent = task.start ? `${task.start}${task.end ? `–${task.end}` : ""}` : "bez času";
    row.appendChild(time);
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = task.title;
    copy.appendChild(title);
    const category = document.createElement("span");
    category.textContent = task.category ?? "";
    copy.appendChild(category);
    row.appendChild(copy);
    list.appendChild(row);
  });
  if (tasks.length > 3) {
    const more = document.createElement("p");
    more.textContent = `+${tasks.length - 3} další`;
    list.appendChild(more);
  }
  body.appendChild(list);
  card.appendChild(body);

  const signals = host.querySelector(".df2-briefing-signals");
  if (signals) signals.insertAdjacentElement("afterend", card);
  else host.appendChild(card);
}

function renderMilestonePrep(host: HTMLElement, state: DayframeState, now: Date) {
  const today = planningDateKey(now);
  const milestone = [...state.milestones]
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const milestoneCopy = host.querySelector<HTMLElement>(".df2-jarvis-milestone > div");
  if (!milestone || !milestoneCopy) return;

  const prep = prepForMilestone(state, milestone, now);
  const status = document.createElement("small");
  status.className = `df2-jarvis-milestone-prep ${prep.tone}`;
  status.dataset.jarvisMilestonePrep = "true";
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  status.appendChild(dot);
  const text = document.createElement("span");
  text.textContent = prep.label;
  status.appendChild(text);
  milestoneCopy.appendChild(status);
}

function syncFutureContext() {
  const host = document.querySelector<HTMLElement>("[data-today-briefing]");
  if (!host) return;
  const state = readState();
  if (!state) return;

  const now = new Date();
  const tomorrowKey = addDaysKey(planningDateKey(now), 1);
  const milestone = [...state.milestones]
    .filter((item) => item.date >= planningDateKey(now))
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const signature = JSON.stringify({
    tomorrowKey,
    tomorrow: getTasksForDate(state, tomorrowKey).map((task) => [task.id, task.title, task.start, task.end, task.duration, task.completed, task.category]),
    milestone,
    prepPlans: Object.entries(state.plans)
      .filter(([date]) => !milestone || date <= milestone.date)
      .map(([date, tasks]) => [date, tasks.map((task) => [task.id, task.title, task.category, task.duration, task.completed])]),
    hour: now.getHours(),
  });
  if (host.dataset[CONTEXT_SIGNATURE] === signature && host.querySelector("[data-jarvis-tomorrow]")) return;
  host.dataset[CONTEXT_SIGNATURE] = signature;

  host.querySelector("[data-jarvis-tomorrow]")?.remove();
  host.querySelector("[data-jarvis-milestone-prep]")?.remove();
  renderMilestonePrep(host, state, now);
  renderTomorrow(host, state, now);
}

export function JarvisFutureContextController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncFutureContext();
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
