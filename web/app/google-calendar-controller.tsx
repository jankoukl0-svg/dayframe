"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_SCRIPT_ID = "dayframe-google-identity";
const TOKEN_STORAGE_KEY = "dayframe-google-calendar-token-v1";
const MINUTE_HEIGHT = 0.72;
const DAY_START = 8 * 60;
const DAY_END = 24 * 60;

type StoredToken = {
  accessToken: string;
  expiresAt: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleCalendarApiEvent = {
  id?: string;
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

type GoogleCalendarApiResponse = {
  items?: GoogleCalendarApiEvent[];
  nextPageToken?: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  allDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
  timeLabel: string;
  htmlLink: string;
};

type MonthTarget = { date: string; host: HTMLElement };
type WeekTarget = { date: string; timedHost: HTMLElement; allDayHost: HTMLElement };
type ControlTarget = { id: string; host: HTMLElement };

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
    __DAYFRAME_GOOGLE_CLIENT_ID__?: string;
  }
}

function buildClientId() {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

function googleClientId() {
  return window.__DAYFRAME_GOOGLE_CLIENT_ID__?.trim() || buildClientId().trim();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function addDaysKey(value: string, amount: number) {
  const date = parseDateKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function minutesLabel(value: number) {
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function readStoredToken(): StoredToken | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (!parsed.accessToken || !parsed.expiresAt || parsed.expiresAt <= Date.now() + 30_000) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function storeToken(response: GoogleTokenResponse) {
  if (!response.access_token) return null;
  const expiresIn = Math.max(60, Number(response.expires_in) || 3600);
  const stored = {
    accessToken: response.access_token,
    expiresAt: Date.now() + expiresIn * 1000 - 30_000,
  } satisfies StoredToken;
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google přihlášení se nepodařilo načíst.")), { once: true });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google přihlášení se nepodařilo načíst."));
    document.head.appendChild(script);
  });
}

function localEvent(event: GoogleCalendarApiEvent, index: number): CalendarEvent[] {
  if (!event.start || event.status === "cancelled") return [];
  const title = event.summary?.trim() || "Událost Google Kalendáře";
  const htmlLink = event.htmlLink ?? "";
  const id = event.id || `google-${index}`;

  if (event.start.date) {
    const start = event.start.date;
    const endExclusive = event.end?.date || addDaysKey(start, 1);
    const result: CalendarEvent[] = [];
    let cursor = start;
    let dayIndex = 0;
    while (cursor < endExclusive && dayIndex < 366) {
      result.push({
        id: `${id}-${cursor}`,
        title,
        date: cursor,
        allDay: true,
        startMinute: null,
        endMinute: null,
        timeLabel: "Celý den",
        htmlLink,
      });
      cursor = addDaysKey(cursor, 1);
      dayIndex += 1;
    }
    return result;
  }

  if (!event.start.dateTime) return [];
  const startDate = new Date(event.start.dateTime);
  if (Number.isNaN(startDate.getTime())) return [];
  const endDate = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(startDate.getTime() + 60 * 60 * 1000);
  const startMinute = startDate.getHours() * 60 + startDate.getMinutes();
  const rawEnd = endDate.getHours() * 60 + endDate.getMinutes();
  const crossesDay = dateKey(endDate) !== dateKey(startDate);
  const endMinute = crossesDay ? DAY_END : Math.max(startMinute + 1, rawEnd);
  return [{
    id,
    title,
    date: dateKey(startDate),
    allDay: false,
    startMinute,
    endMinute,
    timeLabel: `${minutesLabel(startMinute)}–${minutesLabel(Math.min(endMinute, 23 * 60 + 59))}`,
    htmlLink,
  }];
}

async function fetchGoogleEvents(accessToken: string, startDate: string, endDate: string) {
  const timeMin = parseDateKey(startDate).toISOString();
  const timeMaxDate = parseDateKey(endDate);
  timeMaxDate.setDate(timeMaxDate.getDate() + 1);
  const timeMax = timeMaxDate.toISOString();
  const events: GoogleCalendarApiEvent[] = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401 || response.status === 403) throw new Error("GOOGLE_AUTH_EXPIRED");
    if (!response.ok) throw new Error(`Google Calendar API vrátilo ${response.status}.`);
    const data = await response.json() as GoogleCalendarApiResponse;
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  return events.flatMap(localEvent).sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return (left.startMinute ?? 0) - (right.startMinute ?? 0) || left.title.localeCompare(right.title, "cs");
  });
}

function parseWeekStart() {
  const label = document.querySelector<HTMLElement>(".df2-week-view .df2-page-head p")?.textContent ?? "";
  const values = (label.match(/\d+/g) ?? []).map(Number);
  if (values.length < 5) return null;
  const [startDay, startMonth, , endMonth, endYear] = values;
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return new Date(startYear, startMonth - 1, startDay, 12, 0, 0, 0);
}

function collectMonthTargets() {
  return [...document.querySelectorAll<HTMLElement>(".df2-month-day[data-date]")].flatMap<MonthTarget>((day) => {
    const date = day.dataset.date;
    const events = day.querySelector<HTMLElement>(".df2-month-events");
    if (!date || !events) return [];
    let host = events.querySelector<HTMLElement>(":scope > [data-google-calendar-host]");
    if (!host) {
      host = document.createElement("div");
      host.dataset.googleCalendarHost = "true";
      host.className = "df2-google-calendar-month-host";
      events.insertBefore(host, events.firstChild);
    }
    return [{ date, host }];
  });
}

function collectWeekTargets() {
  const start = parseWeekStart();
  if (!start) return [];
  return [...document.querySelectorAll<HTMLElement>(".df2-week-view .df2-week-day")].flatMap<WeekTarget>((day, index) => {
    const body = day.querySelector<HTMLElement>(".df2-time-body");
    if (!body) return [];
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);

    let timedHost = body.querySelector<HTMLElement>(":scope > [data-google-week-timed-host]");
    if (!timedHost) {
      timedHost = document.createElement("div");
      timedHost.dataset.googleWeekTimedHost = "true";
      timedHost.className = "df2-google-week-timed-host";
      body.appendChild(timedHost);
    }

    let allDayHost = day.querySelector<HTMLElement>(":scope > [data-google-week-all-day-host]");
    if (!allDayHost) {
      allDayHost = document.createElement("div");
      allDayHost.dataset.googleWeekAllDayHost = "true";
      allDayHost.className = "df2-google-week-all-day-host";
      day.insertBefore(allDayHost, body);
    }
    return [{ date: key, timedHost, allDayHost }];
  });
}

function ensureControlHost(container: HTMLElement, id: string) {
  let host = container.querySelector<HTMLElement>(`:scope > [data-google-calendar-control="${id}"]`);
  if (!host) {
    host = document.createElement("span");
    host.dataset.googleCalendarControl = id;
    host.className = "df2-google-calendar-control-host";
    container.appendChild(host);
  }
  return { id, host };
}

function collectControlTargets() {
  const targets: ControlTarget[] = [];
  const month = document.querySelector<HTMLElement>(".df2-month-calendar-controls");
  if (month) targets.push(ensureControlHost(month, "month"));
  const week = document.querySelector<HTMLElement>(".df2-week-controls");
  if (week) targets.push(ensureControlHost(week, "week"));
  return targets;
}

function sameTargets<T extends { date: string }>(left: T[], right: T[], keys: Array<keyof T>) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.date === right[index]?.date && keys.every((key) => item[key] === right[index]?.[key]));
}

function sameControlTargets(left: ControlTarget[], right: ControlTarget[]) {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id && item.host === right[index]?.host);
}

function visibleRange(monthTargets: MonthTarget[], weekTargets: WeekTarget[]) {
  const dates = [...monthTargets.map((target) => target.date), ...weekTargets.map((target) => target.date)].sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

export function GoogleCalendarController() {
  const [token, setToken] = useState<StoredToken | null>(() => typeof window === "undefined" ? null : readStoredToken());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [monthTargets, setMonthTargets] = useState<MonthTarget[]>([]);
  const [weekTargets, setWeekTargets] = useState<WeekTarget[]>([]);
  const [controlTargets, setControlTargets] = useState<ControlTarget[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const fetchedRangeRef = useRef("");

  useEffect(() => {
    let queued = false;
    const sync = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const months = collectMonthTargets();
        const weeks = collectWeekTargets();
        const controls = collectControlTargets();
        setMonthTargets((current) => sameTargets(current, months, ["host"]) ? current : months);
        setWeekTargets((current) => sameTargets(current, weeks, ["timedHost", "allDayHost"]) ? current : weeks);
        setControlTargets((current) => sameControlTargets(current, controls) ? current : controls);
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.querySelectorAll<HTMLElement>("[data-google-calendar-host], [data-google-week-timed-host], [data-google-week-all-day-host], [data-google-calendar-control]").forEach((host) => host.remove());
    };
  }, []);

  const range = useMemo(() => visibleRange(monthTargets, weekTargets), [monthTargets, weekTargets]);

  useEffect(() => {
    if (!token || !range) return;
    if (token.expiresAt <= Date.now() + 30_000) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken(null);
      setEvents([]);
      setError("Připojení ke Google Kalendáři vypršelo. Připoj ho znovu.");
      return;
    }
    const rangeKey = `${token.accessToken.slice(-10)}:${range.start}:${range.end}`;
    if (fetchedRangeRef.current === rangeKey) return;
    fetchedRangeRef.current = rangeKey;
    let cancelled = false;
    fetchGoogleEvents(token.accessToken, range.start, range.end)
      .then((nextEvents) => {
        if (cancelled) return;
        setEvents(nextEvents);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof Error && cause.message === "GOOGLE_AUTH_EXPIRED") {
          window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
          setEvents([]);
          setError("Google připojení vypršelo. Připoj kalendář znovu.");
          return;
        }
        setError(cause instanceof Error ? cause.message : "Google Kalendář se nepodařilo načíst.");
      });
    return () => { cancelled = true; };
  }, [token, range]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => {
      const current = map.get(event.date) ?? [];
      current.push(event);
      map.set(event.date, current);
    });
    return map;
  }, [events]);

  const connect = async () => {
    const clientId = googleClientId();
    if (!clientId) {
      setError("Google Calendar není ještě nakonfigurovaný — chybí NEXT_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      await loadGoogleIdentity();
      const oauth = window.google?.accounts?.oauth2;
      if (!oauth) throw new Error("Google přihlášení není dostupné.");
      const client = oauth.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: (response) => {
          setConnecting(false);
          if (response.error || !response.access_token) {
            setError(response.error_description || response.error || "Google připojení bylo zrušeno.");
            return;
          }
          const stored = storeToken(response);
          fetchedRangeRef.current = "";
          setToken(stored);
        },
      });
      client.requestAccessToken({ prompt: "consent" });
    } catch (cause) {
      setConnecting(false);
      setError(cause instanceof Error ? cause.message : "Google připojení se nepodařilo spustit.");
    }
  };

  const disconnect = () => {
    const accessToken = token?.accessToken;
    const finish = () => {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      fetchedRangeRef.current = "";
      setToken(null);
      setEvents([]);
      setError("");
    };
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(accessToken, finish);
    } else {
      finish();
    }
  };

  const controls = controlTargets.map(({ id, host }) => createPortal(
    <div className="df2-google-calendar-control" data-google-connected={token ? "true" : "false"}>
      <button type="button" onClick={token ? disconnect : connect} disabled={connecting} title={token ? "Odpojit Google Kalendář" : "Připojit Google Kalendář"}>
        <span className="df2-google-calendar-mark" aria-hidden="true">G</span>
        {connecting ? "Připojuji…" : token ? "Google připojen" : "Google Kalendář"}
      </button>
      {error && <span className="df2-google-calendar-error" role="status">{error}</span>}
    </div>,
    host,
    id,
  ));

  const monthPortals = monthTargets.map(({ date, host }) => {
    const dayEvents = eventsByDate.get(date) ?? [];
    return createPortal(
      <>{dayEvents.map((event) => (
        <a
          key={event.id}
          className="df2-google-calendar-month-event"
          data-google-event-id={event.id}
          href={event.htmlLink || undefined}
          target={event.htmlLink ? "_blank" : undefined}
          rel={event.htmlLink ? "noreferrer" : undefined}
          title={`${event.title} — ${event.timeLabel}`}
        >
          <strong>{event.title}</strong>
          <small>{event.timeLabel}</small>
        </a>
      ))}</>,
      host,
      date,
    );
  });

  const weekPortals = weekTargets.flatMap(({ date, timedHost, allDayHost }) => {
    const dayEvents = eventsByDate.get(date) ?? [];
    const allDay = dayEvents.filter((event) => event.allDay);
    const timed = dayEvents.filter((event) => !event.allDay && event.startMinute !== null && event.endMinute !== null);
    return [
      createPortal(
        <>{allDay.map((event) => (
          <a key={event.id} className="df2-google-week-all-day-event" href={event.htmlLink || undefined} target={event.htmlLink ? "_blank" : undefined} rel={event.htmlLink ? "noreferrer" : undefined} title={event.title}>
            <span aria-hidden="true">G</span><strong>{event.title}</strong>
          </a>
        ))}</>,
        allDayHost,
        `${date}-all-day`,
      ),
      createPortal(
        <>{timed.map((event) => {
          const start = Math.max(DAY_START, event.startMinute ?? DAY_START);
          const end = Math.min(DAY_END, event.endMinute ?? start + 60);
          if (end <= DAY_START || start >= DAY_END || end <= start) return null;
          return (
            <a
              key={event.id}
              className="df2-google-week-event"
              data-google-event-id={event.id}
              href={event.htmlLink || undefined}
              target={event.htmlLink ? "_blank" : undefined}
              rel={event.htmlLink ? "noreferrer" : undefined}
              style={{ top: `${(start - DAY_START) * MINUTE_HEIGHT}px`, height: `${Math.max(20, (end - start) * MINUTE_HEIGHT)}px` }}
              title={`${event.title} — ${event.timeLabel}`}
            >
              <span>{event.timeLabel}</span>
              <strong>{event.title}</strong>
            </a>
          );
        })}</>,
        timedHost,
        `${date}-timed`,
      ),
    ];
  });

  return <>{controls}{monthPortals}{weekPortals}</>;
}
