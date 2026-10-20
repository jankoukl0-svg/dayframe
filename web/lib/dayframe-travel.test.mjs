import test from "node:test";
import assert from "node:assert/strict";
import {emptyTravelStore,parseTravelStore,travelBlockKey,travelDirectionsUrl,eventStart,upcomingTravelTrips,liveTravelTaskKeys,travelDuration,travelSegments,travelReservationsForDay} from "./dayframe-travel.ts";
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

test("parking discovery validates bounded worldwide queries without provider calls",async()=>{
  const {GET}=await import("../api/parking.ts");
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=()=>{calls++;throw Error("Should not call Overpass")};
  try{
    for(const invalid of ["?lat=999&lon=14","?lat=50&lon=x","?lat=50&lon=14&radius=99999",
      "?lat=NaN&lon=14","?lon=14"]){
      const response=await GET(new Request("https://example.test/api/parking"+invalid));
      assert.equal(response.status,400);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test("parking discovery reports real OSM fee states and filters private spaces",async()=>{
  const {GET}=await import("../api/parking.ts");
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    assert.equal(url,"https://overpass-api.de/api/interpreter");
    assert.match(String(options.body),/amenity/);
    return Response.json({elements:[
      {type:"node",id:101,lat:49.7400,lon:13.3800,tags:{name:"Placená garáž",fee:"yes",charge:"35 CZK/hour",parking:"multi-storey"}},
      {type:"node",id:102,lat:49.7420,lon:13.3810,tags:{name:"Zdarma",fee:"no"}},
      {type:"node",id:103,lat:49.7430,lon:13.3830,tags:{name:"Pouze pro rezidenty",fee:"no",access:"private"}},
      {type:"way",id:104,center:{lat:49.744,lon:13.384},tags:{name:"Neznámý tarif",fee:"yes",charge:"různé"}},
      {type:"way",id:105,center:{lat:49.745,lon:13.385},tags:{name:"Podmíněná zdarma",fee:"no","fee:conditional":"yes @ (Mo-Fr 08:00-18:00)"}},
      {type:"node",id:106,lat:49.746,lon:13.386,tags:{name:"Zákaznické",access:"customers",fee:"yes"}},
      {type:"node",id:107,lat:49.745,lon:13.383,tags:{name:"Soukromá pro auta",motor_vehicle:"private",fee:"no"}},
      {type:"node",id:108,lat:49.745,lon:13.383,tags:{name:"Pro držitele povolení",motorcar:"permit",fee:"no"}},
      {type:"node",id:109,lat:49.745,lon:13.383,tags:{name:"Bez vjezdu aut",vehicle:"no",fee:"no"}},
    ]});
  };
  try{
    const url="https://example.test/api/parking?lat=49.74&lon=13.38&radius=1800";
    const result=await GET(new Request(url));
    assert.equal(result.status,200);
    const body=await result.json();
    assert.equal(body.source,"OpenStreetMap");
    assert.equal(body.items.length,5);
    assert.deepEqual(body.items.find(p=>p.id==="node:101").price,
      {kind:"hourly",label:"35 CZK/hod",amount:35,currency:"CZK"});
    assert.equal(body.items.find(p=>p.id==="node:102").price.kind,"free");
    assert.equal(body.items.find(p=>p.id==="way:104").price.kind,"paid");
    assert.equal(body.items.find(p=>p.id==="way:105").price.kind,"paid");
    assert.equal(body.items.find(p=>p.id==="node:106").access,"customers");
    assert.equal(calls.length,1);
    assert.equal((await GET(new Request(url))).status,200);
    assert.equal(calls.length,1,"nearby searches should reuse cache, not overload public Overpass");
    // Different location must be queried independently, not tied to Prague.
    const result2=await GET(new Request("https://example.test/api/parking?lat=49.75&lon=13.4&radius=4000"));
    assert.equal(result2.status,200);
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=previous;}
});

test("parking discovery degrades safely when Overpass is unavailable",async()=>{
  const {GET}=await import("../api/parking.ts");
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:"not available"},{status:429});
  try{
    const res=await GET(new Request("https://example.test/api/parking?lat=42.772&lon=12.991&radius=1800"));
    assert.equal(res.status,503);
    assert.match((await res.json()).error,/OpenStreetMap/);
  }finally{globalThis.fetch=previous;}
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
      options:[{minutes:62,distanceMeters:54670,steps:[],transfers:0,walkingMeters:0}],
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

test("Google Routes reports actionable but sanitized provider authorization errors",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const expected=new Map([
      [400,"odmítly parametry této trasy"],
      [401,"klíč není platný"],
      [403,"Zkontroluj aktivaci Routes API"],
      [404,"nenašly požadovanou službu"],
      [429,"omezily počet požadavků"],
      [503,"dočasně nedostupná"],
    ]);
    for(const [status,fragment] of expected){
      globalThis.fetch=async(url,options)=>{
        if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
        return Response.json({error:{message:"SECRET-SHOULD-NOT-LEAK"}},{status});
      };
      const response=await POST(googleRequest());
      assert.equal(response.status,502);
      const body=await response.json();
      assert.match(body.error,new RegExp(String(status)));
      assert.ok(body.error.includes(fragment));
      assert.equal(JSON.stringify(body).includes("SECRET-SHOULD-NOT-LEAK"),false);
    }
  });
});
test("standard driving request uses the known working traffic-aware basic payload",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const body=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      body.push(JSON.parse(options.body));
      assert.equal(options.headers["X-Goog-FieldMask"],"routes.duration,routes.distanceMeters");
      return Response.json({routes:[{duration:"3600s",distanceMeters:69700}]});
    };
    const reply=await POST(googleRequest("driving"));
    assert.equal(reply.status,200);
    assert.equal(body.length,1);
    assert.equal(body[0].travelMode,"DRIVE");
    assert.equal(body[0].routingPreference,"TRAFFIC_AWARE");
    assert.equal(body[0].computeAlternativeRoutes,false);
    assert.equal(body[0].departureTime,undefined);
    assert.equal(redis.commands.length,1);
  });
});

test("503 error remains sanitized and enables explicit simplified retry",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const requests=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      requests.push(JSON.parse(options.body));
      if(requests.length===1)
        return Response.json({error:{
          message:"SENSITIVE-REQUEST-CONTEXT",status:"UNAVAILABLE",
          details:[{reason:"BACKEND_NOT_READY"}]
        }},{status:503});
      return Response.json({routes:[{duration:"1500s",distanceMeters:18000}]});
    };
    const first=await POST(googleRequest());
    assert.equal(first.status,502);
    const failure=await first.json();
    assert.equal(failure.providerStatus,503);
    assert.equal(failure.providerCode,"UNAVAILABLE");
    assert.equal(failure.providerReason,"BACKEND_NOT_READY");
    assert.equal(failure.retryable,true);
    assert.equal(JSON.stringify(failure).includes("SENSITIVE-REQUEST-CONTEXT"),false);
    assert.equal(requests[0].computeAlternativeRoutes,false);
    const fallback=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"driving",simpleRoute:true}),
    });
    const second=await POST(fallback);
    assert.equal(second.status,200);
    const fallbackResult=await second.json();
    assert.equal(fallbackResult.minutes,25);
    assert.equal(fallbackResult.trafficAware,false);
    assert.equal(requests[1].computeAlternativeRoutes,false);
    assert.equal(requests[1].routingPreference,"TRAFFIC_UNAWARE");
    assert.equal(requests[1].departureTime,undefined);
    assert.equal(requests.length,2);
    assert.equal(redis.commands.length,2);
  });
});
test("traffic-unaware retry works after a recent now-time expires, unlike traffic-aware calls",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const stale=new Date(Date.now()-3*60000).toISOString();
    const payloads=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      payloads.push(JSON.parse(options.body));
      return Response.json({routes:[{duration:"2300s",distanceMeters:17000}]});
    };
    const request=(simplified)=>new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"driving",departureTime:stale,
        ...(simplified?{simpleRoute:true}:{})}),
    });
    assert.equal((await POST(request(false))).status,400);
    const response=await POST(request(true));
    assert.equal(response.status,200);
    assert.equal((await response.json()).trafficAware,false);
    assert.equal(payloads.length,1);
    assert.equal(payloads[0].departureTime,undefined);
    assert.equal(payloads[0].routingPreference,"TRAFFIC_UNAWARE");
    assert.equal(redis.commands.length,1);
  });
});
test("a stalled Google error body cannot prevent a sanitized 503 response",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      const stream=new ReadableStream({
        start(controller){
          options.signal.addEventListener("abort",()=>controller.error(new Error("aborted")),{once:true});
        },
      });
      return new Response(stream,{status:503});
    };
    const start=Date.now();
    const response=await POST(googleRequest());
    assert.equal(response.status,502);
    assert.equal((await response.json()).providerStatus,503);
    assert.ok(Date.now()-start<5000,"diagnostic stream timeout should not wait indefinitely");
    assert.equal(redis.commands.length,1);
  });
});

test("simple transit retry preserves departure schedule and provider strips unexpected detail values",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const when=new Date(Date.now()+600000).toISOString();
    let googleRequestBody;
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      googleRequestBody=JSON.parse(options.body);
      return Response.json({routes:[{duration:"900s",distanceMeters:4000,
        legs:[{steps:[{travelMode:"TRANSIT",
          transitDetails:{transitLine:{nameShort:"B",vehicle:{type:"SUBWAY"}}}}]}]}]});
    };
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"transit",
        departureTime:when,simpleRoute:true}),
    });
    const response=await POST(req);
    assert.equal(response.status,200);
    assert.equal(googleRequestBody.departureTime,when);
    assert.equal(googleRequestBody.computeAlternativeRoutes,false);
    assert.equal(googleRequestBody.routingPreference,undefined);
    assert.equal(redis.commands.length,1);
  });
});

test("simplified calculation setting is validated without reserving budget",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    let calls=0;globalThis.fetch=()=>{calls++;throw Error("External requests forbidden")};
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"driving",simpleRoute:"yes"}),
    });
    assert.equal((await POST(req)).status,400);
    assert.equal(calls,0);
  });
});

test("transit alternatives choose fastest returned journey and sanitize stop details",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let paid=0;
    const when=new Date(Date.now()+600000).toISOString();
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      paid++;
      const payload=JSON.parse(options.body);
      assert.equal(payload.travelMode,"TRANSIT");
      assert.equal(payload.departureTime,when);
      assert.equal(payload.computeAlternativeRoutes,true);
      assert.equal(payload.transitPreferences.routingPreference,"FEWER_TRANSFERS");
      assert.match(options.headers["X-Goog-FieldMask"],/transitDetails/);
      return Response.json({routes:[
        {duration:"2700s",distanceMeters:12000,legs:[{steps:[{travelMode:"TRANSIT",
          transitDetails:{headsign:"Centrum",transitLine:{nameShort:"A",vehicle:{type:"SUBWAY"}},
            stopCount:3,stopDetails:{departureStop:{name:"Černý Most"},
              arrivalStop:{name:"Muzeum"},departureTime:"2026-10-19T09:10:00Z",
              arrivalTime:"2026-10-19T09:30:00Z"}}}]}]},
        {duration:"2100s",distanceMeters:10000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:150,navigationInstruction:{instructions:"Dojdi na zastávku"}},
          {travelMode:"TRANSIT",transitDetails:{headsign:"Směr <script>nebezpečí</script>",
            transitLine:{nameShort:"9",vehicle:{type:"TRAM"}},stopCount:5,
            localizedValues:{
              departureTime:{time:{text:"11:10"},timeZone:"Europe/Prague"},
              arrivalTime:{time:{text:"11:25"},timeZone:"Europe/Prague"},
            },
            stopDetails:{departureStop:{name:"Florenc"},arrivalStop:{name:"Náměstí Republiky"},
              departureTime:"2026-10-19T09:10:00Z",arrivalTime:"2026-10-19T09:25:00Z"}}},
        ]}]},
      ]});
    };
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"transit",departureTime:when,
        transitPreference:"fewer_transfers"}),
    });
    const response=await POST(req);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.minutes,35);
    assert.equal(result.options.length,2);
    assert.equal(result.options[0].steps[1].line,"9");
    assert.equal(result.options[0].steps[1].departureLabel,"11:10");
    assert.equal(result.options[0].steps[1].arrivalZone,"Europe/Prague");
    assert.equal(result.options[0].steps[1].transfers,undefined);
    assert.equal(result.options[0].walkingMeters,150);
    assert.equal(result.options[0].transfers,0);
    assert.equal(JSON.stringify(result).includes("<script>"),false);
    assert.equal(paid,1);
    assert.equal(redis.commands.length,1);
  });
});
test("walking turn steps are summarized around late S22 and metro rides",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let calls=0;
    const walk=(n,meters)=>Array.from({length:n},()=>({travelMode:"WALK",distanceMeters:meters}));
    const transit=(line,type)=>({travelMode:"TRANSIT",transitDetails:{
      transitLine:{nameShort:line,vehicle:{type}},
      stopDetails:{departureStop:{name:"Rajská zahrada"},arrivalStop:{name:"Hlavní nádraží"}}
    }});
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      calls++;
      return Response.json({routes:[{duration:"2400s",distanceMeters:9200,legs:[{steps:[
        ...walk(90,4),transit("S22","COMMUTER_TRAIN"),...walk(70,2),
        transit("C","SUBWAY"),...walk(5,3),
      ]}]}]});
    };
    const response=await POST(googleRequest("transit"));
    assert.equal(response.status,200);
    const data=await response.json();
    const route=data.options[0];
    assert.deepEqual(route.steps.map(step=>step.kind),["walk","transit","walk","transit","walk"]);
    assert.deepEqual(route.steps.filter(step=>step.kind==="walk").map(step=>step.distanceMeters),[360,140,15]);
    assert.equal(route.walkingMeters,515);
    assert.equal(route.transfers,1);
    assert.equal(route.steps[1].line,"S22");
    assert.equal(route.steps[1].vehicle,"COMMUTER_TRAIN");
    assert.equal(route.steps[3].vehicle,"SUBWAY");
    assert.equal(calls,1);
    assert.equal(redis.commands.length,1);
  });
});

test("metro preference requests actual SUBWAY service in one budgeted MHD call",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let providerCalls=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      providerCalls++;
      const payload=JSON.parse(options.body);
      assert.equal(payload.travelMode,"TRANSIT");
      assert.deepEqual(payload.transitPreferences.allowedTravelModes,["SUBWAY","BUS","LIGHT_RAIL"]);
      assert.equal(payload.transitPreferences.routingPreference,"LESS_WALKING");
      return Response.json({routes:[
        {duration:"2580s",distanceMeters:13400,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:400},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"201",vehicle:{type:"BUS"}}}},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"S34",vehicle:{type:"COMMUTER_TRAIN"}}}},
          {travelMode:"WALK",distanceMeters:500},
        ]}]},
        {duration:"2940s",distanceMeters:13100,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:200},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"B",vehicle:{type:"SUBWAY"}}}},
          {travelMode:"WALK",distanceMeters:350},
        ]}]},
      ]});
    };
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"transit",
        transitPreference:"balanced",transitTravelModes:"metro"}),
    });
    const response=await POST(req);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.options[0].minutes,49);
    assert.equal(data.options[0].steps.find(s=>s.kind==="transit").line,"B");
    assert.equal(data.options[1].minutes,43);
    assert.equal(redis.commands.length,1);
    assert.equal(providerCalls,1);
  });
});
test("subway-only preference prioritizes a verified B to C ride in one paid call",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let provider=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      provider++;
      const payload=JSON.parse(options.body);
      assert.equal(payload.travelMode,"TRANSIT");
      assert.equal(payload.computeAlternativeRoutes,true);
      assert.equal(payload.transitPreferences.routingPreference,"FEWER_TRANSFERS");
      assert.deepEqual(payload.transitPreferences.allowedTravelModes,["SUBWAY"]);
      const transit=(line,type)=>({travelMode:"TRANSIT",transitDetails:{
        transitLine:{nameShort:line,vehicle:{type}},
        stopDetails:{departureStop:{name:"Florenc"},arrivalStop:{name:"Hlavní nádraží"}}
      }});
      return Response.json({routes:[
        {duration:"2640s",distanceMeters:13600,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:150},transit("B","SUBWAY"),
          transit("26","TRAM"),{travelMode:"WALK",distanceMeters:200}]}]},
        {duration:"2760s",distanceMeters:13200,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:150},transit("B","SUBWAY"),
          transit("C","SUBWAY"),{travelMode:"WALK",distanceMeters:500}]}]},
      ]});
    };
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"transit",transitTravelModes:"subway_only"}),
    });
    const response=await POST(req);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result.options[0].steps.filter(x=>x.kind==="transit").map(x=>x.line),["B","C"]);
    assert.equal(result.options[0].minutes,46);
    assert.equal(result.options[1].minutes,44);
    assert.equal(provider,1);
    assert.equal(redis.commands.length,1);
  });
});

test("balanced comfort ranking prefers metro-to-metro over mixed transit for similar trips",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    const transit=(line,type)=>({travelMode:"TRANSIT",transitDetails:{
      transitLine:{nameShort:line,vehicle:{type}}
    }});
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      return Response.json({routes:[
        {duration:"2400s",distanceMeters:12000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:300},transit("B","SUBWAY"),
          transit("26","TRAM"),{travelMode:"WALK",distanceMeters:250}]}]},
        {duration:"2580s",distanceMeters:12000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:300},transit("B","SUBWAY"),
          transit("C","SUBWAY"),{travelMode:"WALK",distanceMeters:250}]}]},
      ]});
    };
    const result=await (await POST(googleRequest("transit"))).json();
    assert.equal(result.minutes,43);
    assert.deepEqual(result.options[0].steps.filter(x=>x.kind==="transit").map(x=>x.line),["B","C"]);
  });
});

test("rejects subway preference on a car route without billing Google",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    let calls=0;globalThis.fetch=()=>{calls++;throw Error("unexpected paid call")};
    const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"driving",transitTravelModes:"metro"}),
    });
    assert.equal((await POST(req)).status,400);
    assert.equal(calls,0);
  });
});

test("default balanced transit prefers the usable metro over a faster 2 km walk to a train",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let count=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      count++;
      const payload=JSON.parse(options.body);
      assert.equal(payload.travelMode,"TRANSIT");
      assert.equal(payload.computeAlternativeRoutes,true);
      assert.equal(payload.transitPreferences.routingPreference,"LESS_WALKING");
      return Response.json({routes:[
        {duration:"2700s",distanceMeters:13000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:1300},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"S3",vehicle:{type:"COMMUTER_TRAIN"}}}},
          {travelMode:"WALK",distanceMeters:900},
        ]}]},
        {duration:"3300s",distanceMeters:15000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:250},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"B",vehicle:{type:"SUBWAY"}}}},
          {travelMode:"WALK",distanceMeters:250},
        ]}]},
      ]});
    };
    const response=await POST(googleRequest("transit"));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.minutes,55);
    assert.equal(data.options[0].steps.find(x=>x.kind==="transit").line,"B");
    assert.equal(data.options[0].walkingMeters,500);
    assert.equal(data.options[1].walkingMeters,2200);
    assert.equal(count,1);
    assert.equal(redis.commands.length,1);
  });
});

test("transit preference rankings favor fewer changes or shorter walks",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    const redis=mockAtomicRedis();
    let providerCalls=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url)===TEST_REDIS_URL)return redis.fetch(url,options);
      providerCalls++;
      return Response.json({routes:[
        {duration:"1200s",distanceMeters:12000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:600},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"A"}}},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"B"}}},
        ]}]},
        {duration:"1500s",distanceMeters:14000,legs:[{steps:[
          {travelMode:"WALK",distanceMeters:100},
          {travelMode:"TRANSIT",transitDetails:{transitLine:{nameShort:"C"}}},
        ]}]},
      ]});
    };
    const makeReq=p=>new Request("https://dayframe2.vercel.app/api/google-travel",{
      method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
      body:JSON.stringify({from:home,to:place,mode:"transit",transitPreference:p}),
    });
    const fastest=await (await POST(makeReq("fastest"))).json();
    assert.equal(fastest.minutes,20);
    const transfers=await (await POST(makeReq("fewer_transfers"))).json();
    assert.equal(transfers.minutes,25);
    assert.equal(transfers.options[0].transfers,0);
    const walking=await (await POST(makeReq("less_walking"))).json();
    assert.equal(walking.minutes,25);
    assert.equal(walking.options[0].walkingMeters,100);
    assert.equal(providerCalls,3);
    assert.equal(redis.commands.length,3);
  });
});
test("route preferences and departure time reject bad values without spending budget",async()=>{
  await withBudgetEnv(async()=>{
    const {POST}=await import("../api/google-travel.ts");
    let calls=0;globalThis.fetch=()=>{calls++;throw Error("No calls allowed")};
    for(const body of [
      {from:home,to:place,mode:"driving",transitPreference:"less_walking"},
      {from:home,to:place,mode:"transit",transitPreference:"bad-value"},
      {from:home,to:place,mode:"transit",departureTime:"2000-01-01T00:00:00Z"},
      {from:home,to:place,mode:"driving",departureTime:new Date(Date.now()+9*86400000).toISOString()},
    ]){
      const req=new Request("https://dayframe2.vercel.app/api/google-travel",{
        method:"POST",headers:{"content-type":"application/json",
          authorization:"Bearer "+"a".repeat(28),origin:"https://dayframe2.vercel.app"},
        body:JSON.stringify(body),
      });
      assert.equal((await POST(req)).status,400);
    }
    assert.equal(calls,0);
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

test("Routes readiness exposes exact Vercel commit for deployment-matched smoke",async()=>{
  const {GET}=await import("../api/google-travel.ts");
  const previous=process.env.VERCEL_GIT_COMMIT_SHA;
  try{
    process.env.VERCEL_GIT_COMMIT_SHA="abc123release";
    assert.equal((await (await GET()).json()).deploymentCommit,"abc123release");
  }finally{
    if(previous===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA=previous;
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

test("single-stage car, walk, bike and public transit reserve both Week directions by actual minutes",()=>{
  const events=[{key:"task:english",date:"2026-10-20",start:"14:00",end:"15:30",title:"Běžná angličtina"}];
  for(const mode of ["driving","walking","cycling","transit"]){
    const store=emptyTravelStore();
    store.blocks["task:english"]={place,mode,bufferMinutes:15,typicalMinutes:32,
      calendarMinutes:32,calendarVerified:true,returnHome:true,returnMinutes:38,
      returnVerified:false,title:events[0].title,date:"2026-10-20",start:"14:00"};
    const windows=travelReservationsForDay(store,"2026-10-20",events);
    assert.deepEqual(windows.map(w=>[w.direction,w.start,w.end,w.estimated]),[
      ["outbound",13*60+13,14*60,false],["return",15*60+30,16*60+8,true]
    ],"mode "+mode+" must not change reservation projection");
    assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  }
});
test("legacy location-only direct trips never invent travel time and remain editable",()=>{
  const store=emptyTravelStore();
  store.blocks["task:english"]={place,mode:"driving",bufferMinutes:15,title:"Angličtina",
    date:"2026-10-20",start:"14:00"};
  const events=[{key:"task:english",date:"2026-10-20",start:"14:00",end:"15:30",title:"Angličtina"}];
  assert.equal(travelReservationsForDay(store,"2026-10-20",events).length,0);
  assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  store.blocks["task:english"].typicalMinutes=27;
  assert.equal(travelReservationsForDay(store,"2026-10-20",events)[0].duration,42);
});
test("travel calendar projects Google outbound minutes before event and optional reverse ride after",()=>{
  const store=emptyTravelStore();
  store.blocks["task:english"]={place,mode:"driving",bufferMinutes:10,typicalMinutes:55,calendarMinutes:48,
    returnHome:true,returnMinutes:52,returnVerified:true,calendarVerified:true,title:"Běžná angličtina",date:"2026-10-20",start:"14:00"};
  const events=[{key:"task:english",date:"2026-10-20",start:"14:00",end:"15:00",title:"Běžná angličtina"}];
  const windows=travelReservationsForDay(store,"2026-10-20",events);
  assert.deepEqual(windows.map(x=>[x.direction,x.start,x.end,x.estimated]),[
    ["outbound",13*60+2,14*60,false],
    ["return",15*60,15*60+52,false],
  ]);
  assert.equal(windows[0].bufferMinutes,10);
  assert.equal(windows[0].duration,58);
  assert.equal(windows[1].duration,52);
  assert.equal(parseTravelStore(JSON.stringify(store)).blocked,false);
  const moved=travelReservationsForDay(store,"2026-10-21",events.map(x=>({...x,date:"2026-10-21",
    start:"16:15",end:"17:15"})));
  assert.equal(moved.length,2);
  assert.equal(moved[0].start,16*60+15-58);
  assert.deepEqual(travelReservationsForDay(store,"2026-10-20",[]),[],"no orphan ghost for deleted event");
});
test("return journey is never projected unless opted in, and manual direction is flagged estimate",()=>{
  const store=emptyTravelStore();
  store.blocks["task:abc"]={place,mode:"walking",bufferMinutes:5,typicalMinutes:20,
    title:"Kurz",date:"2026-10-20",start:"13:00"};
  const event=[{key:"task:abc",date:"2026-10-20",start:"13:00",end:"14:15",title:"Kurz"}];
  assert.equal(travelReservationsForDay(store,"2026-10-20",event).length,1);
  assert.equal(travelReservationsForDay(store,"2026-10-20",event)[0].estimated,true);
  store.blocks["task:abc"].returnHome=true;
  store.blocks["task:abc"].returnMinutes=20;
  const reservations=travelReservationsForDay(store,"2026-10-20",event);
  assert.equal(reservations.length,2);
  assert.equal(reservations[1].estimated,true);
  assert.equal(reservations[1].start,14*60+15);
});
test("return booking validation blocks malformed durations but accepts old saved journeys",()=>{
  const trip={place,mode:"transit",bufferMinutes:15,typicalMinutes:31,
    title:"Návštěva",date:"2026-10-20",start:"17:00"};
  assert.equal(parseTravelStore(JSON.stringify({version:1,blocks:{"task:old":trip}})).blocked,false);
  for(const edits of [
    {returnHome:true}, {returnMinutes:0,returnHome:true},
    {returnMinutes:-5,returnHome:true},{calendarMinutes:1441},
    {returnVerified:"yes"},{returnHome:"false"},{calendarVerified:"true"},
  ]){
    const store=emptyTravelStore();store.blocks["task:x"]={...trip,...edits};
    assert.equal(parseTravelStore(JSON.stringify(store)).blocked,true);
  }
});
test("trip reservations outside the visible working hours are flagged not silently truncated",()=>{
  const store=emptyTravelStore();
  store.blocks["task:early"]={place,mode:"driving",bufferMinutes:10,calendarMinutes:95,
    returnHome:true,returnMinutes:140,title:"Včasný vlak",date:"2026-10-20",start:"08:30"};
  const reservations=travelReservationsForDay(store,"2026-10-20",
    [{key:"task:early",date:"2026-10-20",start:"08:30",end:"23:45",title:"Včasný vlak"}]);
  assert.equal(reservations[0].start,6*60+45);
  assert.equal(reservations[0].outsideCalendar,true);
  assert.equal(reservations[1].outsideCalendar,true);
});
