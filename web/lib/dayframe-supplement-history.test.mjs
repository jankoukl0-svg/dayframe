import test from "node:test";
import assert from "node:assert/strict";
import { emptySupplementStore, newSupplement, withSupplementSchedule, markSupplementIntake, supplementIntakeKey } from "./dayframe-supplements.ts";
import { supplementHistoryDay, supplementHistorySummary, groupHistoryDoses } from "./dayframe-supplement-history.ts";

function setup() {
  const item = newSupplement("Zinek");
  item.times = ["09:00", "22:00"];
  const active = withSupplementSchedule(item, "2026-10-12");
  return {...emptySupplementStore(), supplements: [active]};
}
test("history distinguishes explicit skipped doses from unrecorded scheduled doses", () => {
  let store = setup();
  store = markSupplementIntake(store, supplementIntakeKey(store.supplements[0].id,"2026-10-12","09:00"),"taken");
  store = markSupplementIntake(store, supplementIntakeKey(store.supplements[0].id,"2026-10-13","22:00"),"skipped");
  const s = supplementHistorySummary(store,"2026-10-12","2026-10-14","2026-10-14");
  assert.equal(s.planned,6);
  assert.equal(s.taken,1);
  assert.equal(s.skipped,1);
  assert.equal(s.unrecorded,4);
  assert.equal(s.percentage,17);
  assert.equal(s.days[0].date,"2026-10-14");
  assert.equal(groupHistoryDoses(s.days[0].doses).map(x=>x.label).join(","),"Ráno,Před spaním");
  assert.equal(s.products[0].unrecorded,4);
});
test("historical schedules, pauses and date boundaries give truthful denominators", () => {
  const store = setup(), current = store.supplements[0];
  const paused=withSupplementSchedule({...current,active:false},"2026-10-14",current);
  const s = supplementHistorySummary({...store,supplements:[paused]},"2026-10-12","2026-10-20","2026-10-15");
  assert.equal(s.planned,4);
  assert.equal(s.days[0].date,"2026-10-15");
  assert.equal(s.days[0].planned,0);
  assert.equal(s.unrecorded,4);
  assert.equal(supplementHistorySummary(store,"2026-10-20","2026-10-12","2026-10-15").planned,0);
  assert.equal(supplementHistorySummary(store,"bad","2026-10-12","2026-10-15").planned,0);
});
test("streak ignores an unfinished current day, but stops at an earlier incomplete day",()=>{
  let store=setup();
  for(const date of ["2026-10-12","2026-10-13"])
    for(const time of ["09:00","22:00"])
      store=markSupplementIntake(store,supplementIntakeKey(store.supplements[0].id,date,time),"taken");
  assert.equal(supplementHistorySummary(store,"2026-10-12","2026-10-14","2026-10-14").streak,2);
  assert.equal(supplementHistorySummary(store,"2026-10-12","2026-10-14","2026-10-14").percentage,67);
  store=markSupplementIntake(store,supplementIntakeKey(store.supplements[0].id,"2026-10-14","09:00"),"taken");
  assert.equal(supplementHistorySummary(store,"2026-10-12","2026-10-14","2026-10-14").streak,2);
  assert.equal(supplementHistoryDay(store,"2026-10-14").unrecorded,1);
});
test("new or unscheduled stores have no artificial failures or adherence rate",()=>{
  const s=supplementHistorySummary(emptySupplementStore(),"2026-10-01","2026-10-10","2026-10-10");
  assert.equal(s.planned,0);
  assert.equal(s.percentage,null);
  assert.equal(s.streak,0);
  assert.equal(s.products.length,0);
});
