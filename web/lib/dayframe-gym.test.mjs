import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyGymStore, parseGymStore, makeGymPlan, assignmentsOnDate, moveOccurrence,
  occurrenceKey, startSession, gymMetrics, lastExercisePerformance,
  setActiveGymPlan, setGymDayWeekday, addGymScheduledWorkout, removeGymScheduledWorkout, EXERCISE_LIBRARY, extendGymExerciseCatalog
} from "./dayframe-gym.ts";

function active() {
  const store=emptyGymStore();
  const plan=makeGymPlan("Upper / Lower","upper-lower");
  return {...store,plans:[plan],activePlanId:plan.id};
}
test("plan templates offer adjustable repeated workout days and a stable occurrence identity",()=>{
  assert.deepEqual(["ppl","upper-lower","full-body","custom"].map(t=>makeGymPlan("P",t).days.length),[3,2,2,1]);
  const s=active();const day=s.plans[0].days[0];
  assert.equal(assignmentsOnDate(s,"2026-10-12")[0].name,"Upper");
  assert.equal(assignmentsOnDate(s,"2026-10-13").length,0);
  assert.equal(assignmentsOnDate(s,"2026-10-19")[0].key,occurrenceKey(s.plans[0].id,day.id,"2026-10-19"));
});
test("moving a scheduled occurrence updates both dates without duplicate or new calendar task",()=>{
  let s=active();const occ=assignmentsOnDate(s,"2026-10-12")[0];
  s=moveOccurrence(s,occ.key,"2026-10-13");
  assert.deepEqual(assignmentsOnDate(s,"2026-10-12"),[]);
  assert.equal(assignmentsOnDate(s,"2026-10-13").length,1);
  assert.equal(assignmentsOnDate(s,"2026-10-13")[0].originalDate,"2026-10-12");
  assert.equal(moveOccurrence(s,occ.key,"2026-10-13").moves[occ.key],"2026-10-13");
  s=moveOccurrence(s,occ.key,"2026-10-12");
  assert.equal(Object.keys(s.moves).length,0);
});
test("a session starts once, resume stays idempotent and an in-progress workout cannot move silently",()=>{
  let s=active();const occ=assignmentsOnDate(s,"2026-10-12")[0];
  s=startSession(s,occ.key,"2026-10-12","2026-10-12T10:00:00.000Z");
  const first=s.sessions[0];
  assert.equal(first.exercises.length,4);
  assert.equal(first.exercises[0].sets.length,3);
  assert.equal(startSession(s,occ.key,"2026-10-12").sessions.length,1);
  assert.equal(moveOccurrence(s,occ.key,"2026-10-13"),s);
  assert.equal(assignmentsOnDate(s,"2026-10-12")[0].session?.id,first.id);
});
test("warmup sets are excluded, work-set volumes and estimated 1RM use completed data only",()=>{
  let s=active();const occ=assignmentsOnDate(s,"2026-10-12")[0];
  s=startSession(s,occ.key,"2026-10-12","2026-10-12T09:00:00Z");
  const sess=s.sessions[0];const ex=sess.exercises[0]; const [a,b,c]=ex.sets;
  const upd={...sess,completedAt:"2026-10-12T11:00:00Z",exercises:[{...ex,sets:[
    {...a,kind:"warmup",weightKg:20,reps:15,done:true},
    {...b,weightKg:80,reps:8,done:true},
    {...c,weightKg:90,reps:5,done:true}
  ]},...sess.exercises.slice(1)]};
  s={...s,sessions:[upd]};
  const result=gymMetrics(s);const pr=result.byExercise.get(ex.exerciseId);
  assert.equal(result.totalVolume,1090);
  assert.equal(result.workouts[0].sets,2);
  assert.equal(pr?.weight,90);
  assert.ok(Math.abs(pr.estimated1RM-105)<.01);
  assert.deepEqual(lastExercisePerformance(s,ex.exerciseId,"2026-10-13").map(x=>x.weightKg),[80,90]);
});
test("malformed storage blocks writes rather than replacing user data, valid old state remains intact",()=>{
  const s=active();
  assert.deepEqual(parseGymStore(JSON.stringify(s)),{store:s,blocked:false});
  assert.equal(parseGymStore("{broken").blocked,true);
  assert.equal(parseGymStore(JSON.stringify({...s,plans:[{...s.plans[0],days:[{...s.plans[0].days[0],weekday:22}]}]})).blocked,true);
  assert.equal(parseGymStore(null).blocked,false);
});

test("new plans do not synthesize workouts before the plan activation date",()=>{
  const s=emptyGymStore();
  const plan=makeGymPlan("History safe","upper-lower","2026-10-12");
  const active={...s,plans:[plan],activePlanId:plan.id};
  assert.equal(assignmentsOnDate(active,"2026-10-05").length,0);
  assert.equal(assignmentsOnDate(active,"2026-10-12").length,1);
  assert.equal(assignmentsOnDate(active,"2026-10-19").length,1);
  const key=occurrenceKey(plan.id,plan.days[0].id,"2026-10-12");
  assert.equal(moveOccurrence(active,key,"2026-10-05"),active);
  assert.equal(parseGymStore(JSON.stringify(active)).blocked,false);
});

test("switching active plans preserves the earlier activation timeline without phantom workouts",()=>{
  const a=makeGymPlan("Plan A","upper-lower","2026-10-12");
  const b=makeGymPlan("Plan B","upper-lower","2026-10-12");
  let store={...emptyGymStore(),plans:[a,b]};
  store=setActiveGymPlan(store,a.id,"2026-10-12");
  assert.equal(assignmentsOnDate(store,"2026-10-05").length,0);
  assert.equal(assignmentsOnDate(store,"2026-10-12")[0].planId,a.id);
  store=setActiveGymPlan(store,b.id,"2026-10-19");
  assert.equal(assignmentsOnDate(store,"2026-10-12")[0].planId,a.id);
  assert.equal(assignmentsOnDate(store,"2026-10-19")[0].planId,b.id);
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
});
test("weekday changes keep historical scheduled keys and actual logged completions",()=>{
  const a=makeGymPlan("Plan","upper-lower","2026-10-12");
  let store=setActiveGymPlan({...emptyGymStore(),plans:[a]},a.id,"2026-10-12");
  const original=assignmentsOnDate(store,"2026-10-12")[0];
  store=startSession(store,original.key,"2026-10-12","2026-10-12T10:00:00Z");
  const session={...store.sessions[0],completedAt:"2026-10-12T12:00:00Z"};
  store={...store,sessions:[session]};
  const edited=setGymDayWeekday(a,a.days[0].id,2,"2026-10-12");
  store={...store,plans:[edited]};
  const old=assignmentsOnDate(store,"2026-10-12");
  assert.equal(old.find(x=>x.key===original.key)?.completed,true);
  assert.equal(assignmentsOnDate(store,"2026-10-13").some(x=>x.dayId===a.days[0].id),true);
  assert.equal(assignmentsOnDate(store,"2026-10-19").some(x=>x.dayId===a.days[0].id),false);
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
});

test("new PPL template is Push / Pull / Lower with real editable exercises, and has no effect on existing plans",()=>{
 const store=active();
 const saved=JSON.stringify(store);
 const ppl=makeGymPlan("Push / Pull / Lower","ppl","2026-10-11");
 assert.deepEqual(ppl.days.map(day=>day.name),["Push","Pull","Lower"]);
 assert.deepEqual(ppl.days.map(day=>day.weekday),[1,3,5]);
 assert.equal(ppl.days[0].exercises.length,5);
 assert.equal(ppl.days[0].exercises.every(ex=>store.exercises.some(e=>e.id===ex.exerciseId)),true);
 assert.equal(JSON.stringify(store),saved);
 let updated={...store,plans:[...store.plans,ppl]};
 updated=setActiveGymPlan(updated,ppl.id,"2026-10-11");
 assert.equal(assignmentsOnDate(updated,"2026-10-12")[0].name,"Push");
 assert.equal(assignmentsOnDate(updated,"2026-10-14")[0].name,"Pull");
 assert.equal(assignmentsOnDate(updated,"2026-10-16")[0].name,"Lower");
 assert.equal(parseGymStore(JSON.stringify(updated)).blocked,false);
});

test("curated catalog has stable distinct IDs and broad Push / Pull / Lower / core coverage",()=>{
  const ids=EXERCISE_LIBRARY.map(e=>e.id);
  assert.equal(ids.length,72);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ["pec-deck","machine-chest-press","face-pull","hammer-curl",
    "barbell-row","bulgarian-split-squat","leg-extension","hip-thrust",
    "hanging-leg-raise","cable-crunch"]){
    assert.ok(ids.includes(id),"Missing common movement: "+id);
  }
  for(const ex of EXERCISE_LIBRARY){
    assert.ok(ex.name.trim());
    assert.ok(ex.muscle.trim());
    assert.ok(ex.equipment.trim());
    assert.ok(ex.technique.trim());
  }
});
test("older existing gym stores gain new catalog entries without changing plans, sessions or customized exercises",()=>{
  let old=active();
  old=startSession(old,assignmentsOnDate(old,"2026-10-12")[0].key,"2026-10-12");
  const custom={id:"custom-pec-deck",name:"Můj vlastní cvik",muscle:"Hrudník",
    equipment:"Stroj",kind:"Izolovaný",technique:"Moje vlastní instrukce.",custom:true};
  old={...old,exercises:[...old.exercises.filter(e=>e.id!=="pec-deck"&&e.id!=="hip-thrust").filter(e=>e.id!=="hammer-curl"),
    custom].map(e=>e.id==="bench-press"?{...e,technique:"Vlastní poznámka k benchi"}:e)};
  // Reconstruct the actual 16-exercise library originally stored in old browsers.
  const originallyBundled=new Set(["bench-press","incline-dumbbell","squat","romanian-deadlift",
    "deadlift","lat-pulldown","pull-up","cable-row","overhead-press","lateral-raise",
    "biceps-curl","triceps-pushdown","leg-press","leg-curl","calf-raise","plank"]);
  old={...old,exercises:old.exercises.filter(e=>originallyBundled.has(e.id)||e.custom)};
  const raw=JSON.stringify(old);
  assert.equal(parseGymStore(raw).blocked,false);
  const enlarged=extendGymExerciseCatalog(old);
  assert.equal(enlarged.exercises.length,EXERCISE_LIBRARY.length+1);
  assert.equal(enlarged.exercises.find(e=>e.id==="bench-press").technique,"Vlastní poznámka k benchi");
  assert.ok(enlarged.exercises.find(e=>e.id==="custom-pec-deck"));
  assert.deepEqual(enlarged.plans,old.plans);
  assert.deepEqual(enlarged.sessions,old.sessions);
  assert.deepEqual(enlarged.moves,old.moves);
  assert.equal(JSON.stringify(old),raw,"Source store should not be mutated");
  assert.equal(extendGymExerciseCatalog(enlarged),enlarged,"Repeated hydration must not duplicate entries");
  assert.equal(parseGymStore(JSON.stringify(enlarged)).blocked,false);
});

test("weekly workout templates let a three-day PPL split become five without copying exercises",()=>{
  const plan=makeGymPlan("Push / Pull / Lower","ppl","2026-10-12");
  let store=setActiveGymPlan({...emptyGymStore(),plans:[plan]},plan.id,"2026-10-12");
  assert.equal(assignmentsOnDate(store,"2026-10-12").length,1);
  store=addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-13","weekly");
  store=addGymScheduledWorkout(store,plan.id,plan.days[0].id,"2026-10-15","weekly");
  assert.equal((store.scheduledWorkouts??[]).length,2);
  assert.equal(store.plans[0].days.length,3);
  assert.equal(Array.from({length:7},(_,i)=>assignmentsOnDate(store,dateShiftForTest("2026-10-12",i)).length).reduce((a,b)=>a+b,0),5);
  const tuesday=assignmentsOnDate(store,"2026-10-13")[0];
  assert.equal(tuesday.name,"Pull");
  assert.ok(tuesday.key.split("|").length===4);
  assert.equal(assignmentsOnDate(store,"2026-10-20")[0].dayId,plan.days[1].id);
  assert.deepEqual(addGymScheduledWorkout(store,plan.id,plan.days[0].id,"2026-10-13","weekly"),store,"No duplicate date");
  assert.equal(parseGymStore(JSON.stringify({...store,weeklyGoal:5})).blocked,false);
  const started=startSession(store,tuesday.key,tuesday.date,"2026-10-13T12:00:00Z");
  assert.equal(started.sessions[0].exercises.length,plan.days[1].exercises.length);
  assert.equal(removeGymScheduledWorkout(started,tuesday.key,tuesday.date),started,"A started occurrence is immutable");
});

test("stopping a recurring workout preserves completed history, and one-off dates never repeat",()=>{
  const plan=makeGymPlan("PPL","ppl","2026-10-12");
  let store=setActiveGymPlan({...emptyGymStore(),plans:[plan]},plan.id,"2026-10-12");
  store=addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-13","weekly");
  const first=assignmentsOnDate(store,"2026-10-13")[0];
  store=startSession(store,first.key,first.date,"2026-10-13T09:00:00Z");
  store={...store,sessions:store.sessions.map(s=>({...s,completedAt:"2026-10-13T10:00:00Z"}))};
  const later=assignmentsOnDate(store,"2026-10-20")[0];
  store=removeGymScheduledWorkout(store,later.key,later.date);
  assert.equal(assignmentsOnDate(store,"2026-10-20").length,0);
  assert.equal(assignmentsOnDate(store,"2026-10-27").length,0);
  assert.equal(assignmentsOnDate(store,"2026-10-13")[0].completed,true);
  store=addGymScheduledWorkout(store,plan.id,plan.days[0].id,"2026-10-15","once");
  assert.equal(assignmentsOnDate(store,"2026-10-15").length,1);
  assert.equal(assignmentsOnDate(store,"2026-10-22").length,0);
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
});

test("legacy stores stay valid, invalid schedule and goal are blocked",()=>{
  const old=active();
  assert.equal(parseGymStore(JSON.stringify(old)).blocked,false);
  assert.equal(parseGymStore(JSON.stringify({...old,weeklyGoal:8})).blocked,true);
  assert.equal(parseGymStore(JSON.stringify({...old,scheduledWorkouts:[{id:"x",planId:"p",dayId:"d",date:"bad",repeat:"weekly"}]})).blocked,true);
  assert.equal(parseGymStore(JSON.stringify({...old,scheduledWorkouts:[{id:"x",planId:"p",dayId:"d",date:"2026-10-12",repeat:"weekly",until:"2026-10-12"}]})).blocked,true);
  assert.equal(parseGymStore(JSON.stringify({...old,weeklyGoal:5,scheduledWorkouts:[]})).blocked,false);
});
function dateShiftForTest(date,days){const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}

test("weekly additions reject collisions hidden by moves and future one-off bookings",()=>{
  const plan=makeGymPlan("PPL","ppl","2026-10-12");
  let store=setActiveGymPlan({...emptyGymStore(),plans:[plan]},plan.id,"2026-10-12");
  const native=assignmentsOnDate(store,"2026-10-12")[0];
  store=moveOccurrence(store,native.key,"2026-10-13");
  assert.equal(assignmentsOnDate(store,"2026-10-12").length,0);
  assert.equal(addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-12","weekly"),store);
  assert.equal(assignmentsOnDate(store,"2026-10-19").length,1,"Native Monday still repeats");

  store=addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-22","once");
  assert.equal(assignmentsOnDate(store,"2026-10-22").length,1);
  assert.equal(assignmentsOnDate(store,"2026-10-15").length,0);
  assert.equal(addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-15","weekly"),store,
    "A future one-off date blocks recurrence even though the initial date is empty");
});

test("a moved recurring slot cannot be duplicated from its temporarily empty weekday",()=>{
  const plan=makeGymPlan("PPL","ppl","2026-10-12");
  let store=setActiveGymPlan({...emptyGymStore(),plans:[plan]},plan.id,"2026-10-12");
  store=addGymScheduledWorkout(store,plan.id,plan.days[1].id,"2026-10-13","weekly");
  const tuesday=assignmentsOnDate(store,"2026-10-20")[0];
  store=moveOccurrence(store,tuesday.key,"2026-10-22");
  assert.equal(assignmentsOnDate(store,"2026-10-20").length,0);
  assert.equal(addGymScheduledWorkout(store,plan.id,plan.days[0].id,"2026-10-20","weekly"),store);
  assert.equal(assignmentsOnDate(store,"2026-10-27").length,1);
});
