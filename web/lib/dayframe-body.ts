import { addDaysKey } from "./dayframe-calendar.ts";

export const BODY_STORAGE_KEY = "dayframe-body-v1";
export const BODY_SYNC_EVENT = "dayframe-body-sync";

export type BodyMetric = "weightKg" | "waistCm" | "chestCm" | "hipsCm" | "armCm" | "thighCm" | "neckCm" | "bodyFatPct";
export type BodyMeasurements = Record<BodyMetric, number | null>;
export const BODY_METRICS: ReadonlyArray<{key:BodyMetric;name:string;unit:string;min:number;max:number}> = [
  {key:"weightKg",name:"Hmotnost",unit:"kg",min:1,max:700},
  {key:"waistCm",name:"Pas",unit:"cm",min:10,max:400},
  {key:"chestCm",name:"Hrudník",unit:"cm",min:10,max:400},
  {key:"hipsCm",name:"Boky",unit:"cm",min:10,max:400},
  {key:"armCm",name:"Paže",unit:"cm",min:5,max:150},
  {key:"thighCm",name:"Stehno",unit:"cm",min:5,max:200},
  {key:"neckCm",name:"Krk",unit:"cm",min:5,max:150},
  {key:"bodyFatPct",name:"Tělesný tuk",unit:"%",min:0,max:100},
];
export type BodyEntry = {
  id:string;
  date:string;
  metrics:BodyMeasurements;
  note:string;
  createdAt:string;
  updatedAt:string;
};
export type BodyGoal = { id:string; metric:BodyMetric; target:number; startValue:number|null; createdDate:string; deadline:string|null; active:boolean };
export type BodyPhoto = { id:string; date:string; mimeType:string; caption:string; createdAt:string };
export type BodySchedule = { frequency:"off"|"daily"|"weekly"; weekday:number };
export type BodyStore = {version:1; entries:BodyEntry[]; goals:BodyGoal[]; photos:BodyPhoto[]; schedule:BodySchedule};

export function blankMeasurements():BodyMeasurements {
  return {weightKg:null,waistCm:null,chestCm:null,hipsCm:null,armCm:null,thighCm:null,neckCm:null,bodyFatPct:null};
}
export function emptyBodyStore():BodyStore {
  return {version:1,entries:[],goals:[],photos:[],schedule:{frequency:"off",weekday:1}};
}
export function validBodyDate(date:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const d=new Date(date+"T12:00:00");
  return !Number.isNaN(d.getTime())&&d.getFullYear()===Number(date.slice(0,4))
    && d.getMonth()+1===Number(date.slice(5,7))&&d.getDate()===Number(date.slice(8,10));
}
const string=(v:unknown,max=200)=>typeof v==="string"&&v.length<=max;
const number=(v:unknown,min:number,max:number)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max;
const distinct=(ids:string[])=>new Set(ids).size===ids.length;
export function validBodyMeasurements(m:unknown):m is BodyMeasurements {
  if(!m||typeof m!=="object"||Array.isArray(m))return false;
  const obj=m as Record<string,unknown>;
  return BODY_METRICS.every(x=>Object.hasOwn(obj,x.key)&&(obj[x.key]===null||number(obj[x.key],x.min,x.max)));
}
export function validBodyStore(s:unknown):s is BodyStore {
  if(!s||typeof s!=="object")return false;
  const b=s as BodyStore;
  if(b.version!==1||!Array.isArray(b.entries)||!Array.isArray(b.goals)||!Array.isArray(b.photos)
    ||!b.schedule||!["off","daily","weekly"].includes(b.schedule.frequency)
    ||!Number.isInteger(b.schedule.weekday)||b.schedule.weekday<0||b.schedule.weekday>6)return false;
  if(!distinct(b.entries.map(x=>x?.id))||!distinct(b.entries.map(x=>x?.date))
    ||!distinct(b.goals.map(x=>x?.id))||!distinct(b.photos.map(x=>x?.id)))return false;
  for(const e of b.entries) if(!e||!string(e.id,100)||!e.id||!validBodyDate(e.date)
    ||!validBodyMeasurements(e.metrics)||!BODY_METRICS.some(m=>e.metrics[m.key]!==null)
    ||!string(e.note,1500)||!string(e.createdAt,50)||!string(e.updatedAt,50))return false;
  for(const g of b.goals) {
    const m=BODY_METRICS.find(m=>m.key===g?.metric);
    if(!g||!string(g.id,100)||!g.id||!m||!number(g.target,m.min,m.max)
      ||!(g.startValue===null||number(g.startValue,m.min,m.max))||!validBodyDate(g.createdDate)
      ||!(g.deadline===null||validBodyDate(g.deadline))||typeof g.active!=="boolean")return false;
  }
  for(const p of b.photos) if(!p||!string(p.id,100)||!p.id||!validBodyDate(p.date)
    ||!["image/jpeg","image/png","image/webp"].includes(p.mimeType)
    ||!string(p.caption,300)||!string(p.createdAt,50))return false;
  return true;
}
export function parseBodyStore(raw:string|null):{store:BodyStore;blocked:boolean} {
  if(raw===null)return {store:emptyBodyStore(),blocked:false};
  try{
    const value:unknown=JSON.parse(raw);
    if(!validBodyStore(value))return {store:emptyBodyStore(),blocked:true};
    return {store:value,blocked:false};
  }catch{return {store:emptyBodyStore(),blocked:true};}
}
export function readBodyStore():{store:BodyStore;blocked:boolean} {
  if(typeof window==="undefined")return {store:emptyBodyStore(),blocked:false};
  try{return parseBodyStore(window.localStorage.getItem(BODY_STORAGE_KEY));}
  catch{return {store:emptyBodyStore(),blocked:true};}
}
export function saveBodyStore(store:BodyStore) {
  if(typeof window==="undefined"||!validBodyStore(store))return false;
  try{window.localStorage.setItem(BODY_STORAGE_KEY,JSON.stringify(store));
    window.dispatchEvent(new Event(BODY_SYNC_EVENT));return true;}
  catch{return false;}
}
export function uid(prefix:string):string{return prefix+"-"+crypto.randomUUID();}
export function bodyEntryForDate(store:BodyStore,date:string) {return store.entries.find(x=>x.date===date)??null;}
export function latestBodyEntry(store:BodyStore,date:string) {
  return store.entries.filter(x=>x.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0]??null;
}
export function latestMetric(store:BodyStore,metric:BodyMetric,date:string) {
  return store.entries.filter(e=>e.date<=date&&e.metrics[metric]!==null)
    .sort((a,b)=>b.date.localeCompare(a.date))[0]?.metrics[metric]??null;
}
export function bodyCheckInDue(store:BodyStore,date:string) {
  if(!validBodyDate(date))return false;
  return store.schedule.frequency==="daily" || (store.schedule.frequency==="weekly"
    && new Date(date+"T12:00:00").getDay()===store.schedule.weekday);
}
export function bodyCheckInStatus(store:BodyStore,date:string) {
  return {due:bodyCheckInDue(store,date),complete:!!bodyEntryForDate(store,date)};
}
export function upsertBodyEntry(store:BodyStore,entry:BodyEntry):BodyStore {
  if(!validBodyDate(entry.date)||!validBodyMeasurements(entry.metrics)
    ||!BODY_METRICS.some(m=>entry.metrics[m.key]!==null)||!string(entry.note,1500))return store;
  const old=bodyEntryForDate(store,entry.date);
  const next={...entry,id:old?.id??entry.id,createdAt:old?.createdAt??entry.createdAt};
  return {...store,entries:[...store.entries.filter(x=>x.date!==entry.date),next]
    .sort((a,b)=>a.date.localeCompare(b.date))};
}
export function bodySeries(store:BodyStore,metric:BodyMetric,until:string,windowDays:number|null) {
  const start=windowDays===null?null:addDaysKey(until,-windowDays+1);
  return store.entries.filter(e=>e.date<=until&&(!start||e.date>=start)&&e.metrics[metric]!==null)
    .sort((a,b)=>a.date.localeCompare(b.date))
    .map(e=>({date:e.date,value:e.metrics[metric] as number}));
}
export function bodyChange(store:BodyStore,metric:BodyMetric,date:string) {
  const readings=bodySeries(store,metric,date,null);
  if(readings.length<2)return null;
  return Number((readings.at(-1)!.value-readings[0].value).toFixed(2));
}
export function bodyGoalProgress(store:BodyStore,goal:BodyGoal,date:string) {
  const current=latestMetric(store,goal.metric,date);
  const origin=goal.startValue;
  if(current===null)return {current:null,percent:null,reached:false};
  const reached=origin===null ? Math.abs(current-goal.target)<0.001 :
    origin<goal.target?current>=goal.target:origin>goal.target?current<=goal.target:Math.abs(current-goal.target)<0.001;
  const progress=origin===null?null:origin===goal.target?(reached?100:0):
    Math.round(Math.max(0,Math.min(100,((current-origin)/(goal.target-origin))*100)));
  return {current,percent:progress,reached};
}
export function createBodyGoal(store:BodyStore,metric:BodyMetric,target:number,date:string,deadline:string|null):BodyStore{
  const m=BODY_METRICS.find(m=>m.key===metric);
  if(!m||!number(target,m.min,m.max)||!validBodyDate(date)||deadline!==null&&(!validBodyDate(deadline)||deadline<date))return store;
  return {...store,goals:[...store.goals,{id:uid("goal"),metric,target,startValue:latestMetric(store,metric,date),
    createdDate:date,deadline,active:true}]};
}
