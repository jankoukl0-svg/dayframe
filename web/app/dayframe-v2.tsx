"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addDaysKey,
  addMilestone,
  addTask,
  calendarBounds,
  canPlaceAt,
  createEmptyState,
  dateFromKey,
  deleteRoutine,
  deleteTask,
  durationBetween,
  editRoutineFutureOnly,
  getTasksForDate,
  localDateKey,
  planningDateKey,
  planningMinute,
  materializeRange,
  migrateStoredState,
  minutesToTime,
  moveTask,
  moveTaskToTomorrow,
  overdueTasks,
  replanWeek,
  startOfWeek,
  timeToMinutes,
  toggleTask,
  updateTask,
  weekKeys,
  type CalendarTask,
  type DayframeState,
  type Priority,
  type RepeatRule,
} from "@/lib/dayframe-calendar";
import { daysUntilDate, getDayCountdown } from "@/lib/dayframe-countdown";
import { parseSmartTaskInput } from "@/lib/dayframe-smart-input";
import { DailyChecklist } from "./daily-checklist";
import { HygienePage } from "./hygiene-page";
import { HealthPage } from "./health-page";
import { useGymStore } from "./use-gym-store";
import { useWeekCare } from "./use-week-care";
import { weekCareBlocks, type WeekCareId } from "@/lib/dayframe-week-care";
import { assignmentsOnDate, gymOccurrenceTime, rescheduleGymOccurrence, setGymOccurrenceTime, deleteGymOccurrence, activeGymPlanOnDate, addGymOneOff, uid } from "@/lib/dayframe-gym";
import {placeWeekGymCollisions} from "@/lib/dayframe-week-gym-lanes";
import {sleepCalendarDateKey} from "@/lib/dayframe-sleep";
import {WeekTripLocationModal,type TripTarget} from "./week-trip-location";
import {readTravelStore,saveTravelStore,travelBlockKey,liveTravelTaskKeys,travelDuration,
  travelReservationsForDay,type TravelCalendarEvent,TRAVEL_SYNC_EVENT} from "@/lib/dayframe-travel";

const STORAGE_KEY = "dayframe-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const MINUTE_HEIGHT = 0.72;
const DROP_MAGNET_RANGE = 60;
const COMPLETION_HOLD_MS = 680;
const COMPLETION_TOAST_MS = 5000;

type View = "today" | "week" | "focus" | "milestones" | "hygiene" | "health" | "settings";

type Draft = {
  title: string;
  date: string;
  duration: number;
  start: string;
  dueDate: string;
  deadlineTime: string;
  priority: Priority;
  category: string;
  repeat: RepeatRule;
};

type DragState = {
  kind: "task" | "gym" | "care";
  id: string;
  date: string;
  duration: number;
  grabOffsetMinutes: number;
};

type DropPreview = {
  date: string;
  start: string;
  duration: number;
  valid: boolean;
};
type GymResize = {
  id:string; date:string; edge:"start"|"end";
  originY:number; originalStart:number; originalDuration:number;
  start:number; duration:number; valid:boolean;
};
type GymTimeEdit = {id:string; date:string; title:string; start:string; duration:number};

type TaskCompletionToast = {
  id: string;
  title: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  date: "",
  duration: 45,
  start: "",
  dueDate: "",
  deadlineTime: "22:30",
  priority: "normal",
  category: "Studium",
  repeat: "none",
});

const categories = ["Studium", "Finance", "Matika", "Angličtina", "VŠE AJ", "Ekonomie", "Opakování", "Plánování", "Rutina", "Osobní"];

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function shortDate(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(dateFromKey(key));
}

function longDate(key: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(dateFromKey(key));
}

function travelClock(total:number){
  const minute=((Math.round(total)%1440)+1440)%1440;
  return String(Math.floor(minute/60)).padStart(2,"0")+":"+String(minute%60).padStart(2,"0");
}

function totalMinutes(items: CalendarTask[]) {
  return items.filter((task) => task.start && task.end).reduce((sum, task) => sum + task.duration, 0);
}

function taskById(state: DayframeState, id: string) {
  for (const tasks of Object.values(state.plans)) {
    const task = tasks.find((item) => item.id === id);
    if (task) return task;
  }
  return null;
}

function cleanSmartTitle(value: string) {
  return parseSmartTaskInput(value).title || value.trim();
}

function dayLabel(key: string, today: string) {
  if (key === today) return "Dnes";
  if (key === addDaysKey(today, 1)) return "Zítra";
  return shortDate(key);
}

export function DayframeV2() {
  const [data, setData] = useState<DayframeState>(() => createEmptyState());
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(new Date());
  const [view, setView] = useState<View>("today");
  const [weekOffset, setWeekOffset] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [addingTask, setAddingTask] = useState(false);
  const [addKind, setAddKind] = useState<"task"|"gym">("task");
  const [gymDayId, setGymDayId] = useState("");
  const [editing, setEditing] = useState<CalendarTask | null>(null);
  const [tripTarget,setTripTarget] = useState<TripTarget|null>(null);
  const [travelStore,setTravelStore] = useState(()=>readTravelStore().store);
  const [offsiteOnCreate,setOffsiteOnCreate] = useState(false);
  useEffect(()=>{
    const refresh=()=>setTravelStore(readTravelStore().store);
    window.addEventListener(TRAVEL_SYNC_EVENT,refresh);window.addEventListener("storage",refresh);
    return ()=>{window.removeEventListener(TRAVEL_SYNC_EVENT,refresh);window.removeEventListener("storage",refresh);};
  },[]);
  function openTrip(kind:"task"|"gym"|"care",id:string,date:string,title:string,start:string,
    initialOffsite=false,end?:string){
    setTripTarget({key:travelBlockKey(kind,id,date),title,date,start,end,initialOffsite});
  }
  function migrateTaskTrip(oldId:string,newId:string,newDate:string,newStart:string){
    if(oldId===newId)return;
    const latest=readTravelStore();
    if(latest.blocked)return;
    const from=travelBlockKey("task",oldId),record=latest.store.blocks[from];
    if(!record)return;
    const blocks={...latest.store.blocks};delete blocks[from];
    blocks[travelBlockKey("task",newId)]={...record,date:newDate,start:newStart};
    saveTravelStore({...latest.store,blocks});
  }
  function removeMissingTaskTrips(nextState:DayframeState){
    const latest=readTravelStore();
    if(latest.blocked)return;
    const live=liveTravelTaskKeys(nextState.plans,nextState.backlog);
    const blocks={...latest.store.blocks};let removed=false;
    for(const key of Object.keys(blocks)){
      if(key.startsWith("task:")&&!live.has(key)){delete blocks[key];removed=true;}
    }
    if(removed)saveTravelStore({...latest.store,blocks});
  }
  function postponeWithTrip(id:string){
    const source=taskById(data,id);
    if(!source)return;
    const before=new Set(Object.values(data.plans).flat().map(t=>t.id));
    const next=moveTaskToTomorrow(data,id,now);
    const created=Object.values(next.plans).flat().find(t=>!before.has(t.id)&&t.title===source.title);
    setData(next);
    if(created)migrateTaskTrip(id,created.id,created.date,created.start??"");
  }
  function removeStoredTrip(key:string){
    const current=readTravelStore();
    if(current.blocked||!current.store.blocks[key])return;
    const blocks={...current.store.blocks};
    delete blocks[key];
    saveTravelStore({...current.store,blocks});
  }
  function moveSavedTrip(kind:"gym"|"care",id:string,oldDate:string,newDate:string,newStart:string){
    const current=readTravelStore();
    if(current.blocked)return;
    const oldKey=travelBlockKey(kind,id,oldDate),newKey=travelBlockKey(kind,id,newDate);
    const saved=current.store.blocks[oldKey];
    if(!saved)return;
    const blocks={...current.store.blocks};
    delete blocks[oldKey];
    blocks[newKey]={...saved,date:newDate,start:newStart};
    saveTravelStore({...current.store,blocks});
  }
  function travelPin(kind:"task"|"gym"|"care",id:string,date:string,title:string,start:string,
    top:number,lane?:{left:string;width:string},end?:string){
    const key=travelBlockKey(kind,id,date),saved=travelStore.blocks[key];
    const assigned=Boolean(saved);
    const minutes=saved?(saved.outboundEnabled===false
      ?saved.returnMinutes:(saved.calendarMinutes??travelDuration(saved))):undefined;
    const missingDuration=assigned&&(!Number.isInteger(minutes)||minutes!<=0);
    return <button type="button" className={"df2-week-location-btn"+(assigned?" has-location":"")+
        (missingDuration?" needs-travel-duration":"")}
      key={"loc-"+key} aria-label={"Místo konání: "+title}
      title={missingDuration
        ?"Místo konání – "+title+" · Doplň dobu cesty, jinak se v Týdnu nerezervuje"
        :"Místo konání – "+title} data-week-place={key}
      style={{top:top+3,...(lane?{left:"calc("+lane.left+" + "+lane.width+" - 25px)",right:"auto"}:{})}}
      onClick={e=>{e.stopPropagation();openTrip(kind,id,date,title,start,false,end);}}>
      {missingDuration?"⏱":assigned?"📍":"⌖"}
    </button>;
  }
  const [editingCare, setEditingCare] = useState<{ date: string; id: WeekCareId; duration: number; title: string } | null>(null);
  const [editingCareStart, setEditingCareStart] = useState("");
  const [editingCareDate, setEditingCareDate] = useState("");
  const [editingCareError, setEditingCareError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [gymResizePreview,setGymResizePreview]=useState<GymResize|null>(null);
  const gymResizeRef=useRef<GymResize|null>(null);
  const [editingGym,setEditingGym]=useState<GymTimeEdit|null>(null);
  const [gymEditError,setGymEditError]=useState("");
  const [focusTask, setFocusTask] = useState<CalendarTask | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(50 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(() => new Set());
  const [completingTaskSnapshots, setCompletingTaskSnapshots] = useState<Map<string, CalendarTask>>(() => new Map());
  const [completionToasts, setCompletionToasts] = useState<TaskCompletionToast[]>([]);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [hygieneRoutineFocus, setHygieneRoutineFocus] = useState<string | null>(null);
  const [healthRoutineFocus, setHealthRoutineFocus] = useState<string | null>(null);
  const [gymFocus, setGymFocus] = useState<{ key:string; date:string } | null>(null);
  const [supplementsFocus,setSupplementsFocus] = useState(false);
  const [bodyFocusDate,setBodyFocusDate]=useState<string|null>(null);
  const [sleepFocusDate,setSleepFocusDate]=useState<string|null>(null);
  const [preventionFocusId,setPreventionFocusId]=useState<string|null>(null);
  const gym = useGymStore();
  const focusTimer = useRef<number | null>(null);
  const completionTimers = useRef<Map<string, number>>(new Map());
  const completionToastTimers = useRef<Map<string, number>>(new Map());
  const todayKey = planningDateKey(now);
  const care = useWeekCare(todayKey);
  const sleepTodayKey = sleepCalendarDateKey(now);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => () => {
    completionTimers.current.forEach((timer) => window.clearTimeout(timer));
    completionToastTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const migrated = migrateStoredState(raw ? JSON.parse(raw) : null, new Date());
      const reference = new Date();
      const today = planningDateKey(reference);
      const ready = materializeRange(migrated, addDaysKey(today, -7), addDaysKey(today, 28), reference);
      setData(ready);
    } catch {
      const fresh = createEmptyState();
      const reference = new Date();
      const today = planningDateKey(reference);
      setData(materializeRange(fresh, addDaysKey(today, -7), addDaysKey(today, 28), reference));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const reference = new Date();
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const migrated = migrateStoredState(raw ? JSON.parse(raw) : null, reference);
        const today = planningDateKey(reference);
        const visibleMonday = addDays(startOfWeek(dateFromKey(today)), weekOffset * 7);
        const visibleKeys = weekKeys(visibleMonday);
        const rangeStart = visibleKeys[0] < addDaysKey(today, -7) ? visibleKeys[0] : addDaysKey(today, -7);
        const rangeEnd = visibleKeys[6] > addDaysKey(today, 28) ? visibleKeys[6] : addDaysKey(today, 28);
        setData(materializeRange(migrated, rangeStart, rangeEnd, reference));
      } catch {
        // Keep the current in-memory state if external storage is malformed.
      }
    };
    window.addEventListener(STATE_SYNC_EVENT, syncFromStorage);
    return () => window.removeEventListener(STATE_SYNC_EVENT, syncFromStorage);
  }, [weekOffset]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const monday = addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7);
    const keys = weekKeys(monday);
    setData((current) => materializeRange(current, keys[0], keys[6], new Date(),
      travelBusyBetween(keys[0],keys[6])));
  }, [weekOffset, hydrated, todayKey]);

  useEffect(() => {
    if (!focusRunning) return;
    focusTimer.current = window.setInterval(() => {
      setFocusSeconds((seconds) => {
        if (seconds <= 1) {
          setFocusRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => { if (focusTimer.current) window.clearInterval(focusTimer.current); };
  }, [focusRunning]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setAddingTask(false);
        setOffsiteOnCreate(false);
        setEditing(null);
        setEditingMilestoneId(null);
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "1") setView("today");
      if (event.key.toLowerCase() === "w") setView("week");
      if (event.key === "2") openAdd();
      if (event.key === "3") setView("focus");
      if (event.key === "4") setView("milestones");
      if (event.key === "5") setView("settings");
      if (event.key === "6") setView("hygiene");
      if (event.key === "7") setView("health");
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  const todayTasks = useMemo(() => getTasksForDate(data, todayKey), [data, todayKey]);
  const visualTodayTasks = useMemo(
    () => todayTasks.map((task) => completingTaskSnapshots.get(task.id) ?? task),
    [todayTasks, completingTaskSnapshots],
  );
  const scheduledToday = visualTodayTasks.filter((task) => task.start && task.end && !task.completed);
  const currentMinute = planningMinute(now);
  const activeTask = scheduledToday.find((task) =>
    timeToMinutes(task.start) <= currentMinute && timeToMinutes(task.end) > currentMinute,
  ) ?? null;
  const missed = visualTodayTasks.filter((task) => !task.completed && task.end && timeToMinutes(task.end) <= currentMinute);
  const missedIds = new Set(missed.map((task) => task.id));
  const afterActive = visualTodayTasks
    .filter((task) => !task.completed && task.id !== activeTask?.id && !missedIds.has(task.id))
    .sort((left, right) => {
      if (left.start && right.start) return timeToMinutes(left.start) - timeToMinutes(right.start);
      if (left.start) return -1;
      if (right.start) return 1;
      return left.title.localeCompare(right.title, "cs");
    });

  const nextPlannedTask = useMemo(() => Object.entries(data.plans)
    .flatMap(([date, tasks]) => tasks
      .filter((task) => !task.completed && task.start && date > todayKey)
      .map((task) => ({ ...task, date })))
    .sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date);
      return dateOrder || timeToMinutes(left.start) - timeToMinutes(right.start);
    })[0] ?? null, [data.plans, todayKey]);

  const monday = useMemo(() => addDays(startOfWeek(dateFromKey(todayKey)), weekOffset * 7), [weekOffset, todayKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(monday, index)), [monday]);
  const weekLabel = `${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(days[6])}`;

  function openAdd(date = "", start = "") {
    setDraft({ ...emptyDraft(), date, start });
    setAddKind("task");
    setGymDayId("");
    setError("");
    setNotice("");
    setAddingTask(true);
  }

  function openAddGym(date = todayKey, start = "") {
    const plan = activeGymPlanOnDate(gym.store,date);
    setDraft({ ...emptyDraft(), date, start, duration:90 });
    setAddKind("gym");
    setGymDayId(plan?.days.find(d=>!d.templateDayId)?.id??"");
    setError("");
    setNotice("");
    setAddingTask(true);
  }

  function closeAdd() {
    setAddingTask(false);
    setAddKind("task");
    setGymDayId("");
    setOffsiteOnCreate(false);
    setDraft(emptyDraft());
    setError("");
  }

  function requestTaskCompletion(id: string) {
    const task = taskById(data, id);
    if (!task) return;

    if (task.completed) {
      setData((current) => toggleTask(current, id));
      setEditing(null);
      return;
    }

    const existing = completionTimers.current.get(id);
    if (existing) window.clearTimeout(existing);

    setCompletingTaskIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setCompletingTaskSnapshots((current) => {
      const next = new Map(current);
      next.set(id, { ...task });
      return next;
    });

    // Persist the completion immediately. The visual hold below only keeps a
    // temporary ghost/modal on screen; it must never be responsible for data durability.
    setData((current) => {
      const currentTask = taskById(current, id);
      return currentTask && !currentTask.completed ? toggleTask(current, id) : current;
    });

    const oldToastTimer = completionToastTimers.current.get(id);
    if (oldToastTimer) window.clearTimeout(oldToastTimer);
    setCompletionToasts((current) => [...current.filter((item) => item.id !== id), { id, title: task.title }]);
    const toastTimer = window.setTimeout(() => {
      setCompletionToasts((current) => current.filter((item) => item.id !== id));
      completionToastTimers.current.delete(id);
    }, COMPLETION_TOAST_MS);
    completionToastTimers.current.set(id, toastTimer);

    const timer = window.setTimeout(() => {
      setCompletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setCompletingTaskSnapshots((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      completionTimers.current.delete(id);
      setEditing((current) => current?.id === id ? null : current);
    }, COMPLETION_HOLD_MS);

    completionTimers.current.set(id, timer);
  }

  function undoTaskCompletion(id: string) {
    const pending = completionTimers.current.get(id);
    if (pending) {
      window.clearTimeout(pending);
      completionTimers.current.delete(id);
    }

    setData((current) => {
      const task = taskById(current, id);
      return task?.completed ? toggleTask(current, id) : current;
    });

    setCompletingTaskIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setCompletingTaskSnapshots((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setCompletionToasts((current) => current.filter((item) => item.id !== id));
    const toastTimer = completionToastTimers.current.get(id);
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      completionToastTimers.current.delete(id);
    }
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (addKind==="gym") {
      const date=draft.date||todayKey, start=draft.start, duration=draft.duration;
      const plan=activeGymPlanOnDate(gym.store,date);
      const day=plan?.days.find(item=>item.id===gymDayId&&!item.templateDayId);
      const minute=timeToMinutes(start);
      if(!gym.hydrated||gym.blocked||!plan||!day){
        setError("Vyber existující trénink ze svého Gym plánu.");return;
      }
      if(date<todayKey || (date===todayKey&&minute<=planningMinute(now))){
        setError("Trénink lze naplánovat pouze do budoucna.");return;
      }
      if(!start || minute<calendarBounds.dayStart || minute%15!==0
        || !Number.isInteger(duration)||duration<30||duration>180||duration%15!==0
        || minute+duration>calendarBounds.dayEnd){
        setError("Vyber začátek po 15 minutách od 08:00 a délku 30–180 minut do 02:00.");return;
      }
      if(!gymSlotOpen(date,start,duration)){
        setError("Tento čas se překrývá s jiným blokem nebo cestou. Vyber volný čas.");return;
      }
      const id=uid("manual");
      let added=false;
      const saved=gym.persist(current=>{
        const next=addGymOneOff(current,plan.id,day.id,date,start,duration,id);
        added=next!==current;
        return next;
      });
      if(!saved||!added){setError("Trénink se nepodařilo uložit. Zkus to znovu.");return;}
      const shouldOpenLocation=offsiteOnCreate;
      setNotice(day.name+" · "+dayLabel(date,todayKey)+" · "+start+"–"+minutesToTime(minute+duration));
      closeAdd();
      if(shouldOpenLocation)openTrip("gym",id,date,day.name,start,true,minutesToTime(minute+duration));
      return;
    }
    if (!draft.title.trim()) return;
    const parsed = parseSmartTaskInput(draft.title);
    const parsedDate = parsed.day === "today" ? todayKey : parsed.day === "tomorrow" ? addDaysKey(todayKey, 1) : "";
    const start = draft.start || parsed.start || "";
    if (draft.repeat !== "none" && !start) {
      setError("Opakovaný blok potřebuje konkrétní čas.");
      return;
    }
    const effective = {
      title: parsed.title || draft.title.trim(),
      date: draft.date || parsedDate || undefined,
      duration: draft.duration === 45 && parsed.duration ? parsed.duration : draft.duration,
      start: start || undefined,
      dueDate: draft.dueDate || undefined,
      deadlineTime: draft.deadlineTime === "22:30" && parsed.deadline ? parsed.deadline : draft.deadlineTime,
      priority: draft.priority === "normal" && parsed.priority ? parsed.priority : draft.priority,
      category: draft.category,
      repeat: draft.repeat,
    };
    const targetFrom=effective.date||todayKey;
    const targetTo=effective.date||addDaysKey(todayKey,6);
    const result = addTask(data, effective, now, travelBusyBetween(targetFrom,targetTo));
    if(result.status==="invalid"){
      setError(result.error);
      return;
    }
    setData(result.state);
    setNotice(result.status === "scheduled"
      ? `${effective.title} · ${dayLabel(result.task.date, todayKey)}${result.task.start ? ` · ${result.task.start}–${result.task.end}` : ""}`
      : `${effective.title} je uložený, ale zatím nemá volný čas.`);
    setDraft(emptyDraft());
    setAddingTask(false);
    if(offsiteOnCreate)
      openTrip("task",result.task.id,result.task.date,result.task.title,result.task.start??"",true,result.task.end);
    setOffsiteOnCreate(false);
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") || editing.date);
    const duration = Number(form.get("duration")) || editing.duration;
    const start = String(form.get("start") || "");
    if(start&&intersectsTravel(date,timeToMinutes(start),timeToMinutes(start)+duration,
      travelBlockKey("task",editing.id))){
      setError("Tento čas zabírá naplánovaná cesta. Vyber jiný termín.");return;
    }
    const result = updateTask(data, editing.id, {
      title: String(form.get("title") || editing.title).trim(),
      date,
      duration,
      start: start || undefined,
      end: start ? minutesToTime(timeToMinutes(start) + duration) : undefined,
      mode: "flexible",
      requestedStart: start || undefined,
      dateLocked: true,
      priority: String(form.get("priority")) as Priority,
      category: String(form.get("category") || editing.category),
      dueDate: String(form.get("dueDate") || "") || undefined,
      deadlineTime: String(form.get("deadlineTime") || "22:30"),
      autoScheduled: !start,
    }, now);
    if (result.error) {
      setError(result.error);
      return;
    }
    setData(result.state);
    setEditing(null);
  }

  function reservedTravel(date:string){
    const events:TravelCalendarEvent[]=[
      ...getTasksForDate(data,date).filter(t=>t.start&&t.end).map(t=>({
        key:travelBlockKey("task",t.id),date,start:t.start!,end:t.end!,title:t.title,
      })),
      ...assignmentsOnDate(gym.store,date).map(occ=>({occ,time:gymOccurrenceTime(gym.store,occ)}))
        .filter(({time})=>time.start!==null).map(({occ,time})=>({
          key:travelBlockKey("gym",occ.key),date,start:time.start!,
          end:minutesToTime(timeToMinutes(time.start!)+time.duration),title:occ.name,
        })),
      ...weekCareBlocks(care.store,date,todayKey,care.times,care.hidden).map(item=>({
        key:travelBlockKey("care",item.id,date),date,start:item.start,
        end:minutesToTime(timeToMinutes(item.start)+item.duration),title:item.title,
      })),
    ];
    return travelReservationsForDay(travelStore,date,events);
  }
  function travelBusyBetween(from:string,to:string){
    const result:Record<string,Array<{start:number;end:number}>>={};
    if(from>to)return result;
    for(let date=from;date<=to;date=addDaysKey(date,1)){
      const projected=reservedTravel(date).map(({start,end})=>({start,end}));
      if(projected.length)result[date]=projected;
    }
    return result;
  }
  function intersectsTravel(date:string,start:number,end:number,ignoreKey?:string):boolean{
    return reservedTravel(date).some(r=>r.key!==ignoreKey&&start<r.end&&end>r.start);
  }
  function gymSlotOpen(date:string,start:string,duration:number):boolean {
    const minute=timeToMinutes(start);
    const tasks=getTasksForDate(data,date);
    const occupiedGym=assignmentsOnDate(gym.store,date)
      .map(occ=>gymOccurrenceTime(gym.store,occ))
      .filter(t=>t.start!==null)
      .map(t=>({start:timeToMinutes(t.start??undefined),end:timeToMinutes(t.start??undefined)+t.duration}));
    const occupiedCare=weekCareBlocks(care.store,date,todayKey,care.times,care.hidden)
      .map(t=>({start:timeToMinutes(t.start),end:timeToMinutes(t.start)+t.duration}));
    return canPlaceAt(tasks,minute,duration)
      && !intersectsTravel(date,minute,minute+duration)
      && ![...occupiedGym,...occupiedCare].some(t=>minute<t.end&&minute+duration>t.start);
  }
  function gymOccurrenceSlotOpen(date:string,id:string,start:string,duration:number):boolean {
    const minute=timeToMinutes(start),end=minute+duration;
    const tasks=getTasksForDate(data,date);
    const otherGym=assignmentsOnDate(gym.store,date)
      .filter(item=>item.key!==id)
      .map(item=>gymOccurrenceTime(gym.store,item))
      .filter(t=>t.start!==null)
      .map(t=>({start:timeToMinutes(t.start??undefined),end:timeToMinutes(t.start??undefined)+t.duration}));
    const otherCare=weekCareBlocks(care.store,date,todayKey,care.times,care.hidden)
      .map(t=>({start:timeToMinutes(t.start),end:timeToMinutes(t.start)+t.duration}));
    const owner=travelBlockKey("gym",id,date);
    const otherJourneys=reservedTravel(date).filter(item=>item.key!==owner);
    if(!canPlaceAt(tasks,minute,duration)||intersectsTravel(date,minute,end,owner)
      ||[...otherGym,...otherCare].some(block=>minute<block.end&&end>block.start))return false;
    if(travelStore.blocks[owner]){
      const projected=travelReservationsForDay(travelStore,date,[{
        key:owner,date,start,end:minutesToTime(end),title:"",
      }]);
      const busy=[
        ...tasks.filter(t=>t.start&&t.end).map(t=>({start:timeToMinutes(t.start),end:timeToMinutes(t.end)})),
        ...otherGym,...otherCare,...otherJourneys.map(t=>({start:t.start,end:t.end})),
      ];
      if(projected.some(trip=>busy.some(other=>trip.start<other.end&&trip.end>other.start)))return false;
    }
    return true;
  }

  function gymChangeAllowed(date:string,start:string,duration:number,id:string):boolean {
    const minute=timeToMinutes(start);
    return Boolean(gym.hydrated&&!gym.blocked&&date>=todayKey
      && (date!==todayKey||minute>planningMinute(now))
      && Number.isFinite(minute)&&minute>=calendarBounds.dayStart
      && minute%15===0&&Number.isInteger(duration)&&duration>=30&&duration<=180
      && duration%15===0&&minute+duration<=calendarBounds.dayEnd
      && gymOccurrenceSlotOpen(date,id,start,duration));
  }

  function commitGymTiming(id:string,date:string,start:string,duration:number):boolean {
    let changed=false;
    const saved=gym.persist(current=>{
      const next=setGymOccurrenceTime(current,id,date,start,duration,planningDateKey(new Date()));
      changed=next!==current;
      return next;
    });
    if(!saved||!changed)return false;
    moveSavedTrip("gym",id,date,date,start);
    return true;
  }

  function gymResizeCandidate(draft:GymResize,clientY:number):GymResize {
    const delta=Math.round((clientY-draft.originY)/(MINUTE_HEIGHT*15))*15;
    const start=draft.edge==="start"?draft.originalStart+delta:draft.originalStart;
    const duration=draft.edge==="start"?draft.originalDuration-delta:draft.originalDuration+delta;
    const valid=Number.isInteger(start)&&start>=calendarBounds.dayStart
      && start+duration<=calendarBounds.dayEnd&&duration>=30&&duration<=180
      && gymChangeAllowed(draft.date,minutesToTime(start),duration,draft.id);
    return {...draft,start,duration,valid};
  }

  function onGymResizeStart(event:React.PointerEvent<HTMLButtonElement>,
    id:string,date:string,edge:"start"|"end",start:number,duration:number) {
    if(event.button!==0||!gym.hydrated||gym.blocked)return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const draft:GymResize={id,date,edge,originY:event.clientY,originalStart:start,
      originalDuration:duration,start,duration,valid:true};
    gymResizeRef.current=draft;
    setGymResizePreview(draft);
    setDragging(null);
    setDropPreview(null);
  }

  function onGymResizeMove(event:React.PointerEvent<HTMLButtonElement>) {
    if(!gymResizeRef.current)return;
    const candidate=gymResizeCandidate(gymResizeRef.current,event.clientY);
    setGymResizePreview(candidate);
  }

  function onGymResizeEnd(event:React.PointerEvent<HTMLButtonElement>) {
    const initial=gymResizeRef.current;
    if(!initial)return;
    const value=gymResizeCandidate(initial,event.clientY);
    gymResizeRef.current=null;
    setGymResizePreview(null);
    if(value.start===initial.originalStart&&value.duration===initial.originalDuration)return;
    if(!value.valid){
      setNotice("Pro změnu délky není volný prostor nebo nový čas není povolen. Trénink zůstal beze změny.");
      return;
    }
    if(!commitGymTiming(value.id,value.date,minutesToTime(value.start),value.duration))
      setNotice("Čas tréninku se nepodařilo uložit.");
  }

  function saveEditedGym(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!editingGym)return;
    const form=new FormData(event.currentTarget);
    const date=String(form.get("date")||"");
    const start=String(form.get("start")||"");
    const duration=Number(form.get("duration"));
    const from=editingGym.date;
    const same=date===from;
    if(!gymChangeAllowed(date,start,duration,editingGym.id)){
      setGymEditError("Vyber budoucí čas bez kolizí, v délce 30–180 minut po 15 minutách.");
      return;
    }
    let changed=false;
    const saved=gym.persist(current=>{
      const moved=same?current:rescheduleGymOccurrence(
        current,editingGym.id,from,date,start,planningDateKey(new Date()));
      if(!same&&moved===current)return current;
      const next=setGymOccurrenceTime(moved,editingGym.id,date,start,duration,
        planningDateKey(new Date()));
      changed=next!==current;
      return next;
    });
    if(!saved||!changed){
      setGymEditError("Úpravu tréninku se nepodařilo uložit. Rozpracované nebo dokončené tréninky nelze přesouvat.");
      return;
    }
    moveSavedTrip("gym",editingGym.id,from,date,start);
    setEditingGym(null);
    setGymEditError("");
  }

  function careHasRecordedProgress(date: string, routineId: string): boolean {
    return Object.keys(care.store?.records[date]?.[routineId]?.states ?? {}).length > 0;
  }

  function careSlotOpen(date: string, id: WeekCareId, start: string, duration: number): boolean {
    const minute = timeToMinutes(start);
    const tasks = getTasksForDate(data, date);
    const otherCare = weekCareBlocks(care.store, date, todayKey, care.times, care.hidden)
      .filter(item => item.id !== id)
      .map(item => ({ start: timeToMinutes(item.start), end: timeToMinutes(item.start) + item.duration }));
    const otherGym = assignmentsOnDate(gym.store, date)
      .map(item => gymOccurrenceTime(gym.store, item))
      .filter(item => item.start !== null)
      .map(item => ({ start: timeToMinutes(item.start ?? undefined), end: timeToMinutes(item.start ?? undefined) + item.duration }));
    return canPlaceAt(tasks, minute, duration)
      && !intersectsTravel(date,minute,minute+duration,travelBlockKey("care",id,date))
      && ![...otherCare, ...otherGym].some(item => minute < item.end && minute + duration > item.start);
  }

  function saveEditedCare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCare || care.blocked || !care.hydrated || editingCare.date < todayKey) return;
    const date = editingCareDate || editingCare.date;
    const id = editingCare.id;
    const movedDay = date !== editingCare.date;
    const source = weekCareBlocks(care.store, editingCare.date, todayKey, care.times, care.hidden)
      .find(item => item.id === id);
    if (editingCare.date === todayKey && source
      && timeToMinutes(source.start) <= planningMinute(now)
      && (source.completed || careHasRecordedProgress(editingCare.date, source.routineId))) {
      setEditingCareError("Rozpracovanou nebo splněnou hygienu již nelze přesunout.");
      return;
    }
    const movableDay = care.store?.fixedRepeatRoutineId === id.slice("rolling:".length);
    if (movedDay && (!movableDay || date < todayKey || dateFromKey(date).getDay() === 0)) {
      setEditingCareError("Tento výskyt lze přesunout jen na budoucí den mimo neděli.");
      return;
    }
    if (movedDay && weekCareBlocks(care.store, date, todayKey, care.times, care.hidden).some(item => item.id === id)) {
      setEditingCareError("Na tomto dni už máš opakovanou hygienu naplánovanou.");
      return;
    }
    const start = editingCareStart;
    const minute = timeToMinutes(start);
    const duration = editingCare.duration;
    if (!/^\d{2}:\d{2}$/.test(start)
      || minute < calendarBounds.dayStart || minute + duration > calendarBounds.dayEnd
      || minute % calendarBounds.slot !== 0
      || (date === todayKey && minute <= planningMinute(now))) {
      setEditingCareError("Vyber budoucí čas v rámci dne po 15 minutách.");
      return;
    }
    if (!careSlotOpen(date, id, start, duration)) {
      setEditingCareError("Tento čas už zabírá jiný blok. Vyber jiné místo.");
      return;
    }
    if (!(movedDay
      ? care.moveDate(editingCare.date, date, id, start)
      : care.move(date, id, start))) {
      setEditingCareError("Přesun se nepodařilo uložit. Rutina už mohla být zahájená, nebo má zvolený den jiný výskyt.");
      return;
    }
    moveSavedTrip("care",id,editingCare.date,date,start);
    setEditingCare(null);
    setEditingCareError("");
  }

  function hideEditedCare() {
    if (!editingCare || care.blocked || editingCare.date < todayKey) return;
    if (!care.setHiddenForDay(editingCare.date, editingCare.id, true)) {
      setEditingCareError("Blok se nepodařilo odebrat. Data zůstala beze změny.");
      return;
    }
    removeStoredTrip(travelBlockKey("care",editingCare.id,editingCare.date));
    setEditingCare(null);
    setEditingCareError("");
  }

  function nearestOpenDrop(date: string, desiredStart: number, duration: number, id: string) {
    if(dragging?.kind==="gym"&&date<todayKey)return null;
    // Linked hygiene reservations keep their authoritative routine date; only their clock time moves.
    if(dragging?.kind==="care"&&(date<todayKey
      || (date!==dragging.date && (
        care.store?.fixedRepeatRoutineId !== dragging.id.slice("rolling:".length)
        || dateFromKey(date).getDay() === 0
        || weekCareBlocks(care.store,date,todayKey,care.times,care.hidden).some(item=>item.id===dragging.id)
      ))))return null;
    const min = calendarBounds.dayStart;
    const max = calendarBounds.dayEnd - duration;
    const rounded = Math.max(min, Math.min(max, Math.round(desiredStart / calendarBounds.slot) * calendarBounds.slot));
    const destination = getTasksForDate(data, date).filter(task => dragging?.kind==="task" ? task.id!==id : true);
    const otherGym = assignmentsOnDate(gym.store,date)
      .filter(occ=>dragging?.kind!=="gym"||occ.key!==id)
      .map(occ=>gymOccurrenceTime(gym.store,occ))
      .filter(time=>time.start!==null)
      .map(time=>({start:timeToMinutes(time.start??undefined),end:timeToMinutes(time.start??undefined)+time.duration}));
    const otherCare=weekCareBlocks(care.store,date,todayKey,care.times,care.hidden)
      .filter(item=>dragging?.kind!=="care"||date!==dragging.date||item.id!==dragging.id)
      .map(item=>({start:timeToMinutes(item.start),end:timeToMinutes(item.start)+item.duration}));
    const ownerKey=dragging?.kind==="task"?travelBlockKey("task",dragging.id):
      dragging?.kind==="gym"?travelBlockKey("gym",dragging.id):
        travelBlockKey("care",dragging?.id??"",dragging?.date);
    const otherJourneys=reservedTravel(date).filter(r=>r.key!==ownerKey);
    const busyForJourney=[
      ...destination.filter(t=>t.start&&t.end).map(t=>({
        start:timeToMinutes(t.start),end:timeToMinutes(t.end)})),
      ...otherGym,...otherCare,
      ...otherJourneys.map(r=>({start:r.start,end:r.end})),
    ];
    const offsets = [0, -15, 15, -30, 30, -45, 45, -60, 60];
    for (const offset of offsets) {
      if (Math.abs(offset) > DROP_MAGNET_RANGE) continue;
      const candidate = rounded + offset;
      if (candidate < min || candidate > max) continue;
      if (dragging?.kind==="care"&&date===todayKey&&candidate<=planningMinute(now))continue;
      // A journey follows its parent block. Check its newly projected outbound
      // and return slots against all other events, not just the dragged event.
      if(travelStore.blocks[ownerKey]){
        const own=travelReservationsForDay(travelStore,date,[{
          key:ownerKey,date,start:minutesToTime(candidate),
          end:minutesToTime(candidate+duration),title:"",
        }]);
        if(own.some(res=>busyForJourney.some(other=>
          res.start<other.end&&res.end>other.start)))continue;
      }
      if (canPlaceAt(destination, candidate, duration)
        && !intersectsTravel(date,candidate,candidate+duration,
          dragging?.kind==="task"?travelBlockKey("task",dragging.id):
            dragging?.kind==="gym"?travelBlockKey("gym",dragging.id):
              travelBlockKey("care",dragging?.id??"",dragging?.date))
        && !otherGym.some(block=>candidate<block.end && candidate+duration>block.start)
        && !otherCare.some(block=>candidate<block.end && candidate+duration>block.start))return candidate;
    }
    return null;
  }

  function previewForPointer(event: React.DragEvent<HTMLDivElement>, date: string): DropPreview | null {
    if (!dragging) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerMinute = calendarBounds.dayStart + (event.clientY - rect.top) / MINUTE_HEIGHT;
    const desiredStart = pointerMinute - dragging.grabOffsetMinutes;
    const fallback = Math.max(
      calendarBounds.dayStart,
      Math.min(calendarBounds.dayEnd - dragging.duration, Math.round(desiredStart / calendarBounds.slot) * calendarBounds.slot),
    );
    const snapped = nearestOpenDrop(date, desiredStart, dragging.duration, dragging.id);
    return {
      date,
      start: minutesToTime(snapped ?? fallback),
      duration: dragging.duration,
      valid: snapped !== null,
    };
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const preview = previewForPointer(event, date);
    if (!preview) return;
    setDropPreview((current) => current?.date === preview.date
      && current.start === preview.start
      && current.valid === preview.valid
      && current.duration === preview.duration
      ? current
      : preview);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    if (!dragging) return;
    const preview = previewForPointer(event, date);
    if (!preview?.valid) {
      setDragging(null);
      setDropPreview(null);
      setNotice(dragging.kind==="gym"&&date<todayKey?"Trénink nelze přesunout do minulého dne.":"Tady není volný 15min slot poblíž. Blok zůstal na původním místě.");
      return;
    }
    const selection=dragging;
    setDragging(null);
    setDropPreview(null);
    if(selection.kind==="care"){
      const success=date===selection.date
        ? care.move(date,selection.id as WeekCareId,preview.start)
        : care.moveDate(selection.date,date,selection.id as WeekCareId,preview.start);
      if(!success)setNotice("Čas hygienické rutiny se nepodařilo uložit. Data nebyla změněna.");
      else moveSavedTrip("care",selection.id,selection.date,date,preview.start);
      return;
    }
    if(selection.kind==="gym"){
      let didChange=false;
      const saved=gym.persist(current=>{
        const updated=rescheduleGymOccurrence(current,selection.id,selection.date,date,preview.start,planningDateKey(new Date()));
        didChange=updated!==current;
        return updated;
      });
      if(!saved)setNotice("Nepodařilo se uložit nový čas tréninku.");
      else if(!didChange)setNotice("Tento trénink nelze přesunout. Již zahájené tréninky zůstávají na svém místě.");
      else moveSavedTrip("gym",selection.id,selection.date,date,preview.start);
      return;
    }
    const result=moveTask(data,selection.id,date,preview.start);
    if(result.error){setNotice(result.error);return;}
    setData(result.state);
    if(result.task&&result.task.id!==selection.id)
      migrateTaskTrip(selection.id,result.task.id,result.task.date,result.task.start??"");
  }

  function startFocus(task: CalendarTask | null) {
    setFocusTask(task);
    setFocusSeconds(50 * 60);
    setFocusRunning(true);
    setView("focus");
  }

  function addNewMilestone(event: React.FormEvent) {
    event.preventDefault();
    if (!milestoneTitle.trim() || !milestoneDate) return;
    setData((current) => addMilestone(current, milestoneTitle, milestoneDate));
    setMilestoneTitle("");
    setMilestoneDate("");
  }

  function saveMilestoneEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMilestoneId) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const date = String(form.get("date") || "");
    const note = String(form.get("note") || "").trim();
    if (!title || !date) return;
    setData((current) => ({
      ...current,
      milestones: current.milestones
        .map((milestone) => milestone.id === editingMilestoneId
          ? { ...milestone, title, date, note: note || "Vlastní termín" }
          : milestone)
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setEditingMilestoneId(null);
  }

  function removeMilestone(id: string) {
    setData((current) => ({ ...current, milestones: current.milestones.filter((milestone) => milestone.id !== id) }));
    setEditingMilestoneId(null);
  }

  const editingMilestone = editingMilestoneId
    ? data.milestones.find((milestone) => milestone.id === editingMilestoneId) ?? null
    : null;

  return (
    <main className={`df2-root ${view === "focus" ? "df2-focus-mode" : ""}`}>
      <div className="df2-shell">
        <aside className="df2-sidebar">
          <button className="df2-brand" onClick={() => setView("today")}><span>D</span><strong>Dayframe</strong></button>
          <nav>
            <NavButton active={view === "today"} onClick={() => setView("today")} label="Dnes" shortcut="1" />
            <NavButton active={view === "week"} onClick={() => setView("week")} label="Týden" shortcut="W" />
            <NavButton active={view === "milestones"} onClick={() => setView("milestones")} label="Milníky" shortcut="4" />
            <NavButton active={view === "hygiene"} onClick={() => { setHygieneRoutineFocus(null); setView("hygiene"); }} label="Hygiena" shortcut="6" />
            <NavButton active={view === "health"} onClick={() => { setHealthRoutineFocus(null); setGymFocus(null); setSupplementsFocus(false); setBodyFocusDate(null); setSleepFocusDate(null); setPreventionFocusId(null); setView("health"); }} label="Zdraví" shortcut="7" />
            <NavButton active={view === "settings"} onClick={() => setView("settings")} label="Nastavení" shortcut="5" />
          </nav>
          <div className="df2-sidebar-bottom"><span>Den končí</span><strong>02:00</strong></div>
        </aside>

        <section className="df2-main">
          {view === "today" && (
            <TodayView
              now={now}
              sleepDateKey={sleepTodayKey}
              tasks={todayTasks}
              activeTask={activeTask}
              nextTasks={afterActive}
              nextPlannedTask={nextPlannedTask}
              missed={missed}
              milestones={data.milestones}
              onAdd={() => openAdd(todayKey)}
              onEdit={setEditing}
              onDone={requestTaskCompletion}
              completingTaskIds={completingTaskIds}
              onTomorrow={postponeWithTrip}
               onDelete={(id) => {removeStoredTrip(travelBlockKey("task",id));setData((current) => deleteTask(current, id));}}
              onFocus={startFocus}
              onMilestones={() => setView("milestones")}
              onOpenHygiene={(routineId) => {
                setHygieneRoutineFocus(routineId);
                setView("hygiene");
              }}
              onOpenHealth={(routineId) => {
                setHealthRoutineFocus(routineId);
                setView("health");
              }}
              onOpenGym={(key,date) => { setGymFocus({key,date}); setView("health"); }}
              onOpenSupplements={() => {setSupplementsFocus(true);setView("health");}}
              onOpenBody={(date) => {setBodyFocusDate(date);setView("health");}}
              onOpenSleep={(date) => {setSleepFocusDate(date);setView("health");}}
              onOpenPrevention={(id) => {setPreventionFocusId(id);setView("health");}}
            />
          )}

          {view === "hygiene" && (
            <HygienePage
              planningKey={todayKey}
              focusRoutineId={hygieneRoutineFocus}
              onFocusHandled={() => setHygieneRoutineFocus(null)}
            />
          )}

          {view === "health" && (
            <HealthPage planningKey={todayKey} sleepTodayKey={sleepTodayKey} focusRoutineId={healthRoutineFocus}
              onFocusHandled={() => setHealthRoutineFocus(null)} focusGymKey={gymFocus?.key} focusGymDate={gymFocus?.date}
              onGymFocusHandled={() => setGymFocus(null)} focusSupplements={supplementsFocus}
              onSupplementsFocusHandled={() => setSupplementsFocus(false)} focusBodyDate={bodyFocusDate}
              onBodyFocusHandled={()=>setBodyFocusDate(null)} focusSleepDate={sleepFocusDate}
              onSleepFocusHandled={()=>setSleepFocusDate(null)} focusPreventionId={preventionFocusId}
              onPreventionFocusHandled={()=>setPreventionFocusId(null)} />
          )}

          {view === "week" && (
            <section className="df2-week-view">
              <header className="df2-page-head">
                <div><p>{weekLabel}</p><h1>Týden</h1></div>
                <div className="df2-week-controls">
                  <button onClick={() => setWeekOffset((value) => value - 1)}>←</button>
                  <button onClick={() => setWeekOffset(0)}>Tento týden</button>
                  <button onClick={() => setWeekOffset((value) => value + 1)}>→</button>
                  <button type="button" onClick={() => openAddGym(days.map(d=>localDateKey(d)).find(key=>key>=todayKey)??todayKey)}>+ Trénink</button>
                  <button className="df2-accent-button" onClick={() => setData((current) => replanWeek(current, monday, now,
                    travelBusyBetween(weekKeys(monday)[0],weekKeys(monday)[6])))}>Přepočítat týden</button>
                </div>
              </header>
              {notice && <div className="df2-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
              <div className="df2-week-scroll">
                <div className="df2-week-grid">
                  {days.map((day) => {
                    const key = localDateKey(day);
                    const tasks = getTasksForDate(data, key);
                    const unscheduled = tasks.filter((task) => !task.start);
                    const scheduled = tasks.filter((task) => task.start && task.end);
                    const timedCare=care.hydrated
                      ? weekCareBlocks(care.store,key,todayKey,care.times,care.hidden) : [];
                    const timedGym=assignmentsOnDate(gym.store,key)
                      .map(occ=>({occ,time:gymOccurrenceTime(gym.store,occ)}))
                      .filter(item=>item.time.start!==null);
                    const travelEvents:TravelCalendarEvent[]=[
                      ...scheduled.map(task=>({key:travelBlockKey("task",task.id),date:key,
                        start:task.start!,end:task.end!,title:task.title})),
                      ...timedCare.map(item=>({key:travelBlockKey("care",item.id,key),date:key,
                        start:item.start,end:minutesToTime(timeToMinutes(item.start)+item.duration),title:item.title})),
                      ...timedGym.map(({occ,time})=>({key:travelBlockKey("gym",occ.key),date:key,
                        start:time.start!,end:minutesToTime(timeToMinutes(time.start!)+time.duration),title:occ.name})),
                    ];
                    const travelReservations=travelReservationsForDay(travelStore,key,travelEvents);
                    // Travel slots reflect their parent's completion, without becoming
                    // independently completable tasks or modifying the travel store.
                    const completedTravelOwners=new Set([
                      ...scheduled.filter(task=>task.completed)
                        .map(task=>travelBlockKey("task",task.id)),
                      ...timedCare.filter(item=>item.completed)
                        .map(item=>travelBlockKey("care",item.id,key)),
                      ...timedGym.filter(({occ})=>occ.completed)
                        .map(({occ})=>travelBlockKey("gym",occ.key)),
                    ]);
                    const lanePositions=placeWeekGymCollisions([
                      ...travelReservations.map(item=>({id:"travel:"+item.id,
                        start:Math.max(calendarBounds.dayStart,item.start),
                        end:Math.min(calendarBounds.dayEnd,item.end),gym:true})),
                      ...timedCare.map(item=>({
                        id:"care:"+item.id,start:timeToMinutes(item.start),
                        end:timeToMinutes(item.start)+item.duration,gym:true})),
                      ...timedGym.map(({occ,time})=>({
                        id:"gym:"+occ.key,start:timeToMinutes(time.start??undefined),
                        end:timeToMinutes(time.start??undefined)+time.duration,gym:true})),
                      ...scheduled.map(task=>({
                        id:"task:"+task.id,start:timeToMinutes(task.start),
                        end:timeToMinutes(task.start)+task.duration,gym:false})),
                    ]);
                    return (
                      <article className={`df2-week-day ${key === todayKey ? "today" : ""}`} key={key}>
                        <header className="df2-week-day-head" onClick={() => key >= todayKey && openAdd(key)}>
                          <div><span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(day).replace(".", "")}</span><strong>{day.getDate()}</strong></div>
                          <button disabled={key < todayKey} onClick={(event) => { event.stopPropagation(); openAdd(key); }}>+</button>
                        </header>
                        <div className="df2-unscheduled">
                          {unscheduled.map((task) => <button key={task.id} onClick={() => setEditing(task)}>{task.title}<small>bez času</small></button>)}
                          {/* Unscheduled Gym items remain in the Gym planner and daily checklist.
                               We never fabricate an hour or float them above the week grid. */}
                        </div>
                        {travelReservations.some(res=>res.outsideCalendar)&&<div className="df2-week-travel-outside"
                          role="note" aria-label="Odjezdy mimo zobrazené hodiny">
                          {travelReservations.filter(res=>res.outsideCalendar)
                            .sort((a,b)=>a.start-b.start).map(res=><button
                            key={res.id} type="button"
                            className={completedTravelOwners.has(res.key)?"is-completed":undefined}
                            aria-label={(res.direction==="outbound"?"Vyjeď v ":"Vyjeď domů v ")+travelClock(res.start)+" · "+res.title}
                            title={res.title+" · "+travelClock(res.start)+"–"+travelClock(res.end)}
                            onClick={()=>{const src=travelEvents.find(e=>e.key===res.key);
                              setTripTarget({key:res.key,date:key,title:res.title,
                                start:src?.start??"",end:src?.end});}}>
                            <strong>{res.direction==="outbound"?"Vyjeď v ":"Vyjeď domů v "}{travelClock(res.start)}</strong>
                            <span>{res.title}{res.start<0?" · předchozí den":res.start>=1440?" · následující den":""}</span>
                          </button>)}
                        </div>}
                        <div
                          className={`df2-time-body ${dropPreview?.date === key ? "drop-active" : ""}`}
                          style={{ height: `${(calendarBounds.dayEnd - calendarBounds.dayStart) * MINUTE_HEIGHT}px` }}
                          onDragOver={(event) => onDragOver(event, key)}
                          onDrop={(event) => onDrop(event, key)}
                        >
                          {Array.from({ length: Math.floor((calendarBounds.dayEnd - calendarBounds.dayStart) / 60) + 1 }, (_, index) => {
                            const minute = calendarBounds.dayStart + index * 60;
                            return <span className="df2-hour-line" key={minute} style={{ top: `${index * 60 * MINUTE_HEIGHT}px` }}><em>{minutesToTime(minute)}</em></span>;
                          })}
                          <div className="df2-lunch" style={{ top: `${(calendarBounds.lunchStart - calendarBounds.dayStart) * MINUTE_HEIGHT}px`, height: `${60 * MINUTE_HEIGHT}px` }}><span>oběd</span></div>
                          {dropPreview?.date === key && (
                            <div
                              className={`df2-drop-preview ${dropPreview.valid ? "valid" : "invalid"}`}
                              style={{
                                top: `${(timeToMinutes(dropPreview.start) - calendarBounds.dayStart) * MINUTE_HEIGHT}px`,
                                height: `${dropPreview.duration * MINUTE_HEIGHT}px`,
                              }}
                              aria-hidden="true"
                            >
                              <strong>{dropPreview.valid ? dropPreview.start : "není místo"}</strong>
                            </div>
                          )}
                          {travelReservations.map(reservation=>{
                            const from=Math.max(calendarBounds.dayStart,reservation.start);
                            const to=Math.min(calendarBounds.dayEnd,reservation.end);
                            if(to<=from)return null;
                            const source=travelEvents.find(e=>e.key===reservation.key);
                            const dir=reservation.direction==="outbound"?"Cesta tam":"Cesta domů";
                            const label=dir+" · "+reservation.title;
                            const range=travelClock(reservation.start)+"–"+travelClock(reservation.end);
                            return <button key={"travel:"+reservation.id} type="button"
                              data-week-travel={reservation.id}
                              className={"df2-week-travel"+(reservation.estimated?" is-estimate":"")+(completedTravelOwners.has(reservation.key)?" is-completed":"")}
                              style={{
                                top:(from-calendarBounds.dayStart)*MINUTE_HEIGHT+"px",
                                height:Math.max(18,(to-from)*MINUTE_HEIGHT)+"px",
                                ...(lanePositions["travel:"+reservation.id]??{}),
                              }}
                              aria-label={label+", "+range}
                              title={label+" · "+range+(reservation.estimated?" · orientační odhad":"")}
                              onClick={()=>setTripTarget({
                                key:reservation.key,title:reservation.title,date:key,
                                start:source?.start??"",end:source?.end,
                              })}>
                              <span>{range}</span>
                              <strong>{reservation.direction==="outbound"?"→ Cesta tam":"← Cesta domů"}</strong>
                            </button>;
                          })}
                          {timedGym.map(({occ,time})=>{
                            if(!time.start)return null;
                            const top=(timeToMinutes(time.start)-calendarBounds.dayStart)*MINUTE_HEIGHT;
                            const height=time.duration*MINUTE_HEIGHT;
                            const end=minutesToTime(timeToMinutes(time.start)+time.duration);
                            return <Fragment key={occ.key}><button type="button" data-week-gym={occ.key}
                              className={`df2-week-task df2-week-gym ${occ.completed?"done":""}`}
                              style={{top:`${top}px`,height:`${height}px`,...(lanePositions["gym:"+occ.key]??{})}}
                              draggable={key>=todayKey&&!occ.session&&gym.hydrated&&!gym.blocked}
                              onDragStart={event=>{
                                if(key<todayKey||occ.session||gym.blocked){event.preventDefault();return;}
                                const rect=event.currentTarget.getBoundingClientRect();
                                const grabPixels=Math.max(0,Math.min(rect.height,event.clientY-rect.top));
                                const grabOffsetMinutes=Math.max(0,Math.min(time.duration,grabPixels/MINUTE_HEIGHT));
                                event.dataTransfer.effectAllowed="move";
                                event.dataTransfer.setData("text/plain",occ.key);
                                setDragging({kind:"gym",id:occ.key,date:key,duration:time.duration,grabOffsetMinutes});
                                setDropPreview({date:key,start:time.start!,duration:time.duration,valid:true});
                              }}
                              onDragEnd={()=>{setDragging(null);setDropPreview(null);}}
                              title={occ.session?"Otevřít zahájený trénink v Gymu":"Přetáhni trénink na jiný čas nebo den; kliknutím otevřeš Gym"}
                              onClick={()=>{setGymFocus({key:occ.key,date:key});setView("health");}}> 
                              <span>{time.start}–{end}</span><strong>{occ.name}</strong>
                              <small>{occ.completed?"✓ Hotovo":occ.session?"Rozpracováno":"Gym & Tréninky"}</small>
                            </button>
                              {travelPin("gym",occ.key,key,occ.name,time.start,top,lanePositions["gym:"+occ.key],end)}
                              {(key<todayKey||occ.session||occ.key.startsWith("manual-"))&&gym.hydrated&&!gym.blocked&&<button
                                type="button" className={"df2-week-gym-delete"+(occ.key.startsWith("manual-")?" is-manual":"")}
                                aria-label={"Smazat trénink "+occ.name+" ze dne "+key}
                                title="Smazat tento trénink z historie (ostatní týdny zůstanou)"
                                style={{top:top+Math.max(15,height-19),...(lanePositions["gym:"+occ.key]
                                  ?{left:"calc("+lanePositions["gym:"+occ.key].left+" + "+
                                     lanePositions["gym:"+occ.key].width+" - 23px)",right:"auto"}:{})}}
                                onClick={event=>{
                                  event.stopPropagation();
                                  if(!window.confirm("Smazat trénink „"+occ.name+"“ ze dne "+key+
                                    "? Smažou se i případné zapsané série a výkony tohoto dne. Ostatní tréninky a opakovaný plán zůstanou."))return;
                                  let changed=false;
                                  const saved=gym.persist(store=>{
                                    const next=deleteGymOccurrence(store,occ.key,key);
                                    changed=next!==store;
                                    return next;
                                  });
                                  if(saved&&changed){
                                    removeStoredTrip(travelBlockKey("gym",occ.key,key));
                                    setNotice("Trénink byl odstraněn pouze z "+key+". Další týdny zůstaly beze změny.");
                                  }else setNotice("Trénink se nepodařilo smazat.");
                                }}>×</button>}

                              </Fragment>;
                          })}
                          {timedCare.map(item=>{
                            const startMinute=timeToMinutes(item.start);
                            const end=minutesToTime(startMinute+item.duration);
                            // An unhandled Hygiene block can be rescheduled after its
                            // original time has passed today. Drop/edit validation still
                            // requires the destination to be in the future; past dates
                            // and saved completion history remain untouched.
                            const elapsedToday = key===todayKey && startMinute<=planningMinute(now);
                            const recordedProgress = elapsedToday && careHasRecordedProgress(key, item.routineId);
                            const draggable=key>=todayKey
                              && (!elapsedToday || (!item.completed && !recordedProgress))
                              && care.hydrated&&!care.blocked;
                            return (
                              <Fragment key={item.id}><button type="button" data-week-care={item.id}
                                className={"df2-week-task df2-week-care"+(item.duration===20?" is-short":"")+(item.completed?" done":"")}
                                style={{
                                  top:((startMinute-calendarBounds.dayStart)*MINUTE_HEIGHT)+"px",
                                  height:(item.duration*MINUTE_HEIGHT)+"px",
                                  ...(lanePositions["care:"+item.id]??{}),
                                }}
                                draggable={draggable}
                                onDragStart={event=>{
                                  if(!draggable){event.preventDefault();return;}
                                  const rect=event.currentTarget.getBoundingClientRect();
                                  const grabbed=Math.max(0,Math.min(rect.height,event.clientY-rect.top));
                                  const offset=Math.max(0,Math.min(item.duration,grabbed/MINUTE_HEIGHT));
                                  event.dataTransfer.effectAllowed="move";
                                  event.dataTransfer.setData("text/plain",item.id);
                                  setDragging({kind:"care",id:item.id,date:key,duration:item.duration,grabOffsetMinutes:offset});
                                  setDropPreview({date:key,start:item.start,duration:item.duration,valid:true});
                                }}
                                onDragEnd={()=>{setDragging(null);setDropPreview(null);}}
                                onClick={()=>{
                                  setEditingCare({date:key,id:item.id,duration:item.duration,title:item.title});
                                  setEditingCareStart(item.start);
                                  setEditingCareDate(key);
                                  setEditingCareError("");
                                }}
                                title={item.start+"–"+end+" · "+item.title+" · Kliknutím upravíš nebo odebereš tento den"}
                                aria-label={item.title+", "+item.start+"–"+end}
                              >
                                {item.duration === 30 && <span>{item.start}–{end}</span>}
                                <strong>{item.title}</strong>
                              </button>
                              {travelPin("care",item.id,key,item.title,item.start,
                                (timeToMinutes(item.start)-calendarBounds.dayStart)*MINUTE_HEIGHT,
                                lanePositions["care:"+item.id],minutesToTime(timeToMinutes(item.start)+item.duration))}
                              </Fragment>
                            );
                          })}
                          {scheduled.map((task) => {
                            const top = (timeToMinutes(task.start) - calendarBounds.dayStart) * MINUTE_HEIGHT;
                            const height = task.duration * MINUTE_HEIGHT;
                            return (
                              <Fragment key={task.id}><button
                                className={`df2-week-task ${task.completed ? "done" : ""}`}
                                style={{ top: `${top}px`, height: `${height}px`, ...(lanePositions["task:"+task.id]??{}) }}
                                draggable={!task.completed}
                                onDragStart={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const grabPixels = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                                  const grabOffsetMinutes = Math.max(0, Math.min(task.duration, grabPixels / MINUTE_HEIGHT));
                                  event.dataTransfer.effectAllowed = "move";
                                  setDragging({ kind:"task", id: task.id, date: key, duration: task.duration, grabOffsetMinutes });
                                  setDropPreview({ date: key, start: task.start ?? minutesToTime(calendarBounds.dayStart), duration: task.duration, valid: true });
                                }}
                                onDragEnd={() => { setDragging(null); setDropPreview(null); }}
                                onClick={() => setEditing(task)}
                                title="Přetáhni blok na jiný čas"
                              >
                                <span>{task.start}–{task.end}</span>
                                <strong>{task.title}</strong>
                              </button>
                              {travelPin("task",task.id,key,task.title,task.start!,
                                (timeToMinutes(task.start)-calendarBounds.dayStart)*MINUTE_HEIGHT,
                                lanePositions["task:"+task.id],task.end)}
                              </Fragment>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {view === "focus" && (
            <section className="df2-focus-view">
              <p>{focusTask ? `${focusTask.start ?? ""} · ${focusTask.category}` : "Focus blok"}</p>
              <h1>{focusTask?.title ?? activeTask?.title ?? "Soustředění"}</h1>
              <div className="df2-focus-clock">{String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:{String(focusSeconds % 60).padStart(2, "0")}</div>
              <div className="df2-focus-actions"><button onClick={() => setFocusRunning((value) => !value)}>{focusRunning ? "Pozastavit" : "Spustit"}</button><button onClick={() => { setFocusSeconds(50 * 60); setFocusRunning(false); }}>Začít znovu</button></div>
            </section>
          )}

          {view === "milestones" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><h1>Milníky</h1></div></header>
              <form className="df2-inline-form" onSubmit={addNewMilestone}><input placeholder="Nový milník" value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} /><input type="date" value={milestoneDate} onChange={(event) => setMilestoneDate(event.target.value)} /><button>Přidat</button></form>
              <div className="df2-milestones">{[...data.milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone) => <article key={milestone.id} role="button" tabIndex={0} title="Upravit milník" onClick={() => setEditingMilestoneId(milestone.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingMilestoneId(milestone.id); } }}><div>{milestone.note !== "Vlastní termín" && <span>{milestone.note}</span>}<strong>{milestone.title}</strong></div><div className="df2-milestone-remaining"><strong>{daysUntilDate(milestone.date, now)}</strong><span>dní</span></div><time>{longDate(milestone.date)}</time></article>)}</div>
            </section>
          )}

          {view === "settings" && (
            <section className="df2-simple-view">
              <header className="df2-page-head"><div><h1>Nastavení</h1></div></header>
              <div className="df2-settings-card"><div><strong>Pracovní den</strong><span>{minutesToTime(calendarBounds.dayStart)}–{minutesToTime(calendarBounds.dayEnd)} · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>02:00</span></div><div><strong>Auto-plánování</strong><span>Týden · 15 min · standardně do 22:30</span></div></div>
              <section className="df2-routines"><div className="df2-section-head"><h2>Opakující se rutiny</h2><button onClick={() => openAdd()}>+ Nová rutina</button></div>{data.routines.map((routine) => <article key={routine.id}><div><strong>{routine.title}</strong><small>{routine.frequency === "daily" ? "každý den" : "každý týden"}{routine.start ? ` · ${routine.start}` : ""} · {routine.duration} min</small></div><label><input type="checkbox" checked={routine.active} onChange={(event) => { const enabled = event.target.checked; const reference=new Date();
      const changed=editRoutineFutureOnly(data,routine.id,{active:enabled},reference);
      const next=enabled?materializeRange(changed,planningDateKey(reference),addDaysKey(planningDateKey(reference),28),reference):changed;
      setData(next);
      removeMissingTaskTrips(next); }} /> aktivní</label><button onClick={() => {
      const next=deleteRoutine(data,routine.id,new Date());
      setData(next);removeMissingTaskTrips(next);
    }}>Smazat</button></article>)}</section>
            </section>
          )}
        </section>
      </div>

      {addingTask && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdd(); }}>
          <form className="df2-modal df2-add-modal df2-add-form" role="dialog" aria-modal="true" aria-labelledby="df2-add-task-title" onSubmit={submitDraft}>
            <header><div><h2 id="df2-add-task-title">{addKind==="gym"?"Naplánovat trénink":"Přidat úkol"}</h2></div><button type="button" aria-label="Zavřít" onClick={closeAdd}>×</button></header>
            <label className="df2-title-input"><span>Typ bloku</span><select aria-label="Typ bloku" value={addKind} onChange={event=>{
              const kind=event.target.value as "task"|"gym";
              setAddKind(kind);setError("");
              if(kind==="gym"){
                setDraft(current=>({...current,duration:90,repeat:"none"}));
                setGymDayId(activeGymPlanOnDate(gym.store,draft.date||todayKey)?.days.find(d=>!d.templateDayId)?.id??"");
              }
            }}><option value="task">Úkol</option><option value="gym">Gym · trénink</option></select></label>
            {addKind==="gym" ? <label className="df2-title-input"><span>Trénink</span><select aria-label="Vyber trénink" value={gymDayId} onChange={event=>setGymDayId(event.target.value)}>
              <option value="">Vyber trénink</option>
              {(activeGymPlanOnDate(gym.store,draft.date||todayKey)?.days??[]).filter(day=>!day.templateDayId).map(day=>
                <option key={day.id} value={day.id}>{day.name}</option>)}
            </select>{!activeGymPlanOnDate(gym.store,draft.date||todayKey)&&
              <small>Nejdřív si vytvoř nebo aktivuj plán v Gym & Tréninky.</small>}</label>
            : <label className="df2-title-input"><span>Úkol</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Např. zeměpis 20 min" /></label>}
            <div className="df2-chips" aria-label="Rychlá nastavení">
              <label><span>Den</span><input type="date" value={draft.date} min={todayKey} onChange={(event) => {
                const date=event.target.value;
                setDraft({ ...draft, date });
                if(addKind==="gym")setGymDayId(activeGymPlanOnDate(gym.store,date)?.days.find(d=>!d.templateDayId)?.id??"");
              }} /></label>
              <label><span>Délka</span><select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })}>
                {(addKind==="gym"?[30,45,60,75,90,105,120,135,150,165,180]:[20,30,45,60,90,120]).map(n=><option key={n} value={n}>{n} min</option>)}
              </select></label>
              <label><span>Začít v</span><input type="time" step={addKind==="gym"?900:undefined} value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
              {addKind==="task"&&<label><span>Priorita</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="normal">Běžná</option><option value="high">Vysoká</option><option value="low">Nízká</option></select></label>}
            </div>
            {addKind==="task" && <details className="df2-details">
              <summary>Podrobnosti</summary>
              <div className="df2-details-grid">
                <label>Dokončit do<input type="date" value={draft.dueDate} min={todayKey} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                <label>Nejpozději v<input type="time" value={draft.deadlineTime} onChange={(event) => setDraft({ ...draft, deadlineTime: event.target.value })} /></label>
                <label>Oblast<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label>Opakování<select value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value as RepeatRule })}><option value="none">Neopakovat</option><option value="daily">Každý den</option><option value="weekly">Každý týden</option></select></label>
                {draft.repeat!=="none"&&<small>Opakování se plánuje pouze do budoucna. Minulá data zůstanou beze změny.</small>}
              </div>
            </details>}
            {addKind==="gym" && <div className="df2-understood"><strong>{activeGymPlanOnDate(gym.store,draft.date||todayKey)?.days.find(day=>day.id===gymDayId)?.name??"Vyber trénink"}</strong>
              <small>{draft.date?shortDate(draft.date):"Vyber datum"} · {draft.duration} min{draft.start?" · "+draft.start:" · zvol čas"}</small></div>}
            {addKind==="task"&&draft.title.trim() && <div className="df2-understood"><strong>{cleanSmartTitle(draft.title)}</strong><small>{draft.date ? shortDate(draft.date) : "Tento týden"} · {draft.duration} min{draft.start ? ` · ${draft.start}` : " · automaticky"}</small></div>}
            <label className="df2-travel-offsite"><input type="checkbox" checked={offsiteOnCreate}
              onChange={e=>setOffsiteOnCreate(e.target.checked)}/>
              Odehrává se mimo domov · následně vyber místo na mapě
            </label>
            {error && <p className="df2-error">{error}</p>}
            <div className="df2-modal-actions"><button className="df2-primary" type="submit" disabled={!hydrated || (addKind==="gym"?(!gym.hydrated||gym.blocked||!gymDayId||!draft.start):!draft.title.trim())}>Naplánovat</button><button type="button" onClick={closeAdd}>Zrušit</button></div>
          </form>
        </div>
      )}

      {editingCare && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingCare(null); }}>
          <form className="df2-modal df2-week-care-modal" role="dialog" aria-modal="true" aria-labelledby="df2-week-care-title" onSubmit={saveEditedCare}>
            <header>
              <div><h2 id="df2-week-care-title">{editingCare.title}</h2><small>{shortDate(editingCare.date)} · {editingCare.duration} min · pouze tento den</small></div>
              <button type="button" aria-label="Zavřít" onClick={() => setEditingCare(null)}>×</button>
            </header>
            {care.store?.fixedRepeatRoutineId === editingCare.id.slice("rolling:".length) && (
              <label>Den výskytu<input type="date" min={todayKey} value={editingCareDate || editingCare.date}
                onChange={(event)=>{setEditingCareDate(event.target.value);setEditingCareError("");}} /></label>
            )}
            <label>Začátek bloku<input autoFocus type="time" step={900} value={editingCareStart}
              onChange={(event) => { setEditingCareStart(event.target.value); setEditingCareError(""); }} /></label>
            <p className="df2-week-care-help">Čas lze změnit přetažením. Opakovanou rutinu lze přesunout i na jiný den mimo neděli; úprava se týká pouze tohoto výskytu.</p>
            {editingCareError && <p className="df2-error" role="alert">{editingCareError}</p>}
            <button type="button" className="df2-trip-in-edit"
              onClick={()=>openTrip("care",editingCare.id,editingCare.date,editingCare.title,editingCareStart,false,
                minutesToTime(timeToMinutes(editingCareStart)+editingCare.duration))}>
              📍 Místo konání / cesta
            </button>
            <div className="df2-modal-actions">
              <button className="df2-primary" type="submit" disabled={care.blocked || editingCare.date < todayKey}>Uložit čas</button>
              <button type="button" onClick={()=>{
                setHygieneRoutineFocus(editingCare.id.startsWith("rolling:") ? editingCare.id.slice("rolling:".length) : editingCare.id);
                setEditingCare(null);
                setView("hygiene");
              }}>Otevřít v Hygieně</button>
              <button type="button" className="danger" disabled={care.blocked || editingCare.date < todayKey}
                onClick={hideEditedCare}>Odebrat jen tento den</button>
            </div>
            <p className="df2-week-care-help">Odebrání odstraní blok pouze z tohoto dne v Týdnu. Úkoly a jejich stav v Hygieně se nezmění.</p>
          </form>
        </div>
      )}

      {editingMilestone && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingMilestoneId(null); }}>
          <form className="df2-modal" onSubmit={saveMilestoneEdit}>
            <header><div><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>
            <label>Název<input name="title" autoFocus defaultValue={editingMilestone.title} /></label>
            <div className="df2-form-grid"><label>Datum<input name="date" type="date" defaultValue={editingMilestone.date} /></label><label>Popisek<input name="note" defaultValue={editingMilestone.note} placeholder="Např. hlavní termín" /></label></div>
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="button" className="danger" onClick={() => removeMilestone(editingMilestone.id)}>Smazat milník</button></div>
          </form>
        </div>
      )}

      {tripTarget&&<WeekTripLocationModal key={tripTarget.key} target={tripTarget}
        onClose={()=>setTripTarget(null)} onSaved={()=>setTravelStore(readTravelStore().store)}/>}
      {editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <form className="df2-modal" onSubmit={saveEdit}>
            <header><div><h2>Upravit</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
            <label>Název<input name="title" defaultValue={editing.title} /></label>
            <div className="df2-form-grid"><label>Den<input name="date" type="date" defaultValue={editing.date} /></label><label>Délka<input name="duration" type="number" min="15" step="5" defaultValue={editing.duration} /></label></div>
            <label>Začátek<input name="start" type="time" defaultValue={editing.start ?? ""} /><small>Prázdné = Dayframe najde volný čas automaticky.</small></label>
            <div className="df2-form-grid"><label>Priorita<select name="priority" defaultValue={editing.priority}><option value="high">Vysoká</option><option value="normal">Běžná</option><option value="low">Nízká</option></select></label><label>Oblast<select name="category" defaultValue={editing.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
            <div className="df2-form-grid"><label>Dokončit do<input name="dueDate" type="date" defaultValue={editing.dueDate ?? ""} /></label><label>Nejpozději v<input name="deadlineTime" type="time" defaultValue={editing.deadlineTime ?? "22:30"} /></label></div>
            <button type="button" className="df2-trip-in-edit"
              onClick={()=>openTrip("task",editing.id,editing.date,editing.title,editing.start??"",false,editing.end)}>
              📍 Místo konání / cesta
            </button>
            {error && <p className="df2-error">{error}</p>}
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button
                type="button"
                className={`df2-completion-action ${completingTaskIds.has(editing.id) ? "is-completing" : ""}`}
                disabled={completingTaskIds.has(editing.id)}
                onClick={() => requestTaskCompletion(editing.id)}
              >
                {editing.completed ? "Vrátit jako nesplněné" : completingTaskIds.has(editing.id) ? "✓ Hotovo" : "Označit hotovo"}
              </button><button type="button" className="danger" onClick={() => { removeStoredTrip(travelBlockKey("task",editing.id));setData((current) => deleteTask(current, editing.id)); setEditing(null); }}>Smazat</button></div>
          </form>
        </div>
      )}
      {completionToasts.length > 0 && (
        <div className="df2-completion-toast-stack" aria-label="Nedávno dokončené úkoly">
          {completionToasts.map((toast) => (
            <div className="df2-completion-toast" role="status" aria-live="polite" key={toast.id}>
              <span className="df2-completion-mark" aria-hidden="true">✓</span>
              <div>
                <strong>Úkol dokončen</strong>
                <small>{toast.title}</small>
              </div>
              <button type="button" onClick={() => undoTaskCompletion(toast.id)}>Vrátit</button>
            </div>
          ))}
        </div>
      )}

    </main>
  );
}

function NavButton({ active, onClick, label, shortcut }: { active: boolean; onClick: () => void; label: string; shortcut: string }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{label}</span><kbd>{shortcut}</kbd></button>;
}

function TodayView({
  now, sleepDateKey, tasks, activeTask, nextTasks, nextPlannedTask, missed, milestones, onAdd, onEdit, onDone, onTomorrow, onDelete, onFocus, onMilestones, onOpenHygiene, onOpenHealth, onOpenGym, onOpenSupplements, onOpenBody, onOpenSleep, onOpenPrevention, completingTaskIds,
}: {
  now: Date;
  sleepDateKey: string;
  tasks: CalendarTask[];
  activeTask: CalendarTask | null;
  nextTasks: CalendarTask[];
  nextPlannedTask: CalendarTask | null;
  missed: CalendarTask[];
  milestones: DayframeState["milestones"];
  onAdd: () => void;
  onEdit: (task: CalendarTask) => void;
  onDone: (id: string) => void;
  onTomorrow: (id: string) => void;
  onDelete: (id: string) => void;
  onFocus: (task: CalendarTask | null) => void;
  onMilestones: () => void;
  onOpenHygiene: (routineId: string) => void;
  onOpenHealth: (routineId: string) => void;
  onOpenGym: (key: string,date:string) => void;
  onOpenSupplements:()=>void;
  onOpenBody:(date:string)=>void;
  onOpenSleep:(date:string)=>void;
  onOpenPrevention:(id:string)=>void;
  completingTaskIds: ReadonlySet<string>;
}) {
  const [checklistSummary, setChecklistSummary] = useState({ planningKey: "", completed: 0, total: 0, hydrated: false, blocked: false });
  const completed = tasks.filter((task) => task.completed).length;
  const unscheduled = tasks.filter((task) => !task.start && !task.completed).length;
  const taskProgress = tasks.length ? (completed / tasks.length) * 100 : 0;
  const checklistDone = checklistSummary.total === 0 || checklistSummary.completed === checklistSummary.total;
  const today = planningDateKey(now);
  const dayComplete = checklistSummary.hydrated
    && checklistSummary.planningKey === today
    && !checklistSummary.blocked
    && completingTaskIds.size === 0
    && missed.length === 0
    && (tasks.length > 0 || checklistSummary.total > 0)
    && completed === tasks.length
    && checklistDone;
  const countdown = getDayCountdown(now);
  const nextMilestone = [...milestones]
    .filter((milestone) => milestone.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const countdownText = `${String(countdown.hours).padStart(2, "0")}:${String(countdown.minutes).padStart(2, "0")}`;
  const futureTaskText = nextPlannedTask?.start
    ? `Další blok: ${dayLabel(nextPlannedTask.date, today)} v ${nextPlannedTask.start} · ${nextPlannedTask.title}`
    : "";

  const emptyState = activeTask
    ? {
        title: "Po tomto bloku máš volno.",
        detail: futureTaskText || "Další naplánovaný blok dnes nemáš.",
        kind: "free",
      }
    : missed.length > 0
      ? {
          title: "Další dnešní bloky nejsou.",
          detail: `Nedokončené úkoly: ${missed.length}.`,
          kind: "missed",
        }
      : tasks.length > 0 && completed === tasks.length
        ? {
            title: "Dnes máš hotovo.",
            detail: futureTaskText || "Zbytek dne je volný.",
            kind: "done",
          }
        : tasks.length === 0
          ? {
              title: "Dnes nemáš nic naplánováno.",
              detail: futureTaskText || "Můžeš si nechat den volný nebo přidat nový úkol.",
              kind: "free",
            }
          : {
              title: "Zbytek dne je volný.",
              detail: futureTaskText || "Další naplánovaný blok dnes nemáš.",
              kind: "free",
            };

  return (
    <section className={`df2-today-view ${dayComplete ? "is-complete" : ""}`}>
      <header className="df2-page-head"><div><p>{formatDay(dateFromKey(today))}</p><h1>Dnes</h1></div><button className="df2-accent-button" onClick={onAdd}>+ Nový úkol</button></header>

      <div className="df2-motivation-grid">
        <section className="df2-day-ruler" aria-label="Odpočet do konce dne">
          <div className="df2-day-ruler-copy">
            <span>Do konce dne</span>
            <strong aria-label={`${countdown.hours} hodin ${countdown.minutes} minut ${countdown.seconds} sekund`}>{countdownText}<em>:{String(countdown.seconds).padStart(2, "0")}</em></strong>
          </div>
          <div className="df2-day-track" aria-hidden="true"><span style={{ width: `${countdown.progressPercent}%` }} /><i style={{ left: `${countdown.progressPercent}%` }} /></div>
          <div className="df2-day-scale" aria-hidden="true"><span>08</span><span>12</span><span>16</span><span>20</span><span>00</span><span>02</span></div>
        </section>

        <button type="button" className="df2-event-countdown" onClick={onMilestones} aria-label={nextMilestone ? `Nejbližší termín ${nextMilestone.title}, zbývá ${daysUntilDate(nextMilestone.date, now)} dní` : "Přidat důležitý termín"}>
          <span>Nejbližší termín</span>
          {nextMilestone ? <><strong>{daysUntilDate(nextMilestone.date, now)}<em>dní</em></strong><b>{nextMilestone.title}</b><small>{longDate(nextMilestone.date)}</small></> : <><strong>—</strong><b>Přidat milník</b></>}
        </button>
      </div>

      <section className={`df2-now-card ${activeTask && completingTaskIds.has(activeTask.id) ? "is-completing" : ""}`}>
        <div className="df2-now-main">
          <div className="df2-now-label">
            <span>Teď</span>
            <small>{activeTask?.start && activeTask.end ? `${activeTask.start}–${activeTask.end}` : "volno"}</small>
          </div>
          {activeTask ? (
            <div className="df2-now-copy">
              <h2>{activeTask.title}</h2>
              <p>{activeTask.duration} min</p>
            </div>
          ) : (
            <div className="df2-now-copy">
              <h2>Volno</h2>
              <p>Žádný aktivní blok</p>
            </div>
          )}
        </div>
        {activeTask && (
          <div className="df2-now-actions">
            {completingTaskIds.has(activeTask.id)
              ? <span className="df2-now-completing">✓ Hotovo</span>
              : <button className="df2-now-edit" onClick={() => onEdit(activeTask)}>Upravit</button>}
          </div>
        )}
      </section>
      <DailyChecklist planningKey={today} sleepDateKey={sleepDateKey} onSummaryChange={setChecklistSummary} onOpenHygiene={onOpenHygiene} onOpenHealth={onOpenHealth} onOpenGym={onOpenGym} onOpenSupplements={onOpenSupplements} onOpenBody={onOpenBody} onOpenSleep={onOpenSleep} onOpenPrevention={onOpenPrevention} />

      {dayComplete && (
        <section className="df2-day-complete" aria-live="polite">
          <span className="df2-completion-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Dnešek hotový</strong>
            <small>{completed} úkolů · checklist {checklistSummary.completed}/{checklistSummary.total}</small>
          </div>
        </section>
      )}

      <section className="df2-next df2-today-plan">
        <div className="df2-section-head">
          <div>
            <h2>Dnes</h2>
            <div
              className="df2-section-progress"
              role="progressbar"
              aria-label="Dokončené dnešní úkoly"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={completed}
            >
              <span style={{ width: `${taskProgress}%` }} />
            </div>
          </div>
          <span>{completed}/{tasks.length} úkolů{unscheduled ? ` · ${unscheduled} bez času` : ""}</span>
        </div>
        {nextTasks.length ? nextTasks.map((task) => (
          <button
            key={task.id}
            className={completingTaskIds.has(task.id) ? "is-completing" : ""}
            onClick={() => onEdit(task)}
          >
            <time>{task.start ?? "—"}</time>
            <span>
              <strong>{task.title}</strong>
              <small>{task.duration} min{task.start ? "" : " · bez času"}</small>
            </span>
          </button>
        )) : (
          <div className={`df2-empty df2-empty-state is-${emptyState.kind}`} role="status">
            <strong>{emptyState.title}</strong>
            <span>{emptyState.detail}</span>
          </div>
        )}
      </section>

      {missed.length > 0 && (
        <section className="df2-missed">
          <header><strong>Nedokončeno · {missed.length}</strong></header>
          {missed.map((task) => (
            <article key={task.id} className={completingTaskIds.has(task.id) ? "is-completing" : ""}>
              <div><strong>{task.title}</strong><small>do {task.end}</small></div>
              <div>
                <button
                  className={`df2-missed-complete ${completingTaskIds.has(task.id) ? "is-completing" : ""}`}
                  disabled={completingTaskIds.has(task.id)}
                  onClick={() => onDone(task.id)}
                >
                  {completingTaskIds.has(task.id) ? "✓ Hotovo" : "Hotovo"}
                </button>
                <button onClick={() => onTomorrow(task.id)}>Na zítra</button>
                <button onClick={() => onDelete(task.id)}>Zrušit</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}