import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyGymStore, parseGymStore, makeGymPlan, assignmentsOnDate, moveOccurrence, setGymWeekdayAssignment, setGymWeekdayTime, gymOccurrenceTime,
  occurrenceKey, startSession, gymMetrics, lastExercisePerformance,
  setActiveGymPlan, setGymDayWeekday, EXERCISE_LIBRARY, extendGymExerciseCatalog
} from "./dayframe-gym.ts";

function active() {
  const store=emptyGymStore();
  const plan=makeGymPlan("Upper / Lower","upper-lower","2026-10-12");
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

test("five-day weekly split repeats and leaves historical sessions and exercise IDs intact",()=>{
  let state=active();
  // Existing plan has two template days. Build extra recurring slots from those templates.
  const plan=state.plans[0];
  const original=JSON.stringify(state.sessions);
  state=setGymWeekdayAssignment(state,plan.id,2,plan.days[0].id,"2026-10-12");
  state=setGymWeekdayAssignment(state,plan.id,3,plan.days[1].id,"2026-10-12");
  state=setGymWeekdayAssignment(state,plan.id,5,plan.days[0].id,"2026-10-12");
  assert.equal([12,13,14,15,16,17,18].reduce((sum,d)=>sum+assignmentsOnDate(state,"2026-10-"+d).length,0),5);
  assert.equal(assignmentsOnDate(state,"2026-10-20").length,1);
  assert.equal(JSON.stringify(state.sessions),original);
  assert.equal(parseGymStore(JSON.stringify(state)).blocked,false);
  const count=state.plans[0].days.length;
  state=setGymWeekdayAssignment(state,plan.id,5,plan.days[0].id,"2026-10-12");
  assert.equal(state.plans[0].days.length,count);
  state=setGymWeekdayAssignment(state,plan.id,5,null,"2026-10-12");
  assert.equal(assignmentsOnDate(state,"2026-10-16").length,0);
  assert.equal(parseGymStore(JSON.stringify(state)).blocked,false);
});

test("recurring copies reflect later edits to shared workout templates",()=>{
  let store=active();
  const plan=store.plans[0],template=plan.days[0];
  store=setGymWeekdayAssignment(store,plan.id,2,template.id,"2026-10-12");
  const copy=store.plans[0].days.find(d=>d.templateDayId===template.id);
  assert.ok(copy);
  assert.equal(copy.exercises.length,0);
  store={...store,plans:store.plans.map(p=>({...p,days:p.days.map(d=>d.id===template.id?
    {...d,exercises:[{...template.exercises[0],sets:5,reps:7}]}:d)}))};
  const occ=assignmentsOnDate(store,"2026-10-13")[0];
  store=startSession(store,occ.key,occ.date);
  assert.equal(store.sessions[0].exercises.length,1);
  assert.equal(store.sessions[0].exercises[0].sets.length,5);
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
});

test("changing recurrence preserves manually moved future occurrences and their original identity",()=>{
  let store=active();
  const template=store.plans[0].days[0];
  const original=assignmentsOnDate(store,"2026-10-19")[0];
  assert.ok(original);
  store=moveOccurrence(store,original.key,"2026-10-20");
  assert.equal(assignmentsOnDate(store,"2026-10-20")[0].key,original.key);
  store=setGymWeekdayAssignment(store,store.activePlanId,1,null,"2026-10-12");
  assert.equal(assignmentsOnDate(store,"2026-10-19").length,0);
  const moved=assignmentsOnDate(store,"2026-10-20").find(x=>x.key===original.key);
  assert.ok(moved,"Explicit date move must survive a weekday recurrence change");
  assert.equal(moved.originalDate,"2026-10-19");
  assert.equal(moved.dayId,template.id);
  assert.equal(store.moves[original.key],"2026-10-20");
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
  store=moveOccurrence(store,original.key,"2026-10-21");
  assert.equal(assignmentsOnDate(store,"2026-10-21")[0].key,original.key);
  // Returning an explicitly moved occurrence to its original weekday remains
  // a one-off booking when the old recurring weekday is no longer active.
  store=moveOccurrence(store,original.key,"2026-10-19");
  assert.equal(store.moves[original.key],"2026-10-19");
  assert.equal(assignmentsOnDate(store,"2026-10-19")[0].key,original.key);
  store=startSession(store,original.key,"2026-10-19");
  assert.equal(store.sessions[0].occurrenceKey,original.key);
  assert.equal(parseGymStore(JSON.stringify(store)).blocked,false);
});

test("recurrence edits do not change an already-started moved session",()=>{
  let store=active();
  const occurrence=assignmentsOnDate(store,"2026-10-19")[0];
  store=moveOccurrence(store,occurrence.key,"2026-10-20");
  store=startSession(store,occurrence.key,"2026-10-20");
  const saved=JSON.stringify(store.sessions);
  store=setGymWeekdayAssignment(store,store.activePlanId,1,null,"2026-10-12");
  assert.equal(JSON.stringify(store.sessions),saved);
  assert.equal(assignmentsOnDate(store,"2026-10-20")[0].session?.id,store.sessions[0].id);
});

test("Gym times are optional, repeat weekly, and edits preserve past days",()=>{
  let s=active();const id=s.plans[0].id;
  const initial=assignmentsOnDate(s,"2026-10-12")[0];
  assert.deepEqual(gymOccurrenceTime(s,initial),{start:null,duration:60});
  s=setGymWeekdayTime(s,id,1,"17:00",90,"2026-10-12");
  assert.deepEqual(gymOccurrenceTime(s,assignmentsOnDate(s,"2026-10-12")[0]),{start:"17:00",duration:90});
  assert.deepEqual(gymOccurrenceTime(s,assignmentsOnDate(s,"2026-10-19")[0]),{start:"17:00",duration:90});
  assert.equal(parseGymStore(JSON.stringify(s)).blocked,false);
  s=setGymWeekdayTime(s,id,1,"18:00",60,"2026-10-13");
  assert.deepEqual(gymOccurrenceTime(s,assignmentsOnDate(s,"2026-10-12")[0]),{start:"17:00",duration:90});
  assert.deepEqual(gymOccurrenceTime(s,assignmentsOnDate(s,"2026-10-19")[0]),{start:"18:00",duration:60});
  assert.equal(setGymWeekdayTime(s,id,1,"23:45",180,"2026-10-13"),s);
  assert.deepEqual(s.sessions,[]);
});
test("Replacing workout type carries assigned time; moving the workout retains the hour",()=>{
  let s=active();const p=s.plans[0];
  s=setGymWeekdayTime(s,p.id,1,"16:15",75,"2026-10-12");
  s=setGymWeekdayAssignment(s,p.id,1,p.days[1].id,"2026-10-12");
  const occ=assignmentsOnDate(s,"2026-10-19")[0];
  assert.deepEqual(gymOccurrenceTime(s,occ),{start:"16:15",duration:75});
  s=moveOccurrence(s,occ.key,"2026-10-20");
  assert.deepEqual(gymOccurrenceTime(s,assignmentsOnDate(s,"2026-10-20").find(o=>o.key===occ.key)),{start:"16:15",duration:75});
  assert.equal(parseGymStore(JSON.stringify(s)).blocked,false);
});

test("a started timed workout keeps its calendar hour after the source plan is deleted",()=>{
  let state=active();const id=state.plans[0].id;
  state=setGymWeekdayTime(state,id,1,"17:30",75,"2026-10-12");
  const original=assignmentsOnDate(state,"2026-10-12")[0];
  state=startSession(state,original.key,original.date);
  assert.deepEqual(state.sessions[0].scheduledTime,{start:"17:30",duration:75});
  state={...state,plans:[],activePlanId:null,activations:[]};
  const historical=assignmentsOnDate(state,"2026-10-12")[0];
  assert.equal(historical.key,original.key);
  assert.deepEqual(gymOccurrenceTime(state,historical),{start:"17:30",duration:75});
  assert.equal(parseGymStore(JSON.stringify(state)).blocked,false);
  const older={...state,sessions:state.sessions.map(({scheduledTime,...session})=>session)};
  assert.equal(parseGymStore(JSON.stringify(older)).blocked,false,"Old session shapes stay valid");
});
