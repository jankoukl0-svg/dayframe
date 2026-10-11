import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBodyStore, blankMeasurements, parseBodyStore, validBodyStore, validBodyDate,
  upsertBodyEntry, bodySeries, bodyChange, latestMetric, bodyCheckInStatus, createBodyGoal,
  bodyGoalProgress
} from "./dayframe-body.ts";
const D="2026-10-12";
const entry=(date,fields,id="body-1")=>({
  id,date,metrics:{...blankMeasurements(),...fields},note:"",
  createdAt:"2026-10-12T12:00:00.000Z",updatedAt:"2026-10-12T12:00:00.000Z"
});
test("new body data stays opt-in and rejects malformed existing stores instead of resetting them",()=>{
  const s=emptyBodyStore();
  assert.equal(s.schedule.frequency,"off");
  assert.deepEqual(parseBodyStore(null),{store:s,blocked:false});
  assert.deepEqual(parseBodyStore(JSON.stringify(s)),{store:s,blocked:false});
  assert.equal(parseBodyStore("{").blocked,true);
  assert.equal(parseBodyStore(JSON.stringify({...s,version:9})).blocked,true);
  assert.equal(parseBodyStore(JSON.stringify({...s,entries:[entry(D,{weightKg:-10})]})).blocked,true);
  assert.equal(parseBodyStore(JSON.stringify({...s,photos:[{id:"a",date:D,mimeType:"image/svg+xml",caption:"",createdAt:"now"}]})).blocked,true);
  assert.equal(validBodyStore({...s,schedule:{frequency:"daily",weekday:4}}),true);
});
test("date keys require real local calendar dates",()=>{
  assert.equal(validBodyDate("2026-10-12"),true);
  for(const d of ["2026-02-30","2026-13-01","2026-1-12","2000-02-30"])assert.equal(validBodyDate(d),false);
  assert.equal(validBodyDate("2024-02-29"),true);
});
test("one dated measurement is idempotently edited, partial metrics are accepted",()=>{
  let s=emptyBodyStore();
  s=upsertBodyEntry(s,entry(D,{weightKg:70}));
  assert.equal(s.entries.length,1);
  assert.equal(s.entries[0].metrics.waistCm,null);
  s=upsertBodyEntry(s,entry(D,{weightKg:71,waistCm:81},"another-id"));
  assert.equal(s.entries.length,1);
  assert.equal(s.entries[0].id,"body-1");
  assert.equal(s.entries[0].metrics.weightKg,71);
  const same=upsertBodyEntry(s,entry("2026-10-13",{weightKg:9999}));
  assert.equal(same,s);
});
test("real chart series, changes and latest measurements follow date order and periods",()=>{
  let s=emptyBodyStore();
  s=upsertBodyEntry(s,entry("2026-10-09",{weightKg:67},"a"));
  s=upsertBodyEntry(s,entry("2026-10-12",{waistCm:79},"b"));
  s=upsertBodyEntry(s,entry("2026-10-10",{weightKg:68},"c"));
  assert.equal(latestMetric(s,"weightKg","2026-10-12"),68);
  assert.equal(latestMetric(s,"waistCm","2026-10-10"),null);
  assert.deepEqual(bodySeries(s,"weightKg","2026-10-12",2),[]);
  assert.deepEqual(bodySeries(s,"weightKg","2026-10-12",null).map(x=>x.value),[67,68]);
  assert.equal(bodyChange(s,"weightKg","2026-10-12"),1);
});
test("checklist has no default task and one shared completion per scheduled day",()=>{
  let s=emptyBodyStore();
  assert.deepEqual(bodyCheckInStatus(s,D),{due:false,complete:false});
  s={...s,schedule:{frequency:"weekly",weekday:1}};
  assert.deepEqual(bodyCheckInStatus(s,D),{due:true,complete:false});
  assert.equal(bodyCheckInStatus(s,"2026-10-13").due,false);
  s=upsertBodyEntry(s,entry(D,{chestCm:95}));
  assert.deepEqual(bodyCheckInStatus(s,D),{due:true,complete:true});
  s={...s,schedule:{frequency:"daily",weekday:1}};
  assert.equal(bodyCheckInStatus(s,"2026-10-13").due,true);
});
test("goals use logged baseline and target, not invented medical advice",()=>{
  let s=upsertBodyEntry(emptyBodyStore(),entry(D,{weightKg:70}));
  s=createBodyGoal(s,"weightKg",75,D,"2026-12-01");
  const goal=s.goals[0];assert.equal(goal.startValue,70);
  assert.deepEqual(bodyGoalProgress(s,goal,D),{current:70,percent:0,reached:false});
  s=upsertBodyEntry(s,entry("2026-10-13",{weightKg:72.5},"day-2"));
  assert.deepEqual(bodyGoalProgress(s,goal,"2026-10-13"),{current:72.5,percent:50,reached:false});
  s=upsertBodyEntry(s,entry("2026-10-14",{weightKg:75},"day-3"));
  assert.deepEqual(bodyGoalProgress(s,goal,"2026-10-14"),{current:75,percent:100,reached:true});
  assert.equal(createBodyGoal(s,"weightKg",75,D,"2026-10-01"),s);
});

test("an initially reached target loses full progress when the next measurement moves away",()=>{
  let s=upsertBodyEntry(emptyBodyStore(),entry(D,{weightKg:75}));
  s=createBodyGoal(s,"weightKg",75,D,null);
  const goal=s.goals[0];
  assert.deepEqual(bodyGoalProgress(s,goal,D),{current:75,percent:100,reached:true});
  s=upsertBodyEntry(s,entry("2026-10-13",{weightKg:73},"later"));
  assert.deepEqual(bodyGoalProgress(s,goal,"2026-10-13"),{current:73,percent:0,reached:false});
});
