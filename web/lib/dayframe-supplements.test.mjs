import test from "node:test";
import assert from "node:assert/strict";
import {emptySupplementStore,parseSupplementStore,newSupplement,supplementOccurrences,supplementIntakeKey,
  markSupplementIntake,buySupplement,lowStockSupplements,supplementStats} from "./dayframe-supplements.ts";

const date="2026-10-12";
function setup(){
  const item=newSupplement("Kreatin — testovací přípravek");
  item.doseLabel="Dle etikety";
  item.stock=8;item.lowStockAt=4;item.packServings=30;item.times=["08:00","20:00"];
  return {item,store:{...emptySupplementStore(),supplements:[item]}};
}
test("schedule creates one occurrence per chosen time and weekday with stable IDs",()=>{
  const {store,item}=setup();
  const day=supplementOccurrences(store,date);
  assert.equal(day.length,2);
  assert.deepEqual(day.map(x=>x.time),["08:00","20:00"]);
  assert.equal(day[0].key,supplementIntakeKey(item.id,date,"08:00"));
  assert.equal(supplementOccurrences(store,"2026-10-13").length,2);
  item.weekdays=[1];
  assert.equal(supplementOccurrences(store,"2026-10-13").length,0);
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