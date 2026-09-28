"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { timeToMinutes, type CalendarTask, type DayframeState } from "@/lib/dayframe-calendar";

const STATE_KEY = "dayframe-v1";
const SETTINGS_KEY = "dayframe-notification-settings-v1";
const FIRED_KEY = "dayframe-notification-fired-v1";
const SYNC_EVENT = "dayframe-state-sync";
const CHECK_INTERVAL_MS = 15_000;
const FIRED_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

type NotificationSettings = {
  enabled: boolean;
  leadMinutes: 5 | 10;
};

type PermissionState = NotificationPermission | "unsupported";

type FiredMap = Record<string, number>;

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  leadMinutes: 10,
};

function readSettings(): NotificationSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null") as Partial<NotificationSettings> | null;
    return {
      enabled: stored?.enabled === true,
      leadMinutes: stored?.leadMinutes === 5 ? 5 : 10,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: NotificationSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function readState(): DayframeState | null {
  try {
    return JSON.parse(window.localStorage.getItem(STATE_KEY) || "null") as DayframeState | null;
  } catch {
    return null;
  }
}

function readFired(now: number): FiredMap {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FIRED_KEY) || "{}") as FiredMap;
    return Object.fromEntries(Object.entries(stored).filter(([, timestamp]) => now - timestamp < FIRED_RETENTION_MS));
  } catch {
    return {};
  }
}

function writeFired(fired: FiredMap) {
  window.localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
}

function scheduledDate(dateKey: string, time: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const planningMinutes = timeToMinutes(time);
  if (![year, month, day, planningMinutes].every(Number.isFinite)) return null;
  const result = new Date(year, month - 1, day, 0, 0, 0, 0);
  result.setMinutes(planningMinutes);
  return result;
}

function notificationKey(task: CalendarTask, kind: "lead" | "start" | "overrun", leadMinutes: number) {
  return `${task.id}:${task.date}:${task.start ?? ""}:${task.end ?? ""}:${kind}:${leadMinutes}`;
}

function showNotification(title: string, body: string, tag: string) {
  const notification = new Notification(title, { body, tag });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function sendDueNotifications(settings: NotificationSettings) {
  if (!settings.enabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const state = readState();
  if (!state?.plans) return;

  const now = Date.now();
  const fired = readFired(now);
  let changed = false;

  const fireOnce = (task: CalendarTask, kind: "lead" | "start" | "overrun", title: string, body: string) => {
    const key = notificationKey(task, kind, settings.leadMinutes);
    if (fired[key]) return;
    showNotification(title, body, key);
    fired[key] = now;
    changed = true;
  };

  Object.values(state.plans).flat().forEach((task) => {
    if (task.completed || !task.start || !task.end) return;
    const start = scheduledDate(task.date, task.start)?.getTime();
    const end = scheduledDate(task.date, task.end)?.getTime();
    if (!start || !end) return;

    const leadAt = start - settings.leadMinutes * 60_000;
    if (now >= leadAt && now < start && now - leadAt <= 5 * 60_000) {
      const remaining = Math.max(1, Math.ceil((start - now) / 60_000));
      fireOnce(task, "lead", `${task.title} za ${remaining} min`, `${task.start} · ${task.category}`);
    }

    if (now >= start && now - start <= 5 * 60_000) {
      fireOnce(task, "start", `Začíná: ${task.title}`, `${task.start}–${task.end} · ${task.category}`);
    }

    if (now >= end && now - end <= 15 * 60_000) {
      fireOnce(task, "overrun", `Blok skončil: ${task.title}`, `Pokud ještě pokračuješ, uprav plán nebo označ úkol jako hotový.`);
    }
  });

  if (changed) writeFired(fired);
}

export function NotificationController() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSettings(readSettings());
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    const syncHost = () => {
      const card = document.querySelector(".df2-settings-card");
      if (!(card instanceof HTMLElement)) {
        setHost(null);
        return;
      }
      let nextHost = card.querySelector("[data-notification-settings-host]") as HTMLElement | null;
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.notificationSettingsHost = "true";
        nextHost.className = "df2-notification-settings-host";
        card.appendChild(nextHost);
      }
      setHost((current) => current === nextHost ? current : nextHost);
    };

    syncHost();
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!settings.enabled) return;
    const run = () => sendDueNotifications(settings);
    run();
    const timer = window.setInterval(run, CHECK_INTERVAL_MS);
    const onSync = () => run();
    const onVisibility = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener("storage", onSync);
    window.addEventListener(SYNC_EVENT, onSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onSync);
      window.removeEventListener(SYNC_EVENT, onSync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [settings]);

  async function toggleNotifications() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }

    if (settings.enabled) {
      const next = { ...settings, enabled: false };
      setSettings(next);
      writeSettings(next);
      return;
    }

    const result = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return;
    const next = { ...settings, enabled: true };
    setSettings(next);
    writeSettings(next);
    sendDueNotifications(next);
  }

  function changeLeadMinutes(value: string) {
    const next = { ...settings, leadMinutes: value === "5" ? 5 as const : 10 as const };
    setSettings(next);
    writeSettings(next);
  }

  if (!host) return null;

  const permissionLabel = permission === "denied"
    ? "Přístup je v prohlížeči zablokovaný"
    : permission === "unsupported"
      ? "Tento prohlížeč notifikace nepodporuje"
      : settings.enabled
        ? `${settings.leadMinutes} min před · začátek · konec bloku`
        : "Upozornění před začátkem, při startu a po konci bloku";

  return createPortal(
    <>
      <div>
        <strong>Notifikace bloků</strong>
        <span>{permissionLabel}</span>
      </div>
      <div className="df2-notification-settings-actions">
        <label>
          <span>Předstihem</span>
          <select aria-label="Předstih notifikace" value={settings.leadMinutes} onChange={(event) => changeLeadMinutes(event.target.value)} disabled={!settings.enabled}>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
          </select>
        </label>
        <button type="button" onClick={toggleNotifications} disabled={permission === "unsupported" || permission === "denied"}>
          {settings.enabled ? "Vypnout" : "Povolit"}
        </button>
      </div>
    </>,
    host,
  );
}
