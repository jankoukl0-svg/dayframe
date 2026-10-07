"use client";

import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { planningDateKey } from "@/lib/dayframe-calendar";

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

const STORAGE_KEY = "dayframe-daily-checklist-v1";
const SYNC_EVENT = "dayframe-daily-checklist-sync";
const CORRUPT_STORAGE_ERROR = "Checklist má poškozená uložená data. Ukládání je pro ochranu původních dat vypnuté.";
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
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { store: emptyStore(), blocked: false };

  try {
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

export function DailyChecklist() {
  const [store, setStore] = useState<ChecklistStore>(() => emptyStore());
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("daily");
  const [draftDays, setDraftDays] = useState<number[]>([...ALL_DAYS]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);

  const planningKey = planningDateKey(now);
  const weekday = weekdayForPlanningDate(planningKey);
  const visibleItems = useMemo(
    () => store.items.filter((item) => item.days.includes(weekday)),
    [store.items, weekday],
  );
  const completedIds = new Set(store.completedByDate[planningKey] ?? []);
  const completedCount = visibleItems.filter((item) => completedIds.has(item.id)).length;

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
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modalOpen]);

  const persist = (nextStore: ChecklistStore) => {
    if (storageBlocked) {
      setStorageError(CORRUPT_STORAGE_ERROR);
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
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    persist({
      ...store,
      completedByDate: { ...store.completedByDate, [planningKey]: next },
    });
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

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (draggingId) reorder(draggingId, targetId);
    setDraggingId(null);
  };

  return (
    <>
      <section className="df2-daily-checklist" data-daily-checklist aria-label="Denní checklist">
        <header className="df2-checklist-head">
          <div>
            <h2>Denní checklist</h2>
            <span data-checklist-progress aria-label={completedCount + " z " + visibleItems.length + " hotovo"}>
              {completedCount}/{visibleItems.length}
            </span>
          </div>
          <button type="button" onClick={openNew} disabled={!hydrated || storageBlocked}>+ Přidat položku</button>
        </header>

        {visibleItems.length ? (
          <div className="df2-checklist-list">
            {visibleItems.map((item) => {
              const done = completedIds.has(item.id);
              return (
                <article
                  key={item.id}
                  data-checklist-id={item.id}
                  className={done ? "done" : ""}
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
                    <span aria-hidden="true">{done ? "✓" : ""}</span>
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
            {store.items.length ? "Na dnešek tu nic není." : "Přidej malé věci, které chceš každý den jen odškrtnout."}
          </div>
        )}
        {(storageBlocked || storageError) && (
          <p className="df2-checklist-error">{storageBlocked ? CORRUPT_STORAGE_ERROR : storageError}</p>
        )}
      </section>

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
