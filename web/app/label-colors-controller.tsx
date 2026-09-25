"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TaskLike = {
  title?: string;
  start?: string;
  category?: string;
  [key: string]: unknown;
};

type StoredState = {
  plans?: Record<string, TaskLike[]>;
  backlog?: TaskLike[];
  routines?: TaskLike[];
  [key: string]: unknown;
};

const DAYFRAME_STORAGE_KEY = "dayframe-v1";
const COLORS_STORAGE_KEY = "dayframe-label-colors-v1";
const LABELS_STORAGE_KEY = "dayframe-labels-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const LABELS_SYNC_EVENT = "dayframe-labels-sync";
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

function normalizeLabelName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueLabels(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const label = normalizeLabelName(value);
    const key = label.toLocaleLowerCase("cs-CZ");
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
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

function readStoredLabels(): string[] | null {
  try {
    const raw = window.localStorage.getItem(LABELS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return uniqueLabels(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return null;
  }
}

function readDayframeState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function usedCategories(state: StoredState) {
  const result: string[] = [];
  const add = (items: TaskLike[] | undefined) => {
    for (const item of items ?? []) {
      const category = normalizeLabelName(item.category ?? "");
      if (category) result.push(category);
    }
  };
  for (const items of Object.values(state.plans ?? {})) add(items);
  add(state.backlog);
  add(state.routines);
  return uniqueLabels(result);
}

function collectCategories(state: StoredState, storedLabels: string[] | null) {
  return uniqueLabels([...(storedLabels ?? DEFAULT_CATEGORIES), ...usedCategories(state)]);
}

function categoryUsageCount(state: StoredState, category: string) {
  let count = 0;
  const normalized = category.toLocaleLowerCase("cs-CZ");
  const add = (items: TaskLike[] | undefined) => {
    for (const item of items ?? []) {
      if (normalizeLabelName(item.category ?? "").toLocaleLowerCase("cs-CZ") === normalized) count += 1;
    }
  };
  for (const items of Object.values(state.plans ?? {})) add(items);
  add(state.backlog);
  add(state.routines);
  return count;
}

function rewriteCategory(state: StoredState, from: string, to: string) {
  const fromKey = from.toLocaleLowerCase("cs-CZ");
  const rewriteItems = (items: TaskLike[] | undefined) => items?.map((item) => (
    normalizeLabelName(item.category ?? "").toLocaleLowerCase("cs-CZ") === fromKey
      ? { ...item, category: to }
      : item
  ));
  const plans = state.plans
    ? Object.fromEntries(Object.entries(state.plans).map(([date, items]) => [date, rewriteItems(items) ?? []]))
    : state.plans;
  return {
    ...state,
    plans,
    backlog: rewriteItems(state.backlog),
    routines: rewriteItems(state.routines),
  };
}

function buildCategoryIndex(state: StoredState) {
  const exact = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const add = (items: TaskLike[] | undefined) => {
    for (const item of items ?? []) {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const category = normalizeLabelName(item.category ?? "");
      if (!title || !category) continue;
      exact.set(`${title}@@${typeof item.start === "string" ? item.start : ""}`, category);
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

function syncCategorySelectOptions(labels: string[]) {
  for (const select of document.querySelectorAll<HTMLSelectElement>("select")) {
    const wrapper = select.closest("label");
    const isCategory = select.name === "category" || wrapper?.textContent?.trim().startsWith("Oblast");
    if (!isCategory) continue;

    const current = select.value.trim();
    const options = uniqueLabels([...labels, ...(current ? [current] : [])]);
    const actual = [...select.options].map((option) => option.value);
    if (actual.length === options.length && actual.every((value, index) => value === options[index])) continue;

    const nodes = options.map((label) => {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      return option;
    });
    select.replaceChildren(...nodes);
    if (current && options.includes(current)) select.value = current;
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
  const [state, setState] = useState<StoredState>({});
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null);
  const [modalCategory, setModalCategory] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [managerError, setManagerError] = useState("");
  const colorsRef = useRef<Record<string, string>>({});
  const labelsRef = useRef<string[]>(DEFAULT_CATEGORIES);
  const indexRef = useRef(buildCategoryIndex({}));
  const rawStateRef = useRef("");
  const rawLabelsRef = useRef("");

  function persistLabels(nextLabels: string[]) {
    const normalized = uniqueLabels(nextLabels);
    labelsRef.current = normalized;
    setCategories(normalized);
    const raw = JSON.stringify(normalized);
    rawLabelsRef.current = raw;
    window.localStorage.setItem(LABELS_STORAGE_KEY, raw);
    window.dispatchEvent(new Event(LABELS_SYNC_EVENT));
    syncCategorySelectOptions(normalized);
  }

  function persistState(nextState: StoredState) {
    const raw = JSON.stringify(nextState);
    rawStateRef.current = raw;
    setState(nextState);
    indexRef.current = buildCategoryIndex(nextState);
    window.localStorage.setItem(DAYFRAME_STORAGE_KEY, raw);
    window.dispatchEvent(new Event(STATE_SYNC_EVENT));
  }

  useEffect(() => {
    const initialColors = readColors();
    colorsRef.current = initialColors;
    setColors(initialColors);

    const sync = () => {
      const rawState = window.localStorage.getItem(DAYFRAME_STORAGE_KEY) || "";
      const rawLabels = window.localStorage.getItem(LABELS_STORAGE_KEY) || "";
      if (rawState !== rawStateRef.current || rawLabels !== rawLabelsRef.current) {
        rawStateRef.current = rawState;
        rawLabelsRef.current = rawLabels;
        const nextState = readDayframeState();
        const labels = collectCategories(nextState, readStoredLabels());
        setState(nextState);
        indexRef.current = buildCategoryIndex(nextState);
        labelsRef.current = labels;
        setCategories(labels);
        if (!rawLabels) {
          const serialized = JSON.stringify(labels);
          rawLabelsRef.current = serialized;
          window.localStorage.setItem(LABELS_STORAGE_KEY, serialized);
        }
      }
      const nextHost = syncSettingsHost();
      setHost((current) => current === nextHost ? current : nextHost);
      syncCategorySelectOptions(labelsRef.current);
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
    window.addEventListener(LABELS_SYNC_EVENT, sync);
    const timer = window.setInterval(sync, 350);
    return () => {
      document.removeEventListener("change", onChange);
      window.removeEventListener(LABELS_SYNC_EVENT, sync);
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
    usage: categoryUsageCount(state, category),
  })), [categories, colors, state]);

  const modalColor = modalCategory ? colorFor(modalCategory, colors) : DEFAULT_COLOR;
  const modalCustomized = modalCategory ? Boolean(colors[modalCategory]) : false;

  function startRename(category: string) {
    setManagerError("");
    setEditingLabel(category);
    setEditingName(category);
    setAddingLabel(false);
  }

  function saveRename(event: React.FormEvent, category: string) {
    event.preventDefault();
    const nextName = normalizeLabelName(editingName);
    if (!nextName) {
      setManagerError("Název štítku nesmí být prázdný.");
      return;
    }
    const duplicate = categories.some((label) => label !== category && label.toLocaleLowerCase("cs-CZ") === nextName.toLocaleLowerCase("cs-CZ"));
    if (duplicate) {
      setManagerError("Takový štítek už existuje.");
      return;
    }
    if (nextName === category) {
      setEditingLabel(null);
      return;
    }

    const nextState = rewriteCategory(state, category, nextName);
    const nextLabels = categories.map((label) => label === category ? nextName : label);
    const nextColors = { ...colorsRef.current };
    if (nextColors[category]) {
      nextColors[nextName] = nextColors[category];
      delete nextColors[category];
    }

    persistState(nextState);
    persistLabels(nextLabels);
    colorsRef.current = nextColors;
    setColors(nextColors);
    setEditingLabel(null);
    setManagerError("");
  }

  function addLabel(event: React.FormEvent) {
    event.preventDefault();
    const label = normalizeLabelName(newLabel);
    if (!label) {
      setManagerError("Napiš název nového štítku.");
      return;
    }
    if (categories.some((item) => item.toLocaleLowerCase("cs-CZ") === label.toLocaleLowerCase("cs-CZ"))) {
      setManagerError("Takový štítek už existuje.");
      return;
    }
    persistLabels([...categories, label]);
    setNewLabel("");
    setAddingLabel(false);
    setManagerError("");
  }

  function deleteLabel(category: string, usage: number) {
    if (usage > 0 || categories.length <= 1) return;
    persistLabels(categories.filter((label) => label !== category));
    setColors((current) => {
      const next = { ...current };
      delete next[category];
      return next;
    });
    if (editingLabel === category) setEditingLabel(null);
  }

  const settingsPortal = host ? createPortal(
    <section className="df2-label-colors" aria-label="Štítky">
      <div className="df2-section-head">
        <h2>Štítky</h2>
        <button type="button" onClick={() => { setAddingLabel((value) => !value); setEditingLabel(null); setManagerError(""); }}>+ Nový štítek</button>
      </div>

      {addingLabel && (
        <form className="df2-label-add" onSubmit={addLabel}>
          <input aria-label="Název nového štítku" autoFocus value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Např. Čtení" />
          <button type="submit">Přidat</button>
          <button type="button" onClick={() => { setAddingLabel(false); setNewLabel(""); setManagerError(""); }}>Zrušit</button>
        </form>
      )}

      {managerError && <p className="df2-label-manager-error">{managerError}</p>}

      <div className="df2-label-color-list">
        {rows.map(({ category, color, customized, usage }) => (
          <article key={category} data-label-color-row={category}>
            {editingLabel === category ? (
              <form className="df2-label-rename" onSubmit={(event) => saveRename(event, category)}>
                <i style={{ background: color }} aria-hidden="true" />
                <input aria-label={`Název štítku ${category}`} autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                <button type="submit">Uložit</button>
                <button type="button" onClick={() => { setEditingLabel(null); setManagerError(""); }}>Zrušit</button>
              </form>
            ) : (
              <div className="df2-label-color-name"><i style={{ background: color }} /><strong>{category}</strong></div>
            )}

            <label className="df2-label-color-picker">
              <input
                type="color"
                aria-label={`Barva štítku ${category}`}
                value={color}
                onChange={(event) => setColors((current) => ({ ...current, [category]: normalizeHex(event.target.value) }))}
              />
              <code>{color.toUpperCase()}</code>
            </label>

            <div className="df2-label-row-actions">
              <button type="button" onClick={() => startRename(category)} disabled={editingLabel === category}>Upravit</button>
              <button
                type="button"
                disabled={!customized}
                onClick={() => setColors((current) => {
                  const next = { ...current };
                  delete next[category];
                  return next;
                })}
              >Výchozí</button>
              <button
                type="button"
                className="danger"
                disabled={usage > 0 || categories.length <= 1}
                title={usage > 0 ? `Štítek používá ${usage} bloků nebo rutin` : "Smazat štítek"}
                onClick={() => deleteLabel(category, usage)}
              >Smazat</button>
            </div>
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
