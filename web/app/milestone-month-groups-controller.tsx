"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Milestone = { id: string; title: string; date: string; note?: string };
type MilestoneKind = "deadline" | "option";
type TypeMap = Record<string, MilestoneKind>;

const STATE_KEY = "dayframe-v1";
const TYPE_KEY = "dayframe-milestone-types-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const TYPE_SYNC_EVENT = "dayframe-milestone-types-sync";
const DAY_MS = 86_400_000;

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readMilestones(): Milestone[] {
  try {
    const state = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as { milestones?: unknown };
    if (!Array.isArray(state.milestones)) return [];
    return state.milestones
      .filter((item): item is Milestone => Boolean(item && typeof item === "object" && typeof (item as Milestone).id === "string" && typeof (item as Milestone).title === "string" && typeof (item as Milestone).date === "string"))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function readTypes(): TypeMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TYPE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === "deadline" || value === "option")) as TypeMap;
  } catch {
    return {};
  }
}

function writeTypes(next: TypeMap) {
  window.localStorage.setItem(TYPE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(TYPE_SYNC_EVENT));
}

function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1, 12));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateDistance(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((bUtc - aUtc) / DAY_MS));
}

function findMilestoneView() {
  const list = document.querySelector<HTMLElement>(".df2-milestones");
  if (!list) return null;
  const section = list.closest<HTMLElement>(".df2-simple-view");
  if (!section) return null;
  return section.querySelector(".df2-page-head h1")?.textContent?.trim() === "Milníky" ? { list, section } : null;
}

function directRows(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLElement>(":scope > article")];
}

function createMonthHeader(label: string, count: number) {
  const header = document.createElement("div");
  header.className = "df2-milestone-month-divider";
  header.dataset.milestoneMonthDecoration = "true";
  const title = document.createElement("strong");
  title.textContent = label;
  const meta = document.createElement("span");
  meta.textContent = `${count} ${count === 1 ? "termín" : count <= 4 ? "termíny" : "termínů"}`;
  header.appendChild(title);
  header.appendChild(meta);
  return header;
}

function createDayGap(days: number) {
  const gap = document.createElement("div");
  gap.className = "df2-milestone-day-gap";
  gap.dataset.milestoneMonthDecoration = "true";
  gap.style.setProperty("--df2-gap-days", String(days));
  gap.setAttribute("aria-label", `${days} dní mezi termíny`);
  if (days >= 4) {
    const label = document.createElement("span");
    label.textContent = `${days} dní`;
    gap.appendChild(label);
  }
  return gap;
}

function syncDecorations(milestones: Milestone[], types: TypeMap) {
  const view = findMilestoneView();
  if (!view) return;
  const rows = directRows(view.list);
  const today = localDateKey(new Date());

  view.list.querySelectorAll<HTMLElement>(":scope > [data-milestone-month-decoration]").forEach((node) => node.parentNode?.removeChild(node));

  rows.forEach((row, index) => {
    const milestone = milestones[index];
    if (!milestone) return;
    row.dataset.milestoneMonthId = milestone.id;
    const kind = types[milestone.id] ?? "deadline";
    row.classList.toggle("df2-milestone-deadline", kind === "deadline");
    row.classList.toggle("df2-milestone-option", kind === "option");

    const main = row.querySelector<HTMLElement>(":scope > div:first-child");
    if (!main) return;
    let badge = main.querySelector<HTMLElement>(":scope > .df2-milestone-kind-badge");
    if (!badge) {
      badge = document.createElement("i");
      badge.className = "df2-milestone-kind-badge";
      main.insertBefore(badge, main.firstChild);
    }
    badge.classList.toggle("deadline", kind === "deadline");
    badge.classList.toggle("option", kind === "option");
    badge.textContent = kind === "deadline" ? "Deadline" : "Možnost";
  });

  const visibleUpcoming = rows
    .map((row, index) => ({ row, milestone: milestones[index] }))
    .filter((item): item is { row: HTMLElement; milestone: Milestone } => Boolean(item.milestone && item.milestone.date >= today && !item.row.hidden));

  const counts = new Map<string, number>();
  visibleUpcoming.forEach(({ milestone }) => counts.set(monthKey(milestone.date), (counts.get(monthKey(milestone.date)) ?? 0) + 1));

  visibleUpcoming.forEach(({ row, milestone }, index) => {
    const previous = index > 0 ? visibleUpcoming[index - 1] : null;
    const currentMonth = monthKey(milestone.date);
    const previousMonth = previous ? monthKey(previous.milestone.date) : null;

    if (previous) {
      const gapDays = dateDistance(previous.milestone.date, milestone.date);
      if (gapDays > 0) row.parentNode?.insertBefore(createDayGap(gapDays), row);
    }

    if (currentMonth !== previousMonth) {
      row.parentNode?.insertBefore(createMonthHeader(monthLabel(currentMonth), counts.get(currentMonth) ?? 1), row);
    }
  });
}

function ensureAddTypeSelect() {
  const view = findMilestoneView();
  const form = view?.section.querySelector<HTMLFormElement>(".df2-inline-form");
  if (!form) return null;
  let select = form.querySelector("[data-milestone-add-kind]") as HTMLElement | null;
  if (!select) {
    select = document.createElement("select") as unknown as HTMLElement;
    select.dataset.milestoneAddKind = "true";
    select.className = "df2-milestone-add-kind";
    select.setAttribute("aria-label", "Typ milníku");
    select.innerHTML = '<option value="deadline">Deadline</option><option value="option">Možnost</option>';
    const button = form.querySelector("button");
    form.insertBefore(select as unknown as Node, button ?? null);
  }
  return select;
}

function selectedKind(element: HTMLElement | null): MilestoneKind {
  if (!element) return "deadline";
  return (element as unknown as { value?: string }).value === "option" ? "option" : "deadline";
}

function findEditingMilestone(milestones: Milestone[]) {
  const modal = [...document.querySelectorAll<HTMLFormElement>(".df2-modal")].find((item) => item.querySelector("h2")?.textContent?.trim() === "Upravit milník") ?? null;
  if (!modal) return { modal: null, milestone: null };
  const title = modal.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
  const date = modal.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
  return { modal, milestone: milestones.find((item) => item.title === title && item.date === date) ?? null };
}

function ensureEditorHost(modal: HTMLFormElement) {
  let host = modal.querySelector<HTMLElement>("[data-milestone-kind-editor-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneKindEditorHost = "true";
    host.className = "df2-milestone-kind-editor-host";
    const actions = modal.querySelector(".df2-modal-actions");
    modal.insertBefore(host, actions ?? null);
  }
  return host;
}

export function MilestoneMonthGroupsController() {
  const [types, setTypes] = useState<TypeMap>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorHost, setEditorHost] = useState<HTMLElement | null>(null);
  const pendingAddRef = useRef<{ ids: Set<string>; kind: MilestoneKind } | null>(null);

  useEffect(() => {
    const sync = () => {
      const milestones = readMilestones();
      const nextTypes = readTypes();
      setTypes((current) => JSON.stringify(current) === JSON.stringify(nextTypes) ? current : nextTypes);
      ensureAddTypeSelect();
      syncDecorations(milestones, nextTypes);

      const editing = findEditingMilestone(milestones);
      if (editing.modal && editing.milestone) {
        setEditingId((current) => current === editing.milestone?.id ? current : editing.milestone?.id ?? null);
        const host = ensureEditorHost(editing.modal);
        setEditorHost((current) => current === host ? current : host);
      } else {
        setEditingId(null);
        setEditorHost(null);
      }

      const pending = pendingAddRef.current;
      if (pending) {
        const added = milestones.find((milestone) => !pending.ids.has(milestone.id));
        if (added) {
          pendingAddRef.current = null;
          writeTypes({ ...readTypes(), [added.id]: pending.kind });
        }
      }
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.matches(".df2-inline-form")) return;
      const view = findMilestoneView();
      if (!view?.section.contains(form)) return;
      const selector = form.querySelector("[data-milestone-add-kind]") as HTMLElement | null;
      pendingAddRef.current = { ids: new Set(readMilestones().map((milestone) => milestone.id)), kind: selectedKind(selector) };
    };

    sync();
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener(TYPE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 350);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(TYPE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, []);

  const chooseKind = (kind: MilestoneKind) => {
    if (!editingId) return;
    const next = { ...readTypes(), [editingId]: kind };
    setTypes(next);
    writeTypes(next);
    window.requestAnimationFrame(() => syncDecorations(readMilestones(), next));
  };

  return editorHost && editingId ? createPortal(
    <label className="df2-milestone-kind-editor">
      <span>Typ termínu</span>
      <select value={types[editingId] ?? "deadline"} onChange={(event) => chooseKind(event.target.value as MilestoneKind)}>
        <option value="deadline">Deadline — musím stihnout</option>
        <option value="option">Možnost — jeden z termínů</option>
      </select>
    </label>,
    editorHost,
  ) : null;
}