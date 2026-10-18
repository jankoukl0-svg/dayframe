import test from "node:test";
import assert from "node:assert/strict";
import {emptyTravelStore,parseTravelStore,travelBlockKey,travelDirectionsUrl,eventStart,upcomingTravelTrips,liveTravelTaskKeys,travelDuration,travelSegments} from "./dayframe-travel.ts";
const home={lat:50.1,lon:14.2,label:"Domov"},place={lat:50.08,lon:14.43,label:"Fakulta"};
test("missing and damaged location data",()=>{
  assert.deepEqual(parseTravelStore(null).store,emptyTravelStore());
  assert.equal(parseTravelStore('{"version":1,"blocks":{"task:a":{"place":{"lat":110,"lon":12,"label":"X"}}}}').blocked,true);
});
test("Map URL retains exact lat/lon but never invents duration",()=>{
  const url=new URL(travelDirectionsUrl(home,place));
  assert.equal(url.searchParams.get("origin"),"50.1,14.2");
  assert.equal(url.searchParams.get("destination"),"50.08,14.43");
  assert.equal(url.searchParams.get("travelmode"),"driving");
  assert.equal(new URL(travelDirectionsUrl(home,place,"cycling")).searchParams.get("travelmode"),"bicycling");
});
test("deleted routine occurrences purge only matching travel entries",async()=>{
  const previous=globalThis.window;
  const saved=new Map();
  globalThis.window={
    localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},
    dispatchEvent:()=>{},
  };
  try {
    const a={lat:50,lon:14,label:"A"};
    const plan={place:a,mode:"driving",bufferMinutes:15,title:"Test",date:"2026-10-18",start:"12:00"};
    saved.set("dayframe-travel-v1",JSON.stringify({version:1,origin:a,blocks:{
      "task:removed":plan,"task:keep":plan,"gym:other|day|date":plan,
    }}));
    const {removeTravelForDeletedTasks,readTravelStore}=await import("./dayframe-travel.ts");
    const done=removeTravelForDeletedTasks(
      [{id:"removed"},{id:"keep"}],[{id:"keep"},{id:"new"}]);
    assert.equal(done,true);
    const updated=readTravelStore().store;
    assert.deepEqual(Object.keys(updated.blocks).sort(),["gym:other|day|date","task:keep"]);
    assert.deepEqual(updated.origin,a);
  }finally {globalThis.window=previous;}
});
test("an untimed task can store its location and becomes actionable after scheduling",()=>{
  const store=emptyTravelStore();
  store.blocks["task:untimed"]={
    place,mode:"driving",bufferMinutes:15,typicalMinutes:40,
    title:"Pohovor",date:"2026-10-18",start:"",
  };
  assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  const now=new Date("2026-10-18T08:00:00");
  assert.equal(upcomingTravelTrips(store,now,[{id:"untimed",date:"2026-10-18",title:"Pohovor",completed:false}]).length,0);
  assert.equal(upcomingTravelTrips(store,now,[{id:"untimed",date:"2026-10-18",start:"10:00",title:"Pohovor",completed:false}]).length,1);
});
test("01:30 is in following civil date of planning day",()=>{
  assert.equal(eventStart("2026-10-18","01:30")?.getDate(),19);
  assert.equal(eventStart("2026-10-18","09:00")?.getDate(),18);
});
test("moved task times are live, completed or deleted tasks are hidden",()=>{
  const store=emptyTravelStore();
  store.blocks[travelBlockKey("task","alpha")]={place,mode:"driving",bufferMinutes:15,typicalMinutes:40,
    title:"Škola",date:"2026-10-18",start:"08:00"};
  const now=new Date("2026-10-19T08:00:00");
  const live=[{id:"alpha",date:"2026-10-19",start:"09:30",title:"Pohovor",completed:false}];
  assert.equal(upcomingTravelTrips(store,now,live)[0].title,"Pohovor");
  assert.equal(upcomingTravelTrips(store,now,[{...live[0],completed:true}]).length,0);
  assert.equal(upcomingTravelTrips(store,now,[]).length,0);
});

test("gym and hygiene location is actionable only with a live incomplete occurrence",()=>{
  const store=emptyTravelStore();
  store.blocks["gym:occ-1"]={place,mode:"driving",bufferMinutes:15,typicalMinutes:30,
    title:"Pull",date:"2026-10-19",start:"09:00"};
  store.blocks["care:2026-10-19:morning"]={place,mode:"walking",bufferMinutes:5,typicalMinutes:12,
    title:"Hygiena",date:"2026-10-19",start:"09:30"};
  const now=new Date("2026-10-19T08:00:00");
  assert.equal(upcomingTravelTrips(store,now,[]).length,0);
  const live=[{key:"gym:occ-1",date:"2026-10-19",start:"10:00",title:"Pull",completed:false},
    {key:"care:2026-10-19:morning",date:"2026-10-19",start:"09:30",title:"Hygiena",completed:true}];
  assert.deepEqual(upcomingTravelTrips(store,now,[],live).map(x=>x.title),["Pull"]);
});

test("a waiting/backlog task keeps its exact offsite location through routine cleanup",()=>{
  const planned={"2026-10-18":[{id:"scheduled"}]};
  const backlog=[{id:"still-waiting"}];
  const live=liveTravelTaskKeys(planned,backlog);
  assert.equal(live.has(travelBlockKey("task","scheduled")),true);
  assert.equal(live.has(travelBlockKey("task","still-waiting")),true);
  assert.equal(live.has(travelBlockKey("task","deleted")),false);
});

test("Jarvis ranks earliest required departure, even when its event starts later",()=>{
  const store=emptyTravelStore();
  store.blocks[travelBlockKey("task","short")]={place,mode:"driving",bufferMinutes:10,
    typicalMinutes:10,title:"Krátká cesta",date:"2026-10-18",start:"10:00"};
  store.blocks[travelBlockKey("task","long")]={place,mode:"driving",bufferMinutes:10,
    typicalMinutes:90,title:"Delší cesta",date:"2026-10-18",start:"10:30"};
  const now=new Date("2026-10-18T08:00:00");
  const live=[
    {id:"short",date:"2026-10-18",start:"10:00",title:"Krátká cesta",completed:false},
    {id:"long",date:"2026-10-18",start:"10:30",title:"Delší cesta",completed:false},
  ];
  const trips=upcomingTravelTrips(store,now,live);
  assert.deepEqual(trips.map(t=>t.title),["Delší cesta","Krátká cesta"]);
  assert.equal(trips[0].departureAt.getHours(),8);
  assert.equal(trips[0].departureAt.getMinutes(),50);
});
test("departure-based horizon reveals a distant appointment whose departure is soon",()=>{
  const store=emptyTravelStore();
  store.blocks[travelBlockKey("task","flight")]={place,mode:"driving",bufferMinutes:30,
    typicalMinutes:240,title:"Letiště",date:"2026-10-19",start:"06:00"};
  const live=[{id:"flight",date:"2026-10-19",start:"06:00",title:"Letiště",completed:false}];
  const now=new Date("2026-10-18T09:00:00");
  const trips=upcomingTravelTrips(store,now,live);
  assert.equal(trips.length,1);
  assert.equal(trips[0].departureAt.getHours(),1);
  assert.equal(trips[0].departureAt.getDate(),19);
});

test("legacy simple trips remain readable and support public transit",()=>{
  const legacy={place,mode:"driving",bufferMinutes:15,typicalMinutes:45,title:"Legacy",date:"2026-10-18",start:"10:00"};
  const store=emptyTravelStore();store.blocks["task:legacy"]=legacy;
  assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  assert.equal(travelDuration(legacy),45);
  assert.equal(travelSegments(legacy,home)[0].to.label,"Fakulta");
  assert.equal(new URL(travelDirectionsUrl(home,place,"transit")).searchParams.get("travelmode"),"transit");
});

test("mixed car, transit and walking stages use consecutive map points and summed ETA",()=>{
  const parking={lat:50.11,lon:14.22,label:"Parkoviště"};
  const station={lat:50.12,lon:14.25,label:"Stanice metra"};
  const trip={
    place,mode:"driving",bufferMinutes:15,typicalMinutes:50,
    legs:[{mode:"driving",minutes:25,via:parking},{mode:"transit",minutes:15,via:station},{mode:"walking",minutes:10}],
    title:"Pohovor",date:"2026-10-18",start:"10:00",
  };
  const store=emptyTravelStore();store.origin=home;store.blocks["task:mix"]=trip;
  assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  assert.equal(travelDuration(trip),50);
  const segments=travelSegments(trip,home);
  assert.deepEqual(segments.map(x=>[x.mode,x.from?.label,x.to.label]),[
    ["driving","Domov","Parkoviště"],
    ["transit","Parkoviště","Stanice metra"],
    ["walking","Stanice metra","Fakulta"],
  ]);
  assert.equal(new URL(travelDirectionsUrl(segments[1].from,segments[1].to,segments[1].mode)).searchParams.get("travelmode"),"transit");
  const due=upcomingTravelTrips(store,new Date("2026-10-18T08:00:00"),[
    {id:"mix",date:"2026-10-18",start:"10:00",title:"Pohovor",completed:false},
  ]);
  assert.equal(due.length,1);
  assert.equal(due[0].departureAt.getHours(),8);
  assert.equal(due[0].departureAt.getMinutes(),55);
});

test("invalid multi-stage routes are blocked without discarding valid legacy data",()=>{
  const original={place,mode:"driving",bufferMinutes:5,title:"Cesta",date:"2026-10-18",start:"10:00"};
  const good={...original,typicalMinutes:30,legs:[
    {mode:"driving",minutes:20,via:{lat:50,lon:14,label:"Parkoviště"}},
    {mode:"walking",minutes:10},
  ]};
  const isBlocked=trip=>parseTravelStore(JSON.stringify({version:1,blocks:{"task:a":trip}})).blocked;
  assert.equal(isBlocked(good),false);
  assert.equal(isBlocked({...good,legs:[{mode:"driving",minutes:20},{mode:"walking",minutes:10}]}),true);
  assert.equal(isBlocked({...good,legs:[good.legs[0],{mode:"walking",minutes:10,via:home}]}),true);
  assert.equal(isBlocked({...good,legs:[{...good.legs[0],minutes:-1},good.legs[1]]}),true);
  assert.equal(isBlocked({...good,typicalMinutes:45}),true);
  assert.equal(isBlocked({...good,legs:[good.legs[0]]}),true);
  assert.equal(isBlocked(original),false);
});
