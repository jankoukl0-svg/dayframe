/** Server-only Google Maps Routes proxy. Never place the Google API key in browser JS.
 * Disabled until both secrets are configured on Vercel. No response caching.
 * Keep a separate Google Cloud quota and API restriction to bound usage costs.
 */
import {timingSafeEqual} from "node:crypto";
// Budget implementation is in this Vercel entrypoint so runtime never imports a sibling .ts file.
export const ROUTES_DAILY_LIMIT=50;
export const ROUTES_MONTHLY_LIMIT=1000;

const RESERVE_SCRIPT=`
local day=tonumber(redis.call("GET",KEYS[1]) or "0")
local month=tonumber(redis.call("GET",KEYS[2]) or "0")
if not day or not month then return redis.error_reply("invalid counter") end
if day>=tonumber(ARGV[1]) or month>=tonumber(ARGV[2]) then
  return {0,day,month}
end
day=redis.call("INCR",KEYS[1])
if day==1 then redis.call("EXPIREAT",KEYS[1],ARGV[3]) end
month=redis.call("INCR",KEYS[2])
if month==1 then redis.call("EXPIREAT",KEYS[2],ARGV[4]) end
return {1,day,month}
`;

function config(){
  // The Vercel Marketplace Upstash integration commonly injects KV_REST_API_*.
  // Select one complete credential pair; never mix endpoint and token across stores.
  const useUpstash=Boolean(process.env.UPSTASH_REDIS_REST_URL||process.env.UPSTASH_REDIS_REST_TOKEN);
  const raw=useUpstash?process.env.UPSTASH_REDIS_REST_URL:process.env.KV_REST_API_URL;
  const token=useUpstash?process.env.UPSTASH_REDIS_REST_TOKEN:process.env.KV_REST_API_TOKEN;
  if(!raw||!token||token.length<20)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||!url.hostname.endsWith(".upstash.io")||url.hostname===".upstash.io"
      ||url.username||url.password||url.port||url.pathname!=="/"&&url.pathname!==""
      ||url.search||url.hash)return null;
    return {url:url.origin,token};
  }catch{return null;}
}

export const routeBudgetConfigured=()=>Boolean(config());
export type BudgetReservation=
  | {kind:"reserved";dayUsed:number;monthUsed:number}
  | {kind:"exhausted";dayUsed:number;monthUsed:number;retryAfterSeconds:number}
  | {kind:"unavailable"};

/** This must run before the paid Google fetch, once for EVERY attempted stage. */
export async function reserveRouteBudget(now:Date=new Date()):Promise<BudgetReservation>{
  const credentials=config();
  if(!credentials||Number.isNaN(now.getTime()))return {kind:"unavailable"};

  // UTC calendar days/months; keys share the same Redis hash slot.
  const year=now.getUTCFullYear(),month=now.getUTCMonth(),day=now.getUTCDate();
  const dateKey=`${year}${String(month+1).padStart(2,"0")}${String(day).padStart(2,"0")}`;
  const monthKey=`${year}${String(month+1).padStart(2,"0")}`;
  const tomorrow=Math.floor(Date.UTC(year,month,day+1)/1000);
  const nextMonth=Math.floor(Date.UTC(year,month+1,1)/1000);
  const body=["EVAL",RESERVE_SCRIPT,"2",
    `dayframe:routes:{budget}:${dateKey}`,`dayframe:routes:{budget}:${monthKey}`,
    String(ROUTES_DAILY_LIMIT),String(ROUTES_MONTHLY_LIMIT),
    String(tomorrow),String(nextMonth)];

  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),4500);
  try{
    const response=await fetch(credentials.url,{
      method:"POST",signal:abort.signal,cache:"no-store",
      headers:{"Authorization":"Bearer "+credentials.token,"Content-Type":"application/json"},
      body:JSON.stringify(body),
    });
    if(!response.ok)return {kind:"unavailable"};
    const result=await response.json() as {result?:unknown;error?:unknown};
    if(result.error||!Array.isArray(result.result)||result.result.length!==3)
      return {kind:"unavailable"};
    const [allowed,dayUsed,monthUsed]=result.result.map(Number);
    if(![allowed,dayUsed,monthUsed].every(Number.isSafeInteger)
      ||![0,1].includes(allowed)||dayUsed<0||monthUsed<0
      ||dayUsed>ROUTES_DAILY_LIMIT||monthUsed>ROUTES_MONTHLY_LIMIT)
      return {kind:"unavailable"};
    if(allowed===1)return {kind:"reserved",dayUsed,monthUsed};
    return {kind:"exhausted",dayUsed,monthUsed,
      retryAfterSeconds:Math.max(1,(monthUsed>=ROUTES_MONTHLY_LIMIT?nextMonth:tomorrow)-Math.floor(now.getTime()/1000))};
  }catch{return {kind:"unavailable"};
  }finally{clearTimeout(timeout);}
}


type Point={lat:number;lon:number};
type RouteMode="driving"|"walking"|"cycling"|"transit";
type TransitPreference="fastest"|"fewer_transfers"|"less_walking";
const TRANSIT_PREFERENCES:Record<Exclude<TransitPreference,"fastest">,string>={
  fewer_transfers:"FEWER_TRANSFERS",less_walking:"LESS_WALKING",
};
const cleanText=(value:unknown,max=120):string=>
  typeof value==="string"?value.replace(/<[^>]*>/g,"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max):"";
type GoogleStep={
  travelMode?:string;distanceMeters?:number;navigationInstruction?:{instructions?:string};
  transitDetails?:{
    headsign?:string;stopCount?:number;
    localizedValues?:{
      departureTime?:{time?:{text?:string};timeZone?:string};
      arrivalTime?:{time?:{text?:string};timeZone?:string};
    };
    transitLine?:{name?:string;nameShort?:string;vehicle?:{type?:string}};
    stopDetails?:{departureStop?:{name?:string};arrivalStop?:{name?:string};
      departureTime?:string;arrivalTime?:string};
  };
};
type GoogleRoute={duration?:string;distanceMeters?:number;legs?:Array<{steps?:GoogleStep[]}>};
type DisplayStep={
  kind:"transit"|"walk";line?:string;vehicle?:string;headsign?:string;
  from?:string;to?:string;departureTime?:string;arrivalTime?:string;
  departureLabel?:string;arrivalLabel?:string;departureZone?:string;arrivalZone?:string;
  stops?:number;distanceMeters?:number;instructions?:string;
};
function routeOption(route:GoogleRoute,mode:RouteMode){
  const seconds=typeof route.duration==="string"&&/^\d+(?:\.\d+)?s$/.test(route.duration)
    ?Number(route.duration.slice(0,-1)):NaN;
  const meters=route.distanceMeters;
  if(!Number.isFinite(seconds)||seconds<0||seconds>86400
    ||typeof meters!=="number"||!Number.isFinite(meters)||meters<0)return null;
  const steps:DisplayStep[]=[];
  let walkingMeters=0,transitCount=0;
  if(mode==="transit")for(const leg of (route.legs??[]).slice(0,3)){
    // Google returns dozens of tiny turn-by-turn WALK steps. Collect the entire
    // journey before applying the display cap; otherwise the train may be lost.
    for(const step of (leg.steps??[]).slice(0,500)){
      const transit=step.transitDetails;
      if(transit){
        transitCount++;
        const stop=transit.stopDetails;
        if(steps.length<80)steps.push({
          kind:"transit",line:cleanText(transit.transitLine?.nameShort||transit.transitLine?.name),
          vehicle:cleanText(transit.transitLine?.vehicle?.type,32),
          headsign:cleanText(transit.headsign),
          from:cleanText(stop?.departureStop?.name),to:cleanText(stop?.arrivalStop?.name),
          ...(stop?.departureTime?{departureTime:stop.departureTime}:{}),
          ...(stop?.arrivalTime?{arrivalTime:stop.arrivalTime}:{}),
          departureLabel:cleanText(transit.localizedValues?.departureTime?.time?.text,32),
          arrivalLabel:cleanText(transit.localizedValues?.arrivalTime?.time?.text,32),
          departureZone:cleanText(transit.localizedValues?.departureTime?.timeZone,64),
          arrivalZone:cleanText(transit.localizedValues?.arrivalTime?.timeZone,64),
          stops:Number.isInteger(transit.stopCount)?transit.stopCount:undefined,
        });
      }else if(step.travelMode==="WALK"&&typeof step.distanceMeters==="number"
        &&Number.isFinite(step.distanceMeters)&&step.distanceMeters>=0){
        const distance=Math.round(step.distanceMeters);
        walkingMeters+=distance;
        const previous=steps[steps.length-1];
        if(previous?.kind==="walk")previous.distanceMeters=(previous.distanceMeters??0)+distance;
        else if(steps.length<80)steps.push({kind:"walk",distanceMeters:distance});
      }
    }
  }
  // Only a meaningful boarding or walking section becomes a visible route item.
  return {minutes:Math.max(1,Math.ceil(seconds/60)),distanceMeters:Math.round(meters),steps,
    transfers:Math.max(0,transitCount-1),walkingMeters};
}
const MODES:Record<RouteMode,string>={driving:"DRIVE",walking:"WALK",cycling:"BICYCLE",transit:"TRANSIT"};
const headers={"Cache-Control":"no-store, max-age=0","Content-Type":"application/json; charset=utf-8"};
const send=(status:number,body:object)=>Response.json(body,{status,headers});
const point=(p:unknown):p is Point=>{
  if(!p||typeof p!=="object")return false;
  const x=p as Record<string,unknown>;
  return typeof x.lat==="number"&&Number.isFinite(x.lat)&&Math.abs(x.lat)<=90
    &&typeof x.lon==="number"&&Number.isFinite(x.lon)&&Math.abs(x.lon)<=180;
};
function authorized(request:Request,secret:string){
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
  const a=Buffer.from(secret),b=Buffer.from(supplied);
  return a.length===b.length&&a.length>=20&&timingSafeEqual(a,b);
}
export function GET(){
  return send(200,{
    available:Boolean(routeBudgetConfigured()&&process.env.GOOGLE_MAPS_ROUTES_API_KEY
      &&/^[A-Za-z0-9_-]{20,}$/.test(process.env.DAYFRAME_ROUTES_ACCESS_TOKEN??"")),
    dailyLimit:ROUTES_DAILY_LIMIT,
    monthlyLimit:ROUTES_MONTHLY_LIMIT,
    budgetConfigured:routeBudgetConfigured(),
    ...(process.env.VERCEL_GIT_COMMIT_SHA?{deploymentCommit:process.env.VERCEL_GIT_COMMIT_SHA}:{}),
  });
}
export async function POST(request:Request){
  const apiKey=process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  const access=process.env.DAYFRAME_ROUTES_ACCESS_TOKEN;
  if(!apiKey||!access||!/^[A-Za-z0-9_-]{20,}$/.test(access)||!routeBudgetConfigured())
    return send(503,{error:"Google Maps je bezpečně vypnuté. Chybí centrální počítadlo limitů."});
  // The browser must supply a separately configured personal access secret.
  if(!authorized(request,access))return send(401,{error:"Neplatný přístupový kód k výpočtu tras."});
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return send(403,{error:"Neplatný původ požadavku."});
  if(!request.headers.get("content-type")?.startsWith("application/json"))
    return send(415,{error:"Požadavek musí být JSON."});
  if(Number(request.headers.get("content-length")??0)>4096)return send(413,{error:"Příliš velký požadavek."});
  let input:unknown;
  try{input=await request.json();}catch{return send(400,{error:"Neplatná data."});}
  if(!input||typeof input!=="object")return send(400,{error:"Neplatná data."});
  const data=input as Record<string,unknown>;
  if(!point(data.from)||!point(data.to)||typeof data.mode!=="string"||!Object.hasOwn(MODES,data.mode))
    return send(400,{error:"Vyber platný začátek, cíl a způsob dopravy."});
  const mode=data.mode as RouteMode;
  if(data.simpleRoute!==undefined&&typeof data.simpleRoute!=="boolean")
    return send(400,{error:"Neplatný typ zjednodušeného výpočtu."});
  const simpleRoute=data.simpleRoute===true;
  const preference=data.transitPreference??"fastest";
  if(typeof preference!=="string"||!["fastest","fewer_transfers","less_walking"].includes(preference)
    ||(mode!=="transit"&&preference!=="fastest"))
    return send(400,{error:"Neplatná preference trasy MHD."});
  // Explicit plans must be recent/future, never allow arbitrary Google requests into the past.
  let departureTime:string|undefined;
  if(data.departureTime!==undefined){
    if(typeof data.departureTime!=="string"||data.departureTime.length>35
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(data.departureTime))
      return send(400,{error:"Neplatný čas odjezdu."});
    const timestamp=new Date(data.departureTime).getTime();
    if(!Number.isFinite(timestamp)||timestamp<Date.now()-120000||timestamp>Date.now()+7*86400000)
      return send(400,{error:"Odjezd musí být od nynějška nejvýše sedm dní dopředu."});
    departureTime=new Date(timestamp).toISOString();
  }
  const waypoint=(p:Point)=>({location:{latLng:{latitude:p.lat,longitude:p.lon}}});
  const payload:Record<string,unknown>={
    origin:waypoint(data.from),destination:waypoint(data.to),
    travelMode:MODES[mode],languageCode:"cs",units:"METRIC",computeAlternativeRoutes:!simpleRoute,
  };
  // Explicit low-cost recovery for driving avoids the traffic-aware backend.
  // It is an average, time-independent estimate, NOT live or predictive traffic.
  if(departureTime&&!(simpleRoute&&mode==="driving"))payload.departureTime=departureTime;
  if(mode==="driving")payload.routingPreference=simpleRoute?"TRAFFIC_UNAWARE":"TRAFFIC_AWARE";
  if(mode==="transit"&&preference!=="fastest")
    payload.transitPreferences={routingPreference:TRANSIT_PREFERENCES[preference as Exclude<TransitPreference,"fastest">]};
  // Reserve before calling billable Google Routes. Each leg costs one reservation.
  // On Redis failures, never fall back to in-memory counters or unmetered Google calls.
  const reservation=await reserveRouteBudget();
  if(reservation.kind==="unavailable")
    return send(503,{error:"Počítadlo limitů je nedostupné. Google Maps zůstávají vypnuté; zadej čas ručně."});
  if(reservation.kind==="exhausted")
    return Response.json({
      error:"Bezplatný bezpečnostní limit Google Maps byl vyčerpán. Zadej cestu ručně.",
      dailyLimit:ROUTES_DAILY_LIMIT,monthlyLimit:ROUTES_MONTHLY_LIMIT,
    },{status:429,headers:{...headers,"Retry-After":String(reservation.retryAfterSeconds)}});
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    let reply:Response;
    try{reply=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
      method:"POST",signal:controller.signal,headers:{
        "Content-Type":"application/json","X-Goog-Api-Key":apiKey,
        "X-Goog-FieldMask":mode==="transit"
          ?"routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.transitDetails"
          :"routes.duration,routes.distanceMeters",
      },body:JSON.stringify(payload),
    });}finally{clearTimeout(timer);}
    if(!reply.ok){
      // Only return status-based, predefined messages: Google response bodies can contain
      // sensitive request context, therefore never send their raw text to the browser.
      const errors:Record<number,string>={
        400:"Google Routes odmítly parametry této trasy (400). Zkus jiný způsob dopravy nebo místa.",
        401:"Google Maps API klíč není platný nebo neprošel ověřením (401).",
        403:"Google Routes nepovolily použití API klíče (403). Zkontroluj aktivaci Routes API, omezení klíče a fakturaci v Google Cloud.",
        404:"Google Routes nenašly požadovanou službu (404).",
        429:"Google Maps omezily počet požadavků (429).",
        503:"Služba Google Routes je dočasně nedostupná (503).",
      };
      // Only expose protocol-level Google error codes (never the raw body or
      // developer message, which could contain input details).
      let providerCode:string|undefined;
      let providerReason:string|undefined;
      try{
        const raw=await reply.text();
        if(raw.length<12000){
          const parsed=JSON.parse(raw) as {
            error?:{status?:unknown;details?:Array<{reason?:unknown}>}
          };
          const status=parsed?.error?.status;
          if(typeof status==="string"&&/^[A-Z][A-Z_]{2,48}$/.test(status))
            providerCode=status;
          const details=parsed?.error?.details;
          if(Array.isArray(details)){
            const reason=details.find(x=>x&&typeof x.reason==="string")?.reason;
            if(typeof reason==="string"&&/^[A-Z][A-Z0-9_]{2,60}$/.test(reason))
              providerReason=reason;
          }
        }
      }catch{/* Preserve the provider HTTP status without exposing a raw body. */}
      console.error("[dayframe-routes] Google status",reply.status,"mode",mode,
        "providerCode",providerCode??"unreported","reason",providerReason??"unreported");
      return send(502,{error:errors[reply.status]??`Google Routes odmítly výpočet (HTTP ${reply.status}).`,
        providerStatus:reply.status,retryable:reply.status===503,
        ...(providerCode?{providerCode}:{}),
        ...(providerReason?{providerReason}:{})});
    }
    const response=await reply.json() as {routes?:GoogleRoute[]};
    const options=(Array.isArray(response.routes)?response.routes:[]).slice(0,4)
      .map(route=>routeOption(route,mode)).filter(option=>option!==null)
      .sort((a,b)=>{
        // Explicit MHD preferences rank the returned alternatives by that criterion.
        // A preference changes prioritization, never promises a globally optimal route.
        if(mode==="transit"&&preference==="fewer_transfers"&&a.transfers!==b.transfers)
          return a.transfers-b.transfers;
        if(mode==="transit"&&preference==="less_walking"&&a.walkingMeters!==b.walkingMeters)
          return a.walkingMeters-b.walkingMeters;
        return a.minutes-b.minutes||a.distanceMeters-b.distanceMeters;
      });
    if(!options.length)
      return send(422,{error:"Google Maps pro tato místa nevrátily platnou trasu."});
    const fastest=options[0];
    return send(200,{minutes:fastest.minutes,distanceMeters:fastest.distanceMeters,
      options,source:"Google Maps",trafficAware:mode==="driving"&&!simpleRoute});
  }catch{return send(502,{error:"Google Maps nyní nejsou dostupné. Použij ruční odhad."});}
}

/** Vercel's generic Vite/Other preset supports the default Web Request handler.
 * Keep GET/POST as named exports for Node regression tests and framework adapters.
 */
export default {
  async fetch(request:Request):Promise<Response>{
    if(request.method==="GET")return GET();
    if(request.method==="POST")return POST(request);
    return Response.json({error:"Nepodporovaná HTTP metoda."},{
      status:405,headers:{...headers,Allow:"GET, POST"},
    });
  },
};
