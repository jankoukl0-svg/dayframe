/** Vercel server-only budget for billable Google Routes requests.
 * Two limits are reserved atomically in Upstash Redis (UTC calendar windows).
 * Fail closed on missing credentials, Redis outage, malformed response, or exhausted budget.
 * Requires a DEDICATED free Upstash Redis database. Never use process-memory counters.
 */
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
