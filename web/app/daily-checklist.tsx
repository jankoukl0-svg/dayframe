"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { planningDateKey } from "@/lib/dayframe-calendar";
import { assignmentsOnDate } from "@/lib/dayframe-gym";
import { supplementOccurrences } from "@/lib/dayframe-supplements";
import { useSupplementStore } from "./use-supplement-store";
import { useGymStore } from "./use-gym-store";
import {
  HYGIENE_STORAGE_KEY,
  HYGIENE_SYNC_EVENT,
  loadHygieneStore,
  routineDomain,
  scheduledRoutineSummaries,
} from "@/lib/dayframe-hygiene";

type ChecklistItem = {
  id: string;
  title: string;
  days: number[];
};

type ChecklistStore = {
  version: 1;
  items: ChecklistItem[];
  completedByDate: Record<string, string[]>;
};

type RepeatMode = "daily" | "weekdays" | "custom";

type DailyChecklistSummary = {
  planningKey: string;
  completed: number;
  total: number;
  hydrated: boolean;
  blocked: boolean;
};

const STORAGE_KEY = "dayframe-daily-checklist-v1";
const SYNC_EVENT = "dayframe-daily-checklist-sync";
const STORAGE_READ_ERROR = "Checklist data nelze bezpečně načíst. Ukládání je pro ochranu původních dat vypnuté.";
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_LABELS: Record<number, string> = {
  1: "Po",
  2: "Út",
  3: "St",
  4: "Čt",
  5: "Pá",
  6: "So",
  0: "Ne",
};

function emptyStore(): ChecklistStore {
  return { version: 1, items: [], completedByDate: {} };
}

function normalizeDays(value: unknown) {
  if (!Array.isArray(value)) return [...ALL_DAYS];
  const valid = new Set(value.filter((day): day is number => Number.isInteger(day) && ALL_DAYS.includes(day as number)));
  const sorted = ALL_DAYS.filter((day) => valid.has(day));
  return sorted.length ? sorted : [...ALL_DAYS];
}

function readStore(): { store: ChecklistStore; blocked: boolean } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { store: emptyStore(), blocked: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { store: emptyStore(), blocked: true };
    }

    const candidate = parsed as Partial<ChecklistStore>;
    if (
      candidate.version !== 1
      || !Array.isArray(candidate.items)
      || !candidate.completedByDate
      || typeof candidate.completedByDate !== "object"
      || Array.isArray(candidate.completedByDate)
    ) {
      return { store: emptyStore(), blocked: true };
    }

    const items: ChecklistItem[] = [];
    const seenIds = new Set<string>();
    for (const item of candidate.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { store: emptyStore(), blocked: true };
      }
      const value = item as Partial<ChecklistItem>;
      const cleanTitle = typeof value.title === "string" ? value.title.trim() : "";
      const days = value.days;
      if (
        typeof value.id !== "string"
        || !value.id
        || seenIds.has(value.id)
        || !cleanTitle
        || !Array.isArray(days)
        || !days.length
        || days.some((day) => !Number.isInteger(day) || !ALL_DAYS.includes(day))
        || new Set(days).size !== days.length
      ) {
        return { store: emptyStore(), blocked: true };
      }
      seenIds.add(value.id);
      items.push({
        id: value.id,
        title: cleanTitle,
        days: ALL_DAYS.filter((day) => days.includes(day)),
      });
    }

    const completedByDate: Record<string, string[]> = {};
    for (const [date, ids] of Object.entries(candidate.completedByDate)) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return { store: emptyStore(), blocked: true };
      }
      completedByDate[date] = [...new Set(ids)];
    }

    return { store: { version: 1, items, completedByDate }, blocked: false };
  } catch {
    return { store: emptyStore(), blocked: true };
  }
}

function compactStore(store: ChecklistStore): ChecklistStore {
  const validIds = new Set(store.items.map((item) => item.id));
  const recentDates = Object.keys(store.completedByDate).sort().slice(-45);
  const completedByDate = Object.fromEntries(
    recentDates
      .map((date) => [date, [...new Set(store.completedByDate[date] ?? [])].filter((id) => validIds.has(id))])
      .filter(([, ids]) => (ids as string[]).length),
  ) as Record<string, string[]>;

  return { version: 1, items: store.items, completedByDate };
}

function sameDays(left: number[], right: number[]) {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function modeForDays(days: number[]): RepeatMode {
  if (sameDays(days, ALL_DAYS)) return "daily";
  if (sameDays(days, WEEKDAYS)) return "weekdays";
  return "custom";
}

function cadenceLabel(days: number[]) {
  if (sameDays(days, ALL_DAYS)) return "Každý den";
  if (sameDays(days, WEEKDAYS)) return "Po–Pá";
  return ALL_DAYS.filter((day) => days.includes(day)).map((day) => DAY_LABELS[day]).join(" · ");
}

function weekdayForPlanningDate(key: string) {
  return new Date(key + "T12:00:00").getDay();
}

export function DailyChecklist({
  onSummaryChange,
  planningKey: externalPlanningKey,
  onOpenHygiene,
  onOpenHealth,
  onOpenGym,
  onOpenSupplements,
}: {
  onSummaryChange?: (summary: DailyChecklistSummary) => void;
  planningKey?: string;
  onOpenHygiene?: (routineId: string) => void;
  onOpenHealth?: (routineId: string) => void;
  onOpenGym?: (key: string, date: string) => void;
  onOpenSupplements?:()=>void;
} = {}) {
  const [store, setStore] = useState<ChecklistStore>(() => emptyStore());
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("daily");
  const [draftDays, setDraftDays] = useState<number[]>([...ALL_DAYS]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [recentlyCompletedId, setRecentlyCompletedId] = useState<string | null>(null);
  const [hygieneItems, setHygieneItems] = useState<Array<{ id: string; title: string; handled: number; total: number; complete: boolean }>>([]);
  const [healthItems, setHealthItems] = useState<Array<{ id: string; title: string; handled: number; total: number; complete: boolean }>>([]);
  const [hygieneHydrated, setHygieneHydrated] = useState(false);
  const gym=useGymStore();
  const supplements=useSupplementStore();
  const [hygieneBlocked, setHygieneBlocked] = useState(false);
  const completionFeedbackTimer = useRef<number | null>(null);

  const planningKey = externalPlanningKey ?? planningDateKey(now);
  const weekday = weekdayForPlanningDate(planningKey);
  const visibleItems = useMemo(
    () => store.items.filter((item) => item.days.includes(weekday)),
    [store.items, weekday],
  );
  const completedIds = new Set(store.completedByDate[planningKey] ?? []);
  const completedCount = visibleItems.filter((item) => completedIds.has(item.id)).length;
  const hygieneCompletedCount = hygieneItems.filter((item) => item.complete).length;
  const healthCompletedCount = healthItems.filter((item) => item.complete).length;
  const gymItems = useMemo(()=>assignmentsOnDate(gym.store,planningKey),[gym.store,planningKey]);
  const gymCompletedCount = gymItems.filter(x=>x.completed).length;
  const supplementItems=useMemo(()=>supplementOccurrences(supplements.store,planningKey),[supplements.store,planningKey]);
  const supplementCompletedCount=supplementItems.filter(x=>!!x.intake).length;
  const totalVisibleCount = visibleItems.length + hygieneItems.length + healthItems.length + gymItems.length + supplementItems.length;
  const totalCompletedCount = completedCount + hygieneCompletedCount + healthCompletedCount + gymCompletedCount + supplementCompletedCount;
  const allDone = totalVisibleCount > 0 && totalCompletedCount === totalVisibleCount;
  const progressPercent = totalVisibleCount ? (totalCompletedCount / totalVisibleCount) * 100 : 0;

  useEffect(() => {
    const sync = () => {
      const result = readStore();
      setStore(result.store);
      setStorageBlocked(result.blocked);
    };
    sync();
    setHydrated(true);
    window.addEventListener("storage", sync);
    window.addEventListener(SYNC_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SYNC_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (externalPlanningKey) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [externalPlanningKey]);

  useEffect(() => {
    const syncHygiene = () => {
      const result = loadHygieneStore(planningKey);
      const summaries = result.blocked ? [] : scheduledRoutineSummaries(result.store, planningKey, planningKey);
      const summaryItem = (summary: typeof summaries[number]) => ({
        id: summary.routine.id,
        title: summary.routine.title,
        handled: summary.handled,
        total: summary.total,
        complete: summary.status === "complete" || summary.status === "skipped",
      });
      setHygieneItems(summaries.filter((summary) => routineDomain(summary.routine) === "hygiene").map(summaryItem));
      setHealthItems(summaries.filter((summary) => routineDomain(summary.routine) === "health").map(summaryItem));
      setHygieneBlocked(result.blocked);
      setHygieneHydrated(true);
    };
    syncHygiene();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HYGIENE_STORAGE_KEY) syncHygiene();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(HYGIENE_SYNC_EVENT, syncHygiene);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HYGIENE_SYNC_EVENT, syncHygiene);
    };
  }, [planningKey]);

  useEffect(() => {
    onSummaryChange?.({
      planningKey,
      completed: totalCompletedCount,
      total: totalVisibleCount,
      hydrated: hydrated && hygieneHydrated && gym.hydrated && supplements.hydrated,
      blocked: storageBlocked || hygieneBlocked || gym.blocked || supplements.blocked,
    });
  }, [planningKey, totalCompletedCount, totalVisibleCount, hydrated, hygieneHydrated, storageBlocked, hygieneBlocked, gym.hydrated, gym.blocked, supplements.hydrated, supplements.blocked, onSummaryChange]);

  useEffect(() => () => {
    if (completionFeedbackTimer.current) window.clearTimeout(completionFeedbackTimer.current);
  }, []);

  useEffect(() => {
    if (!modalOpen && !manageOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modalOpen) setModalOpen(false);
      else setManageOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modalOpen, manageOpen]);

  const persist = (nextStore: ChecklistStore) => {
    if (storageBlocked) {
      setStorageError(STORAGE_READ_ERROR);
      return false;
    }
    const compact = compactStore(nextStore);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      setStorageError("");
      setStore(compact);
      window.dispatchEvent(new Event(SYNC_EVENT));
      return true;
    } catch {
      setStorageError("Checklist se nepodařilo uložit.");
      return false;
    }
  };

  const openNew = () => {
    setEditingId(null);
    setTitle("");
    setRepeatMode("daily");
    setDraftDays([...ALL_DAYS]);
    setStorageError("");
    setModalOpen(true);
  };

  const openEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setRepeatMode(modeForDays(item.days));
    setDraftDays([...item.days]);
    setStorageError("");
    setModalOpen(true);
  };

  const chooseMode = (mode: RepeatMode) => {
    setRepeatMode(mode);
    if (mode === "daily") setDraftDays([...ALL_DAYS]);
    if (mode === "weekdays") setDraftDays([...WEEKDAYS]);
    if (mode === "custom" && (sameDays(draftDays, ALL_DAYS) || sameDays(draftDays, WEEKDAYS))) {
      setDraftDays([weekday]);
    }
  };

  const toggleDraftDay = (day: number) => {
    setDraftDays((current) => current.includes(day)
      ? current.filter((item) => item !== day)
      : ALL_DAYS.filter((item) => item === day || current.includes(item)));
  };

  const saveItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || !draftDays.length) return;

    const saved = editingId
      ? persist({
        ...store,
        items: store.items.map((item) => item.id === editingId
          ? { ...item, title: cleanTitle, days: [...draftDays] }
          : item),
      })
      : persist({
        ...store,
        items: [
          ...store.items,
          {
            id: "daily-checklist-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            title: cleanTitle,
            days: [...draftDays],
          },
        ],
      });
    if (saved) setModalOpen(false);
  };

  const removeItem = () => {
    if (!editingId) return;
    const nextItems = store.items.filter((item) => item.id !== editingId);
    const nextCompleted = Object.fromEntries(
      Object.entries(store.completedByDate)
        .map(([date, ids]) => [date, ids.filter((id) => id !== editingId)])
        .filter(([, ids]) => (ids as string[]).length),
    ) as Record<string, string[]>;
    if (persist({ ...store, items: nextItems, completedByDate: nextCompleted })) setModalOpen(false);
  };

  const toggleComplete = (id: string) => {
    const current = store.completedByDate[planningKey] ?? [];
    const wasDone = current.includes(id);
    const next = wasDone ? current.filter((item) => item !== id) : [...current, id];
    const saved = persist({
      ...store,
      completedByDate: { ...store.completedByDate, [planningKey]: next },
    });

    if (!saved) return;
    if (completionFeedbackTimer.current) window.clearTimeout(completionFeedbackTimer.current);
    if (wasDone) {
      setRecentlyCompletedId(null);
      return;
    }

    setRecentlyCompletedId(id);
    completionFeedbackTimer.current = window.setTimeout(() => setRecentlyCompletedId(null), 900);
  };

  const reorder = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const from = store.items.findIndex((item) => item.id === draggedId);
    const target = store.items.findIndex((item) => item.id === targetId);
    if (from < 0 || target < 0) return;
    const items = [...store.items];
    const moved = items.splice(from, 1)[0];
    items.splice(target, 0, moved);
    persist({ ...store, items });
  };

  const moveBy = (id: string, direction: -1 | 1) => {
    const from = visibleItems.findIndex((item) => item.id === id);
    const target = from + direction;
    if (from < 0 || target < 0 || target >= visibleItems.length) return;
    reorder(id, visibleItems[target].id);
  };

  const moveStoredBy = (id: string, direction: -1 | 1) => {
    const from = store.items.findIndex((item) => item.id === id);
    const target = from + direction;
    if (from < 0 || target < 0 || target >= store.items.length) return;
    reorder(id, store.items[target].id);
  };

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (draggingId) reorder(draggingId, targetId);
    setDraggingId(null);
  };

  return (
    <>
      <section className={`df2-daily-checklist ${allDone ? "is-complete" : ""}`} data-daily-checklist aria-label="Denní checklist">
        <header className="df2-checklist-head">
          <div>
            <h2>Denní checklist</h2>
            <span data-checklist-progress aria-label={totalCompletedCount + " z " + totalVisibleCount + " hotovo"}>
              {totalCompletedCount}/{totalVisibleCount}
            </span>
          </div>
          <button
            type="button"
            className="df2-checklist-manage"
            onClick={() => setManageOpen(true)}
            disabled={!hydrated || storageBlocked || !store.items.length}
          >
            Spravovat
          </button>
          <button type="button" onClick={openNew} disabled={!hydrated || storageBlocked}>+ Přidat položku</button>
        </header>

        <div
          className="df2-checklist-progress-track"
          role="progressbar"
          aria-label="Dokončené položky checklistu"
          aria-valuemin={0}
          aria-valuemax={totalVisibleCount}
          aria-valuenow={totalCompletedCount}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>

        {totalVisibleCount ? (
          <div className="df2-checklist-list">
            {hygieneItems.map((item) => (
              <article
                key={"hygiene-" + item.id}
                data-hygiene-checklist-routine={item.id}
                className={"df2-checklist-hygiene-row " + (item.complete ? "done" : "")}
              >
                <span className={"df2-checklist-hygiene-indicator " + (item.complete ? "is-done" : "")} aria-hidden="true">
                  {item.complete ? "✓" : ""}
                </span>
                <button
                  type="button"
                  className="df2-checklist-copy df2-checklist-hygiene-copy"
                  onClick={() => onOpenHygiene?.(item.id)}
                  aria-label={"Otevřít " + item.title + " v Hygieně"}
                >
                  <strong>{item.title}</strong>
                  <small>{item.complete ? "Hotovo" : item.handled + "/" + item.total + " · otevřít detail"}</small>
                </button>
                <span className="df2-checklist-hygiene-link" aria-hidden="true">→</span>
              </article>
            ))}
            {healthItems.map((item) => (
              <article key={"health-" + item.id} data-health-checklist-routine={item.id}
                className={"df2-checklist-hygiene-row " + (item.complete ? "done" : "")}>
                <span className={"df2-checklist-hygiene-indicator " + (item.complete ? "is-done" : "")} aria-hidden="true">
                  {item.complete ? "✓" : ""}
                </span>
                <button type="button" className="df2-checklist-copy df2-checklist-hygiene-copy"
                  onClick={() => onOpenHealth?.(item.id)}
                  aria-label={"Otevřít " + item.title + " ve Zdraví"}>
                  <strong>{item.title}</strong>
                  <small>{item.complete ? "Hotovo" : item.handled + "/" + item.total + " · Zdraví"}</small>
                </button>
                <span className="df2-checklist-hygiene-link" aria-hidden="true">→</span>
              </article>
            ))}
            {gymItems.map((item) => (
              <article key={"gym-"+item.key} data-gym-checklist={item.key}
                className={"df2-checklist-hygiene-row "+(item.completed?"done":"")}>
                <span className={"df2-checklist-hygiene-indicator "+(item.completed?"is-done":"")} aria-hidden="true">{item.completed?"✓":""}</span>
                <button type="button" className="df2-checklist-copy df2-checklist-hygiene-copy"
                  onClick={()=>onOpenGym?.(item.key,planningKey)} aria-label={"Otevřít trénink "+item.name+" ve Zdraví"}>
                  <strong>Gym – {item.name}</strong><small>{item.completed?"Hotovo":item.session?"Rozpracováno":"Plánováno · otevřít trénink"}</small>
                </button>
                <span className="df2-checklist-hygiene-link" aria-hidden="true">→</span>
              </article>
            ))}
            {supplementItems.map((item)=>(
              <article key={"supp-"+item.key} data-supplement-checklist={item.key}
                className={"df2-checklist-hygiene-row "+(item.intake?"done":"")}>
                <span className={"df2-checklist-hygiene-indicator "+(item.intake?"is-done":"")} aria-hidden="true">{item.intake?"✓":""}</span>
                <button type="button" className="df2-checklist-copy df2-checklist-hygiene-copy"
                  aria-label={"Otevřít suplement "+item.supplement.name+" ve Zdraví"} onClick={onOpenSupplements}>
                  <strong>{item.time} · {item.supplement.name}</strong>
                  <small>{item.intake?.status==="taken"?"Užito":item.intake?.status==="skipped"?"Vynecháno":"Čeká · Suplementy"}</small>
                </button><span className="df2-checklist-hygiene-link" aria-hidden="true">→</span>
              </article>
            ))}
            {visibleItems.map((item) => {
              const done = completedIds.has(item.id);
              return (
                <article
                  key={item.id}
                  data-checklist-id={item.id}
                  className={`${done ? "done" : ""} ${recentlyCompletedId === item.id ? "just-completed" : ""}`.trim()}
                  draggable
                  onDragStart={() => setDraggingId(item.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDrop(event, item.id)}
                >
                  <button
                    type="button"
                    className="df2-checklist-check"
                    aria-label={done ? "Vrátit " + item.title + " jako nesplněné" : "Označit " + item.title + " jako hotovo"}
                    aria-pressed={done}
                    onClick={() => toggleComplete(item.id)}
                  >
                    <span className="df2-checkmark" aria-hidden="true">{done ? "✓" : ""}</span>
                  </button>
                  <button type="button" className="df2-checklist-copy" onClick={() => openEdit(item)}>
                    <strong>{item.title}</strong>
                    <small>{cadenceLabel(item.days)}</small>
                  </button>
                  <button
                    type="button"
                    className="df2-checklist-drag"
                    aria-label={"Přesunout " + item.title}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    title="Přetáhnout nebo použít šipky nahoru/dolů"
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        moveBy(item.id, -1);
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        moveBy(item.id, 1);
                      }
                    }}
                  >
                    ⋮⋮
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="df2-checklist-empty">
            {store.items.length || hygieneItems.length || healthItems.length || gymItems.length || supplementItems.length ? "Na dnešek tu nic není." : "Přidej malé věci, které chceš každý den jen odškrtnout."}
          </div>
        )}
        {allDone && <div className="df2-checklist-complete-note" aria-live="polite">✓ Dnešní checklist hotový</div>}
        {(storageBlocked || storageError || hygieneBlocked || gym.blocked || supplements.blocked) && (
          <p className="df2-checklist-error">
            {storageBlocked ? STORAGE_READ_ERROR : hygieneBlocked ? "Hygienické rutiny nelze bezpečně načíst." : gym.blocked ? "Tréninková data nelze bezpečně načíst." : supplements.blocked ? "Data suplementů nelze bezpečně načíst." : storageError}
          </p>
        )}
      </section>

      {manageOpen && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}>
          <section
            className="df2-modal df2-checklist-manage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="df2-checklist-manage-title"
          >
            <header>
              <div><h2 id="df2-checklist-manage-title">Správa checklistu</h2></div>
              <button type="button" aria-label="Zavřít správu checklistu" onClick={() => setManageOpen(false)}>×</button>
            </header>

            <div className="df2-checklist-manage-list">
              {store.items.map((item, index) => (
                <div className="df2-checklist-manage-row" key={item.id}>
                  <button
                    type="button"
                    className="df2-checklist-manage-copy"
                    onClick={() => {
                      setManageOpen(false);
                      openEdit(item);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <small>{cadenceLabel(item.days)}</small>
                  </button>
                  <button
                    type="button"
                    aria-label={"Posunout " + item.title + " nahoru"}
                    disabled={index === 0}
                    onClick={() => moveStoredBy(item.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={"Posunout " + item.title + " dolů"}
                    disabled={index === store.items.length - 1}
                    onClick={() => moveStoredBy(item.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {modalOpen && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
          <form className="df2-modal df2-checklist-modal" onSubmit={saveItem}>
            <header>
              <div><h2>{editingId ? "Upravit položku" : "Přidat do checklistu"}</h2></div>
              <button type="button" aria-label="Zavřít checklist" onClick={() => setModalOpen(false)}>×</button>
            </header>

            <label>
              Název
              <input
                name="title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Např. 20 min čtení"
              />
            </label>

            <div className="df2-checklist-repeat" role="group" aria-label="Opakování">
              <button type="button" aria-pressed={repeatMode === "daily"} onClick={() => chooseMode("daily")}>Každý den</button>
              <button type="button" aria-pressed={repeatMode === "weekdays"} onClick={() => chooseMode("weekdays")}>Po–Pá</button>
              <button type="button" aria-pressed={repeatMode === "custom"} onClick={() => chooseMode("custom")}>Vlastní</button>
            </div>

            {repeatMode === "custom" && (
              <div className="df2-checklist-days" role="group" aria-label="Dny checklistu">
                {ALL_DAYS.map((day) => (
                  <button
                    type="button"
                    key={day}
                    aria-pressed={draftDays.includes(day)}
                    onClick={() => toggleDraftDay(day)}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            )}

            {!draftDays.length && <p className="df2-checklist-error">Vyber alespoň jeden den.</p>}
            {storageError && <p className="df2-checklist-error">{storageError}</p>}

            <div className="df2-modal-actions">
              <button className="df2-primary" disabled={!title.trim() || !draftDays.length}>
                {editingId ? "Uložit změny" : "Přidat položku"}
              </button>
              {editingId && <button type="button" className="danger" onClick={removeItem}>Smazat položku</button>}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
