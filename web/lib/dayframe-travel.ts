export const TRAVEL_STORAGE_KEY="dayframe-travel-v1";
export const TRAVEL_SYNC_EVENT="dayframe-travel-sync";
export type TravelMode="driving"|"walking"|"cycling";
export type TravelPoint={lat:number;lon:number;label:string};
export type TravelBlock={place:TravelPoint;mode:TravelMode;bufferMinutes:number;typicalMinutes?:number;title:string;date:string;start:string};
export type TravelStore={version:1;origin?:TravelPoint;blocks:Record<string,TravelBlock>};
export const emptyTravelStore=():TravelStore=>({version:1,blocks:{}});
export const travelBlockKey=(kind:"task"|"gym"|"care",id:string,date?:string)=>
  kind==="care"?kind+":"+date+":"+id:kind+":"+id;
function validPoint(p:unknown):p is TravelPoint{
  if(!p||typeof p!=="object")return false;
  const x=p as Record<string,unknown>;
  return typeof x.lat==="number"&&Number.isFinite(x.lat)&&Math.abs(x.lat)<=90
    &&typeof x.lon==="number"&&Number.isFinite(x.lon)&&Math.abs(x.lon)<=180
    &&typeof x.label==="string"&&!!x.label.trim()&&x.label.length<=300;
}
const validTime=(s:unknown):s is string=>typeof s==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
const validDate=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s);
export function parseTravelStore(value:string|null):{store:TravelStore;blocked:boolean}{
  if(!value)return {store:emptyTravelStore(),blocked:false};
  try{
    const x=JSON.parse(value) as Partial<TravelStore>;
    if(x.version!==1||!x.blocks||typeof x.blocks!=="object"||Array.isArray(x.blocks)
      ||(x.origin!==undefined&&!validPoint(x.origin)))throw Error("invalid travel data");
    const blocks:Record<string,TravelBlock>={};
    for(const [id,entry] of Object.entries(x.blocks)){
      if(!id||id.length>220||!entry||typeof entry!=="object")throw Error("invalid block");
      const v=entry as TravelBlock;
      if(!validPoint(v.place)||!["driving","walking","cycling"].includes(v.mode)
        ||!Number.isInteger(v.bufferMinutes)||v.bufferMinutes<0||v.bufferMinutes>180
        ||(v.typicalMinutes!==undefined&&(!Number.isInteger(v.typicalMinutes)||v.typicalMinutes<1||v.typicalMinutes>1440))
        ||typeof v.title!=="string"||v.title.length>300||!validDate(v.date)||!validTime(v.start))throw Error("invalid trip");
      blocks[id]=v;
    }
    return {store:{version:1,origin:x.origin,blocks},blocked:false};
  }catch{return {store:emptyTravelStore(),blocked:true};}
}
export function readTravelStore(){
  if(typeof window==="undefined")return {store:emptyTravelStore(),blocked:false};
  try{return parseTravelStore(window.localStorage.getItem(TRAVEL_STORAGE_KEY));}
  catch{return {store:emptyTravelStore(),blocked:true};}
}
export function saveTravelStore(store:TravelStore){
  if(typeof window==="undefined")return false;
  try{
    if(parseTravelStore(JSON.stringify(store)).blocked)return false;
    window.localStorage.setItem(TRAVEL_STORAGE_KEY,JSON.stringify(store));
    window.dispatchEvent(new Event(TRAVEL_SYNC_EVENT));
    return true;
  }catch{return false;}
}
/** Remove only entries whose source block was actually removed, leaving the origin unchanged. */
export function removeTravelBlocksWhere(predicate:(key:string,block:TravelBlock)=>boolean):boolean {
  const result=readTravelStore();
  if(result.blocked)return false;
  const blocks={...result.store.blocks};
  let changed=false;
  for(const [key,block] of Object.entries(blocks)){
    if(predicate(key,block)){delete blocks[key];changed=true;}
  }
  return !changed || saveTravelStore({...result.store,blocks});
}
/** Pure helper for a source-state change; only removed task IDs are deleted. */
export function removeTravelForDeletedTasks(before:Array<{id:string}>,after:Array<{id:string}>):boolean {
  const previous=new Set(before.map(task=>travelBlockKey("task",task.id)));
  const current=new Set(after.map(task=>travelBlockKey("task",task.id)));
  return removeTravelBlocksWhere(key=>previous.has(key)&&!current.has(key));
}
export function travelDirectionsUrl(origin:TravelPoint|undefined,destination:TravelPoint,mode:TravelMode="driving"){
  const u=new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api","1");u.searchParams.set("destination",destination.lat+","+destination.lon);
  if(origin)u.searchParams.set("origin",origin.lat+","+origin.lon);
  u.searchParams.set("travelmode",mode);
  return u.toString();
}
export function eventStart(date:string,time:string):Date|null{
  if(!validDate(date)||!validTime(time))return null;
  const [h,m]=time.split(":").map(Number);
  const d=new Date(date+"T12:00:00");
  if(Number.isNaN(d.getTime())||d.getFullYear()!==Number(date.slice(0,4)))return null;
  d.setHours(h,m,0,0);
  if(h<2)d.setDate(d.getDate()+1);
  return d;
}
export function upcomingTravelTrips(store:TravelStore,now:Date,
  liveTasks:Array<{id:string;date:string;start?:string;title:string;completed:boolean}>=[],
  liveOther:Array<{key:string;date:string;start?:string;title:string;completed:boolean}>=[]){
  const current=new Map(liveTasks.map(t=>[travelBlockKey("task",t.id),t]));
  const additional=new Map(liveOther.map(t=>[t.key,t]));
  return Object.entries(store.blocks).flatMap(([key,trip])=>{
    const task=key.startsWith("task:");
    const actual=task?current.get(key):additional.get(key);
    // Never advise travel for a deleted, hidden, deactivated or completed occurrence.
    if(!actual||actual.completed)return [];
    const date=actual.date,time=actual.start,title=actual.title;
    const when=time?eventStart(date,time):null;
    if(!when)return [];
    const minutesUntil=(when.getTime()-now.getTime())/60000;
    if(minutesUntil < -15||minutesUntil>18*60)return [];
    return [{key,...trip,title,date,start:time,when,minutesUntil}];
  }).sort((a,b)=>a.when.getTime()-b.when.getTime());
}
