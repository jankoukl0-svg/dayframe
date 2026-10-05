"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Milestone = {
  id: string;
  title: string;
  date: string;
  note?: string;
};

type MilestoneKind = "deadline" | "option";
type TypeMap = Record<string, MilestoneKind>;

type MonthGroup = {
  key: string;
  label: string;
  milestones: Milestone[];
};

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
      .filter((item): item is Milestone => Boolean(
        item
        && typeof item === "object"
        && typeof (item as Milestone).id === "string"
        && typeof (item as Milestone).title === "string"
        && typeof (item as Milestone).date === "string",
      ))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function readTypes(): TypeMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TYPE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === "deadline" || value === "option"),
    ) as TypeMap;
  } catch {
    return {};
  }
}

function writeTypes(next: TypeMap) {
  window.localStorage.setItem(TYPE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(TYPE_SYNC_EVENT));
  return next;
}

function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1, 12));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function longDate(dateKey: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${dateKey}T12:00:00`));
}

function dayOfMonth(dateKey: string) {
  return Number(dateKey.slice(8, 10));
}

function daysUntil(dateKey: string) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(`${dateKey}T12:00:00`);
  return Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - today) / DAY_MS);
}

function findMilestoneView() {
  const list = document.querySelector<HTMLElement>(".df2-milestones");
  if (!list) return null;
  const section = list.closest<HTMLElement>(".df2-simple-view");
  if (!section) return null;
  const title = section.querySelector(".df2-page-head h1")?.textContent?.trim();
  return title === "Milníky" ? { list, section } : null;
}

function ensureHost() {
  const view = findMilestoneView();
  if (!view) return null;
  let host = view.section.querySelector<HTMLElement>("[data-milestone-month-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.milestoneMonthHost = "true";
    host.className = "df2-milestone-month-host";
    view.list.before(host);
  }
  view.section.dataset.milestoneMonthGroups = "true";
  return host;
}

function findNativeForm() {
  const view = findMilestoneView();
  return view?.section.querySelector<HTMLFormElement>(".df2-inline-form") ?? null;
}

function findNativeArticle(milestoneId: string, milestones: Milestone[]) {
  const view = findMilestoneView();
  if (!view) return null;
  const sorted = [...milestones].sort((a, b) => a.date.localeCompare(b.date));
  const index = sorted.findIndex((milestone) => milestone.id === milestoneId);
  if (index < 0) return null;
  return view.list.querySelectorAll<HTMLElement>(":scope > article")[index] ?? null;
}

function writeMilestone(title: string, date: string) {
  try {
    const state = JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as { milestones?: Milestone[]; [key: string]: unknown };
    const milestone: Milestone = {
      id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim(),
      date,
      note: "Vlastní termín",
    };
    const next = {
      ...state,
      milestones: [...(Array.isArray(state.milestones) ? state.milestones : []), milestone]
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
    window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(STATE_SYNC_EVENT));
    return milestone;
  } catch {
    return null;
  }
}

function normalizedNote(note?: string) {
  const value = note?.trim() ?? "";
  return value && value !== "Vlastní termín" ? value : "";
}

export function MilestoneMonthGroupsController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [types, setTypes] = useState<TypeMap>({});
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("deadline");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorHost, setEditorHost] = useState<HTMLElement | null>(null);
  const signatureRef = useRef("");
  const typeSignatureRef = useRef("");

  useEffect(() => {
    const sync = () => {
      const nextHost = ensureHost();
      setHost((current) => current === nextHost ? current : nextHost);

      const currentMilestones = readMilestones();
      const signature = JSON.stringify(currentMilestones.map(({ id, title, date, note }) => [id, title, date, note]));
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setMilestones(currentMilestones);
      }

      const currentTypes = readTypes();
      const typeSignature = JSON.stringify(currentTypes);
      if (typeSignature !== typeSignatureRef.current) {
        typeSignatureRef.current = typeSignature;
        setTypes(currentTypes);
      }

      const nativeForm = findNativeForm();
      if (nativeForm) nativeForm.dataset.milestoneMonthNativeHidden = "true";

      const modal = [...document.querySelectorAll<HTMLFormElement>(".df2-modal")]
        .find((item) => item.querySelector("h2")?.textContent?.trim() === "Upravit milník") ?? null;
      if (!modal) {
        setEditingId(null);
        setEditorHost(null);
        return;
      }

      const titleInput = modal.querySelector<HTMLInputElement>('input[name="title"]');
      const dateInput = modal.querySelector<HTMLInputElement>('input[name="date"]');
      const match = currentMilestones.find((milestone) => (
        milestone.title === titleInput?.value && milestone.date === dateInput?.value
      )) ?? null;
      setEditingId((current) => current === match?.id ? current : match?.id ?? null);

      let editorMount = modal.querySelector<HTMLElement>("[data-milestone-kind-editor-host]");
      if (!editorMount) {
        editorMount = document.createElement("div");
        editorMount.dataset.milestoneKindEditorHost = "true";
        editorMount.className = "df2-milestone-kind-editor-host";
        const actions = modal.querySelector(".df2-modal-actions");
        modal.insertBefore(editorMount, actions ?? null);
      }
      setEditorHost((current) => current === editorMount ? current : editorMount);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 500);
    window.addEventListener(STATE_SYNC_EVENT, sync);
    window.addEventListener(TYPE_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener(STATE_SYNC_EVENT, sync);
      window.removeEventListener(TYPE_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const today = localDateKey(new Date());
  const future = useMemo(
    () => milestones.filter((milestone) => milestone.date >= today),
    [milestones, today],
  );

  const groups = useMemo<MonthGroup[]>(() => {
    const grouped = new Map<string, Milestone[]>();
    future.forEach((milestone) => {
      const key = monthKey(milestone.date);
      grouped.set(key, [...(grouped.get(key) ?? []), milestone]);
    });
    return [...grouped.entries()].map(([key, items]) => ({
      key,
      label: monthLabel(key),
      milestones: items.sort((a, b) => a.date.localeCompare(b.date)),
    }));
  }, [future]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !date) return;
    const milestone = writeMilestone(title, date);
    if (!milestone) return;
    writeTypes({ ...readTypes(), [milestone.id]: kind });
    setTitle("");
    setDate("");
    setKind("deadline");
  };

  const chooseKind = (nextKind: MilestoneKind) => {
    if (!editingId) return;
    const next = { ...readTypes(), [editingId]: nextKind };
    writeTypes(next);
    setTypes(next);
  };

  const timeline = host ? createPortal(
    <div className="df2-milestone-month-ui">
      <form className="df2-milestone-month-add" onSubmit={submit}>
        <input aria-label="Nový milník" placeholder="Nový milník" value={title} onChange={(event) => setTitle(event.target.value)} />
        <input aria-label="Datum milníku" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <select aria-label="Typ milníku" value={kind} onChange={(event) => setKind(event.target.value as MilestoneKind)}>
          <option value="deadline">Deadline</option>
          <option value="option">Možnost</option>
        </select>
        <button>Přidat</button>
      </form>

      <div className="df2-milestone-month-legend" aria-label="Typy milníků">
        <span><i className="deadline" /> Deadline — termín, který musíš stihnout</span>
        <span><i className="option" /> Možnost — jeden z možných termínů</span>
      </div>

      <div className="df2-milestone-month-groups">
        {groups.length === 0 && <div className="df2-milestone-month-empty">Žádné nadcházející milníky.</div>}
        {groups.map((group) => (
          <section className="df2-milestone-month-group" key={group.key} data-month={group.key}>
            <header>
              <strong>{group.label}</strong>
              <span>{group.milestones.length} {group.milestones.length === 1 ? "termín" : group.milestones.length <= 4 ? "termíny" : "termínů"}</span>
            </header>
            <div className="df2-milestone-month-timeline">
              {group.milestones.map((milestone, index) => {
                const previous = index > 0 ? group.milestones[index - 1] : null;
                const gapDays = previous ? Math.max(0, dayOfMonth(milestone.date) - dayOfMonth(previous.date)) : 0;
                const milestoneKind = types[milestone.id] ?? "deadline";
                const note = normalizedNote(milestone.note);
                return (
                  <div className="df2-milestone-month-entry" key={milestone.id}>
                    {gapDays > 0 && (
                      <div
                        className="df2-milestone-day-gap"
                        style={{ "--df2-gap-days": gapDays } as React.CSSProperties}
                        aria-label={`${gapDays} dní mezi termíny`}
                      >
                        {gapDays >= 4 && <span>{gapDays} dní</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      className={`df2-milestone-month-card ${milestoneKind}`}
                      data-milestone-id={milestone.id}
                      onClick={() => findNativeArticle(milestone.id, milestones)?.click()}
                    >
                      <div className="df2-milestone-month-main">
                        <div className="df2-milestone-month-titleline">
                          <span className={`df2-milestone-kind ${milestoneKind}`}>{milestoneKind === "deadline" ? "Deadline" : "Možnost"}</span>
                          <strong>{milestone.title}</strong>
                        </div>
                        {note && <small>{note}</small>}
                      </div>
                      <div className="df2-milestone-month-countdown">
                        <strong>{daysUntil(milestone.date)}</strong>
                        <span>dní</span>
                      </div>
                      <time>{longDate(milestone.date)}</time>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>,
    host,
  ) : null;

  const editor = editorHost && editingId ? createPortal(
    <label className="df2-milestone-kind-editor">
      <span>Typ termínu</span>
      <select value={types[editingId] ?? "deadline"} onChange={(event) => chooseKind(event.target.value as MilestoneKind)}>
        <option value="deadline">Deadline — musím stihnout</option>
        <option value="option">Možnost — jeden z termínů</option>
      </select>
    </label>,
    editorHost,
  ) : null;

  return <>{timeline}{editor}</>;
}
