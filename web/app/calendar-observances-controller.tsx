"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ObservanceKind = "public" | "tradition" | "world";

type CalendarObservance = {
  id: string;
  title: string;
  date: string;
  kind: ObservanceKind;
  label: string;
};

type CalendarTarget = {
  date: string;
  host: HTMLElement;
};

type FixedObservance = Omit<CalendarObservance, "id" | "date"> & {
  id: string;
  month: number;
  day: number;
};

const FIXED_OBSERVANCES: FixedObservance[] = [
  { id: "cz-new-year", month: 1, day: 1, title: "Nový rok · Den obnovy samostatného českého státu", kind: "public", label: "Svátek ČR" },
  { id: "world-holocaust-remembrance", month: 1, day: 27, title: "Den památky obětí holocaustu", kind: "world", label: "Světový den" },
  { id: "world-womens-day", month: 3, day: 8, title: "Mezinárodní den žen", kind: "world", label: "Světový den" },
  { id: "world-health-day", month: 4, day: 7, title: "Světový den zdraví", kind: "world", label: "Světový den" },
  { id: "world-earth-day", month: 4, day: 22, title: "Den Země", kind: "world", label: "Světový den" },
  { id: "cz-labour-day", month: 5, day: 1, title: "Svátek práce", kind: "public", label: "Svátek ČR" },
  { id: "cz-victory-day", month: 5, day: 8, title: "Den vítězství", kind: "public", label: "Svátek ČR" },
  { id: "world-europe-day", month: 5, day: 9, title: "Den Evropy", kind: "world", label: "Mezinárodní den" },
  { id: "world-environment-day", month: 6, day: 5, title: "Světový den životního prostředí", kind: "world", label: "Světový den" },
  { id: "world-refugee-day", month: 6, day: 20, title: "Světový den uprchlíků", kind: "world", label: "Světový den" },
  { id: "cz-cyril-methodius", month: 7, day: 5, title: "Den slovanských věrozvěstů Cyrila a Metoděje", kind: "public", label: "Svátek ČR" },
  { id: "cz-jan-hus", month: 7, day: 6, title: "Den upálení mistra Jana Husa", kind: "public", label: "Svátek ČR" },
  { id: "world-youth-day", month: 8, day: 12, title: "Mezinárodní den mládeže", kind: "world", label: "Světový den" },
  { id: "world-peace-day", month: 9, day: 21, title: "Mezinárodní den míru", kind: "world", label: "Světový den" },
  { id: "cz-statehood-day", month: 9, day: 28, title: "Den české státnosti", kind: "public", label: "Svátek ČR" },
  { id: "world-un-day", month: 10, day: 24, title: "Den OSN", kind: "world", label: "Světový den" },
  { id: "cz-independence-day", month: 10, day: 28, title: "Den vzniku samostatného československého státu", kind: "public", label: "Svátek ČR" },
  { id: "tradition-halloween", month: 10, day: 31, title: "Halloween", kind: "tradition", label: "Tradice" },
  { id: "world-veterans-day", month: 11, day: 11, title: "Den válečných veteránů", kind: "world", label: "Významný den" },
  { id: "cz-freedom-democracy-day", month: 11, day: 17, title: "Den boje za svobodu a demokracii", kind: "public", label: "Svátek ČR" },
  { id: "world-human-rights-day", month: 12, day: 10, title: "Den lidských práv", kind: "world", label: "Světový den" },
  { id: "cz-christmas-eve", month: 12, day: 24, title: "Štědrý den", kind: "public", label: "Vánoce · svátek ČR" },
  { id: "cz-christmas-day", month: 12, day: 25, title: "1. svátek vánoční", kind: "public", label: "Vánoce · svátek ČR" },
  { id: "cz-boxing-day", month: 12, day: 26, title: "2. svátek vánoční", kind: "public", label: "Vánoce · svátek ČR" },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fixedDateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDate(date: Date, days: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

export function calendarObservancesForYear(year: number): CalendarObservance[] {
  const easter = easterSunday(year);
  const goodFriday = shiftDate(easter, -2);
  const easterMonday = shiftDate(easter, 1);

  return [
    ...FIXED_OBSERVANCES.map((event) => ({
      id: `${event.id}-${year}`,
      title: event.title,
      date: fixedDateKey(year, event.month, event.day),
      kind: event.kind,
      label: event.label,
    })),
    {
      id: `cz-good-friday-${year}`,
      title: "Velký pátek",
      date: dateKey(goodFriday),
      kind: "public" as const,
      label: "Velikonoce · svátek ČR",
    },
    {
      id: `tradition-easter-sunday-${year}`,
      title: "Velikonoční neděle",
      date: dateKey(easter),
      kind: "tradition" as const,
      label: "Velikonoce",
    },
    {
      id: `cz-easter-monday-${year}`,
      title: "Velikonoční pondělí",
      date: dateKey(easterMonday),
      kind: "public" as const,
      label: "Velikonoce · svátek ČR",
    },
  ].sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "cs"));
}

function collectTargets() {
  return [...document.querySelectorAll<HTMLElement>(".df2-month-day[data-date]")].flatMap<CalendarTarget>((day) => {
    const date = day.dataset.date;
    const events = day.querySelector<HTMLElement>(".df2-month-events");
    if (!date || !events) return [];

    let host = events.querySelector<HTMLElement>(":scope > [data-calendar-observances-host]");
    if (!host) {
      host = document.createElement("div");
      host.dataset.calendarObservancesHost = "true";
      host.className = "df2-calendar-observances-host";
      events.prepend(host);
    }
    return [{ date, host }];
  });
}

function sameTargets(left: CalendarTarget[], right: CalendarTarget[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.date === right[index]?.date && item.host === right[index]?.host);
}

export function CalendarObservancesController() {
  const [targets, setTargets] = useState<CalendarTarget[]>([]);

  useEffect(() => {
    let queued = false;
    const sync = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const next = collectTargets();
        setTargets((current) => sameTargets(current, next) ? current : next);
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.querySelectorAll<HTMLElement>("[data-calendar-observances-host]").forEach((host) => host.remove());
    };
  }, []);

  const observancesByDate = useMemo(() => {
    const years = new Set(targets.map((target) => Number(target.date.slice(0, 4))).filter(Number.isFinite));
    const byDate = new Map<string, CalendarObservance[]>();
    years.forEach((year) => {
      calendarObservancesForYear(year).forEach((event) => {
        const events = byDate.get(event.date) ?? [];
        events.push(event);
        byDate.set(event.date, events);
      });
    });
    return byDate;
  }, [targets]);

  return <>{targets.map(({ date, host }) => {
    const events = observancesByDate.get(date) ?? [];
    if (!events.length) return null;
    return createPortal(
      <>{events.map((event) => (
        <div
          key={event.id}
          className={`df2-calendar-observance ${event.kind}`}
          data-observance-id={event.id}
          data-observance-kind={event.kind}
          role="note"
          aria-label={`${event.title} — ${event.label}`}
          title={`${event.title} — ${event.label}`}
        >
          <strong>{event.title}</strong>
          <small>{event.label}</small>
        </div>
      ))}</>,
      host,
      date,
    );
  })}</>;
}
