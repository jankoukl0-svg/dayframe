import test from "node:test";
import assert from "node:assert/strict";
import {buildActivityLedger, actualActivityMinutes, hasMeasuredMinutes} from "./dayframe-activity-analytics.ts";
const task=(title,category,minutes,actualMinutes,options={})=>({title,category,duration:minutes,completed:true,...(actualMinutes===undefined?{}:{actualMinutes}),...options});
test("reported duration wins over calendar duration; older completed blocks use an explicit fallback",()=>{
  const plans={
    "2026-11-02":[task("Matematika","Škola",60,42),task("Finance","Investice",90,undefined),task("Osobní","Osobní",120,120)],
    "2026-11-03":[task("Matematika","Škola",45,18),task("Čtení","Škola",40,undefined)],
  };
  const ledger=buildActivityLedger(plans,"2026-11-02","2026-11-08","2026-11-08");
  assert.equal(ledger.minutes,190);
  assert.equal(ledger.blocks,4);
  assert.equal(ledger.measured,2);
  assert.equal(ledger.scheduled,2);
  assert.deepEqual(ledger.categories.map(x=>[x.name,x.minutes]),[["Škola",100],["Investice",90]]);
  assert.equal(ledger.activities.find(x=>x.title==="Matematika")?.minutes,60);
  assert.equal(ledger.activities.find(x=>x.title==="Matematika")?.count,2);
  assert.equal(ledger.days[0].date,"2026-11-03");
  assert.equal(ledger.days[1].date,"2026-11-02");
  assert.equal(ledger.days[1].items.find(x=>x.title==="Matematika")?.source,"measured");
  assert.equal(ledger.days[1].items.find(x=>x.title==="Finance")?.source,"scheduled");
});
test("future and incomplete blocks do not appear or inflate totals",()=>{
  const plans={
    "2026-11-01":[task("Stará","Práce",100,80)],
    "2026-11-08":[task("Hotová","Práce",120,30),task("Nedokončená","Práce",60,undefined,{completed:false})],
    "2026-11-09":[task("Budoucí","Práce",90,90)],
  };
  assert.equal(buildActivityLedger(plans,"2026-11-02","2026-11-30","2026-11-08").minutes,30);
  assert.equal(buildActivityLedger(plans,"2026-11-09","2026-11-30","2026-11-08").blocks,0);
});
test("same title in different categories remains distinct and invalid clock data never creates bogus time",()=>{
  const plans={"2026-11-03":[task("Analýza","Finance",50,0),task("Analýza","Studium",40,undefined),task("Bez čísla","Studium",20,NaN)]};
  const result=buildActivityLedger(plans,"2026-11-03","2026-11-03","2026-11-03");
  assert.equal(result.minutes,60);
  assert.equal(result.activities.length,3);
  assert.equal(result.measured,1);
  assert.equal(actualActivityMinutes(plans["2026-11-03"][0]),0);
  assert.equal(hasMeasuredMinutes(plans["2026-11-03"][2]),false);
  assert.equal(result.activities.find(x=>x.title==="Analýza"&&x.category==="Finance")?.minutes,0);
});

test("planning-day ordering places after-midnight entries after the previous evening",()=>{
  const plans={"2026-11-02":[
    task("Po půlnoci","Práce",20,20,{start:"00:30"}),
    task("Večer","Práce",30,30,{start:"22:00"}),
    task("Dříve","Práce",40,40,{start:"18:00"}),
    task("Bez času","Práce",10,undefined),
  ]};
  const result=buildActivityLedger(plans,"2026-11-02","2026-11-02","2026-11-02");
  assert.deepEqual(result.days[0].items.map(x=>x.title),["Dříve","Večer","Po půlnoci","Bez času"]);
});
