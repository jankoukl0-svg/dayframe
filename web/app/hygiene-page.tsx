"use client";

import { useEffect, useMemo, useState } from "react";
import { addDaysKey, dateFromKey } from "@/lib/dayframe-calendar";
import { HygieneProducts, ProductPhoto } from "./hygiene-products";
import { CompactRoutineProductGuide, HygieneTaskTimer, ProductCareGuide } from "./hygiene-care-guide";
import {
  HYGIENE_STORAGE_KEY,
  HYGIENE_SYNC_EVENT,
  createDefaultHygieneStore,
  createRoutineId,
  createTaskId,
  historyStatusForDate,
  loadHygieneStore,
  overallHygieneProgress,
  overdueHygieneTasks,
  planManualHygieneTask,
  postponeHygieneTask,
  refreshHygieneToday,
  routineScheduledOnDate,
  routineStats,
  saveHygieneStore,
  scheduleLabel,
  scheduledRoutineSummaries,
  setHygieneTaskStatus,
  toggleManualRoutine,
  type HygieneRoutineDefinition,
  type HygieneProductSnapshot,
  type HygieneSchedule,
  type HygieneStore,
  type HygieneTaskDefinition,
} from "@/lib/dayframe-hygiene";

type HygieneTab = "today" | "history" | "manage" | "products";

const WEEKDAYS = [
  { value: 1, label: "Po" },
  { value: 2, label: "Út" },
  { value: 3, label: "St" },
  { value: 4, label: "Čt" },
  { value: 5, label: "Pá" },
  { value: 6, label: "So" },
  { value: 0, label: "Ne" },
];

function longDate(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dateFromKey(key));
}

function shortDay(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric" }).format(dateFromKey(key)).replace(".", "");
}

function statusLabel(status: string) {
  if (status === "complete") return "Splněno";
  if (status === "partial") return "Částečně";
  if (status === "missed") return "Nesplněno";
  if (status === "skipped") return "Přeskočeno";
  if (status === "deferred") return "Odloženo";
  if (status === "scheduled") return "Naplánováno";
  return "Nenaplánováno";
}

function monthKeyFromPlanningKey(key: string) {
  return key.slice(0, 7);
}

function monthDays(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(year, month, 0, 12).getDate();
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  });
}

function historyRoutines(store: HygieneStore) {
  const current = new Map(store.routines.map((routine) => [routine.id, routine]));
  for (const dateRecords of Object.values(store.records)) {
    for (const record of Object.values(dateRecords)) {
      if (current.has(record.routineId)) continue;
      current.set(record.routineId, {
        id: record.routineId,
        title: record.routineTitle,
        active: false,
        order: 999,
        schedule: { type: "manual" },
        tasks: [],
      });
    }
  }
  return [...current.values()].sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "cs"));
}

function overallDateStatus(store: HygieneStore, dateKey: string, today: string) {
  const records = Object.values(store.records[dateKey] ?? {});
  if (!records.length) return "not-scheduled";
  const statuses = records.map((record) => historyStatusForDate(store, record.routineId, dateKey, today));
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "complete" || status === "skipped")) return "complete";
  if (statuses.some((status) => status === "complete" || status === "partial" || status === "skipped")) return "partial";
  if (dateKey < today) return "missed";
  return "scheduled";
}

function cloneSchedule(schedule: HygieneSchedule): HygieneSchedule {
  if (schedule.type === "days") return { type: "days", weekdays: [...schedule.weekdays] };
  return { ...schedule };
}

function scheduleFromType(type: HygieneSchedule["type"], planningKey: string): HygieneSchedule {
  if (type === "daily") return { type: "daily" };
  if (type === "days") return { type: "days", weekdays: [1, 2, 3, 4, 5] };
  if (type === "weekly") return { type: "weekly", weekday: 0 };
  if (type === "interval") return { type: "interval", everyDays: 2, anchorDate: planningKey };
  if (type === "rolling") return { type: "rolling", everyDays: 7, anchorDate: planningKey, unit: "days" };
  if (type === "monthly") return { type: "monthly", day: 1 };
  if (type === "nth-weekday") return { type: "nth-weekday", week: 1, weekday: 0 };
  return { type: "manual" };
}

function ScheduleEditor({
  value,
  onChange,
  planningKey,
  allowManual = true,
  showTypeSelect = true,
}: {
  value: HygieneSchedule;
  onChange: (value: HygieneSchedule) => void;
  planningKey: string;
  allowManual?: boolean;
  showTypeSelect?: boolean;
}) {
  const choices: { value: HygieneSchedule["type"]; label: string }[] = [
    { value: "daily", label: "Každý den" },
    { value: "days", label: "Konkrétní dny" },
    { value: "weekly", label: "Jednou týdně" },
    { value: "interval", label: "Pevně každých X dní od data" },
    { value: "rolling", label: "Po X dnech / týdnech od splnění" },
    { value: "monthly", label: "Jednou měsíčně" },
    { value: "nth-weekday", label: "Týden + den v měsíci" },
  ];
  if (allowManual) choices.push({ value: "manual", label: "Bez pevné frekvence" });

  return (
    <div className="df2-hygiene-schedule-editor">
      {showTypeSelect && (
        <label>
          Frekvence
          <select
            aria-label="Frekvence"
            value={value.type}
            onChange={(event) => onChange(scheduleFromType(event.target.value as HygieneSchedule["type"], planningKey))}
          >
            {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
      )}

      {value.type === "days" && (
        <div className="df2-hygiene-weekdays" role="group" aria-label="Dny opakování">
          {WEEKDAYS.map((day) => (
            <button
              type="button"
              key={day.value}
              aria-pressed={value.weekdays.includes(day.value)}
              onClick={() => {
                const weekdays = value.weekdays.includes(day.value)
                  ? value.weekdays.filter((item) => item !== day.value)
                  : WEEKDAYS.map((item) => item.value).filter((item) => item === day.value || value.weekdays.includes(item));
                if (weekdays.length) onChange({ type: "days", weekdays });
              }}
            >
              {day.label}
            </button>
          ))}
        </div>
      )}

      {value.type === "weekly" && (
        <label>
          Den
          <select value={value.weekday} onChange={(event) => onChange({ type: "weekly", weekday: Number(event.target.value) })}>
            {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </select>
        </label>
      )}

      {value.type === "interval" && (
        <div className="df2-hygiene-schedule-row">
          <label>
            Každých
            <input
              aria-label="Každých"
              type="number"
              min="1"
              max="90"
              value={value.everyDays}
              onChange={(event) => onChange({
                ...value,
                everyDays: Math.max(1, Math.min(90, Math.round(Number(event.target.value) || 1))),
              })}
            />
          </label>
          <label>
            Počítat od
            <input type="date" value={value.anchorDate} onChange={(event) => onChange({ ...value, anchorDate: event.target.value || planningKey })} />
          </label>
        </div>
      )}

      {value.type === "rolling" && (
        <div className="df2-hygiene-schedule-row">
          <label>Opakovat každých
            <input aria-label="Interval od dokončení" type="number" min="1" max={value.unit === "weeks" ? 52 : 365}
              value={value.everyDays} onChange={(event) => onChange({
                ...value, everyDays: Math.max(1, Math.min(value.unit === "weeks" ? 52 : 365,
                  Math.round(Number(event.target.value) || 1))),
              })} />
          </label>
          <label>Jednotka
            <select aria-label="Jednotka intervalu" value={value.unit} onChange={(event) => onChange({
              ...value, unit: event.target.value as "days" | "weeks",
              everyDays: Math.min(value.everyDays, event.target.value === "weeks" ? 52 : 365),
            })}>
              <option value="days">Dny</option>
              <option value="weeks">Týdny</option>
            </select>
          </label>
          <label>První termín
            <input aria-label="První termín intervalu" type="date" value={value.anchorDate}
              onChange={(event) => onChange({ ...value, anchorDate: event.target.value || planningKey })} />
          </label>
          <small>Po dokončení se příští termín vypočítá ze skutečného dne splnění. Pevný týdenní rozvrh zůstává beze změny.</small>
        </div>
      )}
      {value.type === "monthly" && (
        <label>
          Den v měsíci
          <input
            aria-label="Den v měsíci"
            type="number"
            min="1"
            max="31"
            value={value.day}
            onChange={(event) => onChange({
              type: "monthly",
              day: Math.max(1, Math.min(31, Math.round(Number(event.target.value) || 1))),
            })}
          />
        </label>
      )}

      {value.type === "nth-weekday" && (
        <div className="df2-hygiene-schedule-row">
          <label>
            Týden
            <select value={value.week} onChange={(event) => onChange({ ...value, week: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5].map((week) => <option key={week} value={week}>{week}.</option>)}
            </select>
          </label>
          <label>
            Den
            <select value={value.weekday} onChange={(event) => onChange({ ...value, weekday: Number(event.target.value) })}>
              {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

export function HygienePage({
  planningKey,
  focusRoutineId,
  onFocusHandled,
}: {
  planningKey: string;
  focusRoutineId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [store, setStore] = useState<HygieneStore>(() => createDefaultHygieneStore(planningKey));
  const [hydrated, setHydrated] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<HygieneTab>("today");
  const [monthKey, setMonthKey] = useState(() => monthKeyFromPlanningKey(planningKey));
  const [routineDraft, setRoutineDraft] = useState<HygieneRoutineDefinition | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ sourceRoutineId: string; targetRoutineId: string; task: HygieneTaskDefinition } | null>(null);
  const [manualPlanDate, setManualPlanDate] = useState("");
  const [scheduleManualDate, setScheduleManualDate] = useState(false);
  const [postponeKey, setPostponeKey] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [historyProductDetail, setHistoryProductDetail] = useState<{
    date: string; routine: string; task: string; product: HygieneProductSnapshot;
  } | null>(null);

  useEffect(() => {
    const sync = () => {
      const result = loadHygieneStore(planningKey);
      setStore(result.store);
      setBlocked(result.blocked);
      setHydrated(true);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HYGIENE_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(HYGIENE_SYNC_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HYGIENE_SYNC_EVENT, sync);
    };
  }, [planningKey]);

  useEffect(() => {
    setMonthKey(monthKeyFromPlanningKey(planningKey));
  }, [planningKey]);

  useEffect(() => {
    if (!focusRoutineId || !hydrated) return;
    setTab("today");
    const timer = window.setTimeout(() => {
      document.getElementById("hygiene-routine-" + focusRoutineId)?.scrollIntoView({ block: "center", behavior: "smooth" });
      onFocusHandled?.();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusRoutineId, hydrated, onFocusHandled]);

  const persist = (next: HygieneStore) => {
    if (blocked) {
      setError("Data Hygieny nelze bezpečně načíst. Ukládání je vypnuté, aby se původní data nepřepsala.");
      return false;
    }
    const refreshed = refreshHygieneToday(next, planningKey);
    if (!saveHygieneStore(refreshed)) {
      setError("Změnu se nepodařilo uložit.");
      return false;
    }
    setStore(refreshed);
    setError("");
    return true;
  };

  const summaries = useMemo(() => scheduledRoutineSummaries(store, planningKey, planningKey), [store, planningKey]);
  const overall = useMemo(() => overallHygieneProgress(summaries), [summaries]);
  const historicalRoutines = useMemo(() => historyRoutines(store), [store]);
  const historicalProducts = useMemo(() => Object.entries(store.records)
    .filter(([date]) => date <= planningKey)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 45)
    .flatMap(([date, records]) => Object.values(records).flatMap((record) =>
      record.scheduledTasks.filter((task) => record.states[task.id] === "done")
        .flatMap((task) => (task.products ?? []).map((product) => ({
          date, task: task.title, product, routine: record.routineTitle,
        }))))), [store.records, planningKey]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysKey(planningKey, index - 6)),
    [planningKey],
  );
  const calendarDates = useMemo(() => monthDays(monthKey), [monthKey]);
  const overdue = useMemo(() => overdueHygieneTasks(store, planningKey), [store, planningKey]);

  const changeStatus = (date: string, routineId: string, taskId: string, status: "done" | "skipped" | "omitted") => {
    const latest = loadHygieneStore(planningKey);
    if (latest.blocked) {
      setBlocked(true);
      setError("Data Hygieny nelze bezpečně načíst. Ukládání je vypnuté.");
      return;
    }
    const current = latest.store.records[date]?.[routineId]?.states[taskId];
    const next = current === status ? null : status;
    persist(setHygieneTaskStatus(latest.store, date, routineId, taskId, next, planningKey));
  };

  const deferTask = (date: string, routineId: string, taskId: string) => {
    const latest = loadHygieneStore(planningKey);
    if (latest.blocked) {
      setBlocked(true);
      setError("Data Hygieny nelze bezpečně načíst. Ukládání je vypnuté.");
      return;
    }
    if (!postponeDate || postponeDate < planningKey || postponeDate <= date) {
      setError("Vyber platné budoucí datum (ne dříve než dnes).");
      return;
    }
    if (persist(postponeHygieneTask(latest.store, date, routineId, taskId, postponeDate))) {
      setPostponeKey("");
      setPostponeDate("");
    }
  };
  const startPostpone = (key: string) => {
    setPostponeKey((old) => old === key ? "" : key);
    setPostponeDate(addDaysKey(planningKey, 1));
  };

  const updateTask = (routineId: string, taskId: string, status: "done" | "skipped" | "omitted") => {
    changeStatus(planningKey, routineId, taskId, status);
  };

  const saveRoutineDraft = () => {
    if (!routineDraft?.title.trim()) return;
    const existing = store.routines.some((routine) => routine.id === routineDraft.id);
    const routines = existing
      ? store.routines.map((routine) => routine.id === routineDraft.id ? { ...routineDraft, title: routineDraft.title.trim() } : routine)
      : [...store.routines, { ...routineDraft, title: routineDraft.title.trim() }];
    if (persist({ ...store, routines })) setRoutineDraft(null);
  };

  const deleteRoutine = (routineId: string) => {
    const routines = store.routines.filter((routine) => routine.id !== routineId);
    const manualDates = Object.fromEntries(
      Object.entries(store.manualDates).map(([date, ids]) => [date, ids.filter((id) => id !== routineId)]),
    );
    const suppressedDates = Object.fromEntries(
      Object.entries(store.suppressedDates).map(([date, ids]) => [date, ids.filter((id) => id !== routineId)]),
    );
    if (persist({ ...store, routines, manualDates, suppressedDates })) setRoutineDraft(null);
  };

  const saveTaskDraft = () => {
    if (!taskDraft?.task.title.trim()) return;
    const cleanTask = { ...taskDraft.task, title: taskDraft.task.title.trim(), section: taskDraft.task.section.trim() || DEFAULT_SECTION };
    const movedState = taskDraft.sourceRoutineId !== taskDraft.targetRoutineId
      ? store.records[planningKey]?.[taskDraft.sourceRoutineId]?.states[cleanTask.id]
      : undefined;
    const movedSnapshot = movedState === "done"
      ? store.records[planningKey]?.[taskDraft.sourceRoutineId]?.scheduledTasks
        .find((task) => task.id === cleanTask.id)
      : undefined;
    const routines = store.routines.map((routine) => {
      if (routine.id === taskDraft.sourceRoutineId && taskDraft.targetRoutineId !== taskDraft.sourceRoutineId) {
        return { ...routine, tasks: routine.tasks.filter((task) => task.id !== cleanTask.id) };
      }
      if (routine.id === taskDraft.targetRoutineId) {
        const exists = routine.tasks.some((task) => task.id === cleanTask.id);
        return {
          ...routine,
          tasks: exists
            ? routine.tasks.map((task) => task.id === cleanTask.id ? cleanTask : task)
            : [...routine.tasks, cleanTask],
        };
      }
      return routine;
    });
    let nextStore = refreshHygieneToday({ ...store, routines }, planningKey);
    if (scheduleManualDate && manualPlanDate >= planningKey && cleanTask.schedule?.type === "manual") {
      nextStore = planManualHygieneTask(nextStore, cleanTask.id, manualPlanDate);
    }
    if (movedState && taskDraft.sourceRoutineId !== taskDraft.targetRoutineId) {
      const destinationHasTask = nextStore.records[planningKey]?.[taskDraft.targetRoutineId]?.scheduledTasks
        .some((task) => task.id === cleanTask.id);
      if (!destinationHasTask) {
        const sourceRecord = nextStore.records[planningKey]?.[taskDraft.sourceRoutineId];
        if (sourceRecord?.scheduledTasks.some((task) => task.id === cleanTask.id)) {
          nextStore = {
            ...nextStore,
            records: {
              ...nextStore.records,
              [planningKey]: {
                ...nextStore.records[planningKey],
                [taskDraft.sourceRoutineId]: {
                  ...sourceRecord,
                  archived: undefined,
                  carryToday: true,
                },
              },
            },
          };
        }
      } else {
        const sourceRecord = nextStore.records[planningKey]?.[taskDraft.sourceRoutineId];
        if (sourceRecord) {
          const sourceStates = { ...sourceRecord.states };
          delete sourceStates[cleanTask.id];
          const sourceTasks = sourceRecord.scheduledTasks.filter((task) => task.id !== cleanTask.id);
          const dateRecords = { ...nextStore.records[planningKey] };
          if (sourceTasks.length === 0) {
            delete dateRecords[taskDraft.sourceRoutineId];
          } else {
            dateRecords[taskDraft.sourceRoutineId] = {
              ...sourceRecord,
              scheduledTasks: sourceTasks,
              states: sourceStates,
            };
          }
          nextStore = {
            ...nextStore,
            records: {
              ...nextStore.records,
              [planningKey]: dateRecords,
            },
          };
        }
        nextStore = setHygieneTaskStatus(
          nextStore,
          planningKey,
          taskDraft.targetRoutineId,
          cleanTask.id,
          movedState,
        );
        // A moved, already completed task keeps the products recorded at completion.
        // Re-snapshotting from the live catalog would rewrite its history.
        if (movedSnapshot) {
          const targetRecord = nextStore.records[planningKey]?.[taskDraft.targetRoutineId];
          if (targetRecord) {
            nextStore = {
              ...nextStore,
              records: {
                ...nextStore.records,
                [planningKey]: {
                  ...nextStore.records[planningKey],
                  [taskDraft.targetRoutineId]: {
                    ...targetRecord,
                    scheduledTasks: targetRecord.scheduledTasks.map((task) =>
                      task.id === cleanTask.id ? { ...task, products: movedSnapshot.products ?? [] } : task),
                  },
                },
              },
            };
          }
        }
      }
    }
    if (persist(nextStore)) { setTaskDraft(null); setScheduleManualDate(false); }
  };

  const deleteTask = () => {
    if (!taskDraft) return;
    const routines = store.routines.map((routine) => routine.id === taskDraft.sourceRoutineId
      ? { ...routine, tasks: routine.tasks.filter((task) => task.id !== taskDraft.task.id) }
      : routine);
    if (persist({ ...store, routines })) setTaskDraft(null);
  };

  const moveTask = (routineId: string, taskId: string, direction: -1 | 1) => {
    const routines = store.routines.map((routine) => {
      if (routine.id !== routineId) return routine;
      const index = routine.tasks.findIndex((task) => task.id === taskId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= routine.tasks.length) return routine;
      const tasks = [...routine.tasks];
      const [moved] = tasks.splice(index, 1);
      tasks.splice(target, 0, moved);
      return { ...routine, tasks };
    });
    persist({ ...store, routines });
  };

  if (!hydrated) {
    return <section className="df2-hygiene-page"><div className="df2-hygiene-loading">Načítám hygienické rutiny…</div></section>;
  }

  return (
    <section className="df2-hygiene-page">
      <header className="df2-page-head df2-hygiene-head">
        <div>
          <p>{longDate(planningKey)}</p>
          <h1>Hygiena</h1>
        </div>
        <div className="df2-hygiene-overall" aria-label={"Celkový progres " + overall.handled + " z " + overall.total}>
          <strong>{overall.percent}%</strong>
          <span>{overall.handled}/{overall.total} dnes</span>
        </div>
      </header>

      <div className="df2-hygiene-tabs" role="tablist" aria-label="Hygiena">
        <button type="button" role="tab" aria-selected={tab === "today"} onClick={() => setTab("today")}>Dnes</button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>Historie</button>
        <button type="button" role="tab" aria-selected={tab === "manage"} onClick={() => setTab("manage")}>Správa rutin</button>
        <button type="button" role="tab" aria-selected={tab === "products"} onClick={() => { setTab("products"); setFocusProductId(null); }}>Moje produkty</button>
      </div>

      {(blocked || error) && <p className="df2-hygiene-error">{blocked ? "Data Hygieny nelze bezpečně načíst. Ukládání je vypnuté." : error}</p>}

      {tab === "today" && (
        <div className="df2-hygiene-today">
          <div className="df2-hygiene-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall.percent}>
            <span style={{ width: overall.percent + "%" }} />
          </div>

          {overdue.length > 0 && (
            <section className="df2-hygiene-overdue" aria-label="Zmeškané hygienické úkoly">
              <header><div><span>Čeká na vyřízení</span><h2>Po termínu</h2></div>
                <small>Každý úkon je zde jen jednou. Starší výskyty zůstávají v historii.</small></header>
              {overdue.map((item) => {
                const key = item.date + "|" + item.routineId + "|" + item.taskId;
                return (
                  <article key={key}>
                    <div><strong>{item.title}</strong><small>{item.routineTitle} · původní termín {item.date}</small></div>
                    <div className="df2-hygiene-overdue-actions">
                      <button type="button" onClick={() => changeStatus(item.date, item.routineId, item.taskId, "done")}>✓ Hotovo dnes</button>
                      <button type="button" onClick={() => changeStatus(item.date, item.routineId, item.taskId, "skipped")}>Není potřeba</button>
                      <button type="button" onClick={() => changeStatus(item.date, item.routineId, item.taskId, "omitted")}>Přeskočit</button>
                      <button type="button" onClick={() => startPostpone(key)}>Odložit</button>
                      {postponeKey === key && <div className="df2-hygiene-postpone">
                        <input aria-label={"Nový termín " + item.title} type="date" min={planningKey}
                          value={postponeDate} onChange={(event) => setPostponeDate(event.target.value)} />
                        <button type="button" onClick={() => deferTask(item.date, item.routineId, item.taskId)}>Potvrdit</button>
                      </div>}
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          {summaries.length ? summaries.map((summary) => {
            // Group only consecutive steps: manual up/down ordering remains exact,
            // even if a step moves across section boundaries.
            const groups = summary.record.scheduledTasks.reduce<Array<{
              section: string; tasks: typeof summary.record.scheduledTasks;
            }>>((items, task) => {
              const previous = items[items.length - 1];
              if (previous?.section === task.section) previous.tasks.push(task);
              else items.push({ section: task.section, tasks: [task] });
              return items;
            }, []);
            const hasMonthly = groups.some((group) => group.section === "Měsíční péče");
            return (
              <article
                className={"df2-hygiene-routine " + (summary.status === "complete" ? "is-complete" : "")}
                id={"hygiene-routine-" + summary.routine.id}
                data-hygiene-routine={summary.routine.id}
                key={summary.routine.id}
              >
                <header>
                  <div>
                    <span>{routineScheduledOnDate(store, summary.routine, planningKey) ? scheduleLabel(summary.routine.schedule) : "Vlastní frekvence úkolu"}</span>
                    <h2>{summary.routine.title}{hasMonthly ? <em>+</em> : null}</h2>
                    {hasMonthly && <small>Měsíční péče je dnes součástí stejné rutiny.</small>}
                  </div>
                  <div className="df2-hygiene-routine-progress">
                    <strong>{summary.handled}/{summary.total}</strong>
                    <span>{summary.status === "complete" ? "✓ Hotovo" : statusLabel(summary.status)}</span>
                  </div>
                </header>

                {groups.map((group, groupIndex) => (
                  <section className="df2-hygiene-task-group" key={group.section + groupIndex}>
                    <h3>{group.section}</h3>
                    <div>
                      {group.tasks.map((task) => {
                        const state = summary.record.states[task.id];
                        const definition = summary.routine.tasks.find((item) => item.id === task.id);
                        const productsInStep = state === "done" ? (task.products ?? [])
                          : definition ? (definition.productIds ?? []).flatMap((id) => {
                            const product = store.products.find((item) => item.id === id && !item.archived);
                            return product ? [{
                              id: product.id, name: product.name, brand: product.brand,
                              instructions: product.instructions,
                              usageWhen: product.usageWhen, usageAmount: product.usageAmount,
                              usageDuration: product.usageDuration, frequency: product.frequency,
                              precautions: product.precautions, photoKey: product.photoKey,
                            }] : [];
                          }) : (task.products ?? []);
                        return (
                          <article className={"df2-hygiene-task " + (state ? "is-" + state : "")} key={task.id}>
                            <button
                              type="button"
                              className="df2-hygiene-check"
                              aria-label={(state === "done" ? "Vrátit " : "Označit ") + task.title + (state === "done" ? " jako nesplněné" : " jako hotovo")}
                              aria-pressed={state === "done"}
                              disabled={state === "deferred"}
                              onClick={() => updateTask(summary.routine.id, task.id, "done")}
                            >
                              {state === "done" ? "✓" : ""}
                            </button>
                            <div>
                              <strong>{task.title}</strong>
                              {productsInStep.length > 0 && (
                                <div className="df2-hygiene-used-products">
                                  {productsInStep.map((product) => (
                                    <div className="df2-hygiene-used-product-entry" key={product.id}>
                                      <button type="button" className="df2-hygiene-used-product"
                                        aria-label={(state === "done" ? "Historický produkt " : "Detail produktu ") + product.name}
                                        onClick={() => {
                                          if (state === "done") {
                                            setHistoryProductDetail({
                                              date: planningKey, routine: summary.routine.title, task: task.title, product,
                                            });
                                          } else {
                                            setFocusProductId(product.id);
                                            setTab("products");
                                          }
                                        }}>
                                        <ProductPhoto photoKey={product.photoKey} name={product.name} />
                                        <span><b>{product.name}</b></span>
                                      </button>
                                      <CompactRoutineProductGuide product={product} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {definition?.timerSeconds && (
                                <HygieneTaskTimer key={planningKey + ":" + task.id}
                                  seconds={definition.timerSeconds} taskTitle={task.title} />
                              )}
                              {task.optional && <small>Volitelné · nezablokuje dokončení</small>}
                              {state === "skipped" && <small>Není potřeba</small>}
                              {state === "omitted" && <small>Přeskočeno (nikoliv splněno)</small>}
                              {state === "deferred" && <small>Odloženo na jiný den</small>}
                            </div>
                            <div className="df2-hygiene-task-actions">
                              {(task.allowSkip || task.optional) && (
                                <button type="button" className="df2-hygiene-skip"
                                  aria-pressed={state === "skipped"}
                                  onClick={() => updateTask(summary.routine.id, task.id, "skipped")}>
                                  {state === "skipped" ? "Vrátit" : "Není potřeba"}
                                </button>
                              )}
                              {state !== "done" && state !== "deferred" && (
                                <button type="button" className="df2-hygiene-skip"
                                  aria-pressed={state === "omitted"} aria-label={"Přeskočit " + task.title}
                                  onClick={() => updateTask(summary.routine.id, task.id, "omitted")}>
                                  {state === "omitted" ? "Vrátit přeskočení" : "Přeskočit"}
                                </button>
                              )}
                              {!state && <button type="button" className="df2-hygiene-skip"
                                aria-label={"Odložit " + task.title}
                                onClick={() => startPostpone(planningKey + "|" + summary.routine.id + "|" + task.id)}>Odložit</button>}
                              {postponeKey === planningKey + "|" + summary.routine.id + "|" + task.id && !state && (
                                <div className="df2-hygiene-postpone">
                                  <input type="date" aria-label={"Nový termín " + task.title} min={planningKey}
                                    value={postponeDate} onChange={(event) => setPostponeDate(event.target.value)} />
                                  <button type="button" onClick={() => deferTask(planningKey, summary.routine.id, task.id)}>Potvrdit</button>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </article>
            );
          }) : (
            <div className="df2-hygiene-empty">
              <strong>Dnes není naplánovaná žádná hygienická rutina.</strong>
              <span>Vlastní rutinu bez pevné frekvence můžeš spustit ve Správě rutin.</span>
            </div>
          )}
        </div>
      )}

      {tab === "products" && (
        <HygieneProducts store={store} today={planningKey} onSave={persist} focusProductId={focusProductId}
          onFocusHandled={() => setFocusProductId(null)} />
      )}

      {tab === "history" && (
        <div className="df2-hygiene-history">
          <section className="df2-hygiene-history-section">
            <div className="df2-hygiene-section-title">
              <div><span>Posledních 7 dní</span><h2>Týdenní přehled</h2></div>
            </div>
            <div className="df2-hygiene-week-history">
              {weekDates.map((date) => {
                const status = overallDateStatus(store, date, planningKey);
                const planned = Object.keys(store.records[date] ?? {}).length;
                return (
                  <div className={"df2-hygiene-history-day is-" + status} key={date}>
                    <span>{shortDay(date)}</span>
                    <strong>{statusLabel(status)}</strong>
                    <small>{planned ? planned + " rutin" : "bez plánu"}</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="df2-hygiene-history-section">
            <div className="df2-hygiene-section-title">
              <div><span>Habit tracking</span><h2>Měsíční kalendář</h2></div>
              <input type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value || monthKeyFromPlanningKey(planningKey))} />
            </div>
            <div className="df2-hygiene-month-grid">
              {["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((day) => (
                <span className="df2-hygiene-month-weekday" key={day}>{day}</span>
              ))}
              {calendarDates.map((date, index) => {
                const status = overallDateStatus(store, date, planningKey);
                const mondayFirstColumn = ((dateFromKey(date).getDay() + 6) % 7) + 1;
                return (
                  <div
                    className={"df2-hygiene-month-day is-" + status}
                    title={statusLabel(status)}
                    key={date}
                    style={index === 0 ? { gridColumnStart: mondayFirstColumn } : undefined}
                    data-calendar-date={date}
                  >
                    <span>{dateFromKey(date).getDate()}</span>
                    <i aria-hidden="true" />
                  </div>
                );
              })}
            </div>
            <div className="df2-hygiene-history-legend">
              <span><i className="is-complete" />Splněno</span>
              <span><i className="is-partial" />Částečně</span>
              <span><i className="is-missed" />Nesplněno</span>
              <span><i className="is-skipped" />Přeskočeno</span>
              <span><i className="is-not-scheduled" />Nenaplánováno</span>
            </div>
          </section>

          <section className="df2-hygiene-history-section">
            <div className="df2-hygiene-section-title"><div><span>Rutina po rutině</span><h2>Statistiky</h2></div></div>
            <div className="df2-hygiene-stats-grid">
              {historicalRoutines.map((routine) => {
                const stats = routineStats(store, routine.id, planningKey);
                return (
                  <article key={routine.id}>
                    <header><strong>{routine.title}</strong><span>{stats.successRate}%</span></header>
                    <dl>
                      <div><dt>Plánované dny</dt><dd>{stats.plannedDays}</dd></div>
                      <div><dt>Splněno</dt><dd>{stats.completedDays}</dd></div>
                      <div><dt>Aktuální streak</dt><dd>{stats.currentStreak}</dd></div>
                      <div><dt>Nejdelší streak</dt><dd>{stats.longestStreak}</dd></div>
                    </dl>
                    <small>{stats.skippedTasks}× „není potřeba“ · {stats.skippedDays} přeskočených dní · {stats.partialDays} částečně · {stats.missedDays} nesplněno</small>
                  </article>
                );
              })}
            </div>
          </section>
          {historicalProducts.length > 0 && (
            <section className="df2-hygiene-history-section">
              <div className="df2-hygiene-section-title"><div><span>Zaznamenané při splnění</span><h2>Použité produkty</h2></div></div>
              <div className="df2-product-history">
                {historicalProducts.map(({ date, routine, task, product }, index) => {
                  const label = (
                    <>
                      <ProductPhoto photoKey={product.photoKey} name={product.name} />
                      <span><strong>{product.name}</strong><small>{date} · {routine} · {task}</small></span>
                    </>
                  );
                  return (
                    <button type="button" key={date + task + product.id + index}
                      aria-label={"Historický produkt " + product.name}
                      onClick={() => setHistoryProductDetail({ date, routine, task, product })}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "manage" && (
        <div className="df2-hygiene-manage">
          <div className="df2-hygiene-manage-head">
            <div><span>Definice se mění jen dopředu</span><h2>Správa rutin</h2></div>
            <button
              type="button"
              className="df2-accent-button"
              onClick={() => setRoutineDraft({
                id: createRoutineId(),
                title: "Nová rutina",
                active: true,
                order: Math.max(0, ...store.routines.map((routine) => routine.order)) + 10,
                schedule: { type: "daily" },
                tasks: [],
              })}
            >
              + Vlastní rutina
            </button>
          </div>

          <div className="df2-hygiene-manage-list">
            {[...store.routines].sort((left, right) => left.order - right.order).map((routine) => {
              const routineRunningToday = summaries.some((summary) => summary.routine.id === routine.id);
              return (
                <article className={routine.active ? "" : "is-inactive"} key={routine.id}>
                  <header>
                    <div>
                      <strong>{routine.title}</strong>
                      <span>{scheduleLabel(routine.schedule)} · {routine.tasks.filter((task) => task.active).length} aktivních úkolů</span>
                    </div>
                    <div>
                      {routine.schedule.type === "manual" && routine.active && (
                        <button
                          type="button"
                          onClick={() => persist(toggleManualRoutine(store, planningKey, routine.id, !routineRunningToday))}
                        >
                          {routineRunningToday ? "Odebrat z dneška" : "Naplánovat dnes"}
                        </button>
                      )}
                      <button type="button" onClick={() => setRoutineDraft({ ...routine, schedule: cloneSchedule(routine.schedule), tasks: routine.tasks.map((task) => ({ ...task, schedule: task.schedule ? cloneSchedule(task.schedule) : undefined })) })}>Upravit</button>
                    </div>
                  </header>

                  <div className="df2-hygiene-manage-tasks">
                    {routine.tasks.map((task, index) => (
                      <div className={task.active ? "" : "is-inactive"} key={task.id}>
                        <button
                          type="button"
                          className="df2-hygiene-manage-task-copy"
                          onClick={() => setTaskDraft({
                            sourceRoutineId: routine.id,
                            targetRoutineId: routine.id,
                            task: { ...task, schedule: task.schedule ? cloneSchedule(task.schedule) : undefined },
                          })}
                        >
                          <strong>{task.title}</strong>
                          <span>{task.section}{task.schedule ? " · " + scheduleLabel(task.schedule) : ""}{task.optional ? " · volitelné" : ""}</span>
                        </button>
                        <button type="button" aria-label={"Posunout " + task.title + " nahoru"} disabled={index === 0} onClick={() => moveTask(routine.id, task.id, -1)}>↑</button>
                        <button type="button" aria-label={"Posunout " + task.title + " dolů"} disabled={index === routine.tasks.length - 1} onClick={() => moveTask(routine.id, task.id, 1)}>↓</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="df2-hygiene-add-task"
                      onClick={() => setTaskDraft({
                        sourceRoutineId: routine.id,
                        targetRoutineId: routine.id,
                        task: {
                          id: createTaskId(),
                          title: "",
                          section: "Péče",
                          active: true,
                          optional: false,
                          allowSkip: false,
                        },
                      })}
                    >
                      + Přidat úkol
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {historyProductDetail && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setHistoryProductDetail(null);
        }}>
          <section role="dialog" aria-modal="true"
            aria-label={"Historický produkt " + historyProductDetail.product.name}
            className="df2-modal df2-product-dialog">
            <header>
              <div><h2>{historyProductDetail.product.name}</h2>
                <small>{historyProductDetail.product.brand || "Bez značky"} · Historický záznam</small>
              </div>
              <button type="button" aria-label="Zavřít historický produkt"
                onClick={() => setHistoryProductDetail(null)}>×</button>
            </header>
            <div className="df2-product-detail-hero">
              <ProductPhoto photoKey={historyProductDetail.product.photoKey}
                name={historyProductDetail.product.name} large />
              <div>
                <p><strong>Datum:</strong> {historyProductDetail.date}</p>
                <p><strong>Rutina:</strong> {historyProductDetail.routine}</p>
                <p><strong>Dokončený krok:</strong> {historyProductDetail.task}</p>
                <ProductCareGuide product={historyProductDetail.product} />
                {!historyProductDetail.product.instructions && !historyProductDetail.product.usageWhen
                  && !historyProductDetail.product.usageAmount && !historyProductDetail.product.usageDuration
                  && !historyProductDetail.product.frequency && !historyProductDetail.product.precautions
                  && <p>Pokyny při dokončení nebyly zadány.</p>}
                <p>Tyto údaje odpovídají okamžiku dokončení, nikoli dnešnímu stavu produktu.</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {routineDraft && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoutineDraft(null); }}>
          <section className="df2-modal df2-hygiene-modal" role="dialog" aria-modal="true" aria-label="Upravit hygienickou rutinu">
            <header><div><h2>Rutina</h2></div><button type="button" onClick={() => setRoutineDraft(null)} aria-label="Zavřít">×</button></header>
            <label>Název<input value={routineDraft.title} onChange={(event) => setRoutineDraft({ ...routineDraft, title: event.target.value })} /></label>
            <ScheduleEditor
              value={routineDraft.schedule}
              planningKey={planningKey}
              onChange={(schedule) => setRoutineDraft({ ...routineDraft, schedule })}
            />
            <label className="df2-hygiene-switch"><input type="checkbox" checked={routineDraft.active} onChange={(event) => setRoutineDraft({ ...routineDraft, active: event.target.checked })} /> Aktivní</label>
            <div className="df2-modal-actions">
              <button type="button" className="df2-primary" onClick={saveRoutineDraft}>Uložit</button>
              {store.routines.some((routine) => routine.id === routineDraft.id) && <button type="button" className="danger" onClick={() => deleteRoutine(routineDraft.id)}>Smazat definici</button>}
            </div>
          </section>
        </div>
      )}

      {taskDraft && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskDraft(null); }}>
          <section className="df2-modal df2-hygiene-modal" role="dialog" aria-modal="true" aria-label="Upravit hygienický úkol">
            <header><div><h2>Hygienický úkol</h2></div><button type="button" onClick={() => setTaskDraft(null)} aria-label="Zavřít">×</button></header>
            <label>Název<input autoFocus value={taskDraft.task.title} onChange={(event) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, title: event.target.value } })} /></label>
            <label>Skupina<input value={taskDraft.task.section} onChange={(event) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, section: event.target.value } })} /></label>
            <label>
              Rutina
              <select aria-label="Rutina" value={taskDraft.targetRoutineId} onChange={(event) => setTaskDraft({ ...taskDraft, targetRoutineId: event.target.value })}>
                {store.routines.map((routine) => <option key={routine.id} value={routine.id}>{routine.title}</option>)}
              </select>
            </label>
            <label>
              Frekvence úkolu
              <select
                aria-label="Frekvence úkolu"
                value={taskDraft.task.schedule?.type ?? "inherit"}
                onChange={(event) => {
                  const value = event.target.value;
                  setTaskDraft({
                    ...taskDraft,
                    task: {
                      ...taskDraft.task,
                      schedule: value === "inherit" ? undefined : scheduleFromType(value as HygieneSchedule["type"], planningKey),
                    },
                  });
                }}
              >
                <option value="inherit">Stejná jako rutina</option>
                <option value="daily">Každý den</option>
                <option value="days">Konkrétní dny</option>
                <option value="weekly">Jednou týdně</option>
                <option value="interval">Pevný interval od data</option>
                <option value="rolling">Interval od posledního splnění</option>
                <option value="manual">Ručně podle potřeby</option>
                <option value="monthly">Jednou měsíčně</option>
                <option value="nth-weekday">Týden + den v měsíci</option>
              </select>
            </label>
            {taskDraft.task.schedule && (
              <ScheduleEditor
                value={taskDraft.task.schedule}
                planningKey={planningKey}
                allowManual
                showTypeSelect={false}
                onChange={(schedule) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, schedule } })}
              />
            )}
            {taskDraft.task.schedule?.type === "manual" && (
              <div className="df2-hygiene-manual-plan">
                <label><input type="checkbox" checked={scheduleManualDate}
                  onChange={(event) => { setScheduleManualDate(event.target.checked); setManualPlanDate(planningKey); }} />
                  Naplánovat konkrétní výskyt
                </label>
                {scheduleManualDate && <input type="date" min={planningKey} aria-label="Datum ručního úkolu"
                  value={manualPlanDate} onChange={(event) => setManualPlanDate(event.target.value)} />}
              </div>
            )}
            <label className="df2-hygiene-timer-setting">
              Volitelný časovač (minuty)
              <input aria-label="Časovač úkolu v minutách" type="number" step="0.25" min="0.25" max="120"
                placeholder="Bez časovače" value={taskDraft.task.timerSeconds ? taskDraft.task.timerSeconds / 60 : ""}
                onChange={(event) => {
                  const value = event.target.value;
                  const timerSeconds = value ? Math.max(15, Math.min(7200, Math.round(Number(value) * 60 / 15) * 15)) : undefined;
                  setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, timerSeconds } });
                }}
              />
              <small>Časovač neovlivňuje dokončení úkolu. Délku si určuješ sám podle známých pokynů.</small>
            </label>
            <div className="df2-hygiene-task-products">
              <strong>Produkty používané v tomto kroku</strong>
              {(taskDraft.task.productIds ?? []).map((id, index) => {
                const product = store.products.find((item) => item.id === id);
                if (!product) return null;
                const ids = taskDraft.task.productIds ?? [];
                return (
                  <div className="df2-hygiene-task-product-editor" key={id}>
                    <ProductPhoto photoKey={product.photoKey} name={product.name} />
                    <select aria-label={"Nahradit produkt " + product.name} value={id} onChange={(event) => {
                      const nextIds = [...ids];
                      const replacement = event.target.value;
                      if (ids.includes(replacement)) nextIds.splice(index, 1);
                      else nextIds[index] = replacement;
                      setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, productIds: nextIds } });
                    }}>
                      <option value={id}>{product.name}</option>
                      {store.products.filter((item) => !item.archived && !ids.includes(item.id))
                        .map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                    <button type="button" aria-label={"Posunout produkt " + product.name + " nahoru"} disabled={index === 0}
                      onClick={() => { const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, productIds: next } }); }}>↑</button>
                    <button type="button" aria-label={"Posunout produkt " + product.name + " dolů"} disabled={index === ids.length - 1}
                      onClick={() => { const next = [...ids]; [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, productIds: next } }); }}>↓</button>
                    <button type="button" aria-label={"Odebrat produkt " + product.name} onClick={() =>
                      setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, productIds: ids.filter((item) => item !== id) } })}>×</button>
                  </div>
                );
              })}
              <select aria-label="Přidat produkt k úkolu" value="" onChange={(event) => {
                if (!event.target.value) return;
                setTaskDraft({ ...taskDraft, task: {
                  ...taskDraft.task,
                  productIds: [...(taskDraft.task.productIds ?? []), event.target.value],
                } });
              }}>
                <option value="">+ Přiřadit produkt z knihovny</option>
                {store.products.filter((item) => !item.archived && !(taskDraft.task.productIds ?? []).includes(item.id))
                  .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="df2-hygiene-task-options">
              <label><input type="checkbox" checked={taskDraft.task.active} onChange={(event) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, active: event.target.checked } })} /> Aktivní</label>
              <label><input type="checkbox" checked={taskDraft.task.optional} onChange={(event) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, optional: event.target.checked } })} /> Volitelné</label>
              <label><input type="checkbox" checked={taskDraft.task.allowSkip} onChange={(event) => setTaskDraft({ ...taskDraft, task: { ...taskDraft.task, allowSkip: event.target.checked } })} /> Povolit „Není potřeba“</label>
            </div>
            <div className="df2-modal-actions">
              <button type="button" className="df2-primary" disabled={!taskDraft.task.title.trim()} onClick={saveTaskDraft}>Uložit</button>
              {store.routines.some((routine) => routine.tasks.some((task) => task.id === taskDraft.task.id)) && <button type="button" className="danger" onClick={deleteTask}>Smazat úkol</button>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

const DEFAULT_SECTION = "Péče";
