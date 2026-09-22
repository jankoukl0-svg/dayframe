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

function applyMilestoneColors(state: StoredState, colors: Record<string, string>) {
  const milestones = sortedMilestones(state);
  const rows = [...document.querySelectorAll<HTMLElement>(".df2-milestones article")];
  rows.forEach((row, index) => {
    const milestone = milestones[index];
    if (!milestone) {
      delete row.dataset.milestoneId;
      row.style.removeProperty("--df2-milestone-color");
      row.style.removeProperty("--df2-milestone-tint");
      return;
    }
    const color = colorFor(milestone.id, colors);
    row.dataset.milestoneId = milestone.id;
    row.dataset.milestoneColor = "true";
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

export function MilestoneColorsController() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const colorsRef = useRef<Record<string, string>>({});
  const stateRef = useRef<StoredState>({});
  const rawStateRef = useRef("");
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const initial = readColors();
    colorsRef.current = initial;
    setColors(initial);

    const sync = () => {
      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current) {
        rawStateRef.current = rawState;
        stateRef.current = readState();
      }
      applyMilestoneColors(stateRef.current, colorsRef.current);
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
    applyMilestoneColors(stateRef.current, colors);
  }, [colors]);

  const currentColor = editingId ? colorFor(editingId, colors) : DEFAULT_COLOR;
  const customized = editingId ? Boolean(colors[editingId]) : false;

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

  return modalPortal;
}
