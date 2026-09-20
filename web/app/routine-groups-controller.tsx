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
};

type RoutineGroup = {
  key: string;
  title: string;
  routines: Routine[];
};

const STATE_KEY = "dayframe-v1";
const weekdayLabels: Record<number, string> = { 1: "Po", 2: "Út", 3: "St", 4: "Čt", 5: "Pá", 6: "So", 0: "Ne" };

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

function slotLabel(routine: Routine) {
  if (routine.frequency === "daily") return `Denně ${routine.start ?? ""} · ${routine.duration} min`.trim();
  const day = weekdayLabels[routine.weekdays?.[0] ?? 1] ?? "";
  return `${day} ${routine.start ?? ""} · ${routine.duration} min`.trim();
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

export function RoutineGroupsController() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const signatureRef = useRef("");

  useEffect(() => {
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

      const signature = JSON.stringify(currentRoutines.map(({ id, title, duration, start, frequency, weekdays, active }) => (
        [id, title, duration, start, frequency, weekdays, active]
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
  }

  return createPortal(
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
                    <button type="button" onClick={() => deleteRoutine(routine)}>Smazat</button>
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
}
