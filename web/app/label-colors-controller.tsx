"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TaskLike = {
  title?: string;
  start?: string;
  category?: string;
};

type StoredState = {
  plans?: Record<string, TaskLike[]>;
  backlog?: TaskLike[];
  routines?: TaskLike[];
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const COLORS_STORAGE_KEY = "dayframe-label-colors-v1";
const DEFAULT_COLOR = "#c85b32";
const DEFAULT_CATEGORIES = [
  "Studium",
  "Finance",
  "Matika",
  "Angličtina",
  "VŠE AJ",
  "Ekonomie",
  "Opakování",
  "Plánování",
  "Rutina",
  "Osobní",
  "Flex blok",
];

function normalizeHex(value: string) {
  const next = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(next) ? next : DEFAULT_COLOR;
}

function readColors(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLORS_STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([category, color]) => [category, normalizeHex(color)]),
    );
  } catch {
    return {};
  }
}

function readDayframeState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function collectCategories(state: StoredState) {
  const categories = new Set(DEFAULT_CATEGORIES);
  const add = (items: TaskLike[] | undefined) => {
    for (const item of items ?? []) {
      const category = item.category?.trim();
      if (category) categories.add(category);
    }
  };
  for (const items of Object.values(state.plans ?? {})) add(items);
  add(state.backlog);
  add(state.routines);
  return [...categories].sort((a, b) => a.localeCompare(b, "cs"));
}

function buildCategoryIndex(state: StoredState) {
  const exact = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const add = (items: TaskLike[] | undefined) => {
    for (const item of items ?? []) {
      const title = item.title?.trim();
      const category = item.category?.trim();
      if (!title || !category) continue;
      exact.set(`${title}@@${item.start ?? ""}`, category);
      if (!byTitle.has(title)) byTitle.set(title, category);
    }
  };
  for (const items of Object.values(state.plans ?? {})) add(items);
  add(state.backlog);
  add(state.routines);
  return { exact, byTitle };
}

function colorFor(category: string, colors: Record<string, string>) {
  return normalizeHex(colors[category] ?? DEFAULT_COLOR);
}

function rgba(hex: string, alpha: number) {
  const normalized = normalizeHex(hex).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyWeekColors(index: ReturnType<typeof buildCategoryIndex>, colors: Record<string, string>) {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".df2-week-task");
  for (const button of buttons) {
    const title = button.querySelector("strong")?.textContent?.trim() ?? "";
    const timeText = button.querySelector("span")?.textContent?.trim() ?? "";
    const start = timeText.split("–")[0]?.trim() ?? "";
    const category = index.exact.get(`${title}@@${start}`) ?? index.byTitle.get(title);
    if (!category) {
      delete button.dataset.labelCategory;
      button.style.removeProperty("--df2-label-color");
      button.style.removeProperty("--df2-label-tint");
      continue;
    }
    const color = colorFor(category, colors);
    button.dataset.labelCategory = category;
    button.style.setProperty("--df2-label-color", color);
    button.style.setProperty("--df2-label-tint", rgba(color, 0.09));
  }
}

function syncSettingsHost() {
  const settingsView = [...document.querySelectorAll<HTMLElement>(".df2-simple-view")]
    .find((view) => view.querySelector(".df2-page-head h1")?.textContent?.trim() === "Nastavení");
  if (!settingsView) return null;
  let host = settingsView.querySelector<HTMLElement>("[data-label-colors-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.labelColorsHost = "true";
    host.className = "df2-label-colors-host";
    const routines = settingsView.querySelector(".df2-routines");
    settingsView.insertBefore(host, routines ?? null);
  }
  return host;
}

function syncModalHost() {
  const categorySelect = document.querySelector('.df2-modal select[name="category"]') as HTMLSelectElement | null;
  if (!categorySelect) return { host: null as HTMLElement | null, category: "" };
  const label = categorySelect.closest("label");
  if (!label) return { host: null as HTMLElement | null, category: "" };
  let host = label.querySelector<HTMLElement>("[data-label-color-modal-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.labelColorModalHost = "true";
    host.className = "df2-modal-label-color-host";
    label.appendChild(host);
  }
  return { host, category: categorySelect.value.trim() };
}

export function LabelColorsController() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null);
  const [modalCategory, setModalCategory] = useState("");
  const colorsRef = useRef<Record<string, string>>({});
  const indexRef = useRef(buildCategoryIndex({}));
  const rawStateRef = useRef("");

  useEffect(() => {
    const initial = readColors();
    colorsRef.current = initial;
    setColors(initial);

    const sync = () => {
      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current) {
        rawStateRef.current = rawState;
        const state = readDayframeState();
        indexRef.current = buildCategoryIndex(state);
        setCategories(collectCategories(state));
      }
      const nextHost = syncSettingsHost();
      setHost((current) => current === nextHost ? current : nextHost);
      const modal = syncModalHost();
      setModalHost((current) => current === modal.host ? current : modal.host);
      setModalCategory((current) => current === modal.category ? current : modal.category);
      applyWeekColors(indexRef.current, colorsRef.current);
    };

    const onChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.name === "category" && target.closest(".df2-modal")) {
        setModalCategory(target.value.trim());
      }
    };

    sync();
    document.addEventListener("change", onChange);
    const timer = window.setInterval(sync, 350);
    return () => {
      document.removeEventListener("change", onChange);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    colorsRef.current = colors;
    window.localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(colors));
    applyWeekColors(indexRef.current, colors);
  }, [colors]);

  const rows = useMemo(() => categories.map((category) => ({
    category,
    color: colorFor(category, colors),
    customized: Boolean(colors[category]),
  })), [categories, colors]);

  const modalColor = modalCategory ? colorFor(modalCategory, colors) : DEFAULT_COLOR;
  const modalCustomized = modalCategory ? Boolean(colors[modalCategory]) : false;

  const settingsPortal = host ? createPortal(
    <section className="df2-label-colors" aria-label="Barvy štítků">
      <div className="df2-section-head"><h2>Barvy štítků</h2></div>
      <div className="df2-label-color-list">
        {rows.map(({ category, color, customized }) => (
          <article key={category} data-label-color-row={category}>
            <div className="df2-label-color-name"><i style={{ background: color }} /><strong>{category}</strong></div>
            <label className="df2-label-color-picker">
              <input
                type="color"
                aria-label={`Barva štítku ${category}`}
                value={color}
                onChange={(event) => setColors((current) => ({ ...current, [category]: normalizeHex(event.target.value) }))}
              />
              <code>{color.toUpperCase()}</code>
            </label>
            <button
              type="button"
              disabled={!customized}
              onClick={() => setColors((current) => {
                const next = { ...current };
                delete next[category];
                return next;
              })}
            >Výchozí</button>
          </article>
        ))}
      </div>
    </section>,
    host,
  ) : null;

  const modalPortal = modalHost && modalCategory ? createPortal(
    <div className="df2-modal-label-color">
      <span>Barva štítku</span>
      <i style={{ background: modalColor }} aria-hidden="true" />
      <input
        type="color"
        aria-label={`Barva štítku ${modalCategory} v editoru`}
        value={modalColor}
        onChange={(event) => setColors((current) => ({ ...current, [modalCategory]: normalizeHex(event.target.value) }))}
      />
      <code>{modalColor.toUpperCase()}</code>
      <button
        type="button"
        disabled={!modalCustomized}
        onClick={() => setColors((current) => {
          const next = { ...current };
          delete next[modalCategory];
          return next;
        })}
      >Výchozí</button>
    </div>,
    modalHost,
  ) : null;

  return <>{settingsPortal}{modalPortal}</>;
}
