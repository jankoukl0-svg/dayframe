"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MilestoneLike = {
  id: string;
  title: string;
  date: string;
};

type StoredState = {
  milestones?: MilestoneLike[];
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const COLORS_STORAGE_KEY = "dayframe-milestone-colors-v1";
const HIDDEN_COLORS_STORAGE_KEY = "dayframe-milestone-hidden-colors-v1";
const DEFAULT_COLOR = "#c85b32";

function normalizeHex(value: string) {
  const next = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(next) ? next : DEFAULT_COLOR;
}

function rgba(hex: string, alpha: number) {
  const normalized = normalizeHex(hex).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function readColors(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLORS_STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([id, color]) => [id, normalizeHex(color)]),
    );
  } catch {
    return {};
  }
}

function readHiddenColors() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HIDDEN_COLORS_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((value): value is string => typeof value === "string").map(normalizeHex))];
  } catch {
    return [];
  }
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function sortedMilestones(state: StoredState) {
  return [...(state.milestones ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

function colorFor(id: string, colors: Record<string, string>) {
  return normalizeHex(colors[id] ?? DEFAULT_COLOR);
}

function colorName(hex: string) {
  const value = normalizeHex(hex).slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;

  if (max < 0.2) return "černé";
  if (saturation < 0.12) return max > 0.85 ? "světlé" : "šedé";

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;

  if (hue < 15 || hue >= 345) return "červené";
  if (hue < 45) return "oranžové";
  if (hue < 70) return "žluté";
  if (hue < 165) return "zelené";
  if (hue < 195) return "tyrkysové";
  if (hue < 255) return "modré";
  if (hue < 315) return "fialové";
  return "růžové";
}

function milestoneColors(state: StoredState, colors: Record<string, string>) {
  return [...new Set(sortedMilestones(state).map((milestone) => colorFor(milestone.id, colors)))];
}

function applyMilestoneColors(state: StoredState, colors: Record<string, string>, hiddenColors: Set<string>) {
  const milestones = sortedMilestones(state);
  const rows = [...document.querySelectorAll<HTMLElement>(".df2-milestones article")];
  rows.forEach((row, index) => {
    const milestone = milestones[index];
    if (!milestone) {
      delete row.dataset.milestoneId;
      delete row.dataset.milestoneHidden;
      row.hidden = false;
      row.style.removeProperty("--df2-milestone-color");
      row.style.removeProperty("--df2-milestone-tint");
      return;
    }
    const color = colorFor(milestone.id, colors);
    const hidden = hiddenColors.has(color);
    row.dataset.milestoneId = milestone.id;
    row.dataset.milestoneColor = "true";
    row.dataset.milestoneHidden = hidden ? "true" : "false";
    row.hidden = hidden;
    row.style.setProperty("--df2-milestone-color", color);
    row.style.setProperty("--df2-milestone-tint", rgba(color, 0.08));
  });
}

function findEditingMilestone(state: StoredState, preferredId: string | null) {
  const milestones = state.milestones ?? [];
  if (preferredId) {
    const preferred = milestones.find((milestone) => milestone.id === preferredId);
    if (preferred) return preferred;
  }
  const modal = [...document.querySelectorAll<HTMLElement>(".df2-modal")]
    .find((item) => item.querySelector("h2")?.textContent?.trim() === "Upravit milník");
  if (!modal) return null;
  const title = (modal.querySelector('input[name="title"]') as HTMLInputElement | null)?.value.trim() ?? "";
  const date = (modal.querySelector('input[name="date"]') as HTMLInputElement | null)?.value ?? "";
  return milestones.find((milestone) => milestone.title === title && milestone.date === date)
    ?? milestones.find((milestone) => milestone.title === title)
    ?? null;
}

function syncModalHost() {
  const modal = [...document.querySelectorAll<HTMLElement>(".df2-modal")]
    .find((item) => item.querySelector("h2")?.textContent?.trim() === "Upravit milník");
  if (!modal) return null;
  let host = modal.querySelector<HTMLElement>("[data-milestone-color-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneColorHost = "true";
    host.className = "df2-milestone-color-host";
    const actions = modal.querySelector(".df2-modal-actions");
    modal.insertBefore(host, actions ?? null);
  }
  return host;
}

function syncFilterHost() {
  const milestonesView = [...document.querySelectorAll<HTMLElement>(".df2-simple-view")]
    .find((view) => view.querySelector(".df2-page-head h1")?.textContent?.trim() === "Milníky");
  if (!milestonesView) return null;
  let host = milestonesView.querySelector<HTMLElement>("[data-milestone-filter-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneFilterHost = "true";
    host.className = "df2-milestone-filter-host";
    const list = milestonesView.querySelector(".df2-milestones");
    milestonesView.insertBefore(host, list ?? null);
  }
  return host;
}

export function MilestoneColorsController() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hiddenColors, setHiddenColors] = useState<string[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null);
  const [filterHost, setFilterHost] = useState<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const colorsRef = useRef<Record<string, string>>({});
  const hiddenColorsRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<StoredState>({});
  const rawStateRef = useRef("");
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const initialColors = readColors();
    const initialHidden = readHiddenColors();
    colorsRef.current = initialColors;
    hiddenColorsRef.current = new Set(initialHidden);
    setColors(initialColors);
    setHiddenColors(initialHidden);

    const sync = () => {
      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current) {
        rawStateRef.current = rawState;
        stateRef.current = readState();
      }
      applyMilestoneColors(stateRef.current, colorsRef.current, hiddenColorsRef.current);
      const nextColors = milestoneColors(stateRef.current, colorsRef.current);
      setAvailableColors((current) => current.join("|") === nextColors.join("|") ? current : nextColors);

      const nextFilterHost = syncFilterHost();
      setFilterHost((current) => current === nextFilterHost ? current : nextFilterHost);

      const host = syncModalHost();
      setModalHost((current) => current === host ? current : host);
      if (host) {
        const milestone = findEditingMilestone(stateRef.current, editingIdRef.current);
        const nextId = milestone?.id ?? null;
        editingIdRef.current = nextId;
        setEditingId((current) => current === nextId ? current : nextId);
      }
    };

    const rememberMilestone = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>(".df2-milestones article[data-milestone-id]") : null;
      if (!element?.dataset.milestoneId) return;
      editingIdRef.current = element.dataset.milestoneId;
      setEditingId(element.dataset.milestoneId);
    };

    const onClick = (event: MouseEvent) => rememberMilestone(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") rememberMilestone(event.target);
    };

    sync();
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    const timer = window.setInterval(sync, 250);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    colorsRef.current = colors;
    window.localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(colors));
    applyMilestoneColors(stateRef.current, colors, hiddenColorsRef.current);
    const nextColors = milestoneColors(stateRef.current, colors);
    setAvailableColors((current) => current.join("|") === nextColors.join("|") ? current : nextColors);
  }, [colors]);

  useEffect(() => {
    hiddenColorsRef.current = new Set(hiddenColors);
    window.localStorage.setItem(HIDDEN_COLORS_STORAGE_KEY, JSON.stringify(hiddenColors));
    applyMilestoneColors(stateRef.current, colorsRef.current, hiddenColorsRef.current);
  }, [hiddenColors]);

  const currentColor = editingId ? colorFor(editingId, colors) : DEFAULT_COLOR;
  const customized = editingId ? Boolean(colors[editingId]) : false;

  const filterPortal = filterHost && availableColors.length > 0 ? createPortal(
    <section className="df2-milestone-filters" aria-label="Skrýt milníky podle barvy">
      <span>Filtr</span>
      <div>
        {availableColors.map((color) => {
          const hidden = hiddenColors.includes(color);
          const name = colorName(color);
          return (
            <button
              key={color}
              type="button"
              className={hidden ? "is-hidden" : ""}
              aria-pressed={hidden}
              aria-label={`${hidden ? "Zobrazit" : "Skrýt"} ${name} milníky`}
              onClick={() => setHiddenColors((current) => current.includes(color)
                ? current.filter((item) => item !== color)
                : [...current, color])}
            >
              <i style={{ background: color }} aria-hidden="true" />
              {hidden ? `Zobrazit ${name}` : `Skrýt ${name}`}
            </button>
          );
        })}
        {hiddenColors.some((color) => availableColors.includes(color)) && (
          <button type="button" className="show-all" onClick={() => setHiddenColors([])}>Zobrazit vše</button>
        )}
      </div>
    </section>,
    filterHost,
  ) : null;

  const modalPortal = modalHost && editingId ? createPortal(
    <div className="df2-milestone-color-editor">
      <span>Barva milníku</span>
      <div className="df2-milestone-color-control">
        <i style={{ background: currentColor }} aria-hidden="true" />
        <input
          type="color"
          aria-label="Barva milníku"
          value={currentColor}
          onChange={(event) => setColors((current) => ({ ...current, [editingId]: normalizeHex(event.target.value) }))}
        />
        <code>{currentColor.toUpperCase()}</code>
        <button
          type="button"
          disabled={!customized}
          onClick={() => setColors((current) => {
            const next = { ...current };
            delete next[editingId];
            return next;
          })}
        >Výchozí</button>
      </div>
    </div>,
    modalHost,
  ) : null;

  return <>{filterPortal}{modalPortal}</>;
}
