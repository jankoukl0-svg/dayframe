import test from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  editRoutineFutureOnly,
  deleteRoutine,
  findSlot,
  getTasksForDate,
  calendarBounds,
  localDateKey,
  minutesToTime,
  planningDateKey,
  planningMinute,
  pruneHistoricalRoutineProjections,
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

test("recurrences cannot be added to previous calendar days or elapsed times",()=>{
  const now=new Date(2026,9,13,20,53);
  const state=migrateStoredState(null,now),before=JSON.stringify(state);
  const draft={title:"Nová rutina",date:"2026-10-05",start:"16:00",
    duration:60,category:"Studium",priority:"normal",repeat:"weekly"};
  const past=addTask(state,draft,now);
  assert.equal(past.status,"invalid");
  assert.equal(past.state,state);
  assert.equal(JSON.stringify(state),before);
  assert.equal(addTask(state,{...draft,date:"2026-10-13"},now).status,"invalid");
  const oneOff=addTask({...state,routines:[]},{...draft,repeat:"none"},now);
  assert.equal(oneOff.status,"scheduled","Retroactive one-off logs remain allowed");
  assert.equal(oneOff.task.date,"2026-10-05");
  const future=addTask({...state,routines:[]},{...draft,date:"2026-10-14",repeat:"daily"},now);
  assert.equal(future.status,"scheduled");
  const generated=materializeRange(future.state,"2026-10-05","2026-10-17",now);
  for(const date of ["2026-10-05","2026-10-12","2026-10-13"]){
    assert.equal((generated.plans[date]??[]).some(task=>task.title==="Nová rutina"),false,date);
  }
  assert.equal((generated.plans["2026-10-14"]??[]).filter(task=>task.title==="Nová rutina").length,1);
});
test("routine edits keep past incomplete and today elapsed events, regenerating only later days",()=>{
  const now=new Date(2026,9,13,20,53);
  let state=migrateStoredState(null,now);
  const original=state.routines.find(r=>r.id==="tue-cfi");
  assert.ok(original);
  const old={id:"routine-tue-cfi-2026-10-06",title:original.title,date:"2026-10-06",
    duration:original.duration,start:"14:00",end:"15:00",category:original.category,
    priority:"normal",mode:"flexible",completed:false,source:"routine",routineId:original.id,createdAt:original.createdAt};
  const elapsed={...old,id:"routine-tue-cfi-2026-10-13",date:"2026-10-13"};
  const future={...old,id:"routine-tue-cfi-2026-10-14",date:"2026-10-14"};
  const completed={...future,id:"completed-future",completed:true};
  const manual={...future,id:"manual",source:"user",routineId:undefined};
  state={...state,plans:{"2026-10-06":[old],"2026-10-13":[elapsed],"2026-10-14":[future,completed,manual]}};
  const changed=editRoutineFutureOnly(state,original.id,{title:"Upravená CFI",start:"18:00",duration:75},now);
  assert.deepEqual(changed.plans["2026-10-06"],[old]);
  assert.deepEqual(changed.plans["2026-10-13"],[elapsed]);
  assert.deepEqual(changed.plans["2026-10-14"],[completed,manual]);
  assert.deepEqual(state.plans["2026-10-14"],[future,completed,manual]);
  assert.equal(changed.routines.find(r=>r.id===original.id).title,"Upravená CFI");
  const next=materializeRange(changed,"2026-10-06","2026-10-20",now);
  assert.deepEqual(next.plans["2026-10-06"],[],"Uncompleted generated blocks from past weeks are purged on materialization");
  assert.ok(next.plans["2026-10-13"].some(t=>t.id===elapsed.id && t.title===old.title));
  assert.ok(next.plans["2026-10-20"].some(t=>t.title==="Upravená CFI"&&t.start==="18:00"));
});
test("opening historical calendar must not schedule previously untimed saved tasks",()=>{
  const now=new Date(2026,9,13,20,53);
  const state=migrateStoredState(null,now);
  const old={id:"historic-wait",title:"Starý nezapsaný blok",date:"2026-10-06",
    duration:45,category:"Studium",priority:"normal",mode:"flexible",
    source:"user",completed:false,createdAt:"2026-10-06T08:00:00Z"};
  state.plans={"2026-10-06":[old]};
  const regenerated=materializeRange(state,"2026-10-05","2026-10-08",now);
  assert.deepEqual(regenerated.plans["2026-10-06"],[old]);
});

test("undated recurring mornings start on the next future day, never in today's elapsed slot",()=>{
  const now=new Date(2026,9,13,20,53);
  const state={...migrateStoredState(null,now),routines:[],plans:{}};
  const draft={title:"Ranní rutina",start:"09:00",duration:30,
    priority:"normal",category:"Rutina",repeat:"daily"};
  const added=addTask(state,draft,now);
  assert.equal(added.status,"scheduled");
  assert.equal(added.task.date,"2026-10-14");
  assert.equal(added.task.start,"09:00");
  assert.equal((added.state.plans["2026-10-13"]??[]).length,0);
  const followup=materializeRange(added.state,"2026-10-12","2026-10-16",now);
  assert.equal((followup.plans["2026-10-13"]??[]).length,0);
  assert.equal((followup.plans["2026-10-15"]??[]).some(t=>t.title==="Ranní rutina"),true);
  assert.equal(addTask(state,{...draft,dueDate:"2026-10-13"},now).status,"invalid");
});

test("future-dated new daily recurrence never backfills dates before the chosen first day",()=>{
  const now=new Date(2026,9,13,15,30);
  const state={...migrateStoredState(null,now),routines:[],plans:{}};
  const result=addTask(state,{title:"Nová denní rutina",date:"2026-10-19",
    start:"10:30",duration:45,category:"Studium",priority:"normal",repeat:"daily"},now);
  assert.equal(result.status,"scheduled");
  assert.equal(result.state.routines[0].effectiveFrom,"2026-10-19");
  const future=materializeRange(result.state,"2026-10-05","2026-10-25",now);
  for(const date of ["2026-10-05","2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-18"]){
    assert.equal((future.plans[date]??[]).some(x=>x.title==="Nová denní rutina"),false,date);
  }
  assert.equal((future.plans["2026-10-19"]??[]).filter(x=>x.title==="Nová denní rutina").length,1);
  assert.equal((future.plans["2026-10-20"]??[]).filter(x=>x.title==="Nová denní rutina").length,1);
  const later=materializeRange(future,"2026-10-05","2026-10-25",new Date(2026,9,20,18));
  assert.equal((later.plans["2026-10-18"]??[]).length,0);
  assert.equal((later.plans["2026-10-19"]??[]).filter(x=>x.title==="Nová denní rutina").length,0,"Expired unfinished occurrence is not historical activity");
});
test("new future weekly repeat starts on its specified weekday without past-week backfill",()=>{
  const now=new Date(2026,9,13,15,30);
  const state={...migrateStoredState(null,now),routines:[],plans:{}};
  const result=addTask(state,{title:"Nové úterní opakování",date:"2026-10-20",
    start:"11:00",duration:45,category:"Studium",priority:"normal",repeat:"weekly"},now);
  assert.equal(result.status,"scheduled");
  assert.deepEqual(result.state.routines[0].weekdays,[2]);
  assert.equal(result.state.routines[0].effectiveFrom,"2026-10-20");
  const future=materializeRange(result.state,"2026-10-06","2026-11-04",now);
  for(const date of ["2026-10-06","2026-10-13"]){
    assert.equal((future.plans[date]??[]).some(x=>x.title==="Nové úterní opakování"),false,date);
  }
  for(const date of ["2026-10-20","2026-10-27","2026-11-03"]){
    assert.equal((future.plans[date]??[]).filter(x=>x.title==="Nové úterní opakování").length,1,date);
  }
});
test("routine start at the current minute is already elapsed and can only start later",()=>{
  const now=new Date(2026,9,13,15,30);
  let state={...migrateStoredState(null,now),routines:[],plans:{}};
  const immediate=addTask(state,{title:"Právě teď",date:"2026-10-13",
    start:"15:30",duration:30,category:"Studium",priority:"normal",repeat:"daily"},now);
  assert.equal(immediate.status,"invalid");
  const fresh={...state,routines:[{id:"exact",title:"Právě teď",duration:30,start:"15:30",
    category:"Studium",priority:"normal",frequency:"daily",active:true,createdAt:now.toISOString()}]};
  const materialized=materializeRange(fresh,"2026-10-12","2026-10-14",now);
  assert.equal((materialized.plans["2026-10-13"]??[]).length,0);
  assert.equal((materialized.plans["2026-10-14"]??[]).length,1);
});
test("deleting a recurrence preserves historical, completed and elapsed instances",()=>{
  const now=new Date(2026,9,13,15,30);
  const state={...migrateStoredState(null,now),routines:[{
    id:"routine-x",title:"Archivovaná rutina",start:"14:00",duration:30,category:"Studium",
    priority:"normal",frequency:"daily",active:true,createdAt:"2026-09-17T00:00:00.000Z",
  }],plans:{}};
  const build=(date,id,start="14:00",completed=false)=>({
    id,title:"Archivovaná rutina",date,start,end:"14:30",duration:30,
    category:"Studium",priority:"normal",mode:"flexible",source:"routine",
    routineId:"routine-x",completed,createdAt:"2026-09-17T00:00:00.000Z",
  });
  const past=build("2026-10-12","old");
  const elapsed=build("2026-10-13","elapsed");
  const future=build("2026-10-14","future");
  const completed=build("2026-10-15","done","14:00",true);
  state.plans={"2026-10-12":[past],"2026-10-13":[elapsed],
    "2026-10-14":[future],"2026-10-15":[completed]};
  const after=deleteRoutine(state,"routine-x",now);
  assert.equal(after.routines.length,0);
  assert.deepEqual(after.plans["2026-10-12"],[past]);
  assert.deepEqual(after.plans["2026-10-13"],[elapsed]);
  assert.deepEqual(after.plans["2026-10-14"],[]);
  assert.deepEqual(after.plans["2026-10-15"],[completed]);
  assert.deepEqual(state.plans["2026-10-14"],[future],"Original storage is unchanged");
});

test("deleting a recurrence removes today's unscheduled occurrence, preserving elapsed and completed ones",()=>{
  const now=new Date(2026,9,13,15,30);
  const base={id:"r",title:"Volná rutina",date:"2026-10-13",duration:30,
    category:"Studium",priority:"normal",mode:"flexible",source:"routine",
    routineId:"r",completed:false,createdAt:"2026-10-10T00:00:00Z"};
  const state={...migrateStoredState(null,now),routines:[{
    id:"r",title:"Volná rutina",duration:30,category:"Studium",priority:"normal",
    frequency:"daily",active:true,createdAt:"2026-10-10T00:00:00Z",
  }],plans:{"2026-10-13":[
    base,{...base,id:"elapsed",start:"11:00",end:"11:30"},
    {...base,id:"finished",completed:true,start:"17:00",end:"17:30"},
  ]}};
  const result=deleteRoutine(state,"r",now);
  assert.deepEqual(result.plans["2026-10-13"].map(x=>x.id),["elapsed","finished"]);
  assert.equal(result.routines.length,0);
});


test("the first scheduled recurrence is linked to its rule and removed on disabling without erasing other tasks",()=>{
  const instant=new Date(2026,9,13,15,30);
  const initial={...migrateStoredState(null,instant),routines:[],plans:{},backlog:[]};
  const result=addTask(initial,{title:"Budoucí propojená rutina",date:"2026-10-20",
    start:"18:00",duration:45,category:"Studium",priority:"normal",repeat:"daily"},instant);
  assert.equal(result.status,"scheduled");
  const rule=result.state.routines[0];
  const first=result.state.plans["2026-10-20"].find(task=>task.title==="Budoucí propojená rutina");
  assert.equal(first.source,"routine");
  assert.equal(first.routineId,rule.id);
  const generated=materializeRange(result.state,"2026-10-19","2026-10-22",instant);
  assert.equal(generated.plans["2026-10-20"].filter(task=>task.routineId===rule.id).length,1);
  const disabled=editRoutineFutureOnly(generated,rule.id,{active:false},instant);
  assert.equal((disabled.plans["2026-10-20"]??[]).some(task=>task.routineId===rule.id),false);
  const enabled=editRoutineFutureOnly(disabled,rule.id,{active:true},instant);
  const restored=materializeRange(enabled,"2026-10-13","2026-11-10",instant);
  assert.equal(restored.plans["2026-10-20"].filter(task=>task.routineId===rule.id).length,1);
  assert.equal((restored.plans["2026-10-19"]??[]).some(task=>task.routineId===rule.id),false);
  const removed=deleteRoutine(restored,rule.id,instant);
  assert.equal((removed.plans["2026-10-20"]??[]).some(task=>task.routineId===rule.id),false);
  assert.deepEqual(removed.routines,[]);
});

test("deactivating a rule preserves past incomplete tasks and today's elapsed or completed tasks",()=>{
  const instant=new Date(2026,9,13,15,30);
  const routine={id:"keep-history",title:"Studium",duration:45,start:"18:00",
    category:"Studium",priority:"normal",frequency:"daily",active:true,
    createdAt:"2026-10-01T08:00:00.000Z"};
  const make=(id,date,start,completed=false)=>({
    id,title:"Studium",date,start,end:start?"18:45":undefined,duration:45,
    priority:"normal",category:"Studium",mode:"flexible",completed,source:"routine",
    routineId:routine.id,createdAt:routine.createdAt,
  });
  const past=make("past","2026-10-12","18:00");
  const elapsed=make("elapsed","2026-10-13","11:00");
  const done=make("done","2026-10-14","18:00",true);
  const upcoming=make("upcoming","2026-10-13","18:00");
  const untimed=make("untimed","2026-10-13",undefined);
  const tomorrow=make("tomorrow","2026-10-14","18:00");
  const state={...migrateStoredState(null,instant),routines:[routine],
    plans:{"2026-10-12":[past],"2026-10-13":[elapsed,upcoming,untimed],"2026-10-14":[done,tomorrow]}};
  const disabled=editRoutineFutureOnly(state,routine.id,{active:false},instant);
  assert.deepEqual(disabled.plans["2026-10-12"],[past]);
  assert.deepEqual(disabled.plans["2026-10-13"],[elapsed]);
  assert.deepEqual(disabled.plans["2026-10-14"],[done]);
  assert.equal(state.plans["2026-10-13"].length,3);
  assert.equal(disabled.routines[0].active,false);
});

test("routine deletion cleans only linked backlog occurrences without touching manual backlog",()=>{
  const instant=new Date(2026,9,13,15,30);
  const id="waiting-rule";
  const base={id:"waiting",title:"Ranní aktivita",date:"2026-10-14",
    duration:45,priority:"normal",category:"Studium",mode:"flexible",
    completed:false,source:"routine",routineId:id,createdAt:instant.toISOString()};
  const state={...migrateStoredState(null,instant),
    routines:[{id,title:"Ranní aktivita",duration:45,category:"Studium",
      priority:"normal",frequency:"daily",active:true,createdAt:instant.toISOString()}],
    backlog:[base,{...base,id:"manual",source:"user",routineId:undefined}]};
  const paused=editRoutineFutureOnly(state,id,{active:false},instant);
  assert.deepEqual(paused.backlog.map(x=>x.id),["manual"]);
  const cleaned=deleteRoutine(state,id,instant);
  assert.deepEqual(cleaned.backlog.map(x=>x.id),["manual"]);
  assert.equal(state.backlog.length,2);
});


test("a newly created repeat without an available first slot is still owned by its rule",()=>{
  const instant=new Date(2026,9,13,15,30);
  const state={...migrateStoredState(null,instant),routines:[],plans:{},backlog:[]};
  const result=addTask(state,{title:"Pozdní opakování",date:"2026-10-20",
    start:"01:50",duration:45,deadlineTime:"22:30",category:"Studium",
    priority:"normal",repeat:"daily"},instant);
  assert.equal(result.status,"waiting");
  const id=result.state.routines[0].id;
  const initial=result.state.plans["2026-10-20"][0];
  assert.equal(initial.source,"routine");
  assert.equal(initial.routineId,id);
  const materialized=materializeRange(result.state,"2026-10-20","2026-10-20",instant);
  assert.equal((materialized.plans["2026-10-20"]??[]).filter(t=>t.routineId===id).length,1);
  const deleted=deleteRoutine(materialized,id,instant);
  assert.equal((deleted.plans["2026-10-20"]??[]).some(t=>t.routineId===id),false);
});


test("old saved weeks lose uncompleted routine ghosts but retain confirmed and manual history",()=>{
  const reference=new Date(2026,9,13,16,30);
  const seed=migrateStoredState(null,reference);
  const base={title:"Studium",duration:45,start:"18:00",end:"18:45",
    category:"Studium",priority:"normal",mode:"flexible",source:"routine",
    routineId:"mon-cfi",completed:false,createdAt:"2026-09-17T00:00:00Z"};
  const ghost={...base,id:"routine-mon-cfi-2026-09-21",date:"2026-09-21"};
  const orphan={...base,id:"old-orphan",routineId:"deleted-old-rule",date:"2026-09-22"};
  const completed={...base,id:"completed",date:"2026-09-21",completed:true};
  const manual={...base,id:"manual",date:"2026-09-21",source:"user",routineId:undefined};
  const legacy={...base,id:"legacy",date:"2026-09-22",source:"legacy",routineId:undefined};
  const today={...base,id:"today",date:"2026-10-13"};
  const future={...base,id:"future",date:"2026-10-14"};
  const raw={...seed,plans:{
    "2026-09-21":[ghost,completed,manual],
    "2026-09-22":[orphan,legacy],
    "2026-10-13":[today],
    "2026-10-14":[future],
  }};
  const before=JSON.stringify(raw);
  // A load of any week must clean the entire stored history, not just the visible range.
  const cleaned=materializeRange(migrateStoredState(raw,reference),"2026-10-13","2026-10-14",reference);
  assert.deepEqual(cleaned.plans["2026-09-21"].map(task=>task.id),["completed","manual"]);
  assert.deepEqual(cleaned.plans["2026-09-22"].map(task=>task.id),["legacy"]);
  assert.ok(cleaned.plans["2026-10-13"].some(x=>x.id==="today"));
  assert.ok(cleaned.plans["2026-10-14"].some(x=>x.id==="future"));
  assert.equal(JSON.stringify(raw),before,"Never mutate the user's source object");
  assert.deepEqual(pruneHistoricalRoutineProjections(cleaned,reference),cleaned,"Cleanup is idempotent");
  const viewedOldWeek=materializeRange(cleaned,"2026-09-21","2026-09-27",reference);
  assert.deepEqual(viewedOldWeek.plans["2026-09-21"],cleaned.plans["2026-09-21"]);
  assert.deepEqual(viewedOldWeek.plans["2026-09-22"],cleaned.plans["2026-09-22"]);
});

test("past routine cleanup rolls over at the existing 02:00 planning boundary",()=>{
  const seed=migrateStoredState(null,new Date(2026,9,14,1,59));
  const base={id:"old",title:"Noční rutina",date:"2026-10-13",duration:30,
    start:"23:00",end:"23:30",category:"Studium",priority:"normal",
    mode:"flexible",source:"routine",routineId:"read",completed:false,
    createdAt:"2026-09-17T00:00:00Z"};
  const yesterday={...base,id:"yesterday",date:"2026-10-12"};
  const completed={...base,id:"finished",completed:true};
  const manual={...base,id:"manual",source:"user",routineId:undefined};
  const state={...seed,plans:{
    "2026-10-12":[yesterday],
    "2026-10-13":[base,completed,manual],
  }};
  const beforeBoundary=pruneHistoricalRoutineProjections(state,new Date(2026,9,14,1,59));
  assert.deepEqual(beforeBoundary.plans["2026-10-12"],[]);
  assert.deepEqual(beforeBoundary.plans["2026-10-13"],[base,completed,manual]);
  const afterBoundary=pruneHistoricalRoutineProjections(beforeBoundary,new Date(2026,9,14,2,0));
  assert.deepEqual(afterBoundary.plans["2026-10-13"],[completed,manual]);
});

test("empty historical days never materialize any routine again on revisit",()=>{
  const reference=new Date(2026,9,13,16,30);
  const old={id:"routine-read-2026-09-21",title:"Čtení knihy",date:"2026-09-21",
    duration:20,start:"22:40",end:"23:00",category:"Rutina",priority:"normal",
    mode:"flexible",completed:false,source:"routine",routineId:"read",
    createdAt:"2026-09-17T00:00:00Z"};
  const initial={...migrateStoredState(null,reference),plans:{"2026-09-21":[old]}};
  let cleaned=materializeRange(initial,"2026-09-21","2026-10-14",reference);
  assert.deepEqual(cleaned.plans["2026-09-21"],[]);
  cleaned=materializeRange(cleaned,"2026-09-21","2026-09-27",reference);
  assert.deepEqual(cleaned.plans["2026-09-21"],[]);
  assert.equal(cleaned.routines.some(x=>x.id==="read"),true,"The underlying schedule remains active");
});
