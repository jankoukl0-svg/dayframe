import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyPreventionStore,parsePreventionStore,validPreventionDate,
  validPreventionStore,newPreventionDraft,addPreventionMonths,
  createPreventionItem,updatePreventionItem,completePrevention,preventionTodayRows,preventionHistory
} from "./dayframe-prevention.ts";
const D="2026-10-10";
const draft=(dueDate="2026-10-12",opts={})=>({
  ...newPreventionDraft(),title:"Zubní kontrola",category:"dental",
  dueDate,...opts
});
const make=()=>createPreventionItem(emptyPreventionStore(),draft());
test("prevention is opt-in with zero seeded medical appointments and invalid stores cannot be silently reset",()=>{
  const blank=emptyPreventionStore();
  assert.deepEqual(parsePreventionStore(null),{store:blank,blocked:false});
  assert.equal(parsePreventionStore(JSON.stringify(blank)).blocked,false);
  assert.equal(parsePreventionStore("{").blocked,true);
  assert.equal(parsePreventionStore(JSON.stringify({...blank,version:2})).blocked,true);
  assert.equal(parsePreventionStore(JSON.stringify({...blank,items:[{id:"x"}]})).blocked,true);
  assert.equal(validPreventionStore(blank),true);
});
test("calendar dates and month repeat clamp correctly across variable month lengths",()=>{
  assert.equal(validPreventionDate("2026-02-30"),false);
  assert.equal(validPreventionDate("2024-02-29"),true);
  assert.equal(addPreventionMonths("2026-01-31",1),"2026-02-28");
  assert.equal(addPreventionMonths("2024-01-31",1),"2024-02-29");
  assert.equal(addPreventionMonths("2026-10-10",6),"2027-04-10");
});
test("reminders are derived from the user's due date, interval, and selected lead window",()=>{
  let store=createPreventionItem(emptyPreventionStore(),draft("2026-10-12",{reminderDays:3}));
  assert.equal(preventionTodayRows(store,"2026-10-08").length,0);
  assert.equal(preventionTodayRows(store,"2026-10-09")[0].status,"upcoming");
  assert.equal(preventionTodayRows(store,"2026-10-12")[0].status,"today");
  assert.equal(preventionTodayRows(store,"2026-10-13")[0].status,"overdue");
  store=createPreventionItem(store,draft(null,{title:"Bez termínu"}));
  assert.equal(preventionTodayRows(store,"2026-10-13").length,1);
});
test("completion is idempotent and retains history while recurring due date advances",()=>{
  let store=createPreventionItem(emptyPreventionStore(),draft("2026-10-10",{repeatMonths:6,reminderDays:0}));
  const id=store.items[0].id;
  store=completePrevention(store,id,D,"Absolvováno");
  assert.equal(store.items[0].dueDate,"2027-04-10");
  assert.equal(store.items[0].history.length,1);
  assert.equal(store.items[0].history[0].scheduledFor,D);
  assert.equal(store.items[0].history[0].note,"Absolvováno");
  assert.equal(preventionTodayRows(store,D)[0].status,"done");
  assert.equal(preventionTodayRows(store,"2026-10-11").length,0);
  assert.equal(completePrevention(store,id,D),null);
  assert.equal(completePrevention(store,id,"2026-09-30"),null);
  assert.equal(store.items[0].dueDate,"2027-04-10");
  assert.equal(preventionHistory(store).length,1);
});
test("one-off completion clears only next due date while preserving its history",()=>{
  let store=createPreventionItem(emptyPreventionStore(),draft(D,{repeatMonths:0}));
  store=completePrevention(store,store.items[0].id,D);
  assert.equal(store.items[0].dueDate,null);
  assert.equal(store.items[0].history.length,1);
});
test("stale metadata edits keep newer completions, and stale conflicting schedule edits fail",()=>{
  let store=make();
  const original={...store.items[0]};
  const base=draft();
  const edit={...base,provider:"Moje ordinace",notes:"Přízemí"};
  store=completePrevention(store,original.id,D);
  const next=updatePreventionItem(store,original.id,edit,base);
  assert.equal(next.items[0].provider,"Moje ordinace");
  assert.equal(next.items[0].dueDate,null);
  assert.equal(next.items[0].history.length,1);
  assert.equal(updatePreventionItem(next,original.id,{...base,dueDate:"2026-11-02"},base),null);
});
test("invalid input cannot create records or destroy valid saved history",()=>{
  const store=make();
  assert.equal(createPreventionItem(store,draft("2026-02-30")),null);
  assert.equal(createPreventionItem(store,draft("2026-10-10",{reminderDays:500})),null);
  assert.equal(completePrevention(store,store.items[0].id,"2026-10-90"),null);
  assert.equal(store.items.length,1);
  const paused=createPreventionItem(emptyPreventionStore(),draft("2026-10-10",{active:false}));
  assert.equal(preventionTodayRows(paused,D).length,0);
});
