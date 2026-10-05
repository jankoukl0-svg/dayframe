"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Milestone = { id: string; title: string; date: string; note?: string };
type MilestoneKind = "deadline" | "option";
type HiddenFilters = { preset: string[]; custom: boolean };
type PendingCreate = { ids: Set<string>; title: string; date: string; kind: MilestoneKind; startedAt: number };

const STATE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const KIND_KEY = "dayframe-milestone-kinds-v1";
const KIND_SYNC_EVENT = "dayframe-milestone-kinds-sync";
const COLORS_KEY = "dayframe-milestone-colors-v1";
const HIDDEN_KEY = "dayframe-milestone-hidden-colors-v1";
const DEFAULT_COLOR = "#c85b32";
const PRESET_COLORS = new Set(["#2563eb", "#c85b32", "#dc2626", "#16a34a", "#7c3aed", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#64748b"]);
const DAY_MS = 86_400_000;

function normalizeHex(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_COLOR;
}

function readMilestones(): Milestone[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as { milestones?: unknown };
    if (!Array.isArray(parsed.milestones)) return [];
    return parsed.milestones
      .filter((item): item is Milestone => Boolean(item && typeof item === "object"
        && typeof (item as Milestone).id === "string"
        && typeof (item as Milestone).title === "string"
        && typeof (item as Milestone).date === "string"))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function readKinds(): Record<string, MilestoneKind> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KIND_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, MilestoneKind] => entry[1] === "deadline" || entry[1] === "option"));
  } catch {
    return {};
  }
}

function writeKinds(next: Record<string, MilestoneKind>) {
  window.localStorage.setItem(KIND_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(KIND_SYNC_EVENT));
}

function readColors(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COLORS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([id, color]) => [id, normalizeHex(color)]));
  } catch {
    return {};
  }
}

function readHidden(): HiddenFilters {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || "{}");
    if (Array.isArray(parsed)) {
      return { preset: parsed.filter((item): item is string => typeof item === "string").map(normalizeHex), custom: false };
    }
    if (!parsed || typeof parsed !== "object") return { preset: [], custom: false };
    const stored = parsed as { preset?: unknown; custom?: unknown };
    return {
      preset: Array.isArray(stored.preset)
        ? stored.preset.filter((item): item is string => typeof item === "string").map(normalizeHex)
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

function hiddenByColor(id: string, colors: Record<string, string>, hidden: HiddenFilters) {
  const color = colorFor(id, colors);
  return PRESET_COLORS.has(color) ? hidden.preset.includes(color) : hidden.custom;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysBetween(from: string, to: string) {
  const left = parseDateKey(from);
  const right = parseDateKey(to);
  if (!left || !right) return 0;
  return Math.max(0, Math.round((Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / DAY_MS));
}

function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function monthLabel(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" })
    .format(new Date(parsed.year, parsed.month - 1, 1, 12)).toLocaleUpperCase("cs-CZ");
}

function longDate(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(parsed.year, parsed.month - 1, parsed.day, 12));
}

function findMilestoneView() {
  return [...document.querySelectorAll<HTMLElement>(".df2-simple-view")]
    .find((view) => view.querySelector(".df2-page-head h1")?.textContent?.trim() === "Milníky") ?? null;
}

function findMilestoneList() {
  const view = findMilestoneView();
  if (!view) return null;
  view.classList.add("df2-milestone-timeline-enhanced");
  return view.querySelector<HTMLElement>(".df2-milestones");
}

function ensureInlineKindHost() {
  const form = findMilestoneView()?.querySelector<HTMLFormElement>(".df2-inline-form");
  if (!form) return null;
  form.classList.add("df2-milestone-kind-form");
  let host = form.querySelector<HTMLElement>("[data-milestone-kind-create-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneKindCreateHost = "true";
    host.className = "df2-milestone-kind-create-host";
    form.appendChild(host);
  }
  return host;
}

function findMilestoneModal(title: "Upravit milník" | "Nový milník") {
  return [...document.querySelectorAll<HTMLFormElement>(".df2-modal")]
    .find((modal) => modal.querySelector("h2")?.textContent?.trim() === title) ?? null;
}

function ensureModalKindHost(mode: "edit" | "new") {
  const modal = findMilestoneModal(mode === "edit" ? "Upravit milník" : "Nový milník");
  if (!modal) return null;
  const selector = mode === "edit" ? "[data-milestone-kind-edit-host]" : "[data-milestone-kind-new-host]";
  let host = modal.querySelector<HTMLElement>(selector);
  if (!host) {
    host = document.createElement("div");
    if (mode === "edit") host.dataset.milestoneKindEditHost = "true";
    else host.dataset.milestoneKindNewHost = "true";
    host.className = "df2-milestone-kind-modal-host";
    modal.insertBefore(host, modal.querySelector(".df2-modal-actions"));
  }
  return host;
}

function kindFor(id: string, kinds: Record<string, MilestoneKind>): MilestoneKind {
  return kinds[id] ?? "deadline";
}

function createTodayAnchor(today: string) {
  const anchor = document.createElement("div");
  anchor.dataset.milestoneTimelineDecoration = "today";
  anchor.className = "df2-milestone-today-anchor";
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = "Dnes";
  const date = document.createElement("small");
  date.textContent = longDate(today);
  anchor.appendChild(dot);
  anchor.appendChild(label);
  anchor.appendChild(date);
  return anchor;
}

function createMonthHeader(dateKey: string, count: number) {
  const header = document.createElement("div");
  header.dataset.milestoneTimelineDecoration = "month";
  header.dataset.month = monthKey(dateKey);
  header.className = "df2-milestone-month-head";
  const title = document.createElement("h2");
  title.textContent = monthLabel(dateKey);
  const meta = document.createElement("span");
  meta.textContent = `${count} ${count === 1 ? "milník" : count <= 4 ? "milníky" : "milníků"}`;
  header.appendChild(title);
  header.appendChild(meta);
  return header;
}

function createDailyGap(days: number) {
  if (days <= 0) return null;
  const gap = document.createElement("div");
  gap.dataset.milestoneTimelineDecoration = "gap";
  gap.dataset.gapDays = String(days);
  gap.className = "df2-milestone-day-gap";
  gap.setAttribute("aria-label", `${days} ${days === 1 ? "den" : days <= 4 ? "dny" : "dní"}`);
  const ruler = document.createElement("div");
  ruler.className = "df2-milestone-day-ruler";
  ruler.setAttribute("aria-hidden", "true");
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < days; index += 1) {
    const tick = document.createElement("span");
    if ((index + 1) % 7 === 0) tick.className = "week";
    fragment.appendChild(tick);
  }
  ruler.appendChild(fragment);
  gap.appendChild(ruler);
  if (days >= 7) {
    const label = document.createElement("small");
    label.textContent = `${days} dní`;
    gap.appendChild(label);
  }
  return gap;
}

function ensureKindBadge(article: HTMLElement, kind: MilestoneKind) {
  const copy = article.querySelector<HTMLElement>(":scope > div:first-child");
  if (!copy) return;
  let badge = copy.querySelector<HTMLElement>("[data-milestone-kind-badge]");
  if (!badge) {
    badge = document.createElement("span");
    badge.dataset.milestoneKindBadge = "true";
    copy.insertBefore(badge, copy.firstChild);
  }
  badge.className = `df2-milestone-kind-chip ${kind}`;
  badge.textContent = kind === "deadline" ? "Deadline" : "Možnost";
}

function decorateNativeTimeline(list: HTMLElement, milestones: Milestone[], kinds: Record<string, MilestoneKind>, colors: Record<string, string>, hidden: HiddenFilters, today: string) {
  list.querySelectorAll<HTMLElement>(":scope > [data-milestone-timeline-decoration]").forEach((node) => node.remove());
  const rows = [...list.querySelectorAll<HTMLElement>(":scope > article")];
  const rowById = new Map<string, HTMLElement>();

  rows.forEach((row, index) => {
    const milestone = milestones[index];
    if (!milestone) return;
    const kind = kindFor(milestone.id, kinds);
    row.dataset.milestoneId = milestone.id;
    row.dataset.milestoneKind = kind;
    row.classList.toggle("is-deadline", kind === "deadline");
    row.classList.toggle("is-option", kind === "option");
    ensureKindBadge(row, kind);
    rowById.set(milestone.id, row);
  });

  const visible = milestones.filter((milestone) => milestone.date >= today && !hiddenByColor(milestone.id, colors, hidden));
  if (visible.length === 0) return;
  const counts = new Map<string, number>();
  visible.forEach((milestone) => counts.set(monthKey(milestone.date), (counts.get(monthKey(milestone.date)) ?? 0) + 1));

  let previousDate = today;
  let previousMonth = "";
  let insertedAnchor = false;
  visible.forEach((milestone) => {
    const row = rowById.get(milestone.id);
    if (!row) return;
    if (!insertedAnchor) {
      list.insertBefore(createTodayAnchor(today), row);
      insertedAnchor = true;
    }
    const gap = createDailyGap(daysBetween(previousDate, milestone.date));
    if (gap) list.insertBefore(gap, row);
    const currentMonth = monthKey(milestone.date);
    if (currentMonth !== previousMonth) {
      list.insertBefore(createMonthHeader(milestone.date, counts.get(currentMonth) ?? 0), row);
      previousMonth = currentMonth;
    }
    previousDate = milestone.date;
  });
}

export function MilestoneTimelineController() {
  const [inlineKindHost, setInlineKindHost] = useState<HTMLElement | null>(null);
  const [editKindHost, setEditKindHost] = useState<HTMLElement | null>(null);
  const [newKindHost, setNewKindHost] = useState<HTMLElement | null>(null);
  const [draftKind, setDraftKind] = useState<MilestoneKind>("deadline");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<MilestoneKind>("deadline");
  const listRef = useRef<HTMLElement | null>(null);
  const timelineSignatureRef = useRef("");
  const preferredEditingIdRef = useRef<string | null>(null);
  const pendingCreateRef = useRef<PendingCreate | null>(null);
  const draftKindRef = useRef<MilestoneKind>("deadline");
  const editingKindRef = useRef<MilestoneKind>("deadline");

  useEffect(() => { draftKindRef.current = draftKind; }, [draftKind]);
  useEffect(() => { editingKindRef.current = editingKind; }, [editingKind]);

  useEffect(() => {
    const sync = () => {
      const milestones = readMilestones();
      const validIds = new Set(milestones.map((milestone) => milestone.id));
      const rawKinds = readKinds();
      const kinds = Object.fromEntries(Object.entries(rawKinds).filter(([id]) => validIds.has(id)));
      if (JSON.stringify(kinds) !== JSON.stringify(rawKinds)) writeKinds(kinds);
      const colors = readColors();
      const hidden = readHidden();
      const today = localDateKey(new Date());
      const list = findMilestoneList();
      const signature = JSON.stringify({ milestones, kinds, colors, hidden, today });
      const missingDecorations = Boolean(list && milestones.some((milestone) => milestone.date >= today) && !list.querySelector(":scope > [data-milestone-timeline-decoration]"));
      if (list && (list !== listRef.current || signature !== timelineSignatureRef.current || missingDecorations)) {
        decorateNativeTimeline(list, milestones, kinds, colors, hidden, today);
        listRef.current = list;
        timelineSignatureRef.current = signature;
      } else if (!list) {
        listRef.current = null;
      }

      const createHost = ensureInlineKindHost();
      setInlineKindHost((current) => current === createHost ? current : createHost);

      const editHost = ensureModalKindHost("edit");
      setEditKindHost((current) => current === editHost ? current : editHost);
      if (editHost) {
        const modal = editHost.closest<HTMLFormElement>("form");
        const title = modal?.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = modal?.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        const preferred = preferredEditingIdRef.current ? milestones.find((milestone) => milestone.id === preferredEditingIdRef.current) ?? null : null;
        const match = preferred ?? milestones.find((milestone) => milestone.title === title && milestone.date === date) ?? milestones.find((milestone) => milestone.title === title) ?? null;
        const nextId = match?.id ?? null;
        if (nextId !== editingId) {
          setEditingId(nextId);
          const nextKind = nextId ? kindFor(nextId, kinds) : "deadline";
          editingKindRef.current = nextKind;
          setEditingKind(nextKind);
        }
      } else if (editingId !== null) {
        preferredEditingIdRef.current = null;
        setEditingId(null);
      }

      const createModalHost = ensureModalKindHost("new");
      setNewKindHost((current) => current === createModalHost ? current : createModalHost);

      const pending = pendingCreateRef.current;
      if (pending) {
        const created = milestones.find((milestone) => !pending.ids.has(milestone.id) && milestone.title === pending.title && milestone.date === pending.date)
          ?? milestones.find((milestone) => !pending.ids.has(milestone.id));
        if (created) {
          writeKinds({ ...kinds, [created.id]: pending.kind });
          pendingCreateRef.current = null;
          draftKindRef.current = "deadline";
          setDraftKind("deadline");
        } else if (Date.now() - pending.startedAt > 2_500) {
          pendingCreateRef.current = null;
        }
      }
    };

    const rememberMilestone = (target: EventTarget | null) => {
      const element = target instanceof Element
        ? target.closest<HTMLElement>(".df2-milestones article[data-milestone-id], .df2-month-milestone[data-milestone-id]")
        : null;
      if (element?.dataset.milestoneId) preferredEditingIdRef.current = element.dataset.milestoneId;
    };
    const onClick = (event: MouseEvent) => rememberMilestone(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") rememberMilestone(event.target);
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      const isInline = form.classList.contains("df2-inline-form") && Boolean(form.querySelector("[data-milestone-kind-create-host]"));
      const isNewModal = Boolean(form.querySelector("[data-milestone-kind-new-host]"));
      const isEditModal = Boolean(form.querySelector("[data-milestone-kind-edit-host]"));
      if (isInline || isNewModal) {
        const title = isInline ? form.querySelector<HTMLInputElement>('input[placeholder="Nový milník"]')?.value.trim() ?? "" : form.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = isInline ? form.querySelector<HTMLInputElement>('input[type="date"]')?.value ?? "" : form.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        if (title && date) pendingCreateRef.current = { ids: new Set(readMilestones().map((milestone) => milestone.id)), title, date, kind: draftKindRef.current, startedAt: Date.now() };
      }
      if (isEditModal && editingId) {
        const title = form.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = form.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        if (title && date) writeKinds({ ...readKinds(), [editingId]: editingKindRef.current });
      }
    };

    sync();
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener(KIND_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 220);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(KIND_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, [editingId]);

  const inlineKindPortal = inlineKindHost ? createPortal(
    <label className="df2-milestone-kind-create-control"><span>Typ</span><select aria-label="Typ nového milníku" value={draftKind} onChange={(event) => setDraftKind(event.target.value as MilestoneKind)}><option value="deadline">Deadline</option><option value="option">Možnost</option></select></label>, inlineKindHost,
  ) : null;
  const newModalPortal = newKindHost ? createPortal(
    <label className="df2-milestone-kind-modal-control">Typ milníku<select aria-label="Typ nového milníku" value={draftKind} onChange={(event) => setDraftKind(event.target.value as MilestoneKind)}><option value="deadline">Deadline</option><option value="option">Možnost</option></select><small>Deadline = jeden závazný termín. Možnost = termín, ze kterého si můžeš vybrat.</small></label>, newKindHost,
  ) : null;
  const editModalPortal = editKindHost && editingId ? createPortal(
    <label className="df2-milestone-kind-modal-control">Typ milníku<select aria-label="Typ milníku" value={editingKind} onChange={(event) => setEditingKind(event.target.value as MilestoneKind)}><option value="deadline">Deadline</option><option value="option">Možnost</option></select><small>Deadline = jeden závazný termín. Možnost = termín, ze kterého si můžeš vybrat.</small></label>, editKindHost,
  ) : null;

  return <>{inlineKindPortal}{newModalPortal}{editModalPortal}</>;
}
