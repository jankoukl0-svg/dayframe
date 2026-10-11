import test from "node:test";
import assert from "node:assert/strict";
import {EXERCISE_LIBRARY} from "./dayframe-gym.ts";
import {defaultGymExerciseFilter,gymExerciseGroup,searchGymExercises,matchesGymExerciseSearch,
  GYM_EXERCISE_GROUPS} from "./dayframe-gym-exercise-groups.ts";

test("standard movements are grouped by split and remain alphabetized inside each group",()=>{
  const groups=searchGymExercises(EXERCISE_LIBRARY,"");
  assert.deepEqual(groups.map(g=>g.group),["Push","Pull","Lower","Core"]);
  assert.equal(groups.reduce((sum,g)=>sum+g.items.length,0),72);
  assert.ok(groups.find(g=>g.group==="Push").items.some(ex=>ex.id==="bench-press"));
  assert.ok(groups.find(g=>g.group==="Pull").items.some(ex=>ex.id==="hammer-curl"));
  assert.ok(groups.find(g=>g.group==="Lower").items.some(ex=>ex.id==="bulgarian-split-squat"));
  assert.ok(groups.find(g=>g.group==="Core").items.some(ex=>ex.id==="plank"));
  for(const g of groups){
    assert.deepEqual(g.items.map(ex=>ex.name),g.items.map(ex=>ex.name)
      .sort((a,b)=>a.localeCompare(b,"cs")));
  }
  assert.deepEqual(GYM_EXERCISE_GROUPS,["Push","Pull","Lower","Core","Ostatní"]);
});
test("name, equipment and muscle search ignores case and Czech diacritics",()=>{
  const flatten=(term,group="Vše")=>searchGymExercises(EXERCISE_LIBRARY,term,group)
    .flatMap(g=>g.items.map(item=>item.id));
  assert.ok(flatten("bulharsky drep").includes("bulgarian-split-squat"));
  assert.ok(flatten("BICEPS").includes("hammer-curl"));
  assert.ok(flatten("jednorucky").includes("dumbbell-bench-press"));
  assert.ok(flatten("kladivove zdvihy").includes("hammer-curl"));
  assert.ok(flatten("stroj predkopavani").includes("leg-extension"));
  assert.ok(flatten("BENCH PRESS").includes("bench-press"));
  assert.equal(flatten("bench","Lower").length,0);
  assert.deepEqual(flatten("xyzneexistuje"),[]);
});
test("custom exercises go to a split by muscle or to Ostatní; no existing data is mutated",()=>{
  const known={id:"my-pull",name:"Můj tah",muscle:"Záda",equipment:"Guma",kind:"Silový",technique:"",custom:true};
  const unknown={...known,id:"my-other",name:"Cvik bez partie",muscle:"Jiná partie"};
  const source=[known,unknown];
  assert.equal(gymExerciseGroup(known),"Pull");
  assert.equal(gymExerciseGroup(unknown),"Ostatní");
  assert.equal(gymExerciseGroup({...unknown,muscle:"Břicho"}),"Core");
  assert.deepEqual(searchGymExercises(source,"muj").map(g=>g.group),["Pull"]);
  assert.deepEqual(searchGymExercises(source,"cvik").map(g=>g.group),["Ostatní"]);
  assert.deepEqual(searchGymExercises(source,"", "Pull")[0].items.map(ex=>ex.id),["my-pull"]);
  assert.equal(source.length,2);
});
test("default filter follows the actual day name, with a safe All fallback for custom days",()=>{
  assert.equal(defaultGymExerciseFilter("Push"),"Push");
  assert.equal(defaultGymExerciseFilter("Pull 2"),"Pull");
  assert.equal(defaultGymExerciseFilter("Lower"),"Lower");
  assert.equal(defaultGymExerciseFilter("Nohy"),"Lower");
  assert.equal(defaultGymExerciseFilter("Upper"),"Vše");
  assert.equal(defaultGymExerciseFilter(""),"Vše");
});


test("pec deck chest and reverse rear-delt deck are distinct existing exercises and searchable by gym spellings",()=>{
  const chest=EXERCISE_LIBRARY.find(e=>e.id==="pec-deck");
  const rear=EXERCISE_LIBRARY.find(e=>e.id==="reverse-pec-deck");
  assert.ok(chest);assert.ok(rear);
  assert.equal(gymExerciseGroup(chest),"Push");
  assert.equal(gymExerciseGroup(rear),"Pull");
  const ids=(q,group="Vše")=>searchGymExercises(EXERCISE_LIBRARY,q,group)
    .flatMap(x=>x.items.map(e=>e.id));
  for(const spelling of ["pec deck","pec dec","pecdec","pecdeck","peck deck"]){
    assert.ok(ids(spelling).includes("pec-deck"),spelling+" should match chest");
    assert.ok(ids(spelling).includes("reverse-pec-deck"),spelling+" should match rear delts");
    assert.deepEqual(ids(spelling,"Push").includes("reverse-pec-deck"),false);
    assert.deepEqual(ids(spelling,"Pull").includes("pec-deck"),false);
  }
  for(const spelling of ["pecdec na zadni ramena","pec dec na zadni ramena","rear delt fly","obraceny motylek"]){
    assert.deepEqual(ids(spelling),["reverse-pec-deck"],spelling);
  }
  assert.ok(ids("pecdec","Pull").includes("reverse-pec-deck"));
  assert.ok(ids("pecdec","Push").includes("pec-deck"));
  assert.equal(gymExerciseGroup(EXERCISE_LIBRARY.find(e=>e.id==="face-pull")),"Pull");
  assert.equal(matchesGymExerciseSearch(rear,"zadni ramena"),true);
  assert.equal(gymExerciseGroup({...rear,id:"user-rear",muscle:"Zadní ramena"}),"Pull");
});
