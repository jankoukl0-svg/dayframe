import test from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  findSlot,
  getTasksForDate,
  calendarBounds,
  localDateKey,
  minutesToTime,
  planningDateKey,
  planningMinute,
  timeToMinutes,
  materializeRange,
  migrateStoredState,
  moveTask,
  replanWeek,
} from "./dayframe-calendar.ts";

const now = new Date("2026-09-17T10:00:00");

test("migrates schema 4 today, tomorrow and future waiting tasks without leaking tokens", () => {
  const old = {
    schema: 4,
    date: "2026-09-17",
    tasks: [{ id: 1001, title: "Matika [[start:17:00]]", start: "17:00", end: "18:00", category: "Matika", completed: false, fixed: true }],
    tomorrowDate: "2026-09-18",
    tomorrowTasks: [],
    inboxTasks: [{ id: 2001, title: "Zeměpis [[date:2026-09-19]]", duration: 20, priority: "normal", category: "Studium", createdAt: "2026-09-17T09:00:00Z", targetDate: "2026-09-19" }],
  };
  const state = migrateStoredState(old, now);
  assert.equal(state.schema, 5);
  assert.equal(state.plans["2026-09-17"][0].title, "Matika");
  assert.equal(state.plans["2026-09-17"][0].mode, "flexible");
  assert.equal(state.plans["2026-09-17"][0].requestedStart, "17:00");
  assert.equal(state.plans["2026-09-19"][0].title, "Zeměpis");
});

test("schema 5 lock state is normalized away without losing the chosen time", () => {
  const state = migrateStoredState({
    schema: 5,
    plans: {
      "2026-09-18": [{
        id: "old-fixed",
        title: "Matika",
        date: "2026-09-18",
        duration: 60,
        start: "16:00",
        end: "17:00",
        priority: "normal",
        category: "Matika",
        mode: "fixed",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    },
    backlog: [],
    routines: [],
    routineSkips: [],
    milestones: [],
    dismissedOverdueKeys: [],
  }, now);
  const task = state.plans["2026-09-18"][0];
  assert.equal(task.mode, "flexible");
  assert.equal(task.requestedStart, "16:00");
  assert.equal(task.autoScheduled, false);
});

test("materializes recurring routines as real dated blocks", () => {
  const state = migrateStoredState(null, now);
  const ready = materializeRange(state, "2026-09-17", "2026-09-20", now);
  const sunday = getTasksForDate(ready, "2026-09-20");
  assert.ok(sunday.some((task) => task.title === "Čtení knihy" && task.start === "22:40"));
  assert.ok(sunday.some((task) => task.title === "Naplánovat další týden" && task.start === "14:00"));
  assert.ok(sunday.every((task) => task.mode === "flexible"));
});

test("auto planner scans the whole week when no day is chosen", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  state.plans = {
    "2026-09-17": [{ id: "busy", title: "Busy", date: "2026-09-17", duration: 870, start: "08:00", end: "22:30", priority: "normal", category: "X", mode: "flexible", completed: false, source: "user", dateLocked: true, createdAt: now.toISOString() }],
  };
  const result = addTask(state, { title: "Deep work", duration: 60, priority: "high", category: "Studium", repeat: "none" }, now);
  assert.equal(result.status, "scheduled");
  assert.equal(result.task.date, "2026-09-18");
});

test("day starts at 08:00 and future auto-planning can use the first slot", () => {
  assert.equal(calendarBounds.dayStart, 8 * 60);
  const slot = findSlot([], "2026-09-18", 60, now);
  assert.deepEqual(slot, { start: "08:00", end: "09:00" });
});


test("planning day continues through 02:00 after midnight", () => {
  assert.equal(calendarBounds.dayEnd, 26 * 60);
  assert.equal(timeToMinutes("23:30"), 23 * 60 + 30);
  assert.equal(timeToMinutes("00:30"), 24 * 60 + 30);
  assert.equal(timeToMinutes("02:00"), 26 * 60);
  assert.equal(minutesToTime(25 * 60 + 30), "01:30");
  const afterMidnight = new Date(2026, 8, 18, 1, 15, 0);
  assert.equal(planningDateKey(afterMidnight), "2026-09-17");
  assert.equal(planningMinute(afterMidnight), 25 * 60 + 15);
});


test("manual placement can use the late lane while automatic planning keeps its 22:30 cutoff", () => {
  const manual = findSlot([], "2026-09-18", 30, now, "22:30", "01:00");
  assert.deepEqual(manual, { start: "01:00", end: "01:30" });
  const automatic = findSlot([], "2026-09-18", 30, now, "22:30");
  assert.deepEqual(automatic, { start: "08:00", end: "08:30" });
});

test("automatic scheduling still avoids the lunch preference", () => {
  const occupied = [{
    id: "morning",
    title: "Morning",
    date: "2026-09-18",
    duration: 300,
    start: "08:00",
    end: "13:00",
    priority: "normal",
    category: "X",
    mode: "flexible",
    completed: false,
    source: "user",
    dateLocked: true,
    createdAt: now.toISOString(),
  }];
  const slot = findSlot(occupied, "2026-09-18", 60, now);
  assert.deepEqual(slot, { start: "14:00", end: "15:00" });
});

test("manual drag may place a task inside the lunch hour", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Obědový call", date: "2026-09-18", duration: 30, priority: "normal", category: "Osobní", repeat: "none" }, now);
  const moved = moveTask(added.state, added.task.id, "2026-09-18", "13:15");
  assert.equal(moved.error, undefined);
  assert.equal(moved.task.start, "13:15");
  assert.equal(moved.task.end, "13:45");
  assert.equal(moved.task.mode, "flexible");
  assert.equal(moved.task.requestedStart, "13:15");
  assert.equal(moved.task.autoScheduled, false);
});

test("a task explicitly assigned to a day stays on that day", () => {
  const state = migrateStoredState(null, now);
  const result = addTask(state, { title: "Zeměpis", date: "2026-09-19", duration: 20, priority: "normal", category: "Studium", repeat: "none" }, now);
  assert.equal(result.task.date, "2026-09-19");
  assert.equal(result.task.dateLocked, true);
});

test("dragging a task keeps the chosen time without creating a lock mode", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Matika", date: "2026-09-18", duration: 60, priority: "normal", category: "Matika", repeat: "none" }, now);
  const moved = moveTask(added.state, added.task.id, "2026-09-19", "16:00");
  assert.equal(moved.error, undefined);
  assert.equal(moved.task.date, "2026-09-19");
  assert.equal(moved.task.start, "16:00");
  assert.equal(moved.task.mode, "flexible");
  assert.equal(moved.task.requestedStart, "16:00");
  assert.equal(moved.task.autoScheduled, false);
});

test("explicit weekly replan keeps manually chosen dates and times in place", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Manual", date: "2026-09-19", duration: 30, priority: "normal", category: "Studium", repeat: "none" }, now);
  const before = added.task.start;
  const replanned = replanWeek(added.state, now, now);
  const after = replanned.plans["2026-09-19"].find((task) => task.id === added.task.id);
  assert.equal(after.start, before);
  assert.equal(localDateKey(now), "2026-09-17");
});
test("new routine never backfills earlier dates or past time slots",()=>{
  const now=new Date("2026-10-13T11:46:00");
  let state=migrateStoredState(null,now);
  state.routines=[{id:"fresh",title:"Nová rutina",start:"09:00",duration:30,
    category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:now.toISOString()}];
  const recorded={id:"logged",date:"2026-10-12",title:"Historie",duration:30,
    start:"10:00",end:"10:30",priority:"normal",category:"Studium",
    mode:"flexible",completed:true,source:"user",createdAt:"2026-10-12T10:00:00.000Z"};
  state.plans["2026-10-12"]=[recorded];
  const next=materializeRange(state,"2026-10-05","2026-10-16",now);
  assert.deepEqual(next.plans["2026-10-12"],[recorded]);
  for(const date of ["2026-10-05","2026-10-12","2026-10-13"])
    assert.equal(getTasksForDate(next,date).some(x=>x.routineId==="fresh"),false,date);
  assert.equal(getTasksForDate(next,"2026-10-14").filter(x=>x.routineId==="fresh").length,1);
  assert.deepEqual(materializeRange(next,"2026-10-05","2026-10-16",now).plans["2026-10-12"],[recorded]);
});

test("routines created today may occur later today, but never before creation",()=>{
  const now=new Date("2026-10-13T11:46:00");
  const state=migrateStoredState(null,now);
  state.routines=[{id:"later",title:"Později",start:"18:00",duration:30,
    category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:now.toISOString()}];
  let result=materializeRange(state,"2026-10-12","2026-10-14",now);
  assert.equal(getTasksForDate(result,"2026-10-12").some(t=>t.routineId==="later"),false);
  assert.equal(getTasksForDate(result,"2026-10-13").filter(t=>t.routineId==="later").length,1);
  result=materializeRange({...state,routines:state.routines.map(r=>({...r,createdAt:"2026-10-13T19:00:00"}))},
    "2026-10-13","2026-10-14",now);
  assert.equal(getTasksForDate(result,"2026-10-13").filter(t=>t.routineId==="later").length,0);
  assert.equal(getTasksForDate(result,"2026-10-14").filter(t=>t.routineId==="later").length,1);
});

test("retroactive repeating drafts are rejected without blocking retrospective one-off tasks",()=>{
  const now=new Date("2026-10-13T11:46:00");
  const state=migrateStoredState(null,now);
  state.routines=[];state.plans={};
  const draft={title:"Nový blok",duration:30,start:"16:00",priority:"normal",
    category:"Studium",repeat:"daily"};
  for(const attrs of [{date:"2026-10-12"},{date:"2026-10-13",start:"10:00"}]){
    const rejected=addTask(state,{...draft,...attrs},now);
    assert.equal(rejected.status,"rejected");
    assert.equal(rejected.state,state);
  }
  const retro=addTask(state,{...draft,date:"2026-10-12",repeat:"none"},now);
  assert.notEqual(retro.status,"rejected");
  assert.equal(retro.task.date,"2026-10-12");
});

test("older already active routines still appear today as missed, never fabricated on older dates",()=>{
  const now=new Date("2026-10-13T11:46:00");
  const data=migrateStoredState(null,now);
  data.routines=[{id:"established",title:"Zavedená rutina",start:"09:00",
    duration:30,category:"Studium",priority:"normal",frequency:"daily",
    active:true,createdAt:"2026-10-01T12:00:00.000Z"}];
  const ready=materializeRange(data,"2026-10-05","2026-10-14",now);
  assert.equal(getTasksForDate(ready,"2026-10-12").some(x=>x.routineId==="established"),false);
  assert.equal(getTasksForDate(ready,"2026-10-13").filter(x=>x.routineId==="established").length,1,
    "Today's elapsed scheduled routines must remain available in the missed flow");
  assert.equal(getTasksForDate(ready,"2026-10-14").filter(x=>x.routineId==="established").length,1);
});

test("adding a daily routine materializes tomorrow immediately without a refresh",()=>{
  const now=new Date("2026-10-13T11:46:00");
  const data=migrateStoredState(null,now);
  data.routines=[];data.plans={};
  const out=addTask(data,{title:"Nová pravidelná",duration:30,start:"20:30",
    date:"2026-10-13",priority:"normal",category:"Studium",repeat:"daily"},now);
  assert.equal(out.status,"scheduled");
  assert.equal(getTasksForDate(out.state,"2026-10-14").filter(t=>t.routineId).length,1);
  assert.equal(getTasksForDate(out.state,"2026-10-12").filter(t=>t.routineId).length,0);
  assert.equal(materializeRange(out.state,"2026-10-13","2026-10-14",now).plans["2026-10-14"].length,1);
});
