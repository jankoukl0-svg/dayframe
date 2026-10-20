export const TRAVEL_STORAGE_KEY="dayframe-travel-v1";
export const TRAVEL_SYNC_EVENT="dayframe-travel-sync";
export type TravelMode="driving"|"walking"|"cycling"|"transit";
export const TRAVEL_MODE_LABELS:Record<TravelMode,string>={driving:"Autem",walking:"Pěšky",cycling:"Na kole",transit:"MHD / vlak"};
const isTravelMode=(value:unknown):value is TravelMode=>["driving","walking","cycling","transit"].includes(String(value));
export type TravelPoint={lat:number;lon:number;label:string};
/** Each leg arrives at its via point, except the final leg which ends at the event location. */
export type TravelLeg={mode:TravelMode;minutes:number;via?:TravelPoint};
/** Geometry of a reverse-only combined route, without invented outbound times. */
export type TravelPathLeg={mode:TravelMode;via?:TravelPoint};
export type TravelBlock={place:TravelPoint;mode:TravelMode;bufferMinutes:number;typicalMinutes?:number;legs?:TravelLeg[];title:string;date:string;start:string;
  /** Calendar-only duration from the explicitly selected Google route, or the saved manual estimate. */
  calendarMinutes?:number;calendarVerified?:boolean;
  /** Defaults to true in older records; false means only reserve the return journey. */
  outboundEnabled?:boolean;
  /** In outbound-disabled plans, preserve mixed-mode geometry without invented leg minutes. */
  pathLegs?:TravelPathLeg[];
  returnHome?:boolean;returnMinutes?:number;returnVerified?:boolean;};
export function travelDuration(trip:Pick<TravelBlock,"legs"|"typicalMinutes">):number|undefined{
  return trip.legs?.length?trip.legs.reduce((minutes,leg)=>minutes+leg.minutes,0):trip.typicalMinutes;
}
export function travelSegments(trip:Pick<TravelBlock,"place"|"mode"|"legs"|"typicalMinutes">,origin?:TravelPoint){
  if(!trip.legs?.length)return [{mode:trip.mode,minutes:trip.typicalMinutes,from:origin,to:trip.place}];
  return trip.legs.map((leg,index)=>({
    mode:leg.mode,minutes:leg.minutes,
    from:index===0?origin:trip.legs![index-1].via,
    to:index===trip.legs!.length-1?trip.place:leg.via!,
  }));
}
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
      if(!validPoint(v.place)||!isTravelMode(v.mode)
        ||!Number.isInteger(v.bufferMinutes)||v.bufferMinutes<0||v.bufferMinutes>180
        ||(v.typicalMinutes!==undefined&&(!Number.isInteger(v.typicalMinutes)||v.typicalMinutes<1||v.typicalMinutes>1440))
        ||(v.calendarMinutes!==undefined&&(!Number.isInteger(v.calendarMinutes)||v.calendarMinutes<1||v.calendarMinutes>1440))
        ||(v.calendarVerified!==undefined&&typeof v.calendarVerified!=="boolean")
        ||(v.outboundEnabled!==undefined&&typeof v.outboundEnabled!=="boolean")
        ||(v.outboundEnabled===false&&(!v.returnHome||v.returnMinutes===undefined
          ||v.calendarMinutes!==undefined||v.typicalMinutes!==undefined||v.legs!==undefined))
        ||(v.returnHome!==undefined&&typeof v.returnHome!=="boolean")
        ||(v.returnVerified!==undefined&&typeof v.returnVerified!=="boolean")
        ||(v.returnMinutes!==undefined&&(!Number.isInteger(v.returnMinutes)||v.returnMinutes<1||v.returnMinutes>1440))
        ||(v.returnHome&&v.returnMinutes===undefined)
        ||typeof v.title!=="string"||v.title.length>300||!validDate(v.date)||!(v.start===""||validTime(v.start)))throw Error("invalid trip");
      if(v.pathLegs!==undefined){
        if(v.outboundEnabled!==false||v.legs!==undefined||!Array.isArray(v.pathLegs)
          ||v.pathLegs.length<2||v.pathLegs.length>6)throw Error("invalid return-only path");
        for(const [index,leg] of v.pathLegs.entries()){
          if(!leg||typeof leg!=="object"||!isTravelMode(leg.mode)
            ||(index<v.pathLegs.length-1?!validPoint(leg.via):leg.via!==undefined))
            throw Error("invalid return-only stage");
        }
        if(v.mode!==v.pathLegs[0].mode)throw Error("invalid return-only starting mode");
      }
      if(v.legs!==undefined){
        if(!Array.isArray(v.legs)||v.legs.length<2||v.legs.length>6)throw Error("invalid route length");
        let total=0;
        for(const [index,leg] of v.legs.entries()){
          if(!leg||typeof leg!=="object"||!isTravelMode(leg.mode)
            ||!Number.isInteger(leg.minutes)||leg.minutes<1||leg.minutes>1440
            ||(index<v.legs.length-1?!validPoint(leg.via):leg.via!==undefined))
            throw Error("invalid route stage");
          total+=leg.minutes;
        }
        if(total>1440||(v.typicalMinutes!==undefined&&v.typicalMinutes!==total))
          throw Error("invalid route total");
      }
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
/** Pure calendar projection: travel is not a study/work task and is never
 *  written into calendar plans. Always use the live event date/time, not the
 *  stale travel snapshot after a user edits or moves an appointment.
 */
export type TravelCalendarEvent={key:string;date:string;start:string;end:string;title:string};
export type TravelReservation={id:string;key:string;date:string;title:string;
  direction:"outbound"|"return";start:number;end:number;duration:number;
  estimated:boolean;bufferMinutes:number;outsideCalendar:boolean;};
const planningClock=(time:string):number=>{
  if(!validTime(time))return NaN;
  const [hour,minute]=time.split(":").map(Number);
  return (hour<8?hour+24:hour)*60+minute;
};
export function travelReservationsForDay(store:TravelStore,date:string,
  events:TravelCalendarEvent[]):TravelReservation[]{
  const result:TravelReservation[]=[];
  for(const event of events){
    const trip=store.blocks[event.key];
    if(!trip||!event.start||!event.end||event.date!==date)continue;
    const eventStart=planningClock(event.start),eventEnd=planningClock(event.end);
    if(!Number.isFinite(eventStart)||!Number.isFinite(eventEnd)||eventEnd<=eventStart)continue;
    if(trip.outboundEnabled!==false){
      const duration=trip.calendarMinutes??travelDuration(trip);
      if(Number.isInteger(duration)&&duration!>0&&duration!<=1440){
        const outboundStart=eventStart-duration!-trip.bufferMinutes;
        result.push({id:event.key+":outbound",key:event.key,date,title:event.title,
          direction:"outbound",start:outboundStart,end:eventStart,
          duration:duration!+trip.bufferMinutes,estimated:trip.calendarVerified!==true,
          bufferMinutes:trip.bufferMinutes,outsideCalendar:outboundStart<480||eventStart>1560});
      }
    }
    if(trip.returnHome&&Number.isInteger(trip.returnMinutes)&&trip.returnMinutes!>0){
      const returnEnd=eventEnd+trip.returnMinutes!;
      result.push({id:event.key+":return",key:event.key,date,title:event.title,
        direction:"return",start:eventEnd,end:returnEnd,duration:trip.returnMinutes!,
        estimated:!trip.returnVerified,bufferMinutes:0,
        outsideCalendar:eventEnd<480||returnEnd>1560});
    }
  }
  return result;
}
/** Backlog tasks still exist, even without a scheduled time in the Week grid. */
export function liveTravelTaskKeys(
  plans:Record<string,Array<{id:string}>>,
  backlog:Array<{id:string}>
):Set<string>{
  return new Set([...Object.values(plans).flat(),...backlog]
    .map(task=>travelBlockKey("task",task.id)));
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
  u.searchParams.set("travelmode",mode==="cycling"?"bicycling":mode);
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
    // A return-only plan must never generate a false "leave home" reminder.
    if(trip.outboundEnabled===false)return [];
    const task=key.startsWith("task:");
    const actual=task?current.get(key):additional.get(key);
    // Never advise travel for a deleted, hidden, deactivated or completed occurrence.
    if(!actual||actual.completed)return [];
    const date=actual.date,time=actual.start,title=actual.title;
    const when=time?eventStart(date,time):null;
    if(!when)return [];
    const minutesUntil=(when.getTime()-now.getTime())/60000;
    // Prioritize the time the user must ACT, not merely the appointment start.
    // When no duration is known, use the appointment start as a neutral fallback.
    const total=travelDuration(trip);
    const departureAt=total===undefined?when
      :new Date(when.getTime()-(total+trip.bufferMinutes)*60_000);
    const minutesUntilDeparture=(departureAt.getTime()-now.getTime())/60_000;
    if(minutesUntil < -15||minutesUntilDeparture>18*60)return [];
    return [{key,...trip,title,date,start:time,when,minutesUntil,departureAt,minutesUntilDeparture}];
  }).sort((a,b)=>a.departureAt.getTime()-b.departureAt.getTime()
    ||a.when.getTime()-b.when.getTime());
}
