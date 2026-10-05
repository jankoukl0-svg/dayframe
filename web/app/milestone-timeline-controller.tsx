"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Milestone = {
  id: string;
  title: string;
  date: string;
  note?: string;
};

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

function rgba(hex: string, alpha: number) {
  const value = normalizeHex(hex).slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function readMilestones(): Milestone[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as { milestones?: unknown };
    if (!Array.isArray(parsed.milestones)) return [];
    return parsed.milestones
      .filter((item): item is Milestone => Boolean(
        item
        && typeof item === "object"
        && typeof (item as Milestone).id === "string"
        && typeof (item as Milestone).title === "string"
        && typeof (item as Milestone).date === "string",
      ))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "cs"));
  } catch {
    return [];
  }
}

function readKinds(): Record<string, MilestoneKind> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KIND_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, MilestoneKind] => entry[1] === "deadline" || entry[1] === "option"),
    );
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
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([id, color]) => [id, normalizeHex(color)]),
    );
  } catch {
    return {};
  }
}

function readHidden(): HiddenFilters {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || "{}");
    if (Array.isArray(parsed)) {
      return {
        preset: parsed.filter((item): item is string => typeof item === "string").map(normalizeHex),
        custom: false,
      };
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
  const leftTime = Date.UTC(left.year, left.month - 1, left.day);
  const rightTime = Date.UTC(right.year, right.month - 1, right.day);
  return Math.max(0, Math.round((rightTime - leftTime) / DAY_MS));
}

function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function monthLabel(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" })
    .format(new Date(parsed.year, parsed.month - 1, 1, 12))
    .toLocaleUpperCase("cs-CZ");
}

function longDate(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(parsed.year, parsed.month - 1, parsed.day, 12));
}

function meaningfulNote(note?: string) {
  const value = note?.trim() ?? "";
  return value && value !== "Vlastní termín" ? value : "";
}

function findMilestoneView() {
  return [...document.querySelectorAll<HTMLElement>(".df2-simple-view")]
    .find((view) => view.querySelector(".df2-page-head h1")?.textContent?.trim() === "Milníky") ?? null;
}

function ensureTimelineHost() {
  const view = findMilestoneView();
  if (!view) return null;
  view.classList.add("df2-milestone-timeline-enhanced");
  let host = view.querySelector<HTMLElement>("[data-milestone-timeline-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneTimelineHost = "true";
    host.className = "df2-milestone-timeline-host";
    const nativeList = view.querySelector(".df2-milestones");
    view.insertBefore(host, nativeList ?? null);
  }
  const filterHost = view.querySelector<HTMLElement>("[data-milestone-filter-host]");
  if (filterHost && filterHost.nextElementSibling !== host && filterHost.parentNode) {
    filterHost.parentNode.insertBefore(host, filterHost.nextSibling);
  }
  return host;
}

function ensureInlineKindHost() {
  const view = findMilestoneView();
  const form = view?.querySelector<HTMLFormElement>(".df2-inline-form");
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
  const attribute = mode === "edit" ? "data-milestone-kind-edit-host" : "data-milestone-kind-new-host";
  let host = modal.querySelector<HTMLElement>(`[${attribute}]`);
  if (!host) {
    host = document.createElement("div");
    if (mode === "edit") host.dataset.milestoneKindEditHost = "true";
    else host.dataset.milestoneKindNewHost = "true";
    host.className = "df2-milestone-kind-modal-host";
    const actions = modal.querySelector(".df2-modal-actions");
    modal.insertBefore(host, actions ?? null);
  }
  return host;
}

function kindFor(id: string, kinds: Record<string, MilestoneKind>): MilestoneKind {
  return kinds[id] ?? "deadline";
}

function DailyGap({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <div className="df2-milestone-day-gap" data-gap-days={days} aria-label={`${days} ${days === 1 ? "den" : days <= 4 ? "dny" : "dní"}`}>
      <div className="df2-milestone-day-ruler" aria-hidden="true">
        {Array.from({ length: days }, (_, index) => <span key={index} className={(index + 1) % 7 === 0 ? "week" : ""} />)}
      </div>
      {days >= 7 && <small>{days} dní</small>}
    </div>
  );
}

export function MilestoneTimelineController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [inlineKindHost, setInlineKindHost] = useState<HTMLElement | null>(null);
  const [editKindHost, setEditKindHost] = useState<HTMLElement | null>(null);
  const [newKindHost, setNewKindHost] = useState<HTMLElement | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [kinds, setKinds] = useState<Record<string, MilestoneKind>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<HiddenFilters>({ preset: [], custom: false });
  const [draftKind, setDraftKind] = useState<MilestoneKind>("deadline");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<MilestoneKind>("deadline");
  const signatureRef = useRef("");
  const preferredEditingIdRef = useRef<string | null>(null);
  const pendingCreateRef = useRef<PendingCreate | null>(null);
  const draftKindRef = useRef<MilestoneKind>("deadline");
  const editingKindRef = useRef<MilestoneKind>("deadline");

  useEffect(() => { draftKindRef.current = draftKind; }, [draftKind]);
  useEffect(() => { editingKindRef.current = editingKind; }, [editingKind]);

  useEffect(() => {
    const sync = () => {
      const nextMilestones = readMilestones();
      const validIds = new Set(nextMilestones.map((milestone) => milestone.id));
      const rawKinds = readKinds();
      const cleanedKinds = Object.fromEntries(Object.entries(rawKinds).filter(([id]) => validIds.has(id)));
      if (JSON.stringify(cleanedKinds) !== JSON.stringify(rawKinds)) writeKinds(cleanedKinds);
      const nextColors = readColors();
      const nextHidden = readHidden();

      const signature = JSON.stringify({
        milestones: nextMilestones,
        kinds: cleanedKinds,
        colors: nextColors,
        hidden: nextHidden,
      });
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setMilestones(nextMilestones);
        setKinds(cleanedKinds);
        setColors(nextColors);
        setHidden(nextHidden);
      }

      const timelineHost = ensureTimelineHost();
      setHost((current) => current === timelineHost ? current : timelineHost);
      const createHost = ensureInlineKindHost();
      setInlineKindHost((current) => current === createHost ? current : createHost);

      const editHost = ensureModalKindHost("edit");
      setEditKindHost((current) => current === editHost ? current : editHost);
      if (editHost) {
        const modal = editHost.closest<HTMLFormElement>("form");
        const title = modal?.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = modal?.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        const preferred = preferredEditingIdRef.current
          ? nextMilestones.find((milestone) => milestone.id === preferredEditingIdRef.current) ?? null
          : null;
        const match = preferred
          ?? nextMilestones.find((milestone) => milestone.title === title && milestone.date === date)
          ?? nextMilestones.find((milestone) => milestone.title === title)
          ?? null;
        const nextId = match?.id ?? null;
        if (nextId !== editingId) {
          setEditingId(nextId);
          const nextKind = nextId ? kindFor(nextId, cleanedKinds) : "deadline";
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
        const created = nextMilestones.find((milestone) => (
          !pending.ids.has(milestone.id)
          && milestone.title === pending.title
          && milestone.date === pending.date
        )) ?? nextMilestones.find((milestone) => !pending.ids.has(milestone.id));
        if (created) {
          writeKinds({ ...cleanedKinds, [created.id]: pending.kind });
          pendingCreateRef.current = null;
          draftKindRef.current = "deadline";
          setDraftKind("deadline");
        } else if (Date.now() - pending.startedAt > 2_500) {
          pendingCreateRef.current = null;
        }
      }
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      const isInline = form.classList.contains("df2-inline-form") && Boolean(form.querySelector("[data-milestone-kind-create-host]"));
      const isNewModal = Boolean(form.querySelector("[data-milestone-kind-new-host]"));
      const isEditModal = Boolean(form.querySelector("[data-milestone-kind-edit-host]"));

      if (isInline || isNewModal) {
        const title = isInline
          ? form.querySelector<HTMLInputElement>('input[placeholder="Nový milník"]')?.value.trim() ?? ""
          : form.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = isInline
          ? form.querySelector<HTMLInputElement>('input[type="date"]')?.value ?? ""
          : form.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        if (!title || !date) return;
        pendingCreateRef.current = {
          ids: new Set(readMilestones().map((milestone) => milestone.id)),
          title,
          date,
          kind: draftKindRef.current,
          startedAt: Date.now(),
        };
      }

      if (isEditModal && editingId) {
        const title = form.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim() ?? "";
        const date = form.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? "";
        if (!title || !date) return;
        writeKinds({ ...readKinds(), [editingId]: editingKindRef.current });
      }
    };

    sync();
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener(KIND_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 220);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(KIND_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, [editingId]);

  const today = localDateKey(new Date());
  const visible = milestones.filter((milestone) => milestone.date >= today && !hiddenByColor(milestone.id, colors, hidden));
  const groups: Array<{ key: string; items: Milestone[] }> = [];
  visible.forEach((milestone) => {
    const key = monthKey(milestone.date);
    const current = groups[groups.length - 1];
    if (!current || current.key !== key) groups.push({ key, items: [milestone] });
    else current.items.push(milestone);
  });

  function openMilestone(id: string) {
    preferredEditingIdRef.current = id;
    const sorted = readMilestones();
    const index = sorted.findIndex((milestone) => milestone.id === id);
    const nativeList = findMilestoneView()?.querySelector<HTMLElement>(".df2-milestones");
    const row = index >= 0 ? nativeList?.querySelectorAll<HTMLElement>(":scope > article")[index] : null;
    row?.click();
  }

  const timelinePortal = host ? createPortal(
    <div className="df2-milestone-timeline" aria-label="Milníky podle měsíců">
      {visible.length === 0 ? (
        <div className="df2-milestone-timeline-empty">Žádné nadcházející milníky.</div>
      ) : (
        <>
          <div className="df2-milestone-today-anchor"><i /><span>Dnes</span><small>{longDate(today)}</small></div>
          {groups.map((group, groupIndex) => {
            const previousDate = groupIndex === 0 ? today : groups[groupIndex - 1].items.at(-1)?.date ?? today;
            const leadDays = daysBetween(previousDate, group.items[0].date);
            return (
              <section key={group.key} className="df2-milestone-month-group" data-month={group.key}>
                <DailyGap days={leadDays} />
                <header className="df2-milestone-month-head">
                  <h2>{monthLabel(group.items[0].date)}</h2>
                  <span>{group.items.length} {group.items.length === 1 ? "milník" : group.items.length <= 4 ? "milníky" : "milníků"}</span>
                </header>
                <div className="df2-milestone-month-items">
                  {group.items.map((milestone, index) => {
                    const previous = index > 0 ? group.items[index - 1] : null;
                    const gapDays = previous ? daysBetween(previous.date, milestone.date) : 0;
                    const kind = kindFor(milestone.id, kinds);
                    const color = colorFor(milestone.id, colors);
                    const note = meaningfulNote(milestone.note);
                    const remaining = daysBetween(today, milestone.date);
                    const style = {
                      "--df2-milestone-color": color,
                      "--df2-milestone-tint": rgba(color, kind === "deadline" ? 0.075 : 0.035),
                    } as CSSProperties;
                    return (
                      <div key={milestone.id} className="df2-milestone-timeline-entry">
                        {previous && <DailyGap days={gapDays} />}
                        <button
                          type="button"
                          className={`df2-milestone-timeline-item ${kind === "deadline" ? "is-deadline" : "is-option"}`}
                          data-milestone-id={milestone.id}
                          data-milestone-kind={kind}
                          style={style}
                          onClick={() => openMilestone(milestone.id)}
                        >
                          <span className="df2-milestone-axis-dot" aria-hidden="true" />
                          <div className="df2-milestone-timeline-copy">
                            <div className="df2-milestone-kind-line">
                              <span className={`df2-milestone-kind-chip ${kind}`}>{kind === "deadline" ? "Deadline" : "Možnost"}</span>
                              {note && <small>{note}</small>}
                            </div>
                            <strong>{milestone.title}</strong>
                          </div>
                          <div className="df2-milestone-timeline-remaining"><strong>{remaining}</strong><span>dní</span></div>
                          <time>{longDate(milestone.date)}</time>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>,
    host,
  ) : null;

  const inlineKindPortal = inlineKindHost ? createPortal(
    <label className="df2-milestone-kind-create-control">
      <span>Typ</span>
      <select aria-label="Typ nového milníku" value={draftKind} onChange={(event) => setDraftKind(event.target.value as MilestoneKind)}>
        <option value="deadline">Deadline</option>
        <option value="option">Možnost</option>
      </select>
    </label>,
    inlineKindHost,
  ) : null;

  const newModalPortal = newKindHost ? createPortal(
    <label className="df2-milestone-kind-modal-control">
      Typ milníku
      <select aria-label="Typ nového milníku" value={draftKind} onChange={(event) => setDraftKind(event.target.value as MilestoneKind)}>
        <option value="deadline">Deadline</option>
        <option value="option">Možnost</option>
      </select>
      <small>Deadline = jeden závazný termín. Možnost = termín, ze kterého si můžeš vybrat.</small>
    </label>,
    newKindHost,
  ) : null;

  const editModalPortal = editKindHost && editingId ? createPortal(
    <label className="df2-milestone-kind-modal-control">
      Typ milníku
      <select aria-label="Typ milníku" value={editingKind} onChange={(event) => setEditingKind(event.target.value as MilestoneKind)}>
        <option value="deadline">Deadline</option>
        <option value="option">Možnost</option>
      </select>
      <small>Deadline = jeden závazný termín. Možnost = termín, ze kterého si můžeš vybrat.</small>
    </label>,
    editKindHost,
  ) : null;

  return <>{timelinePortal}{inlineKindPortal}{newModalPortal}{editModalPortal}</>;
}
