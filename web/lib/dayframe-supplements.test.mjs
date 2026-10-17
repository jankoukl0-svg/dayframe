import test from "node:test";
import {validSupplementPhoto,validSupplementPhotoId,SUPPLEMENT_PHOTO_MAX_SIZE} from "./dayframe-supplement-photos.ts";
import assert from "node:assert/strict";
import {emptySupplementStore,parseSupplementStore,newSupplement,supplementOccurrences,supplementIntakeKey,
  markSupplementIntake,markAllSupplementIntakes,buySupplement,lowStockSupplements,supplementStats,withSupplementSchedule,
  migratePendingSupplementSchedules} from "./dayframe-supplements.ts";

const date="2026-10-12";
function setup(){
  const item=newSupplement("Kreatin — testovací přípravek");
  item.doseLabel="Dle etikety";
  item.stock=8;item.lowStockAt=4;item.packServings=30;item.times=["08:00","20:00"];
  item.scheduleHistory=[{effectiveFrom:date,active:true,weekdays:[...item.weekdays],times:[...item.times]}];
  return {item,store:{...emptySupplementStore(),supplements:[item]}};
}
test("schedule creates one occurrence per chosen time and weekday with stable IDs",()=>{
  const {store,item}=setup();
  const day=supplementOccurrences(store,date);
  assert.equal(day.length,2);
  assert.deepEqual(day.map(x=>x.time),["08:00","20:00"]);
  assert.equal(day[0].key,supplementIntakeKey(item.id,date,"08:00"));
  assert.equal(supplementOccurrences(store,"2026-10-13").length,2);
  const next=withSupplementSchedule({...item,weekdays:[1]},"2026-10-13",item);
  assert.equal(supplementOccurrences({...store,supplements:[next]},"2026-10-13").length,0);
  assert.equal(supplementOccurrences({...store,supplements:[next]},"2026-10-14").length,0);
  assert.equal(supplementOccurrences({...store,supplements:[next]},date).length,2);
});
test("intake is reversible, idempotent, updates stock once and preserves explicit skipped state",()=>{
  const {store}=setup();const key=supplementOccurrences(store,date)[0].key;
  const taken=markSupplementIntake(store,key,"taken");
  assert.equal(taken.supplements[0].stock,7);
  assert.equal(taken.intakes.length,1);
  const undone=markSupplementIntake(taken,key,"taken");
  assert.equal(undone.supplements[0].stock,8);
  assert.equal(undone.intakes.length,0);
  const skipped=markSupplementIntake(taken,key,"skipped");
  assert.equal(skipped.supplements[0].stock,8);
  assert.equal(skipped.intakes[0].status,"skipped");
  assert.equal(markSupplementIntake(skipped,key,"skipped").intakes.length,0);
  assert.equal(markSupplementIntake(store,supplementIntakeKey(store.supplements[0].id,date,"16:00"),"taken"),store);
});
test("stock never silently goes negative or appears on undo; purchases add one declared pack",()=>{
  const {store,item}=setup();item.stock=0;
  const key=supplementOccurrences(store,date)[0].key;
  assert.equal(markSupplementIntake(store,key,"taken"),store);
  const bought=buySupplement(store,item.id,date);
  assert.equal(bought.supplements[0].stock,30);
  assert.equal(bought.purchases.length,1);
  assert.equal(markSupplementIntake(bought,key,"taken").supplements[0].stock,29);
  assert.equal(lowStockSupplements(store)[0].id,item.id);
  assert.equal(lowStockSupplements(bought).length,0);
});
test("history and adherence aggregate actual check-ins and do not create dummy checkboxes",()=>{
  const {store}=setup();const occurrences=supplementOccurrences(store,date);
  const once=markSupplementIntake(store,occurrences[0].key,"taken");
  const twice=markSupplementIntake(once,occurrences[1].key,"skipped");
  assert.equal(supplementStats(twice,date,date).taken,1);
  assert.equal(supplementStats(twice,date,date).skipped,1);
  assert.equal(supplementStats(twice,date,date).planned,2);
});
test("unrecognized or malformed storage blocks changes rather than overwriting records",()=>{
  const {store}=setup();
  assert.deepEqual(parseSupplementStore(JSON.stringify(store)),{store,blocked:false});
  assert.equal(parseSupplementStore(null).blocked,false);
  assert.equal(parseSupplementStore("{").blocked,true);
  assert.equal(parseSupplementStore(JSON.stringify({...store,supplements:[{...store.supplements[0],times:["25:00"]}]})).blocked,true);
  assert.equal(parseSupplementStore(JSON.stringify({...store,supplements:[{...store.supplements[0],stock:-1}]})).blocked,true);
  assert.equal(parseSupplementStore(JSON.stringify({...store,intakes:[{key:"nonsense",supplementId:"a",date,time:"08:00",status:"taken",recordedAt:"x",servings:1}]})).blocked,true);
});
test("schedule-effective dates preserve historical denominator on creation, day edits and pauses",()=>{
  const item=newSupplement("Test");
  item.times=["08:00"];
  const first=withSupplementSchedule(item,"2026-10-12");
  const store={...emptySupplementStore(),supplements:[first]};
  assert.equal(supplementStats(store,"2026-10-09","2026-10-12").planned,1);
  const changed=withSupplementSchedule({...first,times:["08:00","20:00"]},"2026-10-13",first);
  const next={...store,supplements:[changed]};
  assert.equal(supplementStats(next,"2026-10-12","2026-10-13").planned,3);
  assert.equal(supplementStats(next,"2026-10-12","2026-10-14").planned,5);
  const paused=withSupplementSchedule({...changed,active:false},"2026-10-14",changed);
  assert.equal(supplementStats({...next,supplements:[paused]},"2026-10-12","2026-10-15").planned,3);
});

test("an intake logged while stock tracking is off cannot add phantom stock when undone later",()=>{
  const {store,item}=setup();
  item.stock=null;
  const key=supplementOccurrences(store,date)[0].key;
  const taken=markSupplementIntake(store,key,"taken");
  assert.equal(taken.intakes[0].stockDeducted,0);
  const enabled={...taken,supplements:taken.supplements.map(x=>({...x,stock:10}))};
  const undone=markSupplementIntake(enabled,key,"taken");
  assert.equal(undone.supplements[0].stock,10);
  assert.equal(undone.intakes.length,0);
});

test("several same-day edits replace the current schedule without duplicating revisions",()=>{
  const item=newSupplement("Zinc test");
  const initial=withSupplementSchedule(item,date);
  const changed=withSupplementSchedule({...initial,times:["07:00"],active:true},date,initial);
  const paused=withSupplementSchedule({...changed,active:false},date,changed);
  const s={...emptySupplementStore(),supplements:[paused]};
  assert.equal(supplementOccurrences(s,date).length,0);
  assert.equal(supplementOccurrences(s,"2026-10-13").length,0);
  assert.equal(paused.scheduleHistory.length,1);
});

test("moving a logged dose keeps its check-in without scheduling a duplicate serving",()=>{
  const item=newSupplement("Večerní doplněk");
  const saved=withSupplementSchedule(item,date);
  const state={...emptySupplementStore(),supplements:[saved]};
  const morningKey=supplementIntakeKey(saved.id,date,"09:00");
  const taken=markSupplementIntake(state,morningKey,"taken");
  const changed=withSupplementSchedule({...taken.supplements[0],times:["22:00"]},date,taken.supplements[0]);
  let updated={...taken,supplements:[changed]};
  assert.deepEqual(supplementOccurrences(updated,date).map(x=>[x.time,x.intake?.status]),[["09:00","taken"]]);
  assert.equal(markAllSupplementIntakes(updated,date),updated,"Already taken cannot be consumed again");
  updated=markSupplementIntake(updated,morningKey,"taken");
  assert.equal(updated.intakes.length,0);
  assert.deepEqual(supplementOccurrences(updated,date).map(x=>x.time),["22:00"]);
  const marked=markSupplementIntake(updated,supplementIntakeKey(saved.id,date,"22:00"),"taken");
  assert.equal(marked.intakes[0].status,"taken");
});

test("moving two planned doses retains one old check-in and only the remaining new dose",()=>{
  const item=newSupplement("Magnesium");
  item.times=["09:00","15:00"];
  const initial=withSupplementSchedule(item,date);
  let state={...emptySupplementStore(),supplements:[initial]};
  state=markSupplementIntake(state,supplementIntakeKey(initial.id,date,"09:00"),"taken");
  const next=withSupplementSchedule({...state.supplements[0],times:["15:00","22:00"]},date,state.supplements[0]);
  state={...state,supplements:[next]};
  assert.deepEqual(supplementOccurrences(state,date).map(x=>[x.time,x.intake?.status??"pending"]),
    [["09:00","taken"],["22:00","pending"]]);
  assert.equal(supplementStats(state,date,date).planned,2);
});

test("legacy next-day changes migrate to today without rewriting past days or stock",()=>{
  const item=newSupplement("Zinek");
  const original=withSupplementSchedule(item,date);
  const following="2026-10-13";
  const yesterday="2026-10-11";
  const oldIntake={key:supplementIntakeKey(original.id,yesterday,"09:00"),
    supplementId:original.id,date:yesterday,time:"09:00",status:"taken",
    recordedAt:"2026-10-11T09:00:00Z",servings:1,stockDeducted:0};
  const stale={...original,times:["22:00"],scheduleHistory:[
    ...original.scheduleHistory,{effectiveFrom:following,times:["22:00"],weekdays:[...original.weekdays],active:true},
  ]};
  const state={...emptySupplementStore(),supplements:[stale],intakes:[oldIntake]};
  const migrated=migratePendingSupplementSchedules(state,date);
  assert.notEqual(migrated,state);
  assert.deepEqual(migrated.supplements[0].scheduleHistory.map(x=>[x.effectiveFrom,x.times]),
    [[date,["22:00"]]]);
  assert.deepEqual(migrated.intakes,[oldIntake]);
  assert.deepEqual(supplementOccurrences(migrated,date).map(x=>x.time),["22:00"]);
  assert.equal(migratePendingSupplementSchedules(migrated,date),migrated,"migration idempotent");
  assert.equal(parseSupplementStore(JSON.stringify(migrated)).blocked,false);
});

test("supplement photo references are optional, validated and backwards-compatible",()=>{
  const {store}=setup();
  assert.equal(parseSupplementStore(JSON.stringify(store)).blocked,false);
  const photoId="supp-photo-123e4567-e89b-42d3-a456-426614174000";
  assert.equal(validSupplementPhotoId(photoId),true);
  const withPhoto={...store,supplements:store.supplements.map(s=>({...s,photoId}))};
  assert.equal(parseSupplementStore(JSON.stringify(withPhoto)).blocked,false);
  assert.equal(parseSupplementStore(JSON.stringify({...store,supplements:[{...store.supplements[0],photoId:"https://example.com/image.png"}]})).blocked,true);
  assert.equal(parseSupplementStore(JSON.stringify({...store,supplements:[{...store.supplements[0],photoId:"../bad"}]})).blocked,true);
  assert.equal(parseSupplementStore(JSON.stringify({...store,supplements:[{...store.supplements[0],photoId:null}]})).blocked,true);
  assert.deepEqual(withPhoto.intakes,store.intakes);
  assert.deepEqual(withPhoto.purchases,store.purchases);
  assert.equal(JSON.stringify(withPhoto).includes("data:image"),false);
});
test("supplement upload accepts only small nonempty supported images",()=>{
  assert.equal(validSupplementPhoto(new Blob(["x"],{type:"image/png"})),true);
  assert.equal(validSupplementPhoto(new Blob(["x"],{type:"image/webp"})),true);
  assert.equal(validSupplementPhoto(new Blob(["x"],{type:"image/jpeg"})),true);
  assert.equal(validSupplementPhoto(new Blob(["x"],{type:"image/svg+xml"})),false);
  assert.equal(validSupplementPhoto(new Blob([""],{type:"image/png"})),false);
  assert.equal(validSupplementPhoto(new Blob([new Uint8Array(SUPPLEMENT_PHOTO_MAX_SIZE+1)],{type:"image/png"})),false);
});


test("Užito vše confirms all pending daily doses once and subtracts stock exactly once",()=>{
  const {store,item}=setup();
  const before=JSON.stringify(store);
  const marked=markAllSupplementIntakes(store,date);
  assert.notEqual(marked,store);
  assert.equal(marked.intakes.length,2);
  assert.deepEqual(marked.intakes.map(x=>x.status),["taken","taken"]);
  assert.equal(marked.supplements[0].stock,6);
  assert.deepEqual(marked.intakes.map(x=>x.key),supplementOccurrences(store,date).map(x=>x.key));
  assert.equal(markAllSupplementIntakes(marked,date),marked,"Repeated bulk clicks are idempotent");
  assert.equal(JSON.stringify(store),before,"Original store is not mutated");
  const undone=markSupplementIntake(marked,supplementIntakeKey(item.id,date,"08:00"),"taken");
  assert.equal(undone.supplements[0].stock,7,"Single-dose undo remains available");
  assert.equal(undone.intakes.length,1);
});

test("Užito vše respects prior skipped and taken decisions, touching only pending doses",()=>{
  const {store,item}=setup();
  const another=newSupplement("Vitamin D");
  another.doseLabel="Podle etikety";another.stock=4;
  another.scheduleHistory=[{effectiveFrom:date,active:true,weekdays:[...another.weekdays],times:[...another.times]}];
  let current={...store,supplements:[item,another]};
  const morning=supplementIntakeKey(item.id,date,"08:00");
  const evening=supplementIntakeKey(item.id,date,"20:00");
  current=markSupplementIntake(current,morning,"taken");
  current=markSupplementIntake(current,evening,"skipped");
  const originals=current.intakes.map(x=>({...x}));
  const bulk=markAllSupplementIntakes(current,date);
  assert.deepEqual(bulk.intakes.filter(x=>x.key===morning||x.key===evening),originals);
  assert.equal(bulk.intakes.length,3);
  assert.equal(bulk.intakes.find(x=>x.supplementId===another.id)?.status,"taken");
  assert.equal(bulk.supplements.find(x=>x.id===item.id)?.stock,7);
  assert.equal(bulk.supplements.find(x=>x.id===another.id)?.stock,3);
  assert.deepEqual(supplementStats(bulk,date,date),{planned:3,taken:2,skipped:1});
});

test("Užito vše is atomic when one or multiple remaining doses exceed stock",()=>{
  const {store,item}=setup();
  item.stock=1;
  const before=JSON.stringify(store);
  assert.equal(markAllSupplementIntakes(store,date),store,"Two doses need two units, only one available");
  assert.equal(JSON.stringify(store),before,"No partial intake or inventory mutation");
  const another=newSupplement("Unavailable supplement");
  another.doseLabel="Dle etikety";another.stock=0;
  another.scheduleHistory=[{effectiveFrom:date,active:true,weekdays:[...another.weekdays],times:[...another.times]}];
  const mixed={...store,supplements:[{...item,stock:2},another]};
  assert.equal(markAllSupplementIntakes(mixed,date),mixed,"One out-of-stock product blocks full batch");
  assert.equal(mixed.intakes.length,0);
  const replenished={...store,supplements:[{...item,stock:2}]};
  const success=markAllSupplementIntakes(replenished,date);
  assert.equal(success.supplements[0].stock,0);
  assert.equal(success.intakes.length,2);
});

test("Užito vše has no effect on days without scheduled or pending doses",()=>{
  const {store}=setup();
  assert.equal(markAllSupplementIntakes(store,"2026-10-11"),store);
  assert.equal(markAllSupplementIntakes(store,"invalid"),store);
  const allTaken=markAllSupplementIntakes(store,date);
  assert.equal(markAllSupplementIntakes(allTaken,date),allTaken);
});


test("fractional servings do not create false stock shortages, but real shortages stay blocked",()=>{
  const {store,item}=setup();
  item.stock=0.3;
  item.servingsPerIntake=0.1;
  item.times=["08:00","12:00","20:00"];
  item.scheduleHistory=[{effectiveFrom:date,active:true,weekdays:[...item.weekdays],times:[...item.times]}];
  const bulk=markAllSupplementIntakes(store,date);
  assert.notEqual(bulk,store,"Three 0.1-unit doses must fit into 0.3 units");
  assert.equal(bulk.intakes.length,3);
  assert.equal(bulk.supplements[0].stock,0);
  assert.equal(parseSupplementStore(JSON.stringify(bulk)).blocked,false);
  const restored=markSupplementIntake(bulk,supplementIntakeKey(item.id,date,"20:00"),"taken");
  assert.ok(Math.abs(restored.supplements[0].stock-0.1)<1e-12,"Undo restores exactly one serving");
  const retried=markAllSupplementIntakes(restored,date);
  assert.equal(retried.intakes.length,3);
  assert.equal(retried.supplements[0].stock,0);

  const insufficient={...store,supplements:[{...item,stock:0.29}]};
  assert.equal(markAllSupplementIntakes(insufficient,date),insufficient,"A genuine 0.01-unit shortage must reject the entire batch");
  assert.equal(insufficient.intakes.length,0);
});
