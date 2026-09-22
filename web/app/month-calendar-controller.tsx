"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";

type Milestone = {
  id: string;
  title: string;
  date: string;
  note: string;
};

type StoredState = {
  milestones?: Milestone[];
  [key: string]: unknown;
};

type HiddenFilters = {
  preset: string[];
  custom: boolean;
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const COLORS_STORAGE_KEY = "dayframe-milestone-colors-v1";
const HIDDEN_COLORS_STORAGE_KEY = "dayframe-milestone-hidden-colors-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const DEFAULT_COLOR = "#c85b32";
const PRESET_COLORS = ["#2563eb", "#c85b32", "#dc2626", "#16a34a", "#7c3aed", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#64748b"];
const PRESET_SET = new Set(PRESET_COLORS);

function normalizeHex(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_COLOR;
}

function rgba(hex: string, alpha: number) {
  const value = normalizeHex(hex).slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readState(): StoredState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed as StoredState : {};
  } catch {
    return {};
  }
}

function readColors(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLORS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, color]) => typeof color === "string").map(([id, color]) => [id, normalizeHex(String(color))]));
  } catch {
    return {};
  }
}

function readHiddenFilters(): HiddenFilters {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_COLORS_STORAGE_KEY) || "{}");
    if (Array.isArray(parsed)) {
      return { preset: parsed.filter((item): item is string => typeof item === "string").map(normalizeHex).filter((color) => PRESET_SET.has(color)), custom: false };
    }
    if (!parsed || typeof parsed !== "object") return { preset: [], custom: false };
    const stored = parsed as { preset?: unknown; custom?: unknown };
    return {
      preset: Array.isArray(stored.preset)
        ? stored.preset.filter((item): item is string => typeof item === "string").map(normalizeHex).filter((color) => PRESET_SET.has(color))
        : [],
      custom: stored.custom === true,
    };
  } catch {
    return { preset: [], custom: false };
  }
}

function colorFor(id: string, colors: Record<string, string>) {
  return normalizeHex(colors[id] ?? DEFAULT_COLOR);
}

function isHidden(color: string, hidden: HiddenFilters) {
  const normalized = normalizeHex(color);
  return PRESET_SET.has(normalized) ? hidden.preset.includes(normalized) : hidden.custom;
}

function monthAnchor(reference: Date, offset: number) {
  return new Date(reference.getFullYear(), reference.getMonth() + offset, 1, 12);
}

function monthCells(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function monthLabel(anchor: Date) {
  const label = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(anchor);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function meaningfulNote(note?: string) {
  const value = note?.trim() ?? "";
  return value && value !== "Vlastní termín" ? value : "";
}

function findButton(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(".df2-sidebar nav button")]
    .find((button) => button.querySelector("span")?.textContent?.trim() === label) ?? null;
}

function ensureNavHost() {
  const nav = document.querySelector<HTMLElement>(".df2-sidebar nav");
  if (!nav) return null;
  let host = nav.querySelector<HTMLElement>("[data-month-calendar-nav-host]");
  if (!host) {
    host = document.createElement("span");
    host.dataset.monthCalendarNavHost = "true";
    host.className = "df2-month-calendar-nav-host";
    const weekButton = findButton("Týden");
    if (weekButton?.parentNode) weekButton.parentNode.insertBefore(host, weekButton.nextSibling);
    else nav.appendChild(host);
  }
  return host;
}

function ensureViewHost() {
  const main = document.querySelector<HTMLElement>(".df2-main");
  if (!main) return null;
  let host = main.querySelector<HTMLElement>("[data-month-calendar-view-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.monthCalendarViewHost = "true";
    host.className = "df2-month-calendar-view-host";
    main.appendChild(host);
  }
  return host;
}

function writeMilestones(nextMilestones: Milestone[]) {
  const state = readState();
  const next = { ...state, milestones: [...nextMilestones].sort((a, b) => a.date.localeCompare(b.date)) };
  window.localStorage.setItem(DAYFRAME_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(STATE_SYNC_EVENT));
  return next;
}

export function MonthCalendarController() {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [state, setState] = useState<StoredState>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<HiddenFilters>({ preset: [], custom: false });
  const [navHost, setNavHost] = useState<HTMLElement | null>(null);
  const [viewHost, setViewHost] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const rawStateRef = useRef("");
  const rawColorsRef = useRef("");
  const rawHiddenRef = useRef("");

  const now = new Date();
  const today = dateKey(now);
  const anchor = useMemo(() => monthAnchor(now, monthOffset), [monthOffset, today]);
  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const milestones = state.milestones ?? [];

  useEffect(() => {
    const sync = () => {
      const nextNavHost = ensureNavHost();
      const nextViewHost = ensureViewHost();
      setNavHost((current) => current === nextNavHost ? current : nextNavHost);
      setViewHost((current) => current === nextViewHost ? current : nextViewHost);

      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current) {
        rawStateRef.current = rawState;
        setState(readState());
      }
      const rawColors = window.localStorage.getItem(COLORS_STORAGE_KEY) || "";
      if (rawColors !== rawColorsRef.current) {
        rawColorsRef.current = rawColors;
        setColors(readColors());
      }
      const rawHidden = window.localStorage.getItem(HIDDEN_COLORS_STORAGE_KEY) || "";
      if (rawHidden !== rawHiddenRef.current) {
        rawHiddenRef.current = rawHidden;
        setHidden(readHiddenFilters());
      }
    };

    const closeForNativeNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".df2-sidebar nav button") : null;
      if (!target || target.classList.contains("df2-month-calendar-nav-button")) return;
      setOpen(false);
      setEditing(null);
      setCreatingDate(null);
    };

    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "k") {
        findButton("Dnes")?.click();
        setOpen(true);
      }
      if (event.key === "Escape" && editing) setEditing(null);
    };

    sync();
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    document.addEventListener("click", closeForNativeNavigation, true);
    window.addEventListener("keydown", keyboard);
    const timer = window.setInterval(sync, 300);
    return () => {
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      document.removeEventListener("click", closeForNativeNavigation, true);
      window.removeEventListener("keydown", keyboard);
      window.clearInterval(timer);
    };
  }, [editing]);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".df2-main");
    const nav = document.querySelector<HTMLElement>(".df2-sidebar nav");
    if (open) {
      main?.setAttribute("data-month-calendar-open", "true");
      nav?.classList.add("df2-month-calendar-active");
    } else {
      main?.removeAttribute("data-month-calendar-open");
      nav?.classList.remove("df2-month-calendar-active");
    }
    return () => {
      main?.removeAttribute("data-month-calendar-open");
      nav?.classList.remove("df2-month-calendar-active");
    };
  }, [open, viewHost, navHost]);

  const openCalendar = () => {
    findButton("Dnes")?.click();
    setOpen(true);
    setEditing(null);
    setCreatingDate(null);
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const date = String(form.get("date") || "");
    const note = String(form.get("note") || "").trim();
    if (!title || !date) return;
    const current = readState();
    const nextMilestones = (current.milestones ?? []).map((milestone) => milestone.id === editing.id
      ? { ...milestone, title, date, note: note || "Vlastní termín" }
      : milestone);
    const next = writeMilestones(nextMilestones);
    rawStateRef.current = JSON.stringify(next);
    setState(next);
    setEditing(null);
  };

  const saveNew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!creatingDate) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const date = String(form.get("date") || creatingDate);
    const note = String(form.get("note") || "").trim();
    if (!title || !date) return;
    const current = readState();
    const milestone: Milestone = {
      id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      date,
      note: note || "Vlastní termín",
    };
    const next = writeMilestones([...(current.milestones ?? []), milestone]);
    rawStateRef.current = JSON.stringify(next);
    setState(next);
    setCreatingDate(null);
  };

  const removeMilestone = (id: string) => {
    const current = readState();
    const next = writeMilestones((current.milestones ?? []).filter((milestone) => milestone.id !== id));
    rawStateRef.current = JSON.stringify(next);
    setState(next);
    setEditing(null);
  };

  const navPortal = navHost ? createPortal(
    <button className={`df2-month-calendar-nav-button ${open ? "active" : ""}`} onClick={openCalendar}>
      <span>Kalendář</span><kbd>K</kbd>
    </button>,
    navHost,
  ) : null;

  const calendarPortal = viewHost && open ? createPortal(
    <>
      <section className="df2-month-calendar" aria-label="Měsíční kalendář milníků">
        <header className="df2-page-head df2-month-calendar-head">
          <div><p>Měsíční přehled milníků</p><h1>Kalendář</h1></div>
          <div className="df2-month-calendar-controls">
            <button type="button" aria-label="Předchozí měsíc" onClick={() => setMonthOffset((value) => value - 1)}>←</button>
            <button type="button" onClick={() => setMonthOffset(0)}>Tento měsíc</button>
            <button type="button" aria-label="Další měsíc" onClick={() => setMonthOffset((value) => value + 1)}>→</button>
          </div>
        </header>
        <div className="df2-month-calendar-title">{monthLabel(anchor)}</div>
        <div className="df2-month-scroll">
          <div className="df2-month-grid">
            {(["Po", "Út", "St", "Čt", "Pá", "So", "Ne"] as const).map((weekday) => <div key={weekday} className="df2-month-weekday">{weekday}</div>)}
            {cells.map((day) => {
              const key = dateKey(day);
              const isCurrentMonth = day.getMonth() === anchor.getMonth() && day.getFullYear() === anchor.getFullYear();
              const dayMilestones = milestones
                .filter((milestone) => milestone.date === key)
                .filter((milestone) => !isHidden(colorFor(milestone.id, colors), hidden));
              return (
                <article key={key} className={`df2-month-day ${isCurrentMonth ? "" : "outside"} ${key === today ? "today" : ""}`} data-date={key}>
                  <header>
                    <span>{day.getDate()}</span>
                    <button type="button" aria-label={`Přidat milník ${key}`} onClick={() => setCreatingDate(key)}>+</button>
                  </header>
                  <div className="df2-month-events">
                    {dayMilestones.map((milestone) => {
                      const color = colorFor(milestone.id, colors);
                      const note = meaningfulNote(milestone.note);
                      const style = {
                        borderLeftColor: color,
                        background: rgba(color, 0.085),
                        "--df2-month-dot": color,
                      } as CSSProperties;
                      return (
                        <button
                          type="button"
                          key={milestone.id}
                          className="df2-month-milestone"
                          data-milestone-id={milestone.id}
                          style={style}
                          onClick={() => setEditing(milestone)}
                          title={note ? `${milestone.title} — ${note}` : milestone.title}
                        >
                          <strong>{milestone.title}</strong>
                          {note && <small>{note}</small>}
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <form className="df2-modal df2-month-milestone-modal" onSubmit={saveEdit}>
            <header><div><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
            <label>Název<input name="title" autoFocus defaultValue={editing.title} /></label>
            <label>Datum<input name="date" type="date" defaultValue={editing.date} /></label>
            <label>Popisek<textarea name="note" rows={4} defaultValue={meaningfulNote(editing.note)} placeholder="Co se v ten den děje…" /></label>
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="button" className="danger" onClick={() => removeMilestone(editing.id)}>Smazat milník</button></div>
          </form>
        </div>
      )}

      {creatingDate && !editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatingDate(null); }}>
          <form className="df2-modal df2-month-milestone-modal" onSubmit={saveNew}>
            <header><div><h2>Nový milník</h2></div><button type="button" onClick={() => setCreatingDate(null)}>×</button></header>
            <label>Název<input name="title" autoFocus placeholder="Např. SCIO test" /></label>
            <label>Datum<input name="date" type="date" defaultValue={creatingDate} /></label>
            <label>Popisek<textarea name="note" rows={4} placeholder="Co se v ten den děje…" /></label>
            <div className="df2-modal-actions"><button className="df2-primary">Přidat milník</button></div>
          </form>
        </div>
      )}
    </>,
    viewHost,
  ) : null;

  return <>{navPortal}{calendarPortal}</>;
}
