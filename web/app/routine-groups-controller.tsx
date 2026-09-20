"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Routine = {
  id: string;
  title: string;
  duration: number;
  start?: string;
  category: string;
  frequency: "daily" | "weekly";
  weekdays?: number[];
  active: boolean;
  createdAt?: string;
};

type RoutineGroup = {
  key: string;
  title: string;
  routines: Routine[];
};

const STATE_KEY = "dayframe-v1";
const RETURN_TO_SETTINGS_KEY = "dayframe-return-to-settings";
const weekdayLabels: Record<number, string> = { 1: "Po", 2: "Út", 3: "St", 4: "Čt", 5: "Pá", 6: "So", 0: "Ne" };
const weekdayOptions = [
  { value: 1, label: "Po" },
  { value: 2, label: "Út" },
  { value: 3, label: "St" },
  { value: 4, label: "Čt" },
  { value: 5, label: "Pá" },
  { value: 6, label: "So" },
  { value: 0, label: "Ne" },
];

function readRoutines(): Routine[] {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { routines?: unknown };
    if (!Array.isArray(parsed.routines)) return [];
    return parsed.routines.filter((item): item is Routine => Boolean(
      item
      && typeof item === "object"
      && typeof (item as Routine).id === "string"
      && typeof (item as Routine).title === "string"
      && typeof (item as Routine).duration === "number"
      && ((item as Routine).frequency === "daily" || (item as Routine).frequency === "weekly"),
    ));
  } catch {
    return [];
  }
}

function weekdayOrder(routine: Routine) {
  if (routine.frequency === "daily") return -1;
  const day = routine.weekdays?.[0] ?? 7;
  return day === 0 ? 7 : day;
}

function routineSortValue(routine: Routine) {
  const [hours = 0, minutes = 0] = (routine.start ?? "00:00").split(":").map(Number);
  return weekdayOrder(routine) * 24 * 60 + hours * 60 + minutes;
}

function sortedWeekdays(days: number[]) {
  return [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

function slotLabel(routine: Routine) {
  if (routine.frequency === "daily") return `Denně ${routine.start ?? ""} · ${routine.duration} min`.trim();
  const days = sortedWeekdays(routine.weekdays ?? []).map((day) => weekdayLabels[day]).filter(Boolean).join(", ");
  return `${days || "Týdně"} ${routine.start ?? ""} · ${routine.duration} min`.trim();
}

function groupRoutines(routines: Routine[]) {
  const byTitle = new Map<string, RoutineGroup>();
  routines.forEach((routine) => {
    const key = routine.title.trim().toLocaleLowerCase("cs-CZ");
    const group = byTitle.get(key);
    if (group) group.routines.push(routine);
    else byTitle.set(key, { key, title: routine.title, routines: [routine] });
  });

  return [...byTitle.values()]
    .map((group) => ({ ...group, routines: [...group.routines].sort((a, b) => routineSortValue(a) - routineSortValue(b)) }))
    .sort((a, b) => routineSortValue(a.routines[0]) - routineSortValue(b.routines[0]));
}

function originalArticleFor(id: string) {
  return [...document.querySelectorAll<HTMLElement>(".df2-routines > article")]
    .find((article) => article.dataset.routineId === id) ?? null;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function persistRoutineEdit(routineId: string, patch: Partial<Routine>) {
  const raw = window.localStorage.getItem(STATE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as {
      routines?: Routine[];
      plans?: Record<string, Array<Record<string, unknown>>>;
    };
    if (!Array.isArray(parsed.routines)) return false;

    parsed.routines = parsed.routines.map((routine) => routine.id === routineId ? { ...routine, ...patch } : routine);

    // Regenerate only future, unfinished instances of the edited routine on reload.
    // Completed/past blocks remain untouched as historical truth.
    const today = localDateKey(new Date());
    if (parsed.plans && typeof parsed.plans === "object") {
      Object.entries(parsed.plans).forEach(([date, tasks]) => {
        if (date < today || !Array.isArray(tasks)) return;
        parsed.plans![date] = tasks.filter((task) => !(
          task.source === "routine"
          && task.routineId === routineId
          && task.completed !== true
        ));
      });
    }

    window.localStorage.setItem(STATE_KEY, JSON.stringify(parsed));
    window.sessionStorage.setItem(RETURN_TO_SETTINGS_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function RoutineGroupsController() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [editingFrequency, setEditingFrequency] = useState<"daily" | "weekly">("weekly");
  const [formError, setFormError] = useState("");
  const signatureRef = useRef("");

  useEffect(() => {
    if (window.sessionStorage.getItem(RETURN_TO_SETTINGS_KEY) === "1") {
      const settingsButton = [...document.querySelectorAll<HTMLButtonElement>(".df2-sidebar nav button")]
        .find((button) => button.textContent?.includes("Nastavení"));
      if (settingsButton) {
        window.sessionStorage.removeItem(RETURN_TO_SETTINGS_KEY);
        settingsButton.click();
      }
    }

    const sync = () => {
      const section = document.querySelector<HTMLElement>(".df2-routines");
      if (!section) {
        setHost(null);
        return;
      }

      section.classList.add("df2-routines-grouped");
      let nextHost = section.querySelector<HTMLElement>("[data-routine-groups-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.routineGroupsHost = "true";
        nextHost.className = "df2-routine-groups-host";
        const heading = section.querySelector(":scope > .df2-section-head");
        heading?.insertAdjacentElement("afterend", nextHost);
      }
      setHost((current) => current === nextHost ? current : nextHost);

      const currentRoutines = readRoutines();
      const articles = [...section.querySelectorAll<HTMLElement>(":scope > article")];
      articles.forEach((article, index) => {
        const routine = currentRoutines[index];
        if (routine) article.dataset.routineId = routine.id;
      });

      const signature = JSON.stringify(currentRoutines.map(({ id, title, duration, start, category, frequency, weekdays, active }) => (
        [id, title, duration, start, category, frequency, weekdays, active]
      )));
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setRoutines(currentRoutines);
      }
    };

    sync();
    const timer = window.setInterval(sync, 180);
    return () => window.clearInterval(timer);
  }, []);

  const groups = useMemo(() => groupRoutines(routines), [routines]);

  useEffect(() => {
    if (openGroup && !groups.some((group) => group.key === openGroup)) setOpenGroup(null);
  }, [groups, openGroup]);

  if (!host) return null;

  function toggleRoutine(routine: Routine) {
    const input = originalArticleFor(routine.id)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    input?.click();
  }

  function deleteRoutine(routine: Routine) {
    const button = originalArticleFor(routine.id)?.querySelector<HTMLButtonElement>("button");
    button?.click();
    if (editingRoutine?.id === routine.id) setEditingRoutine(null);
  }

  function openEditor(routine: Routine) {
    setFormError("");
    setEditingFrequency(routine.frequency);
    setEditingRoutine(routine);
  }

  function saveRoutine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRoutine) return;

    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const start = String(form.get("start") ?? "");
    const duration = Math.max(15, Number(form.get("duration")) || editingRoutine.duration);
    const category = String(form.get("category") ?? "").trim() || editingRoutine.category;
    const frequency = String(form.get("frequency")) === "daily" ? "daily" : "weekly";
    const weekdays = form.getAll("weekday").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const active = form.get("active") === "on";

    if (!title || !start) {
      setFormError("Vyplň název a čas.");
      return;
    }
    if (frequency === "weekly" && weekdays.length === 0) {
      setFormError("Vyber alespoň jeden den.");
      return;
    }

    const saved = persistRoutineEdit(editingRoutine.id, {
      title,
      start,
      duration,
      category,
      frequency,
      weekdays: frequency === "weekly" ? sortedWeekdays(weekdays) : undefined,
      active,
    });

    if (!saved) {
      setFormError("Rutinu se nepodařilo uložit.");
      return;
    }

    window.location.reload();
  }

  const groupPortal = createPortal(
    <div className="df2-routine-groups" aria-label="Opakující se rutiny">
      {groups.map((group) => {
        const open = openGroup === group.key;
        return (
          <section className={`df2-routine-group${open ? " open" : ""}`} key={group.key}>
            <button
              type="button"
              className="df2-routine-group-summary"
              aria-expanded={open}
              onClick={() => setOpenGroup(open ? null : group.key)}
            >
              <strong>{group.title}</strong>
              <span className="df2-routine-slots">
                {group.routines.map((routine) => (
                  <span className={`df2-routine-slot${routine.active ? "" : " off"}`} key={routine.id}>{slotLabel(routine)}</span>
                ))}
              </span>
              <span className="df2-routine-chevron" aria-hidden="true">⌄</span>
            </button>

            {open && (
              <div className="df2-routine-group-detail">
                {group.routines.map((routine) => (
                  <div className="df2-routine-occurrence" key={routine.id}>
                    <span>{slotLabel(routine)}</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={routine.active}
                        onChange={() => toggleRoutine(routine)}
                        aria-label={`${group.title} ${slotLabel(routine)} aktivní`}
                      />
                      aktivní
                    </label>
                    <button className="edit" type="button" onClick={() => openEditor(routine)}>Upravit</button>
                    <button className="delete" type="button" onClick={() => deleteRoutine(routine)}>Smazat</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>,
    host,
  );

  const editorPortal = editingRoutine ? createPortal(
    <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingRoutine(null); }}>
      <form className="df2-modal df2-routine-editor" onSubmit={saveRoutine}>
        <header>
          <div><h2>Upravit rutinu</h2></div>
          <button type="button" onClick={() => setEditingRoutine(null)}>×</button>
        </header>

        <label>Název<input name="title" autoFocus defaultValue={editingRoutine.title} /></label>

        <div className="df2-form-grid">
          <label>Opakování
            <select name="frequency" value={editingFrequency} onChange={(event) => setEditingFrequency(event.target.value as "daily" | "weekly")}>
              <option value="weekly">Každý týden</option>
              <option value="daily">Každý den</option>
            </select>
          </label>
          <label>Čas<input name="start" type="time" defaultValue={editingRoutine.start ?? ""} /></label>
        </div>

        {editingFrequency === "weekly" && (
          <fieldset className="df2-routine-editor-days">
            <legend>Dny</legend>
            <div>
              {weekdayOptions.map((day) => (
                <label key={day.value}>
                  <input
                    type="checkbox"
                    name="weekday"
                    value={day.value}
                    defaultChecked={(editingRoutine.weekdays ?? []).includes(day.value)}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="df2-form-grid">
          <label>Délka<input name="duration" type="number" min="15" max="480" step="5" defaultValue={editingRoutine.duration} /></label>
          <label>Oblast<input name="category" defaultValue={editingRoutine.category} /></label>
        </div>

        <label className="df2-routine-editor-active">
          <input name="active" type="checkbox" defaultChecked={editingRoutine.active} />
          Aktivní
        </label>

        {formError && <p className="df2-error">{formError}</p>}

        <div className="df2-modal-actions">
          <button className="df2-primary" type="submit">Uložit změny</button>
          <button type="button" onClick={() => setEditingRoutine(null)}>Zrušit</button>
          <button type="button" className="danger" onClick={() => deleteRoutine(editingRoutine)}>Smazat rutinu</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return <>{groupPortal}{editorPortal}</>;
}
