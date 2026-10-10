import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyGymStore, parseGymStore, makeGymPlan, assignmentsOnDate, moveOccurrence,
  occurrenceKey, startSession, gymMetrics, lastExercisePerformance
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
