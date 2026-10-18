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
  const waypoint=(p:Point)=>({location:{latLng:{latitude:p.lat,longitude:p.lon}}});
  const payload:Record<string,unknown>={
    origin:waypoint(data.from),destination:waypoint(data.to),
    travelMode:MODES[mode],languageCode:"cs",units:"METRIC",computeAlternativeRoutes:false,
  };
  if(mode==="driving")payload.routingPreference="TRAFFIC_AWARE";
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
        "X-Goog-FieldMask":"routes.duration,routes.distanceMeters",
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
      console.error("[dayframe-routes] Google status",reply.status,"mode",mode);
      return send(502,{error:errors[reply.status]??`Google Routes odmítly výpočet (HTTP ${reply.status}).`});
    }
    const response=await reply.json() as {routes?:Array<{duration?:string;distanceMeters?:number}>};
    const route=response.routes?.[0],seconds=Number(route?.duration?.replace(/s$/,""));
    const distance=route?.distanceMeters;
    if(!Number.isFinite(seconds)||seconds<0||seconds>86400||typeof distance!=="number"||!Number.isFinite(distance)||distance<0)
      return send(422,{error:"Google Maps pro tato místa nevrátily platnou trasu."});
    return send(200,{minutes:Math.max(1,Math.ceil(seconds/60)),distanceMeters:Math.round(distance),source:"Google Maps",trafficAware:mode==="driving"});
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
