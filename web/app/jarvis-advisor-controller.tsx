"use client";

import { useEffect } from "react";
import {
  addDaysKey,
  findSlot,
  getTasksForDate,
  planningDateKey,
  timeToMinutes,
  type CalendarTask,
  type DayframeState,
} from "@/lib/dayframe-calendar";
import { daysUntilDate } from "@/lib/dayframe-countdown";

const STORAGE_KEY = "dayframe-v1";
const BIRTHDAYS_STORAGE_KEY = "dayframe-birthdays-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const BIRTHDAYS_SYNC_EVENT = "dayframe-birthdays-sync";
const SIGNATURE_KEY = "jarvisAdvisorSignature";
const DAY_MS = 86_400_000;
const PLAN_HORIZON_DAYS = 7;

type Birthday = {
  id: string;
  name: string;
  day: number;
  month: number;
  birthYear?: number;
  note?: string;
};

type Advice = {
  id: string;
  label: string;
  title: string;
  body: string;
  tone: "warning" | "normal";
};

const GENERIC_MILESTONE_TERMS = new Set([
  "test", "zkouska", "zkousky", "termin", "deadline", "prijimacky", "prijimaci", "nanecisto",
  "zapis", "pohovor", "interview", "prezentace", "case", "study", "projekt", "soutez", "finale",
  "exam", "meeting", "schuzka", "udalost", "event", "den", "odevzdani",
]);

const ADMIN_MILESTONE_TERMS = new Set([
  "zapis", "registrace", "registration", "schuzka", "meeting", "udalost", "event", "narozeniny", "svatek",
  "dovolena", "odjezd", "prijezd",
]);

const PREP_ALIASES = [
  { milestone: ["vse", "fph", "ffu"], task: ["vse", "fph", "ffu", "matika", "matematika", "anglictina", "english"] },
  { milestone: ["cambridge", "c1", "cae"], task: ["cambridge", "c1", "cae", "anglictina", "english"] },
  { milestone: ["scio", "osp", "zsv"], task: ["scio", "osp", "zsv"] },
  { milestone: ["investomanie", "econet"], task: ["investomanie", "econet", "investice", "investicni", "akcie", "stock", "finance"] },
  { milestone: ["ki", "investoru", "asset"], task: ["ki", "klub", "investoru", "asset", "akcie", "investice", "investicni", "finance"] },
];

function readState(): DayframeState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as DayframeState | null;
    return parsed && parsed.plans && Array.isArray(parsed.milestones) ? parsed : null;
  } catch {
    return null;
  }
}

function readBirthdays(): Birthday[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BIRTHDAYS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Birthday => Boolean(
      item
      && typeof item === "object"
      && typeof (item as Birthday).id === "string"
      && typeof (item as Birthday).name === "string"
      && Number.isInteger((item as Birthday).day)
      && Number.isInteger((item as Birthday).month),
    ));
  } catch {
    return [];
  }
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

function taskMatchesMilestone(task: CalendarTask, title: string, note?: string) {
  const milestoneTerms = new Set(terms(`${title} ${note ?? ""}`));
  const taskTerms = new Set(terms(`${task.title} ${task.category ?? ""}`));
  const specific = [...milestoneTerms].filter((term) => !GENERIC_MILESTONE_TERMS.has(term));
  if (specific.some((term) => taskTerms.has(term))) return true;
  return PREP_ALIASES
    .filter((group) => group.milestone.some((term) => milestoneTerms.has(term)))
    .some((group) => group.task.some((term) => taskTerms.has(term)));
}

function milestoneNeedsPreparation(title: string, note?: string) {
  const milestoneTerms = new Set(terms(`${title} ${note ?? ""}`));
  return ![...milestoneTerms].some((term) => ADMIN_MILESTONE_TERMS.has(term));
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "0 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function plannedMinutes(tasks: CalendarTask[]) {
  return tasks.filter((task) => !task.completed).reduce((sum, task) => sum + Math.max(0, task.duration || 0), 0);
}

function weekdayLabel(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${key}T12:00:00`));
}

function lightestUpcomingDay(state: DayframeState, now: Date, milestoneDate: string) {
  const today = planningDateKey(now);
  const options: Array<{ key: string; minutes: number }> = [];
  for (let offset = 1; offset <= PLAN_HORIZON_DAYS; offset += 1) {
    const key = addDaysKey(today, offset);
    if (key > milestoneDate) break;
    options.push({ key, minutes: plannedMinutes(getTasksForDate(state, key)) });
  }
  return options.sort((left, right) => left.minutes - right.minutes || left.key.localeCompare(right.key))[0] ?? null;
}

function preparationTarget(days: number) {
  if (days <= 3) return 90;
  if (days <= 7) return 120;
  return 180;
}

function milestonePreparationAdvice(state: DayframeState, now: Date): Advice | null {
  const today = planningDateKey(now);
  const horizon = addDaysKey(today, PLAN_HORIZON_DAYS);
  const milestones = [...state.milestones]
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const milestone of milestones) {
    const days = daysUntilDate(milestone.date, now);
    if (days < 0) continue;
    if (days > 21) break;
    if (!milestoneNeedsPreparation(milestone.title, milestone.note)) continue;

    const relatedBeforeMilestone = Object.entries(state.plans)
      .filter(([date]) => date >= today && date <= milestone.date)
      .flatMap(([, tasks]) => tasks)
      .filter((task) => !task.completed && taskMatchesMilestone(task, milestone.title, milestone.note));

    if (!relatedBeforeMilestone.length) {
      const lightest = lightestUpcomingDay(state, now, milestone.date);
      const timing = days === 0 ? "je dnes" : days === 1 ? "je zítra" : `je za ${days} dní`;
      const slot = lightest
        ? ` Nejvolnější z příštích dnů je ${weekdayLabel(lightest.key)} (${formatDuration(lightest.minutes)} v plánu).`
        : "";
      return {
        id: `milestone-${milestone.id}`,
        label: "Milník",
        title: `Příprava na ${milestone.title}`,
        body: `${milestone.title} ${timing} a v plánu nemáš žádný související blok.${slot}`,
        tone: days <= 7 ? "warning" : "normal",
      };
    }

    if (days < 1 || days > 14) continue;
    const prepEnd = milestone.date < horizon ? milestone.date : horizon;
    const prepMinutes = Object.entries(state.plans)
      .filter(([date]) => date >= today && date <= prepEnd)
      .flatMap(([, tasks]) => tasks)
      .filter((task) => !task.completed && taskMatchesMilestone(task, milestone.title, milestone.note))
      .reduce((sum, task) => sum + Math.max(0, task.duration || 0), 0);
    if (prepMinutes >= preparationTarget(days)) continue;

    const lightest = lightestUpcomingDay(state, now, prepEnd);
    const slot = lightest
      ? ` ${weekdayLabel(lightest.key)} má jen ${formatDuration(lightest.minutes)} v plánu.`
      : "";
    return {
      id: `underprepared-${milestone.id}`,
      label: "Plán",
      title: `Přípravy na ${milestone.title} je zatím málo`,
      body: `Do milníku zbývá ${days} ${days === 1 ? "den" : days >= 2 && days <= 4 ? "dny" : "dní"} a v příštích ${Math.min(days, PLAN_HORIZON_DAYS)} dnech máš ${formatDuration(prepMinutes)} související přípravy.${slot} Zvaž ještě jeden soustředěný blok.`,
      tone: days <= 7 ? "warning" : "normal",
    };
  }

  return null;
}

function betterDayAdvice(state: DayframeState, now: Date): Advice | null {
  const today = planningDateKey(now);
  const days = Array.from({ length: PLAN_HORIZON_DAYS }, (_, index) => {
    const key = addDaysKey(today, index + 1);
    const tasks = getTasksForDate(state, key);
    const activeTasks = tasks.filter((task) => !task.completed);
    return { key, tasks, activeTasks, minutes: plannedMinutes(tasks) };
  });

  for (const crowded of days.filter((day) => day.minutes >= 300).sort((a, b) => b.minutes - a.minutes)) {
    const candidates = crowded.activeTasks
      .filter((task) => task.mode === "flexible" && Math.max(0, task.duration || 0) >= 90 && normalize(task.category ?? "") !== "osobni")
      .sort((a, b) => (b.duration || 0) - (a.duration || 0));

    for (const demanding of candidates) {
      const demandingMinutes = Math.max(0, demanding.duration || 0);
      const lighter = days
        .filter((day) => day.key !== crowded.key
          && (!demanding.dueDate || day.key <= demanding.dueDate)
          && day.minutes <= 180
          && crowded.minutes - day.minutes >= 150
          && day.minutes + demandingMinutes <= crowded.minutes - 90
          && Boolean(findSlot(day.tasks, day.key, demandingMinutes, now, demanding.deadlineTime)))
        .sort((a, b) => a.minutes - b.minutes || a.key.localeCompare(b.key))[0];
      if (!lighter) continue;

      return {
        id: `better-day-${demanding.id}`,
        label: "Plán",
        title: `${demanding.title} by měl lepší místo jinde`,
        body: `${weekdayLabel(crowded.key)} máš ${formatDuration(crowded.minutes)} v plánu, zatímco ${weekdayLabel(lighter.key)} jen ${formatDuration(lighter.minutes)}. Pokud je blok přesunutelný, zvaž přesun ${demanding.title} na volnější den.`,
        tone: "normal",
      };
    }
  }

  return null;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function occurrenceForYear(birthday: Birthday, year: number) {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 28 : birthday.day;
  return new Date(year, birthday.month - 1, day, 12);
}

function nextBirthday(birthdays: Birthday[], now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return birthdays
    .map((birthday) => {
      let occurrence = occurrenceForYear(birthday, now.getFullYear());
      if (occurrence.getTime() < today.getTime()) occurrence = occurrenceForYear(birthday, now.getFullYear() + 1);
      const days = Math.round((Date.UTC(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate())
        - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
      return { birthday, occurrence, days };
    })
    .sort((left, right) => left.days - right.days || left.birthday.name.localeCompare(right.birthday.name, "cs"))[0] ?? null;
}

function birthdayAdvice(birthdays: Birthday[], now: Date): Advice | null {
  const next = nextBirthday(birthdays, now);
  if (!next || next.days > 7) return null;
  const when = next.days === 0 ? "dnes" : next.days === 1 ? "zítra" : `za ${next.days} dní`;
  const note = next.birthday.note?.trim();
  return {
    id: `birthday-${next.birthday.id}`,
    label: "Narozeniny",
    title: `${next.birthday.name} · ${when}`,
    body: note
      ? `Poznámka: ${note}`
      : "Pokud chceš řešit dárek nebo zprávu, je dobrý čas to naplánovat.",
    tone: next.days <= 2 ? "warning" : "normal",
  };
}

function tomorrowAdvice(state: DayframeState, now: Date): Advice | null {
  const todayKey = planningDateKey(now);
  const tomorrowKey = addDaysKey(todayKey, 1);
  const todayMinutes = plannedMinutes(getTasksForDate(state, todayKey));
  const tomorrowTasks = getTasksForDate(state, tomorrowKey).filter((task) => !task.completed);
  const tomorrowMinutes = plannedMinutes(tomorrowTasks);
  const scheduled = tomorrowTasks
    .filter((task) => task.start)
    .sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
  const first = scheduled[0] ?? null;
  const firstMinute = first?.start ? timeToMinutes(first.start) : Number.POSITIVE_INFINITY;
  const postMidnight = now.getHours() < 2;
  const nextLabel = postMidnight ? "Po probuzení" : "Zítra";
  const currentLabel = postMidnight ? "Dosavadní plánovací den" : "Dnes";

  if (tomorrowMinutes >= 300 && tomorrowMinutes - todayMinutes >= 120) {
    return {
      id: "tomorrow-load",
      label: postMidnight ? "Po probuzení" : "Zítřek",
      title: `${nextLabel} je plán výrazně plnější`,
      body: `${nextLabel} máš ${formatDuration(tomorrowMinutes)} v ${tomorrowTasks.length} ${tomorrowTasks.length === 1 ? "bloku" : "blocích"}. ${currentLabel} je lehčí o ${formatDuration(tomorrowMinutes - todayMinutes)}; pokud chceš něco přesouvat, je to přirozenější místo.`,
      tone: "normal",
    };
  }

  if (first?.start && firstMinute >= 8 * 60 && firstMinute < 9 * 60 && (now.getHours() >= 16 || postMidnight)) {
    return {
      id: "tomorrow-early",
      label: postMidnight ? "Po probuzení" : "Zítřek",
      title: `${nextLabel} začínáš brzy`,
      body: `První blok je v ${first.start} · ${first.title}. Počítej s tím už při plánování večera.`,
      tone: "normal",
    };
  }

  return null;
}

function buildAdvice(state: DayframeState, birthdays: Birthday[], now: Date) {
  return [
    milestonePreparationAdvice(state, now),
    birthdayAdvice(birthdays, now),
    tomorrowAdvice(state, now),
    betterDayAdvice(state, now),
  ].filter((item): item is Advice => Boolean(item)).slice(0, 3);
}

function renderAdvisor(host: HTMLElement, advice: Advice[]) {
  host.querySelector("[data-jarvis-advisor]")?.remove();
  if (!advice.length) return;

  const card = document.createElement("section");
  card.className = "df2-jarvis-advisor";
  card.dataset.jarvisAdvisor = "true";

  const head = document.createElement("div");
  head.className = "df2-jarvis-card-head";
  const title = document.createElement("span");
  title.textContent = "Advisor";
  const meta = document.createElement("small");
  meta.textContent = advice.length === 1 ? "1 relevantní doporučení" : `${advice.length} relevantní doporučení`;
  head.appendChild(title);
  head.appendChild(meta);
  card.appendChild(head);

  const list = document.createElement("div");
  list.className = "df2-jarvis-advisor-list";
  advice.forEach((item) => {
    const row = document.createElement("article");
    row.className = `df2-jarvis-advice ${item.tone}`;
    row.dataset.jarvisAdvice = item.id;
    const label = document.createElement("span");
    label.textContent = item.label;
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = item.title;
    const body = document.createElement("p");
    body.textContent = item.body;
    copy.appendChild(heading);
    copy.appendChild(body);
    row.appendChild(label);
    row.appendChild(copy);
    list.appendChild(row);
  });
  card.appendChild(list);

  const primary = host.querySelector(".df2-jarvis-primary-grid");
  if (primary) primary.insertAdjacentElement("afterend", card);
  else host.insertBefore(card, host.firstChild);
}

function syncAdvisor() {
  const host = document.querySelector<HTMLElement>("[data-today-briefing]");
  if (!host) return;
  const state = readState();
  if (!state) return;
  const birthdays = readBirthdays();
  const now = new Date();
  const advice = buildAdvice(state, birthdays, now);
  const signature = JSON.stringify({
    date: planningDateKey(now),
    hour: now.getHours(),
    milestones: state.milestones,
    plans: Object.entries(state.plans).map(([date, tasks]) => [date, tasks.map((task) => [task.id, task.title, task.category, task.duration, task.start, task.completed, task.mode, task.dueDate, task.deadlineTime])]),
    birthdays,
    advice,
  });
  if (host.dataset[SIGNATURE_KEY] === signature && (advice.length === 0 || host.querySelector("[data-jarvis-advisor]"))) return;
  host.dataset[SIGNATURE_KEY] = signature;
  renderAdvisor(host, advice);
}

export function JarvisAdvisorController() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncAdvisor();
      });
    };

    sync();
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener(BIRTHDAYS_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(BIRTHDAYS_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
