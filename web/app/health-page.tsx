"use client";

import { useEffect, useMemo, useState } from "react";
import { addDaysKey, dateFromKey } from "@/lib/dayframe-calendar";
import { ScheduleEditor } from "./hygiene-page";
import { GymPage } from "./health-gym";
import { useGymStore } from "./use-gym-store";
import { assignmentsOnDate } from "@/lib/dayframe-gym";
import {
  HYGIENE_STORAGE_KEY, HYGIENE_SYNC_EVENT,
  careDomainStore, createDefaultHygieneStore, createRoutineId, createTaskId,
  loadHygieneStore, refreshHygieneToday, saveHygieneStore, scheduleLabel,
  scheduledRoutineSummaries, setHygieneTaskStatus, postponeHygieneTask,
  toggleManualRoutine, type HygieneRoutineDefinition, type HygieneSchedule, type HygieneStore,
} from "@/lib/dayframe-hygiene";

type HealthTab = "overview" | "gym" | "supplements" | "body" | "sleep" | "water" | "prevention";
const TABS: { id: HealthTab; name: string; stage: string }[] = [
  { id: "overview", name: "Přehled", stage: "1" },
  { id: "gym", name: "Gym & Tréninky", stage: "2" },
  { id: "supplements", name: "Suplementy", stage: "3" },
  { id: "body", name: "Tělo & Progress", stage: "4" },
  { id: "sleep", name: "Spánek & Regenerace", stage: "5" },
  { id: "water", name: "Hydratace", stage: "5" },
  { id: "prevention", name: "Prevence", stage: "6" },
];

function newHealthRoutine(): HygieneRoutineDefinition {
  return {
    domain: "health",
    id: createRoutineId(),
    title: "",
    active: true,
    order: 100,
    schedule: { type: "daily" },
    tasks: [{
      id: createTaskId(), title: "", section: "Zdraví",
      active: true, optional: false, allowSkip: true,
    }],
  };
}

export function HealthPage({ planningKey, focusRoutineId, onFocusHandled, focusGymKey, focusGymDate }: {
  planningKey: string; focusRoutineId?: string | null; onFocusHandled?: () => void;
  focusGymKey?: string | null; focusGymDate?: string | null;
}) {
  const [store, setStore] = useState<HygieneStore>(() => createDefaultHygieneStore(planningKey));
  const [blocked, setBlocked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<HealthTab>("overview");
  const [draft, setDraft] = useState<HygieneRoutineDefinition | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const gym = useGymStore();
  const todayWorkouts = useMemo(() => assignmentsOnDate(gym.store,planningKey),[gym.store,planningKey]);

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
    window.addEventListener(HYGIENE_SYNC_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HYGIENE_SYNC_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [planningKey]);

  useEffect(() => {
    if (!hydrated || !focusRoutineId) return;
    setTab("overview");
    const timer = window.setTimeout(() => {
      document.getElementById("health-routine-" + focusRoutineId)?.scrollIntoView({ block: "center" });
      onFocusHandled?.();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [hydrated, focusRoutineId, onFocusHandled]);

  useEffect(()=>{if(focusGymKey)setTab("gym");},[focusGymKey]);
  const scoped = useMemo(() => careDomainStore(store, "health"), [store]);
  const summaries = useMemo(() => scheduledRoutineSummaries(scoped, planningKey, planningKey), [scoped, planningKey]);
  const handled = summaries.reduce((sum, item) => sum + item.handled, 0);
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const existing = scoped.routines.slice().sort((a, b) => a.order - b.order);

  const persist = (change: (current: HygieneStore) => HygieneStore) => {
    const latest = loadHygieneStore(planningKey);
    if (latest.blocked) { setBlocked(true); setError("Data nelze bezpečně načíst, ukládání je vypnuté."); return false; }
    const next = refreshHygieneToday(change(latest.store), planningKey);
    if (!saveHygieneStore(next)) { setError("Změnu se nepodařilo uložit."); return false; }
    setStore(next);
    setError("");
    return true;
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.title.trim();
    if (!name || !draft.tasks[0]?.title.trim()) {
      setError("Zadej název rutiny i jejího úkolu.");
      return;
    }
    const valid: HygieneRoutineDefinition = {
      ...draft, domain: "health", title: name.slice(0, 120),
      tasks: [{ ...draft.tasks[0], title: draft.tasks[0].title.trim().slice(0, 160) }],
    };
    if (persist((current) => ({
      ...current,
      routines: current.routines.some((item) => item.id === valid.id)
        ? current.routines.map((item) => item.id === valid.id && item.domain === "health" ? valid : item)
        : [...current.routines, valid],
    }))) setDraft(null);
  };

  const changeStatus = (routineId: string, taskId: string, status: "done" | "skipped") =>
    persist((current) => {
      if (!current.routines.some((routine) => routine.id === routineId && routine.domain === "health")) return current;
      const prev = current.records[planningKey]?.[routineId]?.states[taskId];
      return setHygieneTaskStatus(current, planningKey, routineId, taskId, prev === status ? null : status);
    });

  const postpone = (routineId: string, taskId: string) => persist((current) =>
    current.routines.some((routine) => routine.id === routineId && routine.domain === "health")
      ? postponeHygieneTask(current, planningKey, routineId, taskId, addDaysKey(planningKey, 1)) : current);

  const historyDays = Array.from({ length: 7 }, (_, index) => addDaysKey(planningKey, index - 6));
  const activeTab = TABS.find((item) => item.id === tab)!;

  if (!hydrated) return <section className="df2-health-page"><p>Načítám Zdraví…</p></section>;

  return (
    <section className="df2-health-page" aria-label="Zdraví">
      <header className="df2-page-head df2-health-head">
        <div>
          <p>{new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(dateFromKey(planningKey))}</p>
          <h1>Zdraví</h1>
          <small>Tréninky, návyky, regenerace a péče o tělo — na jednom místě.</small>
        </div>
        <div className="df2-health-today-progress" aria-label={"Zdravotní návyky " + handled + " z " + total}>
          <strong>{handled}/{total}</strong><span>dnešní návyky</span>
        </div>
      </header>

      <div className="df2-health-tabs" role="tablist" aria-label="Sekce Zdraví">
        {TABS.map((item) => <button key={item.id} type="button" role="tab"
          aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.name}</button>)}
      </div>

      {(blocked || error) && <p role="alert" className="df2-hygiene-error">{blocked ? "Uložená data nelze bezpečně načíst. Změny jsou zablokované." : error}</p>}

      {tab === "overview" ? (
        <div className="df2-health-content">
          <section className="df2-health-section" data-health-gym-overview>
            <div className="df2-health-section-heading"><div><span>Tréninkový plán</span><h2>Dnešní gym</h2></div>
              <button type="button" onClick={()=>setTab("gym")}>Otevřít tréninky →</button></div>
            <p className="df2-health-helper">{todayWorkouts.length
              ? todayWorkouts.map(x=>x.name+(x.completed?" · Hotovo":x.session?" · Rozpracováno":" · Plánováno")).join(" / ")
              : "Dnes není plánovaný trénink. V Gymu můžeš aktivovat vlastní plán."}</p>
          </section>
          <section className="df2-health-section">
            <div className="df2-health-section-heading">
              <div><span>Společný plánovač Dayframe</span><h2>Moje zdravotní návyky</h2></div>
              <button type="button" className="df2-accent-button"
                disabled={blocked} onClick={() => { setDraft(newHealthRoutine()); setError(""); }}>+ Přidat návyk</button>
            </div>
            <p className="df2-health-helper">Splnění se automaticky promítá také do stránky Dnes. Jeden úkol se označuje jen jednou.</p>
            {summaries.length ? (
              <div className="df2-health-routines">
                {summaries.map((summary) => (
                  <article id={"health-routine-" + summary.routine.id} key={summary.routine.id} className="df2-health-routine">
                    <div className="df2-health-routine-main">
                      <strong>{summary.routine.title}</strong>
                      <span>{scheduleLabel(summary.routine.schedule)} · {summary.handled}/{summary.total} hotovo</span>
                      {summary.record.scheduledTasks.map((task) => {
                        const state = summary.record.states[task.id];
                        return <div className="df2-health-task" key={task.id}>
                          <span className={state ? "is-done" : ""}>{task.title}</span>
                          <div>
                            <button type="button" disabled={blocked} aria-pressed={state === "done"}
                              onClick={() => changeStatus(summary.routine.id, task.id, "done")}>
                              {state === "done" ? "✓ Hotovo" : "Hotovo"}
                            </button>
                            <button type="button" disabled={blocked} aria-pressed={state === "skipped"}
                              onClick={() => changeStatus(summary.routine.id, task.id, "skipped")}>Přeskočit</button>
                            {!state && <button type="button" disabled={blocked}
                              onClick={() => postpone(summary.routine.id, task.id)}>Na zítra</button>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="df2-health-empty">Pro dnešek nejsou naplánované žádné zdravotní návyky.</p>}
          </section>

          <section className="df2-health-section">
            <div className="df2-health-section-heading"><div><span>Úprava plánování</span><h2>Správa návyků</h2></div></div>
            {existing.length ? <div className="df2-health-manage">
              {existing.map((routine) => <article key={routine.id}>
                <div><strong>{routine.title}</strong><small>{scheduleLabel(routine.schedule)} · {routine.active ? "Aktivní" : "Pozastaveno"}</small></div>
                <div>
                  {routine.schedule.type === "manual" && <button type="button" disabled={blocked}
                    onClick={() => persist((current) => toggleManualRoutine(current, planningKey, routine.id,
                      !summaries.some((summary) => summary.routine.id === routine.id)))}>
                    {summaries.some((summary) => summary.routine.id === routine.id) ? "Odebrat dnes" : "Naplánovat dnes"}
                  </button>}
                  <button type="button" disabled={blocked} onClick={() => setDraft({
                    ...routine, schedule: routine.schedule.type === "days" ? { ...routine.schedule, weekdays: [...routine.schedule.weekdays] } : { ...routine.schedule },
                    tasks: routine.tasks.map((task) => ({ ...task })),
                  })}>Upravit</button>
                </div>
              </article>)}
            </div> : <p className="df2-health-empty">Zatím nemáš žádné zdravotní návyky. Můžeš je vytvořit bez nového trackeru.</p>}
          </section>

          <section className="df2-health-section">
            <div className="df2-health-section-heading"><div><span>Skutečně uložená splnění</span><h2>Posledních 7 dní</h2></div>
              <button type="button" onClick={() => setShowHistory((value) => !value)}>{showHistory ? "Skrýt" : "Zobrazit"}</button></div>
            {showHistory && <div className="df2-health-history">
              {historyDays.map((date) => {
                // A handled record may be archived when a routine is deactivated or rescheduled.
                // It remains a real completion in historical reporting.
                const records = Object.values(scoped.records[date] ?? {});
                const planned = records.flatMap((record) => record.scheduledTasks.map((task) => ({ record, task })));
                const done = planned.filter(({ record, task }) => record.states[task.id] === "done").length;
                return <div key={date}><time dateTime={date}>{date}</time><span>{planned.length ? done + "/" + planned.length + " splněno" : "Bez záznamu"}</span></div>;
              })}
            </div>}
          </section>
        </div>
      ) : tab === "gym" ? (
        <GymPage today={planningKey} focusKey={focusGymKey} focusDate={focusGymDate} />
      ) : (
        <section className="df2-health-coming-soon">
          <span>ETAPA {activeTab.stage}</span>
          <h2>{activeTab.name}</h2>
          <p>Tento modul je připravený v navigaci. Podrobné funkce přidáme v příslušné další etapě, bez změny existujících hygienických dat.</p>
          <button type="button" onClick={() => setTab("overview")}>Zpět na přehled</button>
        </section>
      )}

      {draft && <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
        <section role="dialog" aria-modal="true" aria-label="Zdravotní návyk" className="df2-modal df2-hygiene-modal">
          <header><div><h2>{existing.some((routine) => routine.id === draft.id) ? "Upravit návyk" : "Nový zdravotní návyk"}</h2></div>
            <button type="button" onClick={() => setDraft(null)} aria-label="Zavřít">×</button></header>
          <label>Název rutiny<input autoFocus maxLength={120} value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Název úkolu<input maxLength={160} value={draft.tasks[0]?.title ?? ""}
            onChange={(event) => setDraft({ ...draft, tasks: draft.tasks.map((task, i) => i === 0 ? { ...task, title: event.target.value } : task) })} /></label>
          <ScheduleEditor value={draft.schedule} planningKey={planningKey}
            onChange={(schedule: HygieneSchedule) => setDraft({ ...draft, schedule })} />
          <label className="df2-hygiene-switch"><input type="checkbox" checked={draft.active}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Aktivní</label>
          <div className="df2-modal-actions">
            <button type="button" className="df2-primary" disabled={blocked} onClick={saveDraft}>Uložit návyk</button>
          </div>
        </section>
      </div>}
    </section>
  );
}
