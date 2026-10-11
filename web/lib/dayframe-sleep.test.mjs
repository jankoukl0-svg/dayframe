import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySleepStore,validSleepStore,parseSleepStore,sleepDurationMinutes,upsertSleepEntry,
  sleepCheckInStatus,sleepSeries,sleepAverageMinutes
} from "./dayframe-sleep.ts";
const day="2026-10-12";
const entry=(date,bedtime="23:30",wakeTime="07:15")=>({
  date,bedtime,wakeTime,quality:4,note:"",
  createdAt:"2026-10-12T09:00:00.000Z",updatedAt:"2026-10-12T09:00:00.000Z"
});
test("sleep is opt-in and malformed or newer store blocks changes",()=>{
  const empty=emptySleepStore();
  assert.deepEqual(parseSleepStore(null),{store:empty,blocked:false});
  assert.deepEqual(parseSleepStore(JSON.stringify(empty)),{store:empty,blocked:false});
  assert.equal(parseSleepStore("{").blocked,true);
  assert.equal(parseSleepStore(JSON.stringify({...empty,version:2})).blocked,true);
  assert.equal(parseSleepStore(JSON.stringify({...empty,entries:[entry("2026-02-30")]})).blocked,true);
  assert.equal(parseSleepStore(JSON.stringify({...empty,entries:[entry(day,"23:00","23:00")]})).blocked,true);
  assert.equal(parseSleepStore(JSON.stringify({...empty,entries:[{...entry(day),quality:10}]})).blocked,true);
  assert.equal(validSleepStore({...empty,goalMinutes:440}),true);
});
test("overnight and post-midnight sleep durations are derived from wake date",()=>{
  assert.equal(sleepDurationMinutes(day,"23:30","07:15"),465);
  assert.equal(sleepDurationMinutes(day,"01:00","09:00"),480);
  assert.equal(sleepDurationMinutes(day,"23:00","23:00"),null);
  assert.equal(sleepDurationMinutes(day,"garbage","07:00"),null);
  assert.equal(sleepDurationMinutes(day,"22:00","22:10"),null);
});
test("one wake date maps to exactly one editable sleep record",()=>{
  let store=emptySleepStore();
  store=upsertSleepEntry(store,entry(day));
  store=upsertSleepEntry(store,{...entry(day,"00:15","08:15"),createdAt:"new"});
  assert.equal(store.entries.length,1);
  assert.equal(store.entries[0].createdAt,entry(day).createdAt);
  assert.equal(sleepDurationMinutes(day,store.entries[0].bedtime,store.entries[0].wakeTime),480);
});
test("single Today item uses Sleep's completion only when enabled",()=>{
  let store=emptySleepStore();
  assert.deepEqual(sleepCheckInStatus(store,day),{due:false,complete:false});
  store={...store,checkInEnabled:true};
  assert.deepEqual(sleepCheckInStatus(store,day),{due:true,complete:false});
  store=upsertSleepEntry(store,entry(day));
  assert.deepEqual(sleepCheckInStatus(store,day),{due:true,complete:true});
});
test("series and average only include actual nights in the selected date range",()=>{
  let store=upsertSleepEntry(emptySleepStore(),entry("2026-10-08","23:00","07:00"));
  store=upsertSleepEntry(store,entry(day,"00:30","07:30"));
  assert.equal(sleepSeries(store,day,3).length,1);
  assert.equal(sleepAverageMinutes(store,day,3),420);
  assert.equal(sleepAverageMinutes(store,day,30),450);
  assert.equal(sleepAverageMinutes(emptySleepStore(),day,30),null);
});
