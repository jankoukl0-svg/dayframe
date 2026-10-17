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
import {markSupplementIntake,readSupplementStore,saveSupplementStore,
  supplementOccurrences,SUPPLEMENTS_SYNC_EVENT} from "@/lib/dayframe-supplements";

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const MODAL_ID = "dayframe-today-briefing-dialog";
const WEATHER_COORDS_KEY = "dayframe-weather-location-v1";
const WEATHER_REFRESH_MS = 20 * 60 * 1000;
const WEATHER_LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WEATHER_LOCATION = { latitude: 50.0755, longitude: 14.4378, label: "Praha · výchozí" };

type BriefingTask = CalendarTask & {
  actualRunningSince?: string;
};

type WeatherHour = {
  time: string;
  temperature: number;
  apparent: number;
  code: number;
  rain: number;
  wind: number;
};

type WeatherSnapshot = {
  status: "loading" | "ready" | "error";
  location: string;
  temperature?: number;
  apparent?: number;
  code?: number;
  wind?: number;
  high?: number;
  low?: number;
  precipitationProbability?: number;
  sunrise?: string | number;
  sunset?: string | number;
  hours?: WeatherHour[];
  forecastFrom?: string;
  timezone?: string;
};

type BriefingModel = {
  greeting: string;
  overdueSummary: string | null;
  priority: string;
  plan: string;
  remainingPlan: string;
  progress: string;
  nextLabel: string;
  nextValue: string;
  contextLabel: string;
  contextValue: string;
  time: string;
  date: string;
  timeline: Array<{ id: string; time: string; title: string; category: string; priority: string }>;
  milestoneTitle: string;
  milestoneDays: string;
  insight: string;
  weather: WeatherSnapshot;
  dueSupplements: Array<{ key: string; name: string; time: string; doseLabel: string; brand: string }>;
  supplementsBlocked: boolean;
};

let weatherSnapshot: WeatherSnapshot = { status: "loading", location: "Zjišťuji polohu…" };
let weatherPromise: Promise<void> | null = null;
let weatherFetchedAt = 0;

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

function formatTime(now: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(now);
}

function formatDate(now: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(now);
}

function byStart(a: CalendarTask, b: CalendarTask) {
  const aMinute = Number.isFinite(timeToMinutes(a.start)) ? timeToMinutes(a.start) : Number.POSITIVE_INFINITY;
  const bMinute = Number.isFinite(timeToMinutes(b.start)) ? timeToMinutes(b.start) : Number.POSITIVE_INFINITY;
  return aMinute - bMinute;
}

function overdueSummary(missedCount: number) {
  if (missedCount <= 0) return null;
  return `Z dřívějška ${missedCount === 1 ? "zůstává 1 rest" : `zůstávají ${missedCount} resty`}.`;
}

function runningFocusTask(tasks: BriefingTask[]) {
  return [...tasks]
    .filter((task) => !task.completed && Boolean(task.actualRunningSince))
    .sort((a, b) => Date.parse(b.actualRunningSince ?? "") - Date.parse(a.actualRunningSince ?? ""))[0] ?? null;
}

function weatherCodeLabel(code = -1) {
  if (code === 0) return "Jasno";
  if ([1, 2].includes(code)) return "Polojasno";
  if (code === 3) return "Zataženo";
  if ([45, 48].includes(code)) return "Mlha";
  if ([51, 53, 55, 56, 57].includes(code)) return "Mrholení";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Déšť";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Sněžení";
  if ([95, 96, 99].includes(code)) return "Bouřky";
  return "Počasí";
}

function weatherIcon(code = -1) {
  if (code === 0) return "☀︎";
  if ([1, 2].includes(code)) return "◒";
  if (code === 3) return "☁︎";
  if ([45, 48].includes(code)) return "≋";
  if ([51, 53, 55, 56, 57].includes(code)) return "⌁";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "☂︎";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "✣";
  if ([95, 96, 99].includes(code)) return "ϟ";
  return "·";
}

function isoClock(value?: string | number, timezone = "UTC") {
  if (typeof value === "number" && Number.isFinite(value)) return localWeatherTime(value, timezone).slice(11, 16);
  if (typeof value !== "string") return "—";
  const match = value.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? "—";
}

function localWeatherTime(epochSeconds: number, timezone: string): string {
  const timestamp = new Date(epochSeconds * 1000);
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(timestamp);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return part("year") + "-" + part("month") + "-" + part("day")
      + "T" + part("hour") + ":" + part("minute");
  } catch {
    return timestamp.toISOString().slice(0, 16);
  }
}

function parseWeatherHours(hourly: {
  time?: number[];
  temperature_2m?: number[];
  apparent_temperature?: number[];
  weather_code?: number[];
  precipitation_probability?: number[];
  wind_speed_10m?: number[];
} | undefined, currentTime: number | undefined, timezone: string): WeatherHour[] {
  if (!hourly?.time || !hourly.temperature_2m || !hourly.apparent_temperature
      || !hourly.weather_code || !hourly.precipitation_probability || !hourly.wind_speed_10m) return [];

  // Compare Unix instants, not fixed-offset ISO strings, across DST transitions.
  const fromTime = typeof currentTime === "number" && Number.isFinite(currentTime)
    ? currentTime : Math.floor(Date.now() / 1000);
  const hours: WeatherHour[] = [];
  for (let i = 0; i < hourly.time.length && hours.length < 24; i += 1) {
    const timestamp = hourly.time[i];
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < fromTime) continue;
    const values = [
      hourly.temperature_2m[i], hourly.apparent_temperature[i],
      hourly.weather_code[i], hourly.precipitation_probability[i], hourly.wind_speed_10m[i],
    ];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    hours.push({
      time: localWeatherTime(timestamp, timezone),
      temperature: values[0],
      apparent: values[1],
      code: values[2],
      rain: Math.min(100, Math.max(0, values[3])),
      wind: Math.max(0, values[4]),
    });
  }
  return hours;
}

function outfitAdvice(hours: WeatherHour[]): string {
  const minimumFeelsLike = Math.min(...hours.map((hour) => hour.apparent));
  const tempRange = Math.max(...hours.map((hour) => hour.temperature))
    - Math.min(...hours.map((hour) => hour.temperature));
  const wet = Math.max(...hours.map((hour) => hour.rain)) >= 45;
  const windy = Math.max(...hours.map((hour) => hour.wind)) >= 35;
  let clothing = "tričko a lehké oblečení";
  if (minimumFeelsLike <= 0) clothing = "zimní bunda, teplé vrstvy, čepice a rukavice";
  else if (minimumFeelsLike <= 7) clothing = "teplá bunda a vrstvy";
  else if (minimumFeelsLike <= 13) clothing = "přechodná bunda nebo mikina";
  else if (minimumFeelsLike <= 19) clothing = "mikina nebo lehká bunda";
  return "Orientačně: " + clothing
    + (tempRange >= 8 ? "; vrstvy se hodí kvůli změnám teplot" : "")
    + (wet ? "; přibal deštník nebo nepromokavou vrstvu" : "")
    + (windy ? "; počítej i s větrem" : "") + ".";
}

function renderHourlyWeather(card: HTMLElement, hours: WeatherHour[], todayDate: string) {
  if (!hours.length) {
    const unavailable = addText(card, "p", "Hodinová předpověď nyní není k dispozici.", "df2-jarvis-weather-no-hours");
    unavailable.dataset.jarvisHourlyUnavailable = "true";
    return;
  }

  const forecast = document.createElement("section");
  forecast.className = "df2-jarvis-hourly";
  forecast.dataset.jarvisHourly = "true";
  forecast.dataset.jarvisHourCount = String(hours.length);
  forecast.setAttribute("aria-label", "Hodinový výhled počasí");

  const headline = document.createElement("div");
  headline.className = "df2-jarvis-hourly-head";
  addText(headline, "strong", "Dalších 24 hodin");
  addText(headline, "span", "Po 3 hodinách");
  forecast.appendChild(headline);

  const grid = document.createElement("div");
  grid.className = "df2-jarvis-hourly-scroll";
  const temperatureMin = Math.min(...hours.map((hour) => hour.temperature));
  const temperatureMax = Math.max(...hours.map((hour) => hour.temperature));
  const span = Math.max(1, temperatureMax - temperatureMin);

  hours.filter((_, index) => index % 3 === 0).forEach((hour, index) => {
    const point = document.createElement("article");
    point.className = "df2-jarvis-hourly-point";
    point.dataset.jarvisHour = hour.time;
    const date = hour.time.slice(0, 10);
    const previousDate = index ? hours[(index - 1) * 3]?.time.slice(0, 10) : todayDate;
    addText(point, "span", date !== previousDate ? "zítra" : " ", "df2-jarvis-hourly-day");
    const clock = addText(point, "time", hour.time.slice(11, 16));
    clock.setAttribute("datetime", hour.time);
    addText(point, "span", weatherIcon(hour.code), "df2-jarvis-hourly-icon");

    const barTrack = document.createElement("div");
    barTrack.className = "df2-jarvis-hourly-track";
    const bar = document.createElement("i");
    bar.style.height = (26 + (hour.temperature - temperatureMin) / span * 70) + "%";
    barTrack.appendChild(bar);
    point.appendChild(barTrack);

    addText(point, "strong", Math.round(hour.temperature) + "°");
    addText(point, "small", "☂ " + Math.round(hour.rain) + " %");
    addText(point, "small", "Vítr " + Math.round(hour.wind) + " km/h");
    point.setAttribute("aria-label", hour.time.slice(0, 10) + " " + hour.time.slice(11, 16)
      + ", " + Math.round(hour.temperature) + " stupňů, déšť " + Math.round(hour.rain)
      + " %, vítr " + Math.round(hour.wind) + " kilometrů za hodinu");
    grid.appendChild(point);
  });
  forecast.appendChild(grid);

  const minimum = Math.round(temperatureMin);
  const maximum = Math.round(temperatureMax);
  const highestRain = Math.round(Math.max(...hours.map((hour) => hour.rain)));
  addText(forecast, "p", "Rozmezí " + minimum + " až " + maximum
    + " °C · pravděpodobnost srážek až " + highestRain + " %", "df2-jarvis-weather-trend");
  const clothing = document.createElement("div");
  clothing.className = "df2-jarvis-outfit";
  clothing.dataset.jarvisOutfit = "true";
  addText(clothing, "span", "CO SI OBLÉCT");
  addText(clothing, "p", outfitAdvice(hours));
  forecast.appendChild(clothing);
  card.appendChild(forecast);
}

function buildInsight(missedCount: number, milestoneTitle: string, milestoneDays: number | null, weather: WeatherSnapshot) {
  if (missedCount > 0) return `Pozornost: ${missedCount === 1 ? "1 rest z minulých dnů" : `${missedCount} resty z minulých dnů`}.`;
  if (milestoneDays !== null && milestoneDays <= 3) return `${milestoneTitle} je za ${milestoneDays} ${milestoneDays === 1 ? "den" : "dny"}.`;
  if (weather.status === "ready" && (weather.precipitationProbability ?? 0) >= 60) return "Déšť je dnes pravděpodobný. Deštník se může hodit.";
  if (weather.status === "ready" && (weather.wind ?? 0) >= 35) return "Venku bude výraznější vítr. Počítej s ním při přesunech.";
  if (weather.status === "ready" && (weather.temperature ?? 20) <= 5) return "Venku je chladno. Při odchodu počítej s nízkou teplotou.";
  if (weather.status === "ready" && (weather.temperature ?? 20) >= 28) return "Dnes je teplo. Delší přesuny venku plánuj s rezervou.";
  return "Systém je klidný. Žádný výrazný konflikt ani externí signál.";
}

function buildModel(state: DayframeState, now: Date): BriefingModel {
  const today = planningDateKey(now);
  const supplementData = readSupplementStore();
  const dueSupplements = supplementData.blocked ? [] :
    supplementOccurrences(supplementData.store,today)
      .filter(occurrence=>!occurrence.intake && timeToMinutes(occurrence.time)<=planningMinute(now))
      .map(occurrence=>({key:occurrence.key,name:occurrence.supplement.name,time:occurrence.time,
        doseLabel:occurrence.supplement.doseLabel,brand:occurrence.supplement.brand}))
      .sort((a,b)=>timeToMinutes(b.time)-timeToMinutes(a.time)||a.name.localeCompare(b.name,"cs"));
  const tasks = getTasksForDate(state, today) as BriefingTask[];
  const scheduled = tasks.filter((task) => task.start && task.end).sort(byStart);
  const unfinished = tasks.filter((task) => !task.completed);
  const unfinishedScheduled = scheduled.filter((task) => !task.completed);
  const currentMinute = planningMinute(now);
  const running = runningFocusTask(unfinished);
  const scheduledCurrent = unfinishedScheduled.find((task) => timeToMinutes(task.start) <= currentMinute && timeToMinutes(task.end) > currentMinute) ?? null;
  const current = running ?? scheduledCurrent;
  const upcoming = unfinishedScheduled.find((task) => task.id !== running?.id && timeToMinutes(task.start) > currentMinute) ?? null;
  const highPriority = [...unfinished].filter((task) => task.priority === "high").sort(byStart)[0] ?? null;
  const mainTask = running ?? highPriority ?? scheduledCurrent ?? upcoming ?? [...unfinished].sort(byStart)[0] ?? null;
  const completed = tasks.filter((task) => task.completed).length;
  const plannedMinutes = scheduled.reduce((sum, task) => sum + task.duration, 0);
  const remainingMinutes = unfinished.reduce((sum, task) => sum + task.duration, 0);
  const missed = overdueTasks(state, now).filter((task) => task.id !== running?.id);
  const nextMilestone = [...state.milestones]
    .filter((milestone) => milestone.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const nextMilestoneDays = nextMilestone ? daysUntilDate(nextMilestone.date, now) : null;

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
  let contextValue = nextMilestone ? `${nextMilestoneDays} dní` : "Žádný";
  if (missed.length) {
    contextLabel = "Resty";
    contextValue = String(missed.length);
  }

  const timeline = [...unfinishedScheduled]
    .sort(byStart)
    .filter((task) => running?.id === task.id || timeToMinutes(task.end) > currentMinute)
    .slice(0, 4)
    .map((task) => ({
      id: task.id,
      time: task.start ? `${task.start}–${task.end}` : "bez času",
      title: task.title,
      category: task.category,
      priority: task.priority,
    }));

  return {
    greeting: greetingFor(now),
    overdueSummary: overdueSummary(missed.length),
    priority: mainTask?.title ?? "Bez hlavní priority",
    plan: formatDuration(plannedMinutes),
    remainingPlan: formatDuration(remainingMinutes),
    progress: `${completed}/${tasks.length}`,
    nextLabel,
    nextValue,
    contextLabel,
    contextValue,
    time: formatTime(now),
    date: formatDate(now),
    timeline,
    milestoneTitle: nextMilestone?.title ?? "Bez blízkého milníku",
    milestoneDays: nextMilestoneDays === null ? "—" : `${nextMilestoneDays} dní`,
    insight: buildInsight(missed.length, nextMilestone?.title ?? "Milník", nextMilestoneDays, weatherSnapshot),
    weather: weatherSnapshot,
    dueSupplements,
    supplementsBlocked:supplementData.blocked,
  };
}

function addText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderWeather(parent: HTMLElement, weather: WeatherSnapshot) {
  const card = document.createElement("section");
  card.className = "df2-jarvis-weather";

  const head = document.createElement("div");
  head.className = "df2-jarvis-card-head";
  addText(head, "span", "Počasí");
  addText(head, "small", weather.location);
  card.appendChild(head);

  if (weather.status === "loading") {
    const loading = document.createElement("div");
    loading.className = "df2-jarvis-weather-loading";
    addText(loading, "strong", "Získávám podmínky…");
    addText(loading, "span", "Poloha se použije pouze pro lokální předpověď.");
    card.appendChild(loading);
    parent.appendChild(card);
    return;
  }

  if (weather.status === "error") {
    const error = document.createElement("div");
    error.className = "df2-jarvis-weather-loading";
    addText(error, "strong", "Počasí není dostupné");
    addText(error, "span", "Ostatní informace zůstávají aktivní.");
    card.appendChild(error);
    parent.appendChild(card);
    return;
  }

  const main = document.createElement("div");
  main.className = "df2-jarvis-weather-main";
  addText(main, "b", weatherIcon(weather.code), "df2-jarvis-weather-icon");
  const temp = document.createElement("div");
  addText(temp, "strong", `${Math.round(weather.temperature ?? 0)}°`);
  addText(temp, "span", weatherCodeLabel(weather.code));
  main.appendChild(temp);
  card.appendChild(main);

  const metrics = document.createElement("div");
  metrics.className = "df2-jarvis-weather-metrics";
  const metricItems = [
    ["Pocitově", `${Math.round(weather.apparent ?? 0)}°`],
    ["Max / min", `${Math.round(weather.high ?? 0)}° / ${Math.round(weather.low ?? 0)}°`],
    ["Déšť", `${Math.round(weather.precipitationProbability ?? 0)} %`],
    ["Vítr", `${Math.round(weather.wind ?? 0)} km/h`],
    ["Východ", isoClock(weather.sunrise, weather.timezone)],
    ["Západ", isoClock(weather.sunset, weather.timezone)],
  ];
  metricItems.forEach(([label, value]) => {
    const item = document.createElement("div");
    addText(item, "span", label);
    addText(item, "strong", value);
    metrics.appendChild(item);
  });
  card.appendChild(metrics);
  renderHourlyWeather(card, weather.hours ?? [], weather.forecastFrom ?? "");
  parent.appendChild(card);
}

function renderBriefing(host: HTMLElement, model: BriefingModel) {
  const signature = JSON.stringify(model);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.replaceChildren();

  const hero = document.createElement("div");
  hero.className = "df2-jarvis-hero";

  const copy = document.createElement("div");
  copy.className = "df2-briefing-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "df2-briefing-eyebrow";
  const pulse = document.createElement("span");
  pulse.setAttribute("aria-hidden", "true");
  eyebrow.appendChild(pulse);
  addText(eyebrow, "strong", "JARVIS · LIVE");
  copy.appendChild(eyebrow);
  addText(copy, "h2", model.greeting);
  hero.appendChild(copy);

  const clock = document.createElement("div");
  clock.className = "df2-jarvis-clock";
  addText(clock, "strong", model.time);
  addText(clock, "span", model.date);
  hero.appendChild(clock);
  host.appendChild(hero);

  const primaryGrid = document.createElement("div");
  primaryGrid.className = "df2-jarvis-primary-grid";
  renderWeather(primaryGrid, model.weather);

  const supplements = document.createElement("section");
  supplements.className = "df2-jarvis-supplement-reminders";
  supplements.dataset.jarvisSupplements = "true";
  const supplementsHead = document.createElement("div");
  supplementsHead.className = "df2-jarvis-card-head";
  addText(supplementsHead, "span", "Suplementy · čas užívání");
  if (model.dueSupplements.length) addText(supplementsHead, "small", String(model.dueSupplements.length) + " k vyřízení");
  supplements.appendChild(supplementsHead);

  if (model.supplementsBlocked) {
    addText(supplements, "p", "Suplementy nelze bezpečně načíst. Zkontroluj je v sekci Zdraví.",
      "df2-jarvis-supplement-empty");
  } else if (!model.dueSupplements.length) {
    addText(supplements, "strong", "Teď není žádný suplement k užití.", "df2-jarvis-supplement-all-clear");
    addText(supplements, "p", "Jarvis zobrazí dávku až v nastavený čas a skryje ji po označení jako užitou nebo vynechanou.",
      "df2-jarvis-supplement-empty");
  } else {
    addText(supplements, "p", "Tyto dávky už dosáhly svého naplánovaného času.",
      "df2-jarvis-supplement-lead");
    const list = document.createElement("div");
    list.className = "df2-jarvis-supplement-list";
    for (const dose of model.dueSupplements) {
      const row = document.createElement("article");
      row.className = "df2-jarvis-supplement-item";
      row.dataset.jarvisSupplementKey = dose.key;
      const details = document.createElement("div");
      details.className = "df2-jarvis-supplement-detail";
      const when = addText(details, "time", dose.time);
      when.setAttribute("datetime", dose.time);
      addText(details, "strong", dose.name);
      if (dose.doseLabel) addText(details, "span", dose.doseLabel);
      else if (dose.brand) addText(details, "span", dose.brand);
      row.appendChild(details);
      const actions = document.createElement("div");
      actions.className = "df2-jarvis-supplement-actions";
      const statuses: Array<["taken" | "skipped", string]> = [["taken","Užito"],["skipped","Vynechat"]];
      for (const [status, label] of statuses) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.jarvisSupplementAction = status;
        button.setAttribute("aria-label", label + ": " + dose.name + " (" + dose.time + ")");
        button.addEventListener("click", () => {
          const current = readSupplementStore();
          if (current.blocked) return;
          const now = new Date();
          const valid = supplementOccurrences(current.store, planningDateKey(now))
            .some(x=>x.key===dose.key && !x.intake && timeToMinutes(x.time)<=planningMinute(now));
          if (!valid) { syncBriefing(); return; }
          const updated = markSupplementIntake(current.store,dose.key,status);
          if (updated===current.store || !saveSupplementStore(updated)){
            addText(row, "p", "Záznam se nepodařilo uložit. Zkontroluj zásoby nebo data v sekci Zdraví.",
              "df2-jarvis-supplement-error");
            return;
          }
          syncBriefing();
        });
        actions.appendChild(button);
      }
      row.appendChild(actions);
      list.appendChild(row);
    }
    supplements.appendChild(list);
  }
  primaryGrid.appendChild(supplements);
  host.appendChild(primaryGrid);
}

function readStoredCoordinates() {
  try {
    const raw = window.localStorage.getItem(WEATHER_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { latitude?: number; longitude?: number; acquiredAt?: number };
    if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude) || !Number.isFinite(parsed.acquiredAt)) return null;
    const age = Date.now() - Number(parsed.acquiredAt);
    if (age < 0 || age >= WEATHER_LOCATION_MAX_AGE_MS) return null;
    return { latitude: Number(parsed.latitude), longitude: Number(parsed.longitude), label: "Moje poloha" };
  } catch {
    return null;
  }
}

function locateForWeather(): Promise<{ latitude: number; longitude: number; label: string }> {
  const stored = readStoredCoordinates();
  if (stored) return Promise.resolve(stored);
  if (!("geolocation" in navigator)) return Promise.resolve(DEFAULT_WEATHER_LOCATION);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Moje poloha",
        };
        try {
          window.localStorage.setItem(WEATHER_COORDS_KEY, JSON.stringify({
            latitude: location.latitude,
            longitude: location.longitude,
            acquiredAt: Date.now(),
          }));
        } catch {
          // Weather still works without persisting coordinates.
        }
        resolve(location);
      },
      () => resolve(DEFAULT_WEATHER_LOCATION),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: WEATHER_LOCATION_MAX_AGE_MS },
    );
  });
}

async function refreshWeather() {
  const location = await locateForWeather();
  weatherSnapshot = { status: "loading", location: location.label };
  syncBriefing();

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "3",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) throw new Error("Weather request failed");
    const payload = await response.json() as {
      timezone?: string;
      current?: { time?: number; temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number };
      hourly?: {
        time?: number[];
        temperature_2m?: number[];
        apparent_temperature?: number[];
        weather_code?: number[];
        precipitation_probability?: number[];
        wind_speed_10m?: number[];
      };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        sunrise?: Array<string | number>;
        sunset?: Array<string | number>;
      };
    };
    weatherSnapshot = {
      status: "ready",
      location: location.label,
      temperature: payload.current?.temperature_2m,
      apparent: payload.current?.apparent_temperature,
      code: payload.current?.weather_code,
      wind: payload.current?.wind_speed_10m,
      high: payload.daily?.temperature_2m_max?.[0],
      low: payload.daily?.temperature_2m_min?.[0],
      precipitationProbability: payload.daily?.precipitation_probability_max?.[0],
      sunrise: payload.daily?.sunrise?.[0],
      sunset: payload.daily?.sunset?.[0],
      hours: parseWeatherHours(payload.hourly, payload.current?.time, payload.timezone ?? "UTC"),
      forecastFrom: typeof payload.current?.time === "number"
        ? localWeatherTime(payload.current.time, payload.timezone ?? "UTC").slice(0, 10) : undefined,
      timezone: payload.timezone,
    };
  } catch {
    weatherSnapshot = { status: "error", location: location.label };
  }
  weatherFetchedAt = Date.now();
  syncBriefing();
}

function ensureWeather() {
  if (weatherPromise) return;
  if (weatherFetchedAt && Date.now() - weatherFetchedAt < WEATHER_REFRESH_MS) return;
  weatherPromise = refreshWeather().finally(() => {
    weatherPromise = null;
  });
}

function setAppInert(inert: boolean) {
  const root = document.querySelector<HTMLElement>(".df2-root");
  if (!root) return;
  if (inert) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

function closeBriefingModal(restoreFocus = true) {
  const overlay = document.querySelector<HTMLElement>("[data-today-briefing-modal]");
  overlay?.remove();
  document.body.classList.remove("df2-briefing-modal-open");
  document.removeEventListener("keydown", handleModalDocumentKeydown, true);
  setAppInert(false);
  if (restoreFocus) document.querySelector<HTMLElement>("[data-today-briefing-launcher]")?.focus();
}

function handleModalDocumentKeydown(event: KeyboardEvent) {
  const overlay = document.querySelector<HTMLElement>("[data-today-briefing-modal]");
  if (!overlay) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeBriefingModal();
    return;
  }

  if (event.key === "Tab") {
    const close = overlay.querySelector<HTMLElement>("[data-today-briefing-close]");
    if (!close) return;
    event.preventDefault();
    close.focus();
  }
}

function openBriefingModal() {
  const existing = document.querySelector<HTMLElement>("[data-today-briefing-modal]");
  if (existing) {
    existing.querySelector<HTMLElement>("[data-today-briefing-close]")?.focus();
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "df2-briefing-modal-backdrop";
  overlay.dataset.todayBriefingModal = "true";

  const dialog = document.createElement("section");
  dialog.id = MODAL_ID;
  dialog.className = "df2-briefing-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Ranní briefing");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "df2-briefing-modal-close";
  close.dataset.todayBriefingClose = "true";
  close.setAttribute("aria-label", "Zavřít briefing");
  close.textContent = "×";
  close.addEventListener("click", () => closeBriefingModal());
  dialog.appendChild(close);

  const host = document.createElement("div");
  host.className = "df2-today-briefing";
  host.dataset.todayBriefing = "true";
  dialog.appendChild(host);
  overlay.appendChild(dialog);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeBriefingModal();
  });

  document.body.appendChild(overlay);
  document.body.classList.add("df2-briefing-modal-open");
  setAppInert(true);
  document.addEventListener("keydown", handleModalDocumentKeydown, true);

  const state = readState();
  if (state) renderBriefing(host, buildModel(state, new Date()));
  ensureWeather();
  close.focus();
}

function ensureLauncher(todayView: HTMLElement) {
  let launcher = todayView.querySelector<HTMLButtonElement>("[data-today-briefing-launcher]");
  if (launcher) return launcher;

  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "df2-briefing-launcher";
  launcher.dataset.todayBriefingLauncher = "true";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-controls", MODAL_ID);
  launcher.innerHTML = '<span class="df2-briefing-launcher-dot" aria-hidden="true"></span><span>Jarvis briefing</span><span class="df2-briefing-launcher-arrow" aria-hidden="true">↗</span>';
  launcher.addEventListener("click", openBriefingModal);

  const anchor = todayView.querySelector(".df2-motivation-grid");
  if (anchor) todayView.insertBefore(launcher, anchor);
  else todayView.querySelector(".df2-page-head")?.insertAdjacentElement("afterend", launcher);
  return launcher;
}

function activeViewLabel() {
  return document.querySelector<HTMLElement>(".df2-sidebar nav button.active span")?.textContent?.trim() ?? "";
}

function removeLaunchers() {
  document.querySelectorAll<HTMLElement>("[data-today-briefing-launcher]").forEach((launcher) => launcher.remove());
}

function syncBriefing() {
  const todayView = document.querySelector(".df2-today-view");
  const activeView = activeViewLabel();
  if (activeView && activeView !== "Dnes") {
    removeLaunchers();
    closeBriefingModal(false);
    return;
  }
  if (!(todayView instanceof HTMLElement)) {
    removeLaunchers();
    closeBriefingModal(false);
    return;
  }

  ensureLauncher(todayView);

  const host = document.querySelector<HTMLElement>("[data-today-briefing]");
  if (!host) return;
  ensureWeather();
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
    window.addEventListener(SUPPLEMENTS_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const timer = window.setInterval(sync, 30_000);

    return () => {
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(SUPPLEMENTS_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      observer.disconnect();
      window.clearInterval(timer);
      removeLaunchers();
      closeBriefingModal(false);
    };
  }, []);

  return null;
}
