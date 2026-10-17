import test from "node:test";
import assert from "node:assert/strict";
import {emptyTravelStore,parseTravelStore,travelBlockKey,travelDirectionsUrl,eventStart,upcomingTravelTrips} from "./dayframe-travel.ts";
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
