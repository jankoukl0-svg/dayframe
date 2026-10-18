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

const TEST_REDIS_URL="https://route-budget-test.upstash.io";
function withBudgetEnv(fn){
  const keys=["GOOGLE_MAPS_ROUTES_API_KEY","DAYFRAME_ROUTES_ACCESS_TOKEN",
    "UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","DAYFRAME_ROUTES_CLOUD_DAILY_QUOTA_CONFIRMED"];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const oldFetch=globalThis.fetch;
  process.env.GOOGLE_MAPS_ROUTES_API_KEY="google-api-test";
  process.env.DAYFRAME_ROUTES_ACCESS_TOKEN="a".repeat(28);
  process.env.UPSTASH_REDIS_REST_URL=TEST_REDIS_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN="redis-test-secret".repeat(3);
  delete process.env.DAYFRAME_ROUTES_CLOUD_DAILY_QUOTA_CONFIRMED;
  return Promise.resolve().then(fn).finally(()=>{
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    globalThis.fetch=oldFetch;
  });
}
function mockAtomicRedis({deny=false,outage=false}={}){
  const counts=new Map();
  const commands=[];
  const fetch=async(url,options)=>{
    assert.equal(url,TEST_REDIS_URL);
    const cmd=JSON.parse(options.body);
    commands.push(cmd);
    assert.equal(cmd[0],"EVAL");
    assert.equal(cmd[2],"2");
    assert.match(cmd[3],/dayframe:routes:/);
    assert.match(cmd[4],/dayframe:routes:/);
    if(outage)throw Error("Redis unavailable");
    const day=counts.get(cmd[3])??0,month=counts.get(cmd[4])??0;
    if(deny||day>=Number(cmd[5])||month>=Number(cmd[6]))
      return Response.json({result:[0,day,month]});
    counts.set(cmd[3],day+1);counts.set(cmd[4],month+1);
    return Response.json({result:[1,day+1,month+1]});
  };
  return {fetch,counts,commands};
}
const googleRequest=(mode="driving",token="a".repeat(28),origin="https://dayframe2.vercel.app")=>
  new Request("https://dayframe2.vercel.app/api/google-travel",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token,origin},
    body:JSON.stringify({from:home,to:place,mode}),
  });

test("Google Routes is fail-closed without a persistent atomic budget",async()=>{
  await withBudgetEnv(async()=>{
    const {GET,POST}=await import("../api/google-travel.ts");
    globalThis.fetch=()=>{throw Error("NO external calls allowed")};
    delete process.env.UPSTASH_REDIS_REST_URL;
    assert.deepEqual(await (await GET()).json(),{
      available:false,dailyLimit:50,monthlyLimit:1000,budgetConfigured:false,
    });
    assert.equal((await POST(googleRequest())).status,503);
    process.env.UPSTASH_REDIS_REST_URL="http://untrusted.example.org";
    assert.equal((await POST(googleRequest())).status,503);
    process.env.UPSTASH_REDIS_REST_URL=TEST_REDIS_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.equal((await POST(googleRequest())).status,503);
    process.env.UPSTASH_REDIS_REST_TOKEN="redis-test-secret".repeat(3);
    assert.equal((await POST(googleRequest("driving","invalid-token"))).status,401);
    assert.equal((await POST(googleRequest("driving","a".repeat(28),"https://attacker.invalid"))).status,403);
    assert.equal((await POST(googleRequest("toString"))).status,400);
    const check=await GET();
    assert.equal((await check.json()).available,true);
    // Unknown Redis outage must still fail closed and never call Google.
    assert.equal((await POST(googleRequest())).status,503);
  });
});

test("Google Routes reserves a budget atomically before charging provider",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const googleCalls=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      googleCalls.push({url,payload:JSON.parse(options.body),headers:options.headers});
      return Response.json({routes:[{duration:"3678s",distanceMeters:54670}]});
    };
    const result=await POST(googleRequest());
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{
      minutes:62,distanceMeters:54670,source:"Google Maps",trafficAware:true,
    });
    assert.equal(result.headers.get("cache-control"),"no-store, max-age=0");
    assert.equal(redis.commands.length,1);
    assert.equal(googleCalls[0].payload.travelMode,"DRIVE");
    assert.equal(googleCalls[0].payload.routingPreference,"TRAFFIC_AWARE");
    assert.equal(googleCalls[0].headers["X-Goog-Api-Key"],"google-api-test");
    assert.equal((await POST(googleRequest("transit"))).status,200);
    assert.equal(googleCalls[1].payload.travelMode,"TRANSIT");
    assert.equal(googleCalls[1].payload.routingPreference,undefined);
    assert.equal(redis.commands.length,2);
  });
});

test("budget refuses 51st daily request, 1001st monthly, and resets only at UTC boundaries",async()=>{
  await withBudgetEnv(async()=>{
    const {reserveRouteBudget,ROUTES_DAILY_LIMIT,ROUTES_MONTHLY_LIMIT}=await import("./server-route-budget.ts");
    assert.equal(ROUTES_DAILY_LIMIT,50);
    assert.equal(ROUTES_MONTHLY_LIMIT,1000);
    const redis=mockAtomicRedis();
    globalThis.fetch=redis.fetch;
    const now=new Date("2026-10-18T12:00:00Z");
    const attempts=await Promise.all(Array.from({length:75},()=>reserveRouteBudget(now)));
    assert.equal(attempts.filter(x=>x.kind==="reserved").length,50);
    assert.equal(attempts.filter(x=>x.kind==="exhausted").length,25);
    assert.equal(redis.counts.get("dayframe:routes:{budget}:20261018"),50);
    assert.equal(redis.counts.get("dayframe:routes:{budget}:202610"),50);
    // Check 19 more days; 50 per day then 1000 attempts are reserved in October.
    for(let date=19;date<=31;date++){
      const d=new Date(`2026-10-${date}T12:00:00Z`);
      const results=await Promise.all(Array.from({length:50},()=>reserveRouteBudget(d)));
      assert.equal(results.filter(x=>x.kind==="reserved").length,50);
    }
    for(let date=1;date<=6;date++){
      const d=new Date(`2026-11-${String(date).padStart(2,"0")}T12:00:00Z`);
      const results=await Promise.all(Array.from({length:50},()=>reserveRouteBudget(d)));
      assert.equal(results.filter(x=>x.kind==="reserved").length,50);
    }
    const octoberUsed=redis.counts.get("dayframe:routes:{budget}:202610");
    assert.equal(octoberUsed,700);
    assert.equal(redis.counts.get("dayframe:routes:{budget}:202611"),300);
    // Fill remaining October budget by using earlier October dates with capacity.
    for(let date=1;date<=6;date++){
      const d=new Date(`2026-10-${String(date).padStart(2,"0")}T12:00:00Z`);
      const results=await Promise.all(Array.from({length:50},()=>reserveRouteBudget(d)));
      assert.equal(results.filter(x=>x.kind==="reserved").length,50);
    }
    // If both limits are exhausted, the Retry-After must wait for the later monthly reset.
    const combined=await reserveRouteBudget(new Date("2026-10-06T13:00:00Z"));
    assert.equal(combined.kind,"exhausted");
    assert.equal(combined.dayUsed,50);
    assert.equal(combined.monthUsed,1000);
    assert.equal(combined.retryAfterSeconds,Math.floor((Date.UTC(2026,10,1)-Date.UTC(2026,9,6,13))/1000));
    const blocked=await reserveRouteBudget(new Date("2026-10-07T12:00:00Z"));
    assert.equal(blocked.kind,"exhausted");
    assert.equal(blocked.monthUsed,1000);
    assert.equal(blocked.retryAfterSeconds,Math.floor((Date.UTC(2026,10,1)-Date.UTC(2026,9,7,12))/1000));
    // A new month has its own counters.
    assert.equal((await reserveRouteBudget(new Date("2026-12-01T00:00:00Z"))).kind,"reserved");
  });
});

test("Redis outage, denied budget and invalid reply never contact Google",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    let calls=0;
    const redis=mockAtomicRedis({deny:true});
    globalThis.fetch=async(url,options)=>{
      if(url===TEST_REDIS_URL)return redis.fetch(url,options);
      calls++;throw Error("Google must not be reached");
    };
    const exhausted=await POST(googleRequest());
    assert.equal(exhausted.status,429);
    assert.equal((await exhausted.json()).monthlyLimit,1000);
    assert.equal(calls,0);
    globalThis.fetch=async(url)=>url===TEST_REDIS_URL
      ?Response.json({result:["not-valid"]}):Promise.reject(Error("Google must not be reached"));
    assert.equal((await POST(googleRequest())).status,503);
    assert.equal(calls,0);
  });
});

test("Marketplace KV credentials activate atomic budget without duplicating secrets",async()=>{
  const {routeBudgetConfigured,reserveRouteBudget}=await import("./server-route-budget.ts");
  const keys=["UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","KV_REST_API_URL","KV_REST_API_TOKEN"];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  try{
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL=TEST_REDIS_URL;
    process.env.KV_REST_API_TOKEN="kv-redis-token".repeat(3);
    assert.equal(routeBudgetConfigured(),true);
    const redis=mockAtomicRedis();
    globalThis.fetch=redis.fetch;
    assert.equal((await reserveRouteBudget(new Date("2026-10-18T14:00:00Z"))).kind,"reserved");
    assert.equal(redis.commands.length,1);

    // If the explicitly named credentials are partially supplied, do NOT mix the
    // Marketplace token with a different Upstash endpoint.
    process.env.UPSTASH_REDIS_REST_URL=TEST_REDIS_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.equal(routeBudgetConfigured(),false);
    assert.equal((await reserveRouteBudget()).kind,"unavailable");
    assert.equal(redis.commands.length,1);
  }finally{
    for(const key of keys){
      if(old[key]===undefined)delete process.env[key];
      else process.env[key]=old[key];
    }
    globalThis.fetch=originalFetch;
  }
});

test("Vercel Web default handler dispatches GET and rejects unsupported verbs without Google",async()=>{
  const {default:handler}=await import("../api/google-travel.ts");
  const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error("Must not contact Google");};
  try{
    const get=await handler.fetch(new Request("https://dayframe2.vercel.app/api/google-travel"));
    assert.equal(get.status,200);
    assert.equal(get.headers.get("content-type")?.includes("application/json"),true);
    const wrong=await handler.fetch(new Request("https://dayframe2.vercel.app/api/google-travel",{method:"PUT"}));
    assert.equal(wrong.status,405);
    assert.equal(wrong.headers.get("allow"),"GET, POST");
  }finally{globalThis.fetch=oldFetch;}
});
