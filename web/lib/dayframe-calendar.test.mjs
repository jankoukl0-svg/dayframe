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
  updateRoutineSchedule,
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
test("new recurring routines never populate already elapsed days or hours",()=>{
  const instant=new Date(2026,9,13,12,40,0);
  let state=migrateStoredState(null,instant);
  state={...state,plans:{},routines:[
    {id:"before",title:"Před obědem",duration:45,start:"09:00",category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:instant.toISOString()},
    {id:"after",title:"Večer",duration:45,start:"18:00",category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:instant.toISOString()},
  ]};
  const ready=materializeRange(state,"2026-10-05","2026-10-15",instant);
  for(const key of ["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10","2026-10-11","2026-10-12"]){
    assert.equal((ready.plans[key]??[]).length,0,key+" must remain unpopulated");
  }
  assert.deepEqual((ready.plans["2026-10-13"]??[]).map(t=>t.title),["Večer"]);
  assert.deepEqual((ready.plans["2026-10-14"]??[]).map(t=>t.title),["Před obědem","Večer"]);
});
test("historical completed and manually placed tasks survive recurrence generation",()=>{
  const instant=new Date(2026,9,13,12,40,0);
  let state=migrateStoredState(null,instant);
  const past={id:"routine-old-2026-10-05",title:"Stará rutina",date:"2026-10-05",start:"09:00",end:"09:45",
    duration:45,category:"Studium",priority:"normal",mode:"flexible",completed:true,
    source:"routine",routineId:"old",createdAt:"2026-10-01T09:00:00Z"};
  state={...state,plans:{"2026-10-05":[past]},routines:[
    {id:"old",title:"Stará rutina",duration:45,start:"09:00",category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:"2026-10-01T09:00:00Z"},
  ]};
  const ready=materializeRange(state,"2026-10-05","2026-10-14",instant);
  assert.deepEqual(ready.plans["2026-10-05"],[past]);
  assert.equal((ready.plans["2026-10-12"]??[]).length,0);
  assert.equal((ready.plans["2026-10-13"]??[]).length,0);
  assert.equal((ready.plans["2026-10-14"]??[]).length,1);
});
test("new routines do not backfill the hours before their creation even if viewed later",()=>{
  const creation=new Date(2026,9,13,15,30);
  const later=new Date(2026,9,14,9,0);
  let state=migrateStoredState(null,later);
  state={...state,plans:{},routines:[
    {id:"early",title:"Brzká",duration:30,start:"11:00",category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:creation.toISOString()},
  ]};
  // On the creation date the 11:00 session had already passed.
  assert.equal((materializeRange(state,"2026-10-13","2026-10-13",creation).plans["2026-10-13"]??[]).length,0);
  const future=materializeRange(state,"2026-10-13","2026-10-15",later);
  assert.equal((future.plans["2026-10-13"]??[]).length,0);
  assert.equal((future.plans["2026-10-14"]??[]).length,1);
});

test("untimed routines still receive a future auto-planned slot later in the day",()=>{
  const now=new Date(2026,9,13,9,15);
  let state=migrateStoredState(null,now);
  state={...state,plans:{},routines:[{
    id:"flex",title:"Volná rutina",duration:45,category:"Studium",priority:"normal",
    frequency:"daily",active:true,createdAt:new Date(2026,9,13,9,0).toISOString(),
  }]};
  const planned=materializeRange(state,"2026-10-12","2026-10-14",now);
  assert.equal((planned.plans["2026-10-12"]??[]).length,0);
  const today=planned.plans["2026-10-13"]??[];
  assert.equal(today.length,1);
  assert.equal(today[0].title,"Volná rutina");
  assert.ok(today[0].start && timeToMinutes(today[0].start)>=planningMinute(now));
});

test("repeating task cannot be added to elapsed days or hours, but one-off history is allowed",()=>{
  const now=new Date(2026,9,13,17,5);
  const state={...migrateStoredState(null,now),plans:{},routines:[]};
  const base={title:"Nová rutina",duration:30,start:"18:00",priority:"normal",category:"Studium",repeat:"weekly"};
  for(const patch of [{date:"2026-10-05"},{date:"2026-10-13",start:"16:00"},{dueDate:"2026-10-12"}]){
    const out=addTask(state,{...base,...patch},now);
    assert.equal(out.status,"rejected");
    assert.equal(out.state,state);
  }
  const note=addTask(state,{...base,date:"2026-10-05",repeat:"none"},now);
  assert.notEqual(note.status,"rejected");
  assert.equal(note.task.date,"2026-10-05");
  assert.equal(state.routines.length,0);
});
test("future-dated daily routine never appears before its selected first day and repeats after reload",()=>{
  const now=new Date(2026,9,13,17,5);
  const state={...migrateStoredState(null,now),plans:{},routines:[]};
  const created=addTask(state,{title:"Teprve zítra",date:"2026-10-14",start:"18:00",duration:45,
    priority:"normal",category:"Studium",repeat:"daily"},now);
  assert.equal(created.status,"scheduled");
  assert.equal(created.state.routines[0].startDate,"2026-10-14");
  assert.equal((created.state.plans["2026-10-13"]??[]).some(t=>t.title==="Teprve zítra"),false);
  const reloaded=migrateStoredState(JSON.parse(JSON.stringify(created.state)),now);
  const visible=materializeRange(reloaded,"2026-10-05","2026-10-20",now);
  assert.equal((visible.plans["2026-10-05"]??[]).some(t=>t.title==="Teprve zítra"),false);
  assert.equal((visible.plans["2026-10-13"]??[]).some(t=>t.title==="Teprve zítra"),false);
  assert.equal((visible.plans["2026-10-14"]??[]).filter(t=>t.title==="Teprve zítra").length,1);
  assert.equal((visible.plans["2026-10-15"]??[]).filter(t=>t.title==="Teprve zítra").length,1);
});
test("editing an existing routine preserves historic tasks and applies revisions only to future occurrences",()=>{
  const now=new Date(2026,9,13,17,5);
  const template={id:"routine-edit",title:"Starý název",category:"Studium",start:"10:00",duration:45,
    frequency:"daily",priority:"normal",active:true,createdAt:"2026-10-01T09:00:00Z"};
  const occurrence=(date,start,completed=false)=>({id:`routine-routine-edit-${date}`,
    title:"Starý název",date,start,end:start==="10:00"?"10:45":"19:00",duration:45,priority:"normal",
    category:"Studium",mode:"flexible",completed,source:"routine",routineId:"routine-edit",
    createdAt:"2026-10-01T09:00:00Z"});
  const past=occurrence("2026-10-05","10:00",false);
  const todayPast=occurrence("2026-10-13","10:00",false);
  const tomorrow=occurrence("2026-10-14","10:00",false);
  const completed=occurrence("2026-10-15","10:00",true);
  const state={...migrateStoredState(null,now),routines:[template],
    plans:{"2026-10-05":[past],"2026-10-13":[todayPast],"2026-10-14":[tomorrow],"2026-10-15":[completed]}};
  const next=updateRoutineSchedule(state,"routine-edit",{title:"Nový název",start:"18:00"},now);
  assert.deepEqual(next.plans["2026-10-05"],[past]);
  assert.deepEqual(next.plans["2026-10-13"],[todayPast]);
  assert.equal(next.plans["2026-10-14"].length,0);
  assert.deepEqual(next.plans["2026-10-15"],[completed]);
  assert.equal(next.routines[0].createdAt,template.createdAt);
  const loaded=materializeRange(next,"2026-10-05","2026-10-16",now);
  assert.deepEqual(loaded.plans["2026-10-13"],[todayPast]);
  assert.equal(loaded.plans["2026-10-14"][0].title,"Nový název");
  assert.equal(loaded.plans["2026-10-14"][0].start,"18:00");
  assert.deepEqual(loaded.plans["2026-10-15"],[completed]);
});

test("a routine cannot start in the already elapsed current minute, including when seconds remain",()=>{
  const instant=new Date(2026,9,13,17,5,30);
  const state={...migrateStoredState(null,instant),routines:[],plans:{}};
  const attrs={title:"Tato minuta už běží",start:"17:05",duration:30,
    priority:"normal",category:"Studium",repeat:"daily",date:"2026-10-13"};
  const blocked=addTask(state,attrs,instant);
  assert.equal(blocked.status,"rejected");
  assert.equal(blocked.state,state);
  const direct={...state,routines:[{id:"direct",title:"Direct",start:"17:05",
    duration:30,priority:"normal",category:"Studium",frequency:"daily",
    active:true,createdAt:new Date(2026,9,13,16,0).toISOString()}]};
  const rendered=materializeRange(direct,"2026-10-13","2026-10-14",instant);
  assert.equal((rendered.plans["2026-10-13"]??[]).some(t=>t.routineId==="direct"),false);
  assert.equal((rendered.plans["2026-10-14"]??[]).filter(t=>t.routineId==="direct").length,1);
});

test("the first recurring task is linked to its rule and replaced when the rule is edited",()=>{
  const now=new Date(2026,9,13,17,5);
  const empty={...migrateStoredState(null,now),plans:{},routines:[]};
  const added=addTask(empty,{title:"Starý čas",date:"2026-10-14",start:"18:00",
    duration:30,category:"Studium",priority:"normal",repeat:"daily"},now);
  assert.equal(added.status,"scheduled");
  const routine=added.state.routines[0];
  const first=added.state.plans["2026-10-14"][0];
  assert.equal(first.source,"routine");
  assert.equal(first.routineId,routine.id);
  const changed=updateRoutineSchedule(added.state,routine.id,{title:"Nový čas",start:"19:00"},now);
  const regenerated=materializeRange(changed,"2026-10-13","2026-10-16",now);
  const day=regenerated.plans["2026-10-14"];
  assert.equal(day.length,1,"Future seed must not survive as an orphaned duplicate");
  assert.equal(day[0].title,"Nový čas");
  assert.equal(day[0].start,"19:00");
  assert.equal(day[0].routineId,routine.id);
});
test("future legacy seeds from the prior version are removed without touching separate one-off tasks",()=>{
  const now=new Date(2026,9,13,17,5);
  const instant=now.toISOString();
  const rule={id:"legacy-rule",title:"Stará rutina",start:"18:00",duration:30,
    frequency:"daily",priority:"normal",category:"Studium",active:true,
    createdAt:instant,startDate:"2026-10-14"};
  const legacy={id:"old-seed",title:rule.title,date:"2026-10-14",
    duration:rule.duration,start:"18:00",requestedStart:"18:00",end:"18:30",
    priority:"normal",category:rule.category,mode:"flexible",completed:false,
    source:"user",createdAt:instant};
  const manual={...legacy,id:"unrelated",createdAt:"2026-10-11T08:00:00.000Z"};
  const state={...migrateStoredState(null,now),routines:[rule],
    plans:{"2026-10-14":[legacy,manual]}};
  const updated=updateRoutineSchedule(state,rule.id,{title:"Změna",start:"19:00"},now);
  assert.deepEqual(updated.plans["2026-10-14"],[manual]);
  const rendered=materializeRange(updated,"2026-10-14","2026-10-15",now);
  assert.equal(rendered.plans["2026-10-14"].filter(t=>t.routineId===rule.id).length,1);
  assert.equal(rendered.plans["2026-10-14"].find(t=>t.routineId===rule.id).title,"Změna");
});
