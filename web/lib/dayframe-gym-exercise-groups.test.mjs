import test from "node:test";
import assert from "node:assert/strict";
import {EXERCISE_LIBRARY} from "./dayframe-gym.ts";
import {defaultGymExerciseFilter,gymExerciseGroup,searchGymExercises,
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
