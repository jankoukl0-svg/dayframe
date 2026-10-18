/** Server-only Google Maps Routes proxy. Never place the Google API key in browser JS.
 * Disabled until both secrets are configured on Vercel. No response caching.
 * Keep a separate Google Cloud quota and API restriction to bound usage costs.
 */
import {timingSafeEqual} from "node:crypto";
import {ROUTES_DAILY_LIMIT,ROUTES_MONTHLY_LIMIT,routeBudgetConfigured,reserveRouteBudget} from "../lib/server-route-budget.ts";

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
    if(!reply.ok)return send(502,{error:reply.status===429?"Limit Google Maps API byl vyčerpán.":"Google Maps nyní trasu nedokázaly vypočítat."});
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
