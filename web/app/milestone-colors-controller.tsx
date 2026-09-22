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

type HiddenFilters = {
  preset: string[];
  custom: boolean;
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const COLORS_STORAGE_KEY = "dayframe-milestone-colors-v1";
const HIDDEN_COLORS_STORAGE_KEY = "dayframe-milestone-hidden-colors-v1";
const DEFAULT_COLOR = "#c85b32";

const PRESET_COLORS = [
  { color: "#2563eb", name: "modré" },
  { color: "#c85b32", name: "oranžové" },
  { color: "#dc2626", name: "červené" },
  { color: "#16a34a", name: "zelené" },
  { color: "#7c3aed", name: "fialové" },
  { color: "#0891b2", name: "tyrkysové" },
  { color: "#ca8a04", name: "žluté" },
  { color: "#db2777", name: "růžové" },
  { color: "#4f46e5", name: "indigové" },
  { color: "#64748b", name: "šedé" },
] as const;

const PRESET_SET = new Set(PRESET_COLORS.map((item) => item.color));

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

function readHiddenFilters(): HiddenFilters {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HIDDEN_COLORS_STORAGE_KEY) || "{}");
    if (Array.isArray(raw)) {
      return {
        preset: [...new Set(raw.filter((value): value is string => typeof value === "string")
          .map(normalizeHex)
          .filter((color) => PRESET_SET.has(color as (typeof PRESET_COLORS)[number]["color"])))],
        custom: false,
      };
    }
    if (!raw || typeof raw !== "object") return { preset: [], custom: false };
    const preset = Array.isArray(raw.preset)
      ? [...new Set(raw.preset.filter((value: unknown): value is string => typeof value === "string")
        .map(normalizeHex)
        .filter((color: string) => PRESET_SET.has(color as (typeof PRESET_COLORS)[number]["color"]))) ]
      : [];
    return { preset, custom: raw.custom === true };
  } catch {
    return { preset: [], custom: false };
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

function isPresetColor(color: string) {
  return PRESET_SET.has(normalizeHex(color) as (typeof PRESET_COLORS)[number]["color"]);
}

function hasCustomMilestones(state: StoredState, colors: Record<string, string>) {
  return sortedMilestones(state).some((milestone) => !isPresetColor(colorFor(milestone.id, colors)));
}

function applyMilestoneColors(state: StoredState, colors: Record<string, string>, hidden: HiddenFilters) {
  const milestones = sortedMilestones(state);
  const hiddenPreset = new Set(hidden.preset);
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
    const preset = isPresetColor(color);
    const isHidden = preset ? hiddenPreset.has(color) : hidden.custom;
    row.dataset.milestoneId = milestone.id;
    row.dataset.milestoneColor = "true";
    row.dataset.milestoneColorType = preset ? "preset" : "custom";
    row.dataset.milestoneHidden = isHidden ? "true" : "false";
    row.hidden = isHidden;
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
  const [hiddenFilters, setHiddenFilters] = useState<HiddenFilters>({ preset: [], custom: false });
  const [customInUse, setCustomInUse] = useState(false);
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null);
  const [filterHost, setFilterHost] = useState<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const colorsRef = useRef<Record<string, string>>({});
  const hiddenRef = useRef<HiddenFilters>({ preset: [], custom: false });
  const stateRef = useRef<StoredState>({});
  const rawStateRef = useRef("");
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const initialColors = readColors();
    const initialHidden = readHiddenFilters();
    colorsRef.current = initialColors;
    hiddenRef.current = initialHidden;
    setColors(initialColors);
    setHiddenFilters(initialHidden);

    const sync = () => {
      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current) {
        rawStateRef.current = rawState;
        stateRef.current = readState();
      }
      applyMilestoneColors(stateRef.current, colorsRef.current, hiddenRef.current);
      const nextCustomInUse = hasCustomMilestones(stateRef.current, colorsRef.current);
      setCustomInUse((current) => current === nextCustomInUse ? current : nextCustomInUse);

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
    applyMilestoneColors(stateRef.current, colors, hiddenRef.current);
    setCustomInUse(hasCustomMilestones(stateRef.current, colors));
  }, [colors]);

  useEffect(() => {
    hiddenRef.current = hiddenFilters;
    window.localStorage.setItem(HIDDEN_COLORS_STORAGE_KEY, JSON.stringify(hiddenFilters));
    applyMilestoneColors(stateRef.current, colorsRef.current, hiddenFilters);
  }, [hiddenFilters]);

  const currentColor = editingId ? colorFor(editingId, colors) : DEFAULT_COLOR;
  const customized = editingId ? Boolean(colors[editingId]) : false;
  const anyHidden = hiddenFilters.preset.length > 0 || hiddenFilters.custom;

  const filterPortal = filterHost ? createPortal(
    <section className="df2-milestone-filters" aria-label="Skrýt milníky podle barvy">
      <span>Filtr</span>
      <div className="df2-milestone-preset-filters" aria-label="Přednastavené barvy">
        {PRESET_COLORS.map(({ color, name }) => {
          const hidden = hiddenFilters.preset.includes(color);
          return (
            <button
              key={color}
              type="button"
              className={hidden ? "is-hidden" : ""}
              aria-pressed={hidden}
              aria-label={`${hidden ? "Zobrazit" : "Skrýt"} ${name} milníky`}
              title={`${hidden ? "Zobrazit" : "Skrýt"} ${name}`}
              onClick={() => setHiddenFilters((current) => ({
                ...current,
                preset: current.preset.includes(color)
                  ? current.preset.filter((item) => item !== color)
                  : [...current.preset, color],
              }))}
            >
              <i style={{ background: color }} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="df2-milestone-custom-filter">
        <button
          type="button"
          className={hiddenFilters.custom ? "is-hidden" : ""}
          aria-pressed={hiddenFilters.custom}
          disabled={!customInUse}
          onClick={() => setHiddenFilters((current) => ({ ...current, custom: !current.custom }))}
        >
          <i className="custom-swatch" aria-hidden="true" />
          {hiddenFilters.custom ? "Zobrazit custom" : "Skrýt custom"}
        </button>
      </div>
      {anyHidden && (
        <button type="button" className="show-all" onClick={() => setHiddenFilters({ preset: [], custom: false })}>Zobrazit vše</button>
      )}
    </section>,
    filterHost,
  ) : null;

  const modalPortal = modalHost && editingId ? createPortal(
    <div className="df2-milestone-color-editor">
      <span>Barva milníku</span>
      <div className="df2-milestone-color-presets" aria-label="Přednastavené barvy milníku">
        {PRESET_COLORS.map(({ color, name }) => (
          <button
            key={color}
            type="button"
            className={currentColor === color ? "active" : ""}
            aria-label={`Nastavit ${name}`}
            title={name}
            onClick={() => setColors((current) => ({ ...current, [editingId]: color }))}
          >
            <i style={{ background: color }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="df2-milestone-color-control">
        <span>Vlastní</span>
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
