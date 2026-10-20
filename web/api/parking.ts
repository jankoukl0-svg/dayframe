/** Nearby car parking discovery from OpenStreetMap, independent of billable Google Routes.
 * Public Overpass is a best-effort, low-volume data source, NOT a guaranteed
 * parking inventory or live tariff service. Keep a bounded query and cache.
 */
type Point={lat:number;lon:number};
type Element={type?:string;id?:number;lat?:number;lon?:number;
  center?:Point;tags?:Record<string,string>};
type ParkingPrice={kind:"free"|"hourly"|"paid"|"unknown";label:string;
  amount?:number;currency?:string};
type Parking={id:string;name:string;lat:number;lon:number;distanceMeters:number;
  kind:string;access:string;capacity?:number;price:ParkingPrice;parkRide:boolean;
  osmUrl:string;website?:string};
const headers={"Content-Type":"application/json; charset=utf-8"};
const cache=new Map<string,{expires:number;items:Parking[]}>();
const inFlight=new Map<string,Promise<Parking[]>>();
const VALID_RADII=new Set([1800,4000]);
const OSM_OVERPASS="https://overpass-api.de/api/interpreter";

const meters=(a:Point,b:Point)=>{
  const rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
function price(tags:Record<string,string>):ParkingPrice{
  // Dynamic, customer-only and conditional tariffs cannot be safely inferred.
  const charge=(tags.charge??"").trim();
  const conditional=Boolean(tags["fee:conditional"]||tags["charge:conditional"]);
  if(charge&&!conditional){
    const match=/^(\d+(?:[.,]\d+)?)\s*(CZK|EUR|USD|GBP|CHF|PLN)\s*\/\s*(?:hour|h|1\s*h|60\s*min)$/i.exec(charge);
    if(match){
      const amount=Number(match[1].replace(",","."));
      if(Number.isFinite(amount)&&amount>=0&&amount<=100000)
        return {kind:"hourly",label:amount+" "+match[2].toUpperCase()+"/hod",amount,currency:match[2].toUpperCase()};
    }
  }
  if(tags.fee==="no"&&!charge&&!conditional)return {kind:"free",label:"Zdarma dle OSM"};
  if(tags.fee==="yes"||charge||conditional)return {kind:"paid",label:"Placené · sazba neznámá"};
  return {kind:"unknown",label:"Cena neuvedena"};
}
function parseElements(json:unknown,center:Point):Parking[]{
  const raw=(json&&typeof json==="object"&&Array.isArray((json as {elements?:unknown}).elements))
    ?(json as {elements:unknown[]}).elements:[];
  const result:Parking[]=[];
  for(const item of raw.slice(0,450)){
    if(!item||typeof item!=="object")continue;
    const el=item as Element,tags=el.tags??{};
    const lat=el.lat??el.center?.lat,lon=el.lon??el.center?.lon;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat!)>90||Math.abs(lon!)>180)continue;
    if(!["node","way","relation"].includes(el.type??"")||
      !Number.isSafeInteger(el.id)||Number(el.id)<=0)continue;
    const access=tags.access??"unknown";
    if(["private","no","permit","delivery","agricultural","forestry"].includes(access)
      ||tags.parking==="private"||tags["motorcar"]==="no")continue;
    const name=(tags.name||tags.operator||"Parkoviště").trim().slice(0,120);
    const p={lat:lat!,lon:lon!};
    const kind=tags.parking??"surface";
    const capacity=Number(tags.capacity);
    const url=typeof tags.website==="string"&&/^https:\/\/[^\s]+$/i.test(tags.website)&&tags.website.length<250
      ?tags.website:undefined;
    result.push({id:el.type+":"+el.id,name,lat:lat!,lon:lon!,
      distanceMeters:Math.round(meters(center,p)),kind:kind.slice(0,40),
      access:access.slice(0,30),capacity:Number.isInteger(capacity)&&capacity>0&&capacity<100000?capacity:undefined,
      price:price(tags),parkRide:tags.park_ride!==undefined&&tags.park_ride!=="no",
      osmUrl:"https://www.openstreetmap.org/"+el.type+"/"+el.id,
      ...(url?{website:url}:{})});
  }
  return result.sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,28);
}
export async function GET(request:Request):Promise<Response>{
  const u=new URL(request.url);
  const latStr=u.searchParams.get("lat"),lonStr=u.searchParams.get("lon"),radiusStr=u.searchParams.get("radius")??"1800";
  const lat=Number(latStr),lon=Number(lonStr),radius=Number(radiusStr);
  if(latStr===null||lonStr===null||!latStr.trim()||!lonStr.trim()
    ||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180
    ||!VALID_RADII.has(radius))
    return Response.json({error:"Neplatné souřadnice nebo okruh hledání."},{status:400,headers:{"Cache-Control":"no-store",...headers}});
  // Round to ~100m for shared cache, but keep searched radius and distance honest.
  const center={lat:Number(lat.toFixed(3)),lon:Number(lon.toFixed(3))};
  const key=center.lat+":"+center.lon+":"+radius;
  const cached=cache.get(key),now=Date.now();
  if(cached&&cached.expires>now)
    return Response.json({items:cached.items,source:"OpenStreetMap",cached:true},
      {headers:{"Cache-Control":"public, max-age=0, s-maxage=1800",...headers}});
  if(cache.size>120)for(const [k,v] of cache){if(v.expires<=now||cache.size>100)cache.delete(k);}
  let pending=inFlight.get(key);
  if(!pending){
    if(inFlight.size>=2)
      return Response.json({error:"Vyhledávání parkování je právě vytížené. Zkus to znovu."},
        {status:503,headers:{"Cache-Control":"no-store",...headers}});
    pending=(async()=>{
      const query=`[out:json][timeout:8];nwr["amenity"="parking"](around:${radius},${center.lat},${center.lon});out center 400;`;
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),11000);
      try{
        const reply=await fetch(OSM_OVERPASS,{
          method:"POST",signal:controller.signal,
          headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent":"DayframeTravel/1.0 (OpenStreetMap parking discovery)"},
          body:new URLSearchParams({data:query}).toString(),
        });
        if(!reply.ok)throw Error("Overpass unavailable");
        const data=await reply.json();
        const items=parseElements(data,center);
        cache.set(key,{expires:Date.now()+30*60000,items});
        return items;
      }finally{clearTimeout(timer);}
    })();
    inFlight.set(key,pending);
    void pending.finally(()=>inFlight.delete(key)).catch(()=>{});
  }
  try{
    const items=await pending;
    return Response.json({items,source:"OpenStreetMap",cached:false},
      {headers:{"Cache-Control":"public, max-age=0, s-maxage=1800",...headers}});
  }catch{
    return Response.json({error:"OpenStreetMap parkoviště teď nevrátil. Vyber místo ručně na mapě."},
      {status:503,headers:{"Cache-Control":"no-store",...headers}});
  }
}
export default {async fetch(request:Request):Promise<Response>{
  if(request.method==="GET")return GET(request);
  return Response.json({error:"Nepodporovaná HTTP metoda."},
    {status:405,headers:{"Allow":"GET",...headers}});
}};
